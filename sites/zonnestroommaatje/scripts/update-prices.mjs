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

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Per databestand: waar de productlijst staat en welke prijzen geloofwaardig
// zijn (panelen zijn per stuk goedkoop; omvormers lopen op tot enkele duizenden
// euro's en worden soms exclusief btw getoond).
const BESTANDEN = [
  { pad: resolve(__dirname, "../data/panelen.json"), lijst: "panelen", min: 20, max: 2000 },
  { pad: resolve(__dirname, "../data/omvormers.json"), lijst: "omvormers", min: 50, max: 3000 },
];

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
      nieuw = await bolApiPrijs(aanbieding);
    } else {
      const html = await haalPagina(aanbieding.url);
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

    data.laatst_bijgewerkt = VANDAAG;
    writeFileSync(bestand.pad, JSON.stringify(data, null, 2) + "\n", "utf8");
  }
  // De paneelpagina's en sitemap worden hierna herbouwd door
  // scripts/genereer-paneelpaginas.mjs (zie de workflow).

  console.log(`\nKlaar. ${wijzigingen} prijswijziging(en). laatst_bijgewerkt = ${VANDAAG}`);
}

main().catch((err) => {
  console.error("Onverwachte fout:", err);
  process.exit(1);
});
