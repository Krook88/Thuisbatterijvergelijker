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
 *     alleen de datum (`datum` per aanbieding) wordt dan NIET bijgewerkt,
 *     zodat zichtbaar blijft hoe vers elke prijs is.
 *   - Het script faalt nooit hard op één winkel: fouten worden gelogd
 *     en de rest gaat door.
 */

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { haalPagina, haalMetBrowser, sluitBrowser, browserBeschikbaar, prijsUitPagina, andereRoute, controleerbaar, btwVolgensPagina } from "./prijs-uitlezen.mjs";
import { voorraadVolgensWinkel, verwerkVoorraad, meldBereikbaarheid, paginaWeg } from "./voorraad.mjs";
import { bolApiPrijs, bolBeschikbaar } from "./bol.mjs";
import { vergelijk, leesBekend, schrijfBekend, meldAandacht } from "./prijs-aandacht.mjs";
import { sprong, hersteld, referentie } from "./prijs-sprong.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PAD = resolve(__dirname, "../data/batterijen.json");

const VANDAAG = new Date().toISOString().slice(0, 10);

// Alleen kijken, niets wegschrijven. Voor als je wilt zien waarom een winkel
// niet meewerkt zonder de gegevens aan te raken.
const DROOG = process.argv.includes("--droog");
const i_alleen = process.argv.indexOf("--alleen");
const ALLEEN = i_alleen !== -1 ? process.argv[i_alleen + 1] : null;

/* Bol.com: zie kern/scripts/bol.mjs. */

// Aanbiedingen waarvan de winkel zelf zegt dat hij ze niet meer voert, en
// aanbiedingen die weer terug zijn: van bol.com en van de voorraadcontrole.
const nietMeerLeverbaar = [];
const weerLeverbaar = [];
const BOL = {
  // Ruimer dan GRENZEN hieronder: dit zoekt alleen het prijsveld in het
  // antwoord van bol, en de marge vangt de rest.
  grenzen: { min: 50, max: 30000 },
  bijNietLeverbaar: (a) => nietMeerLeverbaar.push({ winkel: a.winkel, url: a.url }),
  bijWeerLeverbaar: (a) => weerLeverbaar.push({ winkel: a.winkel, url: a.url }),
};

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

// Aanbiedingen waarvan vandaag een bedrag is bevestigd, met dat bedrag, ook in
// een droge run (die zet geen datum). probeerFabrikant leest hieruit of de
// fabrikantpagina iets opleverde.
const vandaagBevestigd = new WeakMap();

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
    if (/www\.bol\.com/.test(aanbieding.url) && bolBeschikbaar()) {
      nieuw = await bolApiPrijs(aanbieding, BOL);
      hoe = "bol-API";
    } else {
      /* Twee soorten winkels komen hier niet doorheen met een gewoon verzoek:
         die met botbescherming en die de prijs pas in de browser invullen.
         Voor allebei is de terugval een echte browser. Alleen als het nodig is
         - hem standaard gebruiken kost twee seconden per winkel en levert bij
         veertig winkels niets op.

         Elke mislukking telt, niet alleen een 403 of 429. Dat stond hier eerst
         wel zo, en dat kostte bij zonnestroommaatje drie winkels: die weren
         bots met een 404 of een 400, en zo hield de lijst aanbiedingen voor
         dood die het gewoon doen. Lukt het de browser ook niet, dan geldt de
         oorspronkelijke fout. */
      // Zegt de winkel zelf dat alle varianten uitverkocht zijn (Shopify), dan
      // telt de aanbieding niet mee, ook al staat het bedrag nog in de pagina.
      // Zie voorraad.mjs: Multi Solar en Zendure toonden zo dagenlang een prijs
      // voor iets wat je niet kon bestellen.
      const voorraad = verwerkVoorraad(aanbieding, await voorraadVolgensWinkel(aanbieding.url));
      if (voorraad === "uitverkocht" || voorraad === "blijft") {
        console.log(voorraad === "uitverkocht"
          ? `  ! ${batterij.id} @ ${aanbieding.winkel}: alles uitverkocht volgens de winkel, telt niet meer mee voor de kopprijs`
          : `  ~ ${batterij.id} @ ${aanbieding.winkel}: nog steeds uitverkocht`);
        if (voorraad === "uitverkocht") nietMeerLeverbaar.push({ winkel: aanbieding.winkel, url: aanbieding.url });
        return false;
      }
      if (voorraad === "weer") {
        console.log(`  ! ${batterij.id} @ ${aanbieding.winkel}: weer leverbaar, markering vervalt`);
        weerLeverbaar.push({ winkel: aanbieding.winkel, url: aanbieding.url });
      }
      let html;
      let viaBrowser = false;
      try {
        html = await haalPagina(aanbieding.url);
      } catch (err) {
        const uitBrowser = await haalMetBrowser(aanbieding.url).catch(() => null);
        if (!uitBrowser) throw err;
        html = uitBrowser;
        viaBrowser = true;
      }
      meldBereikbaarheid(batterij, aanbieding, true, VANDAAG);
      if (handmatig) {
        console.log(`  = ${batterij.id} @ ${aanbieding.winkel}: pagina staat er nog; prijs blijft mensenwerk (€${aanbieding.prijs_eur})`);
        return false;
      }
      let uit = prijsUitPagina(html, naamVan(batterij), { ...GRENZEN, route: aanbieding.prijs_route, variant: aanbieding.prijs_variant });
      if (uit.prijs === null && !viaBrowser) {
        // Pagina antwoordde wel maar toont geen bedrag: vaak wordt de prijs pas
        // door javascript ingevuld. Sessy en BeterDuurzaam doen dat.
        const uitBrowser = await haalMetBrowser(aanbieding.url).catch(() => null);
        if (uitBrowser) {
          html = uitBrowser;
          viaBrowser = true;
          uit = prijsUitPagina(html, naamVan(batterij), { ...GRENZEN, route: aanbieding.prijs_route, variant: aanbieding.prijs_variant });
        }
      }
      nieuw = uit.prijs;
      hoe = uit.hoe ? `${uit.hoe}${viaBrowser ? ", via de browser" : ""}` : uit.hoe;
      // Geeft de gewone route een bedrag dat niet bij de vorige prijs past,
      // dan eerst de andere routes proberen; zie andereRoute in
      // prijs-uitlezen.mjs. Een vaste route blijft vast.
      if (nieuw && !aanbieding.prijs_route && aanbieding.prijs_eur && !plausibel(nieuw, aanbieding.prijs_eur)) {
        const ander = andereRoute(html, naamVan(batterij), { ...GRENZEN, variant: aanbieding.prijs_variant }, uit.hoe, (p) => plausibel(p, aanbieding.prijs_eur));
        if (ander) {
          console.log(`  ↻ ${batterij.id} @ ${aanbieding.winkel}: ${uit.hoe} gaf €${nieuw}, ${ander.route} geeft €${ander.prijs}; die route wordt onthouden`);
          if (!DROOG) aanbieding.prijs_route = ander.route;
          nieuw = ander.prijs;
          hoe = `${ander.route}${viaBrowser ? ", via de browser" : ""}, andere route`;
        }
      }

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
      // Wat er met een aanhoudende sprong gebeurt: zie kern/scripts/prijs-sprong.mjs.
      const ref = referentie(batterij.aanbiedingen, aanbieding, (a) => a.prijs_eur, batterij.richtprijs_eur);
      const besluit = sprong(aanbieding, nieuw, ref, VANDAAG);
      if (besluit !== "overnemen") {
        console.log(`  ! ${batterij.id} @ ${aanbieding.winkel}: gevonden prijs €${nieuw} wijkt ${verschil > 0 ? "+" : ""}${verschil}% af van €${aanbieding.prijs_eur}, ${besluit === "wachten" ? `overgeslagen (${aanbieding.afwijking.runs}e run)` : "uit de vergelijking gehaald"}`);
        if (besluit === "uitgezet") nietMeerLeverbaar.push({ id: batterij.id, winkel: aanbieding.winkel, url: aanbieding.url, reden: `prijs wijkt af: €${nieuw} tegen €${ref ?? "?"} elders` });
        if (besluit === "wachten") teControleren.push({ id: batterij.id, winkel: aanbieding.winkel, oud: aanbieding.prijs_eur, nieuw, verschil, url: aanbieding.url });
        return false;
      }
      console.log(`  ✓ ${batterij.id} @ ${aanbieding.winkel}: €${nieuw} drie runs gezien en in lijn met €${ref} elders, overgenomen`);
    } else if (hersteld(aanbieding)) {
      weerLeverbaar.push({ id: batterij.id, winkel: aanbieding.winkel, url: aanbieding.url });
    }
    const veranderd = nieuw !== aanbieding.prijs_eur;
    vandaagBevestigd.set(aanbieding, nieuw);
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
    if (paginaWeg(err) && !/www\.bol\.com/.test(aanbieding.url)) meldBereikbaarheid(batterij, aanbieding, false, VANDAAG);
    if (status === "404" || status === "410" || err.name === "TypeError") {
      kapotteLinks.push({ id: batterij.id, winkel: aanbieding.winkel, url: aanbieding.url, reden: err.message });
    } else if (status === "403" || status === "429") {
      geweigerd.push({ id: batterij.id, winkel: aanbieding.winkel, url: aanbieding.url, reden: `HTTP ${status}` });
    }
    return false;
  }
}

/**
 * Verkoopt de fabrikant zelf? Elke dag even kijken op product_url.
 *
 * De Anker Solarbank 3 Pro stond een maand zonder winkel, met een richtprijs
 * die nergens werd nagekeken, terwijl product_url naar de Anker-shop wees met
 * precies dat bedrag erop. Dat geldt voor meer merken die direct verkopen
 * (Anker, Zendure, Marstek, Jackery): de fabrikant is een winkel die we al
 * kennen en alleen niet bezochten.
 *
 * Staat de pagina nog niet als aanbieding in de lijst, dan halen we hem op met
 * dezelfde regels als een gewone winkel. Een bedrag binnen de marge van de
 * laagste winkelprijs (of, zonder winkel, de richtprijs) wordt een aanbieding
 * "<merk> (officieel)" en loopt vanaf dan gewoon mee. Een bedrag daarbuiten is
 * vaak iets anders - een bundel, een besparing per jaar - en komt alleen in
 * het overzicht. Geen bedrag of uitverkocht: stil overslaan, want de meeste
 * fabrikanten van installateursbatterijen hebben geen shop, en die zouden
 * anders elke dag in de lijst "pagina zonder leesbaar bedrag" staan.
 */
const fabrikantErbij = [];
const fabrikantAfwijkend = [];

// Fabrikantpagina's die deze run al een uitkomst gaven. updateRichtprijs slaat
// die over: bij de EcoFlow Stream AC Pro is prijs_bron_url dezelfde pagina, en
// anders stond een afwijkend bedrag twee keer in het overzicht.
const fabrikantBezocht = new Set();

// Het domein zonder subdomein: nl.ecoflow.com en eu.ecoflow.com zijn dezelfde
// winkel. Grof (co.uk wordt "co.uk"), maar dat komt in deze data niet voor.
function domeinVan(url) {
  const host = hostVan(url);
  return host ? host.split(".").slice(-2).join(".") : null;
}

function geenProductpagina(url) {
  let pad;
  try {
    pad = new URL(url).pathname.toLowerCase();
  } catch {
    return true;
  }
  if (/incl-|-set\b|bundel|pakket|\/collections?\//.test(pad)) return true;
  const kaal = pad.replace(/^\/(nl|en|de|be|nl-nl|nl_nl|nl-be|en-gb|eu)(?=\/|$)/, "").replace(/\//g, "");
  return kaal.length < 3;
}

function hostVan(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

async function probeerFabrikant(batterij) {
  const url = batterij.product_url;
  if (typeof url !== "string" || !/^https?:/.test(url)) return false;
  if (batterij.prijs_controle === "handmatig") return false;
  const aanbiedingen = batterij.aanbiedingen || [];
  // Alleen als het echt de fabrikant is. Bij de Voltdeer en de HYXi wijst
  // product_url naar stekkerdeal.nl, en dat "(officieel)" noemen is precies
  // de verkeerde naam onder een prijs. Het merk moet in de domeinnaam staan:
  // marstek.nl, ankersolix.com, aegthuisbatterij.nl.
  const host = hostVan(url);
  const merk = String(batterij.merk || "").toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, "");
  if (!host || merk.length < 2 || !host.replace(/[^a-z0-9.]/g, "").includes(merk)) return false;
  // En niet als die site er al in staat, onder een ander adres of subdomein:
  // Marstek.nl (officieel) bij de Venus E 3.0, Anker SOLIX (officieel) bij de
  // Solarbank 4, en eu.ecoflow.com naast nl.ecoflow.com.
  if (aanbiedingen.some((a) => a && domeinVan(a.url) === domeinVan(url))) return false;
  // Geen set- of overzichtspagina. De Venus D wijst naar "...-incl-p1-meter/",
  // de Indevolt naar een collectie en de Huawei naar de homepage: een bedrag
  // daarvan hoort niet als losse batterijprijs in de lijst.
  if (geenProductpagina(url)) return false;

  // IJken op wat de bezoeker nu ziet, incl. btw. Een prijs met installatie of
  // een prijs die mensenwerk is, zegt niets over de losse batterij: bij de
  // Sigenergy is de enige winkel Frank Energie, excl. btw en mét installatie.
  const vergelijkbaar = aanbiedingen.filter((a) => a && typeof a.prijs_eur === "number" && a.niet_leverbaar !== true
    && a.prijs_controle !== "handmatig" && !/installatie/i.test(`${a.winkel || ""} ${a.omvat || ""}`));
  const ijk = vergelijkbaar.length
    ? Math.min(...vergelijkbaar.map((a) => (a.btw_inbegrepen === false ? Math.round(a.prijs_eur * 1.21) : a.prijs_eur)))
    : aanbiedingen.some((a) => a && a.niet_leverbaar !== true) ? null : batterij.richtprijs_eur;
  if (typeof ijk !== "number") return false;

  const proef = { winkel: `${batterij.merk} (officieel)`, url, prijs_eur: ijk };
  const lijsten = [geenPrijs, geweigerd, kapotteLinks, teControleren, btwTwijfel, nietMeerLeverbaar, weerLeverbaar];
  const lengtes = lijsten.map((l) => l.length);
  await updateAanbieding(batterij, proef);
  await new Promise((r) => setTimeout(r, 1500));
  const afwijking = teControleren.length > lengtes[3] ? teControleren[teControleren.length - 1] : null;
  // Zegt de pagina "excl. btw", dan staat het bedrag 21% te laag op de site
  // als we hem stil toevoegen. Dan liever niet, en wel melden.
  const btwAnders = btwTwijfel.length > lengtes[4];
  lijsten.forEach((l, i) => { l.length = lengtes[i]; });

  const gevonden = vandaagBevestigd.get(proef);
  if (afwijking || (btwAnders && typeof gevonden === "number")) {
    fabrikantAfwijkend.push({
      id: batterij.id, winkel: proef.winkel, ijk, nieuw: afwijking ? afwijking.nieuw : gevonden, url,
      reden: afwijking ? "buiten de marge" : "pagina zegt excl. btw",
    });
    fabrikantBezocht.add(url);
    return false;
  }
  if (typeof gevonden !== "number" || proef.niet_leverbaar) return false;

  fabrikantBezocht.add(url);
  if (!DROOG) {
    if (!batterij.aanbiedingen) batterij.aanbiedingen = [];
    batterij.aanbiedingen.unshift({ winkel: proef.winkel, prijs_eur: gevonden, url, datum: VANDAAG });
  }
  fabrikantErbij.push({ id: batterij.id, winkel: proef.winkel, prijs: gevonden, url });
  console.log(`  + ${batterij.id}: ${proef.winkel} verkoopt hem zelf voor €${gevonden}${DROOG ? " (droge run, niet toegevoegd)" : ", toegevoegd als aanbieding"}`);
  return true;
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
    if (await probeerFabrikant(batterij)) wijzigingen++;
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
    if (!bruikbaar.length && !fabrikantBezocht.has(batterij.prijs_bron_url)) {
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
    /* Alleen "vandaag gecontroleerd" als er vandaag ook echt iets bevestigd
       is. Viel elke winkel weg (netwerkstoring, alles 403), dan toonde de
       site anders een verse datum boven prijzen van dagen oud. */
    const bevestigd = data.batterijen.some((b) => (b.aanbiedingen || []).some((a) => a.datum === VANDAAG));
    if (!ALLEEN && bevestigd) data.laatst_bijgewerkt = VANDAAG;
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

  meld(fabrikantErbij, DROOG ? "fabrikant(en) die zelf verkopen (droge run, niet toegevoegd)" : "fabrikant(en) als winkel toegevoegd",
    "De productpagina van de fabrikant toonde een prijs binnen de marge van de laagste winkelprijs of de richtprijs. Hij staat nu als aanbieding in de lijst en loopt vanaf morgen gewoon mee. Even nakijken of het bedrag bij de losse batterij hoort en niet bij een set.",
    ["Batterij", "Winkel", "Prijs", "Link"], (g) => [g.id, g.winkel, `€ ${g.prijs}`, g.url]);

  meld(fabrikantAfwijkend, "fabrikantprijs(en) niet overgenomen",
    "De fabrikant toont een bedrag dat te ver van de winkelprijs of richtprijs ligt, of de pagina zegt dat het excl. btw is. Vaak een set of een ander getal op de pagina; soms een echte prijs die de richtprijs moet bijstellen. Klopt hij, zet hem dan met de hand als aanbieding (met btw_inbegrepen: false waar nodig).",
    ["Batterij", "Winkel", "Ijkprijs", "Gevonden", "Reden", "Link"], (g) => [g.id, g.winkel, `€ ${g.ijk}`, `€ ${g.nieuw}`, g.reden, g.url]);

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

  /* Of de browserterugval beschikbaar was, hoort in het rapport: anders is
     "winkel weigert" niet te onderscheiden van "we hebben het niet geprobeerd".
     Dat verschil bepaalt of iemand iets moet doen. */
  if (!(await browserBeschikbaar())) {
    console.log("\nLet op: playwright ontbreekt, dus winkels met botbescherming zijn niet met een browser geprobeerd.");
    console.log("Installeren in de workflow:  npm i --no-save playwright && npx playwright install --with-deps chromium");
  }
  await sluitBrowser();
}

main().catch((err) => {
  console.error("Onverwachte fout:", err);
  process.exit(1);
});
