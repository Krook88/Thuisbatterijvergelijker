#!/usr/bin/env node
/**
 * Dagelijkse prijsupdate voor data/batterijen.json.
 *
 * Voor elk product met een adres probeert dit script de actuele prijs van de
 * winkelpagina te lezen. Hoe dat lezen gaat staat in scripts/prijs-uitlezen.mjs,
 * gedeeld met de andere twee sites; hier staat wat er met de uitkomst gebeurt.
 *
 * "Elk product met een adres" is sinds kort ruimer dan "elke aanbieding". Tien
 * van de eenenveertig batterijen hebben geen aanbieding maar een richtprijs, en
 * die werden nooit bezocht: het script liep alleen langs aanbiedingen. Hun
 * prijsdatum stond dus stil op de dag dat iemand ze met de hand invulde. Zeven
 * van de twaalf prijzen die een maand achterliepen waren van dat soort.
 *
 * Staat er een prijs_bron_url bij zo'n richtprijs, dan gaat die nu gewoon mee
 * in de dagelijkse ronde. Staat er niets, dan meldt het script dat als wat het
 * is: een prijs zonder adres, die geen script ooit kan bevestigen.
 *
 * Veiligheidsregels:
 *   - Een nieuwe prijs wordt alleen overgenomen als hij dicht genoeg bij de
 *     vorige ligt (75% tot 125%); grotere sprongen komen in de samenvatting
 *     van de run te staan voor een menselijke controle.
 *   - Omdat dit script elke dag precies de winkelpagina's bezoekt waar de
 *     "Bekijk aanbieding"-knoppen naartoe wijzen, meldt het meteen welke
 *     daarvan verdwenen zijn. Een aparte controle daarvoor zou dezelfde
 *     winkels een tweede keer belasten.
 *   - Bij fouten of onduidelijke pagina's blijft de oude prijs staan;
 *     alleen de datum "prijs_gecontroleerd" wordt dan NIET bijgewerkt,
 *     zodat zichtbaar blijft hoe vers elke prijs is.
 *   - Het script faalt nooit hard op één winkel: fouten worden gelogd
 *     en de rest gaat door.
 */

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { haalPagina, prijsUitPagina, controleerbaar } from "./prijs-uitlezen.mjs";
import { vergelijk, leesBekend, schrijfBekend, meldAandacht } from "./prijs-aandacht.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PAD = resolve(__dirname, "../data/batterijen.json");

const VANDAAG = new Date().toISOString().slice(0, 10);
// Alleen kijken, niets wegschrijven. Voor als je wilt zien waarom een winkel
// niet meewerkt zonder de gegevens aan te raken.
const DROOG = process.argv.includes("--droog");
const i_alleen = process.argv.indexOf("--alleen");
const ALLEEN = i_alleen !== -1 ? process.argv[i_alleen + 1] : null;

/* ------------------------------------------------------------------
   Bol.com Marketing Catalog API (officiële partnerroute).
   Bol blokkeert gewone scraping (403); met partner-inloggegevens halen
   we prijzen op via de API. Zonder BOL_CLIENT_ID/BOL_CLIENT_SECRET in
   de omgeving wordt dit overgeslagen en blijft de oude prijs staan.
   Auth: https://api.bol.com/marketing/docs/catalog-api/authentication.html
   ------------------------------------------------------------------ */

// Aanbiedingen waarvan de winkel zelf zegt dat hij ze niet meer voert, en
// aanbiedingen die weer terug zijn. Hier gedeclareerd en niet verderop bij de
// andere rapportlijsten: bolApiPrijs() hieronder gebruikt ze, en een const die
// pas later in het bestand staat werkt alleen zolang niemand die functie
// eerder aanroept.
const nietMeerLeverbaar = [];
const weerLeverbaar = [];

const BOL_CLIENT_ID = process.env.BOL_CLIENT_ID || "";
const BOL_CLIENT_SECRET = process.env.BOL_CLIENT_SECRET || "";
let bolToken = null;

async function haalBolToken() {
  if (!BOL_CLIENT_ID || !BOL_CLIENT_SECRET) return null;
  if (bolToken) return bolToken;
  const res = await fetch("https://login.bol.com/token?grant_type=client_credentials", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(`${BOL_CLIENT_ID}:${BOL_CLIENT_SECRET}`).toString("base64"),
      "Accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(`bol-token HTTP ${res.status}`);
  bolToken = (await res.json()).access_token;
  return bolToken;
}

// Defensief: vind de eerste plausibele price-waarde in de API-respons,
// zodat kleine wijzigingen in het responsformaat ons niet breken.
function zoekPrijsInRespons(obj) {
  if (obj == null || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const x of obj) { const p = zoekPrijsInRespons(x); if (p) return p; }
    return null;
  }
  if (typeof obj.price === "number" && obj.price >= 50 && obj.price <= 30000) return obj.price;
  for (const k of Object.keys(obj)) {
    const p = zoekPrijsInRespons(obj[k]);
    if (p) return p;
  }
  return null;
}

// Defensief, net als hierboven: pak de eerste waarde die eruitziet als een
// EAN. Zo blijft de omzetting werken als bol het veld ooit anders noemt.
function zoekEanInRespons(obj) {
  if (obj == null) return null;
  if (typeof obj === "string") return /^\d{13}$/.test(obj) ? obj : null;
  if (typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const x of obj) { const e = zoekEanInRespons(x); if (e) return e; }
    return null;
  }
  for (const k of Object.keys(obj)) {
    const e = zoekEanInRespons(obj[k]);
    if (e) return e;
  }
  return null;
}

const BOL_BASIS = "https://api.bol.com/marketing/catalog/v1";

// Accept-Language is verplicht. Node stuurt zonder deze regel "*", en dat
// wijst bol af met HTTP 400 (violation: acceptLanguage).
function bolHeaders(token) {
  return {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/json",
    "Accept-Language": "nl",
  };
}

// De catalogus werkt op EAN's van 13 cijfers, maar een bol-URL bevat het
// bol-product-ID van 16 cijfers. Bol heeft daar een omzet-endpoint voor.
async function bolEan(bolProductId, token) {
  const res = await fetch(`${BOL_BASIS}/products/${bolProductId}/to-ean?country-code=NL`, {
    headers: bolHeaders(token),
  });
  if (!res.ok) {
    console.log(`  ~ bol-API ${bolProductId}: omzetten naar EAN gaf HTTP ${res.status} (${(await res.text()).slice(0, 300)})`);
    return null;
  }
  const ean = zoekEanInRespons(await res.json());
  if (!ean) console.log(`  ~ bol-API ${bolProductId}: geen EAN in de respons`);
  return ean;
}

// Tweede route naar de EAN. Het omzet-endpoint kent niet elk product, maar het
// zoek-endpoint geeft per resultaat zowel de EAN als het bol-product-ID terug.
// Zoeken op de productnaam uit de URL en dan matchen op dat ID is exact: we
// nemen alleen een EAN over als bol zelf hem aan hetzelfde product hangt.
async function bolEanViaZoeken(bolProductId, url, token) {
  const slug = (url.match(/\/p\/([^/]+)\//) || [])[1];
  if (!slug) return null;
  const zoekterm = decodeURIComponent(slug).replace(/-/g, " ").slice(0, 100);
  const res = await fetch(
    `${BOL_BASIS}/products/search?search-term=${encodeURIComponent(zoekterm)}&country-code=NL`,
    { headers: bolHeaders(token) },
  );
  if (!res.ok) return null;
  const data = await res.json();
  const treffer = (data.results || []).find((r) => String(r.bolProductId) === String(bolProductId));
  if (!treffer) return null;
  const ean = zoekEanInRespons(treffer);
  if (ean) console.log(`  ~ bol-API ${bolProductId}: EAN ${ean} gevonden via zoeken`);
  return ean;
}

async function bolApiPrijs(aanbieding) {
  const token = await haalBolToken();
  if (!token) return null;

  // De EAN wordt na de eerste keer in de gegevens bewaard, zodat een dagelijkse
  // run maar één aanroep per aanbieding nodig heeft.
  let ean = typeof aanbieding.ean === "string" && /^\d{13}$/.test(aanbieding.ean) ? aanbieding.ean : null;
  if (!ean) {
    const m = (aanbieding.url || "").match(/\/(\d{8,})\/?$/);
    if (!m) { console.log(`  ~ bol-API: geen product-id herkend in ${aanbieding.url}`); return null; }
    ean = (await bolEan(m[1], token)) || (await bolEanViaZoeken(m[1], aanbieding.url, token));
    if (!ean) {
      // Twee verschillende bol-endpoints kennen dit product-id niet: het
      // omzet-endpoint gaf 404 en het zoek-endpoint hangt de EAN aan geen
      // enkel resultaat met dit id. Dat is bol die zegt dat hij dit artikel
      // niet meer voert, net als een 404 verderop, en het telt dus ook zo.
      //
      // Zonder deze stap bleef de HomeWizard-aanbieding elke dag "geen prijs
      // gevonden" melden terwijl er 1.195 euro bij bol.com bovenaan stond die
      // daar niet meer af te rekenen was.
      if (!aanbieding.niet_leverbaar) {
        console.log(`  ! bol-API ${m[1]}: bol kent dit product niet meer, telt niet meer mee voor de kopprijs`);
        nietMeerLeverbaar.push({ winkel: aanbieding.winkel, url: aanbieding.url });
      }
      aanbieding.niet_leverbaar = true;
      return null;
    }
    // Een eerder gemarkeerd artikel dat weer een EAN oplevert is terug; de
    // markering valt hieronder af zodra er ook een prijs bij hoort.
    aanbieding.ean = ean;
  }

  const res = await fetch(`${BOL_BASIS}/products/${ean}/offers/best?country-code=NL`, {
    headers: bolHeaders(token),
  });
  if (res.status === 404) {
    // Geen storing: bol heeft dit artikel op dit moment niet in de verkoop.
    // Dit is bol die het zelf zegt, geen gok van ons, en dus mag het de
    // gegevens aanpassen: de aanbieding telt niet meer mee voor de kopprijs.
    // Zonder deze stap blijft er een bedrag bovenaan staan dat je nergens kunt
    // afrekenen - precies wat er bij de Wolf CHA-07 bij Benem misging, en wat
    // daar met de hand rechtgezet moest worden.
    if (!aanbieding.niet_leverbaar) {
      console.log(`  ! bol-API ${ean}: bol verkoopt dit artikel niet meer, telt niet meer mee voor de kopprijs`);
      nietMeerLeverbaar.push({ winkel: aanbieding.winkel, url: aanbieding.url });
    }
    aanbieding.niet_leverbaar = true;
    return null;
  }
  if (!res.ok) {
    console.log(`  ~ bol-API ${ean}: HTTP ${res.status} (respons: ${(await res.text()).slice(0, 300)})`);
    return null;
  }
  const prijs = zoekPrijsInRespons(await res.json());
  // Weer te koop: de markering valt vanzelf af, zonder dat iemand ernaar
  // hoeft te kijken.
  if (prijs && aanbieding.niet_leverbaar) {
    console.log(`  ! bol-API ${ean}: weer leverbaar, markering vervalt`);
    delete aanbieding.niet_leverbaar;
    weerLeverbaar.push({ winkel: aanbieding.winkel, url: aanbieding.url });
  }
  return prijs ? Math.round(prijs) : null;
}

// Wat op deze site een prijs van een thuisbatterij kan zijn. De ondergrens is
// niet willekeurig: bij Vattenfall en MOVA pikte het script 200 euro op, een
// kortingsbedrag naast de productnaam. Zulke vondsten sneuvelen verderop
// alsnog op de marge, maar dan staan ze wel als "afwijking" in het rapport
// alsof de winkel zijn prijs heeft verlaagd. De goedkoopste batterij op deze
// site kost ruim vierhonderd euro.
const GRENZEN = { min: 300, max: 30000 };

// Een echte prijswijziging is zelden groot. Een sprong van tientallen procenten
// betekent meestal iets anders: een andere variant op dezelfde pagina, een
// accessoire, een bundel of een prijs excl. btw. Die nemen we niet automatisch
// over, want een verkeerde prijs is schadelijker dan een dag een oude prijs.
const MARGE_ONDER = 0.75;
const MARGE_BOVEN = 1.25;

function plausibel(nieuw, oud) {
  if (!oud) return nieuw >= 100 && nieuw <= 30000;
  return nieuw >= oud * MARGE_ONDER && nieuw <= oud * MARGE_BOVEN;
}

/* ------------------------------------------------------------------ */

// Prijzen die te veel afweken om automatisch over te nemen. Die komen aan het
// eind in de samenvatting te staan, zodat een variantwissel of een prijs excl.
// btw wordt opgemerkt door een mens in plaats van door een bezoeker.
const teControleren = [];

// Winkelpagina's die niet meer op te halen zijn. Dit script bezoekt elke dag
// precies de URL's waar de "Bekijk aanbieding"-knoppen naartoe wijzen, dus het
// weet als eerste wanneer een winkel zijn productpagina weghaalt. Zonder deze
// lijst verdween die kennis in het logboek en bleef de oude prijs staan alsof
// er niets aan de hand was.
const kapotteLinks = [];

// Prijzen die al een tijd niet meer bevestigd konden worden. De prijs klopt dan
// misschien nog, maar niemand weet het; dat hoort de bezoeker niet te merken
// zonder dat wij het eerst zien.
const VEROUDERD_NA_DAGEN = 21;
const verouderd = [];

// Aanbiedingen waarvan de winkelpagina iets anders over btw lijkt te zeggen dan
// wat er bij ons staat. Dat is een dure vergissing: een prijs excl. btw die als
// incl. btw wordt getoond scheelt 21 procent en zet de hele rangschikking op
// zijn kop. Alleen melden, nooit zelf aanpassen - de pagina kan het ook over
// verzendkosten of een ander product hebben.
const btwTwijfel = [];

// Winkels die het verzoek weigeren (403, 429). Dat is iets anders dan een
// verdwenen pagina: de link werkt voor een bezoeker prima, alleen wij komen er
// niet in. Stond vroeger op één hoop met de rest, waardoor de dagelijkse lijst
// niet liet zien wat er te doen viel.
const geweigerd = [];

// Pagina's die wel binnenkwamen maar geen leesbaar bedrag bevatten. Meestal een
// winkel die de prijs pas in de browser invult, en soms een pagina waar het
// product van af is.
const geenPrijs = [];

// Prijzen zonder adres. Hier valt niets te automatiseren: een offerteprijs of
// een bedrag uit een prijsvergelijking van vorige maand heeft geen pagina om te
// bezoeken. Zeven van de twaalf prijzen die een maand stilstonden waren dit -
// geen scriptfout, maar een prijs waar nooit een bron-URL bij is gezet.
const zonderAdres = [];

function naamVan(batterij) {
  return `${batterij.merk || ""} ${batterij.model || ""}`.trim();
}

// Een lijst in het logboek en, in GitHub Actions, bovenaan de run. De uitleg
// erbij zegt wat het vervolg is: een lijst zonder vervolg leest niemand twee
// keer.
function meld(rijen, titel, uitleg, kolommen, naarRij) {
  if (!rijen.length) return;
  console.log(`\n${rijen.length} ${titel}:`);
  for (const r of rijen) console.log(`  ${naarRij(r).join("  |  ")}`);
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    `### ${rijen.length} ${titel}`,
    "", uitleg, "",
    `| ${kolommen.join(" | ")} |`,
    `| ${kolommen.map(() => "---").join(" | ")} |`,
    ...rijen.map((r) => `| ${naarRij(r).join(" | ")} |`),
    "",
  ].join("\n") + "\n");
}

// Kijkt of de pagina onmiskenbaar over prijzen excl. of incl. btw spreekt.
// Staan beide er, of geen van beide, dan zegt de pagina er te weinig over en
// houden we onze mond; alleen een eenduidig signaal is het melden waard.
function btwVolgensPagina(html) {
  const tekst = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .toLowerCase();
  const exclusief = /\b(excl\.?|exclusief|ex\.)\s*(btw|b\.t\.w)/.test(tekst);
  const inclusief = /\b(incl\.?|inclusief|in\.)\s*(btw|b\.t\.w)/.test(tekst);
  if (exclusief && !inclusief) return false;
  if (inclusief && !exclusief) return true;
  return null;
}

async function updateAanbieding(batterij, aanbieding) {
  if (!aanbieding.url) return false;

  // Een prijs die als mensenwerk is aangemerkt komt uit een offerte of is
  // samengesteld: er staat geen bedrag op een pagina dat erbij hoort. De
  // pagina wordt wél opgehaald, want dan merken we nog steeds wanneer de
  // winkel hem weghaalt - maar wat er aan getallen op staat blijft eraf.
  //
  // Tot nu toe vond het script daar niets bruikbaars, dus er is nooit een
  // vanaf-prijs overschreven. Daar is alleen niets dat dat tegenhoudt: zet
  // Zonneplan morgen een actiebedrag op die pagina dat binnen de marge van
  // 75 tot 125 procent valt, dan komt het er zonder meer in - en dan staat er
  // een kale actieprijs op de plek van een bedrag dat installatie dekt.
  // Precies de fout die deze sites al vaker gemaakt hebben: twee verschillende
  // getallen in één kolom.
  const handmatig = batterij.prijs_controle === "handmatig" || aanbieding.prijs_controle === "handmatig";

  try {
    let nieuw;
    let hoe = null;
    if (/www\.bol\.com/.test(aanbieding.url) && BOL_CLIENT_ID && BOL_CLIENT_SECRET) {
      nieuw = await bolApiPrijs(aanbieding);
      hoe = "bol-API";
    } else {
      const html = await haalPagina(aanbieding.url);
      if (handmatig) {
        console.log(`  = ${batterij.id} @ ${aanbieding.winkel}: pagina staat er nog; prijs blijft mensenwerk (€${aanbieding.prijs_eur})`);
        return false;
      }
      const uit = prijsUitPagina(html, naamVan(batterij), GRENZEN);
      nieuw = uit.prijs;
      hoe = uit.hoe;

      // Zegt de pagina eenduidig iets anders over btw dan wij, dan is dat het
      // melden waard. Zonder veld gaan wij uit van incl. btw.
      const volgensPagina = btwVolgensPagina(html);
      const bijOns = aanbieding.btw_inbegrepen !== false;
      if (volgensPagina !== null && volgensPagina !== bijOns) {
        btwTwijfel.push({
          id: batterij.id,
          winkel: aanbieding.winkel,
          bijOns: bijOns ? "incl. btw" : "excl. btw",
          volgensPagina: volgensPagina ? "incl. btw" : "excl. btw",
          url: aanbieding.url,
        });
      }
    }
    if (!nieuw) {
      console.log(`  ~ ${batterij.id} @ ${aanbieding.winkel}: geen prijs gevonden${aanbieding.niet_leverbaar ? " (winkel voert dit artikel niet meer)" : `, oude prijs blijft (€${aanbieding.prijs_eur})`}`);
      // De pagina bestaat wel, maar de prijs staat er niet (meer) in leesbare
      // vorm - vrijwel altijd een winkel die het bedrag pas in de browser
      // invult. Geen kapotte link, wel iets dat nooit vanzelf overgaat.
      //
      // Behalve als de winkel zelf al gezegd heeft dat hij het artikel niet
      // meer verkoopt. Dan is "geen prijs" geen storing maar het juiste
      // antwoord, en hoort het niet in een lijst met dingen om op te lossen:
      // vier bol-artikelen stonden daar elke dag in terwijl er niets aan te
      // doen viel. De aanbieding telt al niet meer mee voor de kopprijs, en
      // zodra bol hem weer verkoopt valt die markering vanzelf af.
      if (!aanbieding.niet_leverbaar) {
        geenPrijs.push({ id: batterij.id, winkel: aanbieding.winkel, prijs: aanbieding.prijs_eur, url: aanbieding.url });
      }
      return false;
    }
    if (!plausibel(nieuw, aanbieding.prijs_eur)) {
      const verschil = Math.round((nieuw / aanbieding.prijs_eur - 1) * 100);
      console.log(`  ! ${batterij.id} @ ${aanbieding.winkel}: gevonden prijs €${nieuw} wijkt ${verschil > 0 ? "+" : ""}${verschil}% af van €${aanbieding.prijs_eur}, overgeslagen`);
      teControleren.push({ id: batterij.id, winkel: aanbieding.winkel, oud: aanbieding.prijs_eur, nieuw, verschil, url: aanbieding.url });
      return false;
    }
    const veranderd = nieuw !== aanbieding.prijs_eur;
    if (!DROOG) {
      aanbieding.prijs_eur = nieuw;
      aanbieding.datum = VANDAAG;
    }
    console.log(`  ${veranderd ? "✓ NIEUW" : "= gelijk"} ${batterij.id} @ ${aanbieding.winkel}: €${nieuw}${hoe ? ` (via ${hoe})` : ""}`);
    return veranderd;
  } catch (err) {
    console.log(`  x ${batterij.id} @ ${aanbieding.winkel}: ${err.message} (oude prijs blijft staan)`);
    // 404 en 410 betekenen dat de pagina echt weg is; 403 en 429 betekenen
    // meestal dat de winkel geautomatiseerde verzoeken weert. Alleen het eerste
    // is een link die een bezoeker op een foutpagina laat belanden - het tweede
    // is een winkel die ons niet binnenlaat, en dat vraagt om iets anders.
    const status = (err.message.match(/HTTP (\d+)/) || [])[1];
    if (status === "404" || status === "410" || err.name === "TypeError") {
      kapotteLinks.push({ id: batterij.id, winkel: aanbieding.winkel, url: aanbieding.url, reden: err.message });
    } else if (status === "403" || status === "429") {
      geweigerd.push({ id: batterij.id, winkel: aanbieding.winkel, url: aanbieding.url, reden: `HTTP ${status}` });
    }
    return false;
  }
}

/**
 * Een richtprijs zonder winkel. Die heeft geen aanbieding en werd daarom nooit
 * bezocht: het script liep alleen langs aanbiedingen, en de prijsdatum bleef
 * staan op de dag dat iemand het bedrag met de hand invulde.
 *
 * Staat er een prijs_bron_url bij, dan gaat de richtprijs mee in de gewone
 * ronde. Om precies dezelfde regels te laten gelden - dezelfde marge, dezelfde
 * btw-controle, dezelfde meldingen - reist hij als aanbieding mee en gaat de
 * uitkomst daarna terug.
 */
async function updateRichtprijs(batterij) {
  const bron = {
    winkel: batterij.prijs_bron || "richtprijs",
    url: batterij.prijs_bron_url,
    prijs_eur: batterij.richtprijs_eur,
    btw_inbegrepen: batterij.btw_inbegrepen,
    prijs_controle: batterij.prijs_controle,
  };
  if (!controleerbaar(bron)) {
    // Alleen melden als er iets te bewaken valt: een product zonder prijs kan
    // geen verouderde prijs tonen, en een prijs die als mensenwerk is
    // aangemerkt hoort niet in een lijst met dingen die het script moet doen.
    if (typeof batterij.richtprijs_eur === "number" && batterij.prijs_controle !== "handmatig") {
      zonderAdres.push({ id: batterij.id, prijs: batterij.richtprijs_eur, bron: batterij.prijs_bron || "?", datum: batterij.prijs_datum || "?" });
    }
    return false;
  }
  const veranderd = await updateAanbieding(batterij, bron);
  if (bron.datum && !DROOG) {
    batterij.richtprijs_eur = bron.prijs_eur;
    batterij.prijs_datum = bron.datum;
  }
  return veranderd;
}

async function main() {
  const data = JSON.parse(readFileSync(DATA_PAD, "utf8"));
  let wijzigingen = 0;

  for (const batterij of data.batterijen || []) {
    if (ALLEEN && batterij.id !== ALLEEN) continue;
    for (const aanbieding of batterij.aanbiedingen || []) {
      if (await updateAanbieding(batterij, aanbieding)) wijzigingen++;
      await new Promise((r) => setTimeout(r, 1500)); // beleefde pauze tussen requests
    }
    /* Een batterij zonder bruikbare aanbieding toont de richtprijs, en die
       hoort dus ook gecontroleerd te worden.

       Hier stond "zonder aanbiedingen", en dat is iets anders. De Zendure
       SolarFlow Hyper 2000 heeft één aanbieding bij bol, maar die staat op
       niet_leverbaar omdat bol met 404 antwoordt. De bezoeker ziet daardoor de
       richtprijs - Prijs.beste() valt daarop terug - terwijl dit script de
       richtprijs oversloeg omdat de lijst niet leeg was. Een bron-URL erbij
       zetten hielp dan niets: hij werd nooit bezocht.

       Dezelfde regel als in assets/prijs.js: een aanbieding telt alleen mee als
       ze een bedrag heeft en de winkel haar nog voert. */
    const bruikbaar = (batterij.aanbiedingen || []).filter(
      (a) => a && typeof a.prijs_eur === "number" && a.niet_leverbaar !== true,
    );
    if (!bruikbaar.length) {
      if (await updateRichtprijs(batterij)) wijzigingen++;
      await new Promise((r) => setTimeout(r, 1500));
    }
    // prijs_datum van de batterij = meest recente controle-datum van zijn aanbiedingen
    const datums = (batterij.aanbiedingen || []).map((a) => a.datum).filter(Boolean).sort();
    if (datums.length) batterij.prijs_datum = datums[datums.length - 1];

    // Ook een richtprijs veroudert. Die telde hier niet mee zolang het script
    // hem niet bezocht, en dat is precies waarom hij een maand kon stilstaan.
    // Alleen aanbiedingen die de winkel nog voert. Een artikel dat bol niet
    // meer verkoopt hoort niet als "al 21 dagen niet bevestigd" in de lijst:
    // dat wordt het nooit meer, en het telt ook niet mee voor de prijs die de
    // bezoeker ziet.
    //
    // En een prijs die als mensenwerk is aangemerkt hoort er ook niet in. Die
    // wordt niet vanzelf jonger: geen enkele run kan hem bevestigen, dus hij
    // zou vanaf dag 21 tot in de eeuwigheid in deze lijst blijven staan. Hoe
    // oud zulke prijzen zijn, blijft wél te zien - de ouderdomscontrole zet
    // ze in een eigen groep, met de reden erbij.
    if (batterij.prijs_controle === "handmatig") continue;

    const leverbaar = (batterij.aanbiedingen || []).filter((a) => !a.niet_leverbaar);
    const teWegen = leverbaar.length
      ? leverbaar.map((a) => ({ winkel: a.winkel, prijs: a.prijs_eur, datum: a.datum }))
      : typeof batterij.richtprijs_eur === "number"
        ? [{ winkel: batterij.prijs_bron || "richtprijs", prijs: batterij.richtprijs_eur, datum: batterij.prijs_datum }]
        : [];
    for (const p of teWegen) {
      const dagen = p.datum
        ? Math.round((Date.now() - new Date(`${p.datum}T12:00:00`)) / 86400000)
        : null;
      if (dagen === null || dagen >= VEROUDERD_NA_DAGEN) {
        verouderd.push({ id: batterij.id, winkel: p.winkel, prijs: p.prijs, dagen });
      }
    }
  }

  if (!DROOG) {
    data.laatst_bijgewerkt = VANDAAG;
    writeFileSync(DATA_PAD, JSON.stringify(data, null, 2) + "\n", "utf8");
    // De batterijpagina's en sitemap worden hierna herbouwd door
    // scripts/genereer-batterijpaginas.mjs (zie de workflow).
  }

  console.log(`\nKlaar. ${wijzigingen} prijswijziging(en).${DROOG ? " Droge run: niets weggeschreven." : ` laatst_bijgewerkt = ${VANDAAG}`}`);

  if (kapotteLinks.length) {
    console.log(`\n${kapotteLinks.length} winkelpagina('s) niet meer bereikbaar:`);
    for (const k of kapotteLinks) console.log(`  ${k.id} @ ${k.winkel}: ${k.reden}\n     ${k.url}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
        `### ${kapotteLinks.length} winkelpagina('s) verdwenen`,
        "",
        "Een bezoeker die hierop klikt komt op een foutpagina terwijl de site nog een prijs toont. Haal de aanbieding weg of zoek een andere winkel.",
        "",
        "| Batterij | Winkel | Reden | Link |",
        "| --- | --- | --- | --- |",
        ...kapotteLinks.map((k) => `| ${k.id} | ${k.winkel} | ${k.reden} | ${k.url} |`),
        "",
      ].join("\n") + "\n");
    }
  }

  // De drie redenen waarom een prijs niet ververst is, elk met een eigen
  // vervolg. Vroeger stonden ze door elkaar als "geen prijs gevonden", en dan
  // ziet een lijst van twaalf eruit als twaalf keer hetzelfde probleem terwijl
  // er drie verschillende dingen te doen waren.
  meld(geweigerd, "winkel(s) lieten ons niet binnen",
    "De pagina werkt voor een bezoeker gewoon; alleen ons verzoek wordt geweigerd (403 of 429), ook na een tweede poging. Te overwegen: een andere winkel voor dit product opnemen, of deze prijs met de hand bijhouden en als zodanig markeren.",
    ["Batterij", "Winkel", "Reden", "Link"], (g) => [g.id, g.winkel, g.reden, g.url]);

  meld(geenPrijs, "pagina('s) zonder leesbaar bedrag",
    "Deze pagina's kwamen binnen, maar er stond geen bedrag in dat aan dit product te koppelen was. Meestal vult de winkel de prijs pas in de browser in. Dat gaat niet vanzelf over: zolang dit hier staat, veroudert die prijs elke dag verder.",
    ["Batterij", "Winkel", "Prijs in de data", "Link"], (g) => [g.id, g.winkel, `€ ${g.prijs}`, g.url]);

  meld(zonderAdres, "richtprijs(en) zonder bron-URL",
    "Hier valt niets te automatiseren: er staat geen adres bij waar dit bedrag vandaan komt, dus geen enkel script kan het bevestigen. Zet er een `prijs_bron_url` bij die naar een pagina met dit bedrag wijst, dan loopt hij vanaf morgen mee in de dagelijkse ronde. Kan dat niet - een offerte, een schatting - zet dan `\"prijs_controle\": \"handmatig\"` erbij, zodat duidelijk is dat dit mensenwerk blijft.",
    ["Batterij", "Richtprijs", "Bron zoals genoteerd", "Sinds"], (g) => [g.id, `€ ${g.prijs}`, g.bron, g.datum]);

  if (verouderd.length) {
    console.log(`\n${verouderd.length} prijs(en) al ${VEROUDERD_NA_DAGEN}+ dagen niet bevestigd:`);
    for (const v of verouderd) console.log(`  ${v.id} @ ${v.winkel}: €${v.prijs} (${v.dagen === null ? "nooit bevestigd" : v.dagen + " dagen"})`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
        `### ${verouderd.length} prijs(en) al lang niet bevestigd`,
        "",
        `Deze winkels laten zich niet automatisch uitlezen. De prijs klopt misschien nog, maar niemand heeft het de laatste ${VEROUDERD_NA_DAGEN} dagen kunnen vaststellen.`,
        "",
        "| Batterij | Winkel | Prijs in de data | Laatst bevestigd |",
        "| --- | --- | --- | --- |",
        ...verouderd.map((v) => `| ${v.id} | ${v.winkel} | € ${v.prijs} | ${v.dagen === null ? "nooit" : v.dagen + " dagen geleden"} |`),
        "",
      ].join("\n") + "\n");
    }
  }

  if (nietMeerLeverbaar.length || weerLeverbaar.length) {
    for (const a of nietMeerLeverbaar) console.log(`  telt niet meer mee: ${a.winkel} (${a.url})`);
    for (const a of weerLeverbaar) console.log(`  weer leverbaar: ${a.winkel} (${a.url})`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      const regels = [`### Leverbaarheid gewijzigd bij ${nietMeerLeverbaar.length + weerLeverbaar.length} aanbieding(en)`, ""];
      if (nietMeerLeverbaar.length) {
        regels.push(
          "Bol meldt zelf dat deze artikelen niet meer verkocht worden. Ze tellen vanaf nu niet meer mee voor de prijs die de site toont, maar blijven wel in de winkellijst staan. Komt het artikel terug, dan valt die markering vanzelf af.",
          "", "| Winkel | Adres |", "| --- | --- |",
          ...nietMeerLeverbaar.map((a) => `| ${a.winkel} | ${a.url} |`), "",
        );
      }
      if (weerLeverbaar.length) {
        regels.push("Deze zijn juist weer wel te koop en tellen weer mee:", "",
          ...weerLeverbaar.map((a) => `- ${a.winkel} (${a.url})`), "");
      }
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, regels.join("\n") + "\n");
    }
  }

  if (btwTwijfel.length) {
    console.log(`\n${btwTwijfel.length} aanbieding(en) waarbij de winkelpagina iets anders over btw zegt:`);
    for (const b of btwTwijfel) {
      console.log(`  ${b.id} @ ${b.winkel}: bij ons ${b.bijOns}, pagina zegt ${b.volgensPagina}  ${b.url}`);
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
        `### ${btwTwijfel.length} aanbieding(en) met twijfel over btw`,
        "",
        "Een prijs excl. btw die als incl. btw wordt getoond scheelt 21 procent en zet de rangschikking op zijn kop. Deze pagina's spreken zich eenduidig uit over btw, maar anders dan wat er bij ons staat. Klopt de pagina, zet dan `\"btw_inbegrepen\": false` bij die aanbieding (of haal het weg).",
        "",
        "Let op: dit is een signaal, geen bewijs. De pagina kan het ook over verzendkosten of een ander artikel hebben.",
        "",
        "| Batterij | Winkel | Bij ons | Volgens de pagina |",
        "| --- | --- | --- | --- |",
        ...btwTwijfel.map((b) => `| ${b.id} | ${b.winkel} | ${b.bijOns} | ${b.volgensPagina} |`),
        "",
      ].join("\n") + "\n");
    }
  }

  if (teControleren.length) {
    console.log(`\n${teControleren.length} prijs(en) overgeslagen wegens een te grote afwijking:`);
    for (const t of teControleren) {
      console.log(`  ${t.id} @ ${t.winkel}: €${t.oud} -> €${t.nieuw} (${t.verschil > 0 ? "+" : ""}${t.verschil}%)  ${t.url}`);
    }
    // In GitHub Actions verschijnt dit bovenaan de run, zodat het opvalt
    // zonder de logs te openen.
    if (process.env.GITHUB_STEP_SUMMARY) {
      const regels = [
        `### ${teControleren.length} prijs(en) handmatig controleren`,
        "",
        "Deze afwijkingen zijn te groot om automatisch over te nemen. Vaak is het een andere variant op dezelfde productpagina, een bundel of een prijs excl. btw.",
        "",
        "| Batterij | Winkel | Nu in de data | Gevonden | Verschil |",
        "| --- | --- | --- | --- | --- |",
        ...teControleren.map((t) => `| ${t.id} | ${t.winkel} | € ${t.oud} | € ${t.nieuw} | ${t.verschil > 0 ? "+" : ""}${t.verschil}% |`),
      ];
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, regels.join("\n") + "\n");
    }
  }

  /* Vroeger werd de run rood zodra er iets aandacht vroeg, en dat was elke
     dag: zevenentwintig punten, waarvan drie winkels die bots weren en dat
     blijven doen. Zo'n controle staat binnen een week permanent rood en wordt
     dan behang. Nu is alleen nieuws een alarm; de rest is werkvoorraad en
     staat in het rapport. Zie kern/scripts/prijs-aandacht.mjs. */
  const punten = [
    ...verouderd.map((v) => ({ soort: "verouderd", id: v.id, winkel: v.winkel, tekst: `${v.id} @ ${v.winkel}: €${v.prijs} (${v.dagen === null ? "nooit bevestigd" : v.dagen + " dagen"})` })),
    ...teControleren.map((t) => ({ soort: "te controleren", id: t.id, winkel: t.winkel, tekst: `${t.id} @ ${t.winkel}: €${t.oud} → €${t.nieuw} (${t.verschil > 0 ? "+" : ""}${t.verschil}%)` })),
    ...kapotteLinks.map((k) => ({ soort: "onbereikbaar", id: k.id, winkel: k.winkel, tekst: `${k.id} @ ${k.winkel}: ${k.reden || "niet bereikbaar"}` })),
    ...geweigerd.map((g) => ({ soort: "geweigerd", id: g.id, winkel: g.winkel, tekst: `${g.id} @ ${g.winkel}: ${g.reden || "HTTP 403"}` })),
    ...geenPrijs.map((g) => ({ soort: "zonder bedrag", id: g.id, winkel: g.winkel, tekst: `${g.id} @ ${g.winkel}: geen leesbaar bedrag` })),
    ...zonderAdres.map((z) => ({ soort: "zonder bron", id: z.id, winkel: z.bron, tekst: `${z.id}: €${z.prijs} van ${z.bron}, geen bron-URL` })),
  ];

  const LIJST = resolve(__dirname, "../data/prijs-aandacht.json");
  const uitkomst = vergelijk(punten, leesBekend(LIJST), VANDAAG);
  if (!DROOG) schrijfBekend(LIJST, uitkomst.punten, VANDAAG);
  meldAandacht("batterijmaatje", uitkomst, VANDAAG);
}

main().catch((err) => {
  console.error("Onverwachte fout:", err);
  process.exit(1);
});
