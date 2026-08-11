#!/usr/bin/env node
/**
 * Dagelijkse prijsupdate voor data/panelen.json en data/omvormers.json.
 *
 * Voor elke aanbieding (winkel-URL) probeert dit script de actuele prijs van de
 * productpagina te lezen, in deze volgorde:
 *   1. JSON-LD structured data (schema.org Product/Offer) - meest betrouwbaar
 *   2. Meta-tags (og:price:amount, product:price:amount, itemprop="price")
 *   3. Een voorzichtige regex op zichtbare prijzen in de HTML
 *
 * Veiligheidsregels:
 *   - Een nieuwe prijs wordt alleen overgenomen als hij plausibel is
 *     (tussen 40% en 250% van de laatst bekende prijs).
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

// Per databestand: waar de productlijst staat en welke prijzen geloofwaardig
// zijn (panelen zijn per stuk goedkoop; omvormers lopen op tot enkele duizenden
// euro's en worden soms exclusief btw getoond).
const BESTANDEN = [
  // Panelen kennen geen btw-vraag: bij levering voor een woning geldt het
  // nultarief, dus incl. en excl. btw zijn hetzelfde bedrag. Bij een los
  // verkochte omvormer geldt dat niet, en daar tonen sommige winkels hun
  // prijzen zonder btw. Daarom wordt alleen daar op btw gelet.
  { pad: resolve(__dirname, "../data/panelen.json"), lijst: "panelen", min: 20, max: 2000, btwControle: false },
  { pad: resolve(__dirname, "../data/omvormers.json"), lijst: "omvormers", min: 50, max: 3000, btwControle: true },
];

// Alleen de btw-controle draaien, zonder prijzen aan te raken. Handig om het
// signaal op te halen zonder er een prijswijziging doorheen te mengen.
const ALLEEN_BTW = process.argv.includes("--alleen-btw");

const VANDAAG = new Date().toISOString().slice(0, 10);
const TIMEOUT_MS = 20000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Zonnestroommaatje-prijscheck/1.0";

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
  if (typeof obj.price === "number" && obj.price >= 20 && obj.price <= 2000) return obj.price;
  for (const k of Object.keys(obj)) {
    const p = zoekPrijsInRespons(obj[k]);
    if (p) return p;
  }
  return null;
}

async function bolApiPrijs(aanbieding) {
  const token = await haalBolToken();
  if (!token) return null;
  const m = (aanbieding.url || "").match(/\/(\d{8,})\/?$/);
  if (!m) { console.log(`  ~ bol-API: geen product-id herkend in ${aanbieding.url}`); return null; }
  const res = await fetch(`https://api.bol.com/marketing/catalog/v1/products/${m[1]}/offers/best?country-code=NL`, {
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
  });
  if (!res.ok) {
    console.log(`  ~ bol-API ${m[1]}: HTTP ${res.status} (respons kort: ${(await res.text()).slice(0, 120)})`);
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
      // Een verzoek met alleen een User-Agent valt op: echte browsers sturen
      // altijd een hele set headers mee. Verschillende winkels antwoorden
      // daarom met 403 terwijl de pagina gewoon openbaar is. Dit kost niets en
      // scheelt naar verwachting een deel van die weigeringen; wat er dan nog
      // overblijft is een winkel die het echt niet wil, en dat is te
      // respecteren.
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
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
          const p = parsePrijsWaarde(offer.price ?? offer.lowPrice);
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

function prijsUitTekst(html, grenzen) {
  // Voorzichtige fallback: pak de meest voorkomende "€ x.xxx"-prijs op de pagina.
  const matches = html.match(/€\s?([\d.]{3,7}(?:,\d{2})?)/g) || [];
  const telling = new Map();
  for (const m of matches) {
    const p = parsePrijsWaarde(m);
    if (p && p >= grenzen.min && p <= grenzen.max) telling.set(p, (telling.get(p) || 0) + 1);
  }
  let beste = null, max = 0;
  for (const [prijs, n] of telling) {
    if (n > max) { max = n; beste = prijs; }
  }
  return max >= 2 ? beste : null; // alleen bij herhaald voorkomen
}

/* ------------------------------------------------------------------
   Btw-signaal.

   Wat een winkelpagina over btw zegt is een signaal, geen bewijs: de zin kan
   ook over verzendkosten of een ander artikel gaan. Daarom spreekt deze
   functie zich alleen uit als de pagina eenduidig is, en wordt de uitkomst
   gemeld in plaats van stilzwijgend in de data gezet. Een prijs die 21 procent
   te laag staat zet de hele rangschikking op zijn kop; dat hoort een mens te
   bevestigen.
   ------------------------------------------------------------------ */

const btwTwijfel = [];

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

function meldBtw(product, aanbieding, html) {
  const volgensPagina = btwVolgensPagina(html);
  // Zonder veld gaan wij uit van incl. btw.
  const bijOns = aanbieding.btw_inbegrepen !== false;
  if (volgensPagina === null || volgensPagina === bijOns) return;
  btwTwijfel.push({
    id: product.id,
    winkel: aanbieding.winkel,
    bijOns: bijOns ? "incl. btw" : "excl. btw",
    volgensPagina: volgensPagina ? "incl. btw" : "excl. btw",
    url: aanbieding.url,
  });
}

function plausibel(nieuw, oud, grenzen) {
  if (!oud) return nieuw >= grenzen.min && nieuw <= grenzen.max;
  return nieuw >= oud * 0.4 && nieuw <= oud * 2.5;
}

/* ------------------------------------------------------------------ */

async function updateAanbieding(paneel, aanbieding, grenzen) {
  if (!aanbieding.url) return false;
  try {
    let nieuw;
    if (/www\.bol\.com/.test(aanbieding.url) && BOL_CLIENT_ID && BOL_CLIENT_SECRET) {
      if (ALLEEN_BTW) return false;
      nieuw = await bolApiPrijs(aanbieding);
    } else {
      const html = await haalPagina(aanbieding.url);
      if (grenzen.btwControle) meldBtw(paneel, aanbieding, html);
      if (ALLEEN_BTW) return false;
      nieuw = prijsUitJsonLd(html) ?? prijsUitMeta(html) ?? prijsUitTekst(html, grenzen);
    }
    if (!nieuw) {
      console.log(`  ~ ${paneel.id} @ ${aanbieding.winkel}: geen prijs gevonden, oude prijs blijft (€${aanbieding.prijs_eur})`);
      return false;
    }
    if (!plausibel(nieuw, aanbieding.prijs_eur, grenzen)) {
      console.log(`  ! ${paneel.id} @ ${aanbieding.winkel}: gevonden prijs €${nieuw} niet plausibel t.o.v. €${aanbieding.prijs_eur}, overgeslagen`);
      return false;
    }
    const veranderd = nieuw !== aanbieding.prijs_eur;
    aanbieding.prijs_eur = nieuw;
    aanbieding.datum = VANDAAG;
    console.log(`  ${veranderd ? "✓ NIEUW" : "= gelijk"} ${paneel.id} @ ${aanbieding.winkel}: €${nieuw}`);
    return veranderd;
  } catch (err) {
    console.log(`  x ${paneel.id} @ ${aanbieding.winkel}: ${err.message} (oude prijs blijft staan)`);
    return false;
  }
}

async function main() {
  let wijzigingen = 0;

  for (const bestand of BESTANDEN) {
    console.log(`\n=== ${bestand.lijst} (${bestand.pad}) ===`);
    const data = JSON.parse(readFileSync(bestand.pad, "utf8"));

    for (const product of data[bestand.lijst] || []) {
      for (const aanbieding of product.aanbiedingen || []) {
        if (await updateAanbieding(product, aanbieding, bestand)) wijzigingen++;
        await new Promise((r) => setTimeout(r, 1500)); // beleefde pauze tussen requests
      }
      // prijs_datum van het product = meest recente controle-datum van zijn aanbiedingen
      const datums = (product.aanbiedingen || []).map((a) => a.datum).filter(Boolean).sort();
      if (datums.length) product.prijs_datum = datums[datums.length - 1];
    }

    if (!ALLEEN_BTW) {
      data.laatst_bijgewerkt = VANDAAG;
      writeFileSync(bestand.pad, JSON.stringify(data, null, 2) + "\n", "utf8");
    }
  }
  // De paneelpagina's en sitemap worden hierna herbouwd door
  // scripts/genereer-paneelpaginas.mjs (zie de workflow).

  if (btwTwijfel.length) {
    console.log(`\n${btwTwijfel.length} aanbieding(en) waarbij de winkelpagina iets anders over btw zegt:`);
    for (const b of btwTwijfel) {
      console.log(`  ${b.id} @ ${b.winkel}: bij ons ${b.bijOns}, pagina zegt ${b.volgensPagina}  ${b.url}`);
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
        `### ${btwTwijfel.length} omvormer-aanbieding(en) met twijfel over btw`,
        "",
        "Een prijs excl. btw die als incl. btw wordt getoond scheelt 21 procent en zet de rangschikking op zijn kop. Deze pagina's spreken zich eenduidig uit over btw, maar anders dan wat er bij ons staat. Klopt de pagina, zet dan `\"btw_inbegrepen\": false` bij die aanbieding (of haal het weg).",
        "",
        "Let op: dit is een signaal, geen bewijs. De pagina kan het ook over verzendkosten of een ander artikel hebben.",
        "",
        "Panelen staan hier nooit tussen: bij levering voor een woning geldt het btw-nultarief, dus incl. en excl. btw zijn daar hetzelfde bedrag.",
        "",
        "| Omvormer | Winkel | Bij ons | Volgens de pagina |",
        "| --- | --- | --- | --- |",
        ...btwTwijfel.map((b) => `| ${b.id} | ${b.winkel} | ${b.bijOns} | ${b.volgensPagina} |`),
        "",
      ].join("\n") + "\n");
    }
  }

  console.log(ALLEEN_BTW
    ? "\nAlleen de btw-controle gedraaid; geen prijzen of bestanden aangeraakt."
    : `\nKlaar. ${wijzigingen} prijswijziging(en). laatst_bijgewerkt = ${VANDAAG}`);
}

main().catch((err) => {
  console.error("Onverwachte fout:", err);
  process.exit(1);
});
