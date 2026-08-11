#!/usr/bin/env node
/**
 * Dagelijkse prijsupdate voor data/batterijen.json.
 *
 * Voor elke aanbieding (winkel-URL) probeert dit script de actuele prijs van de
 * productpagina te lezen, in deze volgorde:
 *   1. JSON-LD structured data (schema.org Product/Offer) - meest betrouwbaar
 *   2. Meta-tags (og:price:amount, product:price:amount, itemprop="price")
 *   3. Een voorzichtige regex op zichtbare prijzen in de HTML
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PAD = resolve(__dirname, "../data/batterijen.json");

const VANDAAG = new Date().toISOString().slice(0, 10);
const TIMEOUT_MS = 20000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 ThuisbatterijVergelijker-prijscheck/1.0";

/* ------------------------------------------------------------------
   Bol.com Marketing Catalog API (officiële partnerroute).
   Bol blokkeert gewone scraping (403); met partner-inloggegevens halen
   we prijzen op via de API. Zonder BOL_CLIENT_ID/BOL_CLIENT_SECRET in
   de omgeving wordt dit overgeslagen en blijft de oude prijs staan.
   Auth: https://api.bol.com/marketing/docs/catalog-api/authentication.html
   ------------------------------------------------------------------ */

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
    if (!ean) return null;
    aanbieding.ean = ean;
  }

  const res = await fetch(`${BOL_BASIS}/products/${ean}/offers/best?country-code=NL`, {
    headers: bolHeaders(token),
  });
  if (res.status === 404) {
    // Geen storing: bol heeft dit artikel op dit moment gewoon niet in de
    // verkoop. De oude prijs blijft staan en komt vanzelf in het overzicht
    // van niet-bevestigde prijzen terecht.
    console.log(`  ~ bol-API ${ean}: bol verkoopt dit artikel nu niet`);
    return null;
  }
  if (!res.ok) {
    console.log(`  ~ bol-API ${ean}: HTTP ${res.status} (respons: ${(await res.text()).slice(0, 300)})`);
    return null;
  }
  const prijs = zoekPrijsInRespons(await res.json());
  return prijs ? Math.round(prijs) : null;
}

/* ------------------------------------------------------------------ */

async function haalPagina(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "nl-NL,nl;q=0.9,en;q=0.6",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parsePrijsWaarde(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/[^\d.,]/g, "");
  if (!s) return null;
  // "1.234,56" (NL) -> 1234.56 ; "1234.56" -> 1234.56 ; "1.299" -> 1299
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  else if (/\.\d{3}$/.test(s)) s = s.replace(/\./g, "");
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function prijsUitJsonLd(html) {
  const blokken = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const blok of blokken) {
    const inhoud = blok.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "");
    let data;
    try { data = JSON.parse(inhoud); } catch { continue; }
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      const kandidaten = [item, ...(item["@graph"] || [])];
      for (const k of kandidaten) {
        if (!k || typeof k !== "object") continue;
        const offers = k.offers ? (Array.isArray(k.offers) ? k.offers : [k.offers]) : [];
        for (const offer of offers) {
          // lowPrice hoort bij een AggregateOffer en is de goedkoopste variant
          // van de pagina - bij een productpagina met varianten (met of zonder
          // P1-meter, kleiner model) is dat niet de prijs van dit product.
          // Alleen de losse price is betrouwbaar genoeg om automatisch over te
          // nemen; de rest laten we aan een mens over.
          const p = parsePrijsWaarde(offer.price);
          if (p) return p;
        }
      }
    }
  }
  return null;
}

function prijsUitMeta(html) {
  const patronen = [
    /<meta[^>]+(?:property|name)=["'](?:og:price:amount|product:price:amount)["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:price:amount|product:price:amount)["']/i,
    /itemprop=["']price["'][^>]*content=["']([^"']+)["']/i,
  ];
  for (const p of patronen) {
    const m = html.match(p);
    if (m) {
      const prijs = parsePrijsWaarde(m[1]);
      if (prijs) return prijs;
    }
  }
  return null;
}

function prijsUitTekst(html) {
  // Voorzichtige fallback: pak de meest voorkomende "€ x.xxx"-prijs op de pagina.
  const matches = html.match(/€\s?([\d.]{3,7}(?:,\d{2})?)/g) || [];
  const telling = new Map();
  for (const m of matches) {
    const p = parsePrijsWaarde(m);
    if (p && p >= 100 && p <= 30000) telling.set(p, (telling.get(p) || 0) + 1);
  }
  let beste = null, max = 0;
  for (const [prijs, n] of telling) {
    if (n > max) { max = n; beste = prijs; }
  }
  return max >= 2 ? beste : null; // alleen bij herhaald voorkomen
}

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
  try {
    let nieuw;
    if (/www\.bol\.com/.test(aanbieding.url) && BOL_CLIENT_ID && BOL_CLIENT_SECRET) {
      nieuw = await bolApiPrijs(aanbieding);
    } else {
      const html = await haalPagina(aanbieding.url);
      nieuw = prijsUitJsonLd(html) ?? prijsUitMeta(html) ?? prijsUitTekst(html);

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
      console.log(`  ~ ${batterij.id} @ ${aanbieding.winkel}: geen prijs gevonden, oude prijs blijft (€${aanbieding.prijs_eur})`);
      // De pagina bestaat wel, maar de prijs staat er niet (meer) in leesbare
      // vorm. Dat is geen kapotte link, dus alleen loggen.
      return false;
    }
    if (!plausibel(nieuw, aanbieding.prijs_eur)) {
      const verschil = Math.round((nieuw / aanbieding.prijs_eur - 1) * 100);
      console.log(`  ! ${batterij.id} @ ${aanbieding.winkel}: gevonden prijs €${nieuw} wijkt ${verschil > 0 ? "+" : ""}${verschil}% af van €${aanbieding.prijs_eur}, overgeslagen`);
      teControleren.push({ id: batterij.id, winkel: aanbieding.winkel, oud: aanbieding.prijs_eur, nieuw, verschil, url: aanbieding.url });
      return false;
    }
    const veranderd = nieuw !== aanbieding.prijs_eur;
    aanbieding.prijs_eur = nieuw;
    aanbieding.datum = VANDAAG;
    console.log(`  ${veranderd ? "✓ NIEUW" : "= gelijk"} ${batterij.id} @ ${aanbieding.winkel}: €${nieuw}`);
    return veranderd;
  } catch (err) {
    console.log(`  x ${batterij.id} @ ${aanbieding.winkel}: ${err.message} (oude prijs blijft staan)`);
    // 404 en 410 betekenen dat de pagina echt weg is; 403 en 429 betekenen
    // meestal dat de winkel geautomatiseerde verzoeken weert. Alleen het eerste
    // is een link die een bezoeker op een foutpagina laat belanden.
    const status = (err.message.match(/HTTP (\d+)/) || [])[1];
    if (status === "404" || status === "410" || err.name === "TypeError") {
      kapotteLinks.push({ id: batterij.id, winkel: aanbieding.winkel, url: aanbieding.url, reden: err.message });
    }
    return false;
  }
}

async function main() {
  const data = JSON.parse(readFileSync(DATA_PAD, "utf8"));
  let wijzigingen = 0;

  for (const batterij of data.batterijen || []) {
    for (const aanbieding of batterij.aanbiedingen || []) {
      if (await updateAanbieding(batterij, aanbieding)) wijzigingen++;
      await new Promise((r) => setTimeout(r, 1500)); // beleefde pauze tussen requests
    }
    // prijs_datum van de batterij = meest recente controle-datum van zijn aanbiedingen
    const datums = (batterij.aanbiedingen || []).map((a) => a.datum).filter(Boolean).sort();
    if (datums.length) batterij.prijs_datum = datums[datums.length - 1];

    for (const aanbieding of batterij.aanbiedingen || []) {
      const dagen = aanbieding.datum
        ? Math.round((Date.now() - new Date(`${aanbieding.datum}T12:00:00`)) / 86400000)
        : null;
      if (dagen === null || dagen >= VEROUDERD_NA_DAGEN) {
        verouderd.push({ id: batterij.id, winkel: aanbieding.winkel, prijs: aanbieding.prijs_eur, dagen });
      }
    }
  }

  data.laatst_bijgewerkt = VANDAAG;
  writeFileSync(DATA_PAD, JSON.stringify(data, null, 2) + "\n", "utf8");
  // De batterijpagina's en sitemap worden hierna herbouwd door
  // scripts/genereer-batterijpaginas.mjs (zie de workflow).

  console.log(`\nKlaar. ${wijzigingen} prijswijziging(en). laatst_bijgewerkt = ${VANDAAG}`);

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
}

main().catch((err) => {
  console.error("Onverwachte fout:", err);
  process.exit(1);
});
