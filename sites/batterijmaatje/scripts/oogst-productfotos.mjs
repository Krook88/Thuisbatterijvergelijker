#!/usr/bin/env node
/**
 * Haalt kandidaat-productfoto's op, zodat ze daarna met de hand beoordeeld
 * kunnen worden. Dit script kiest niets: het verzamelt alleen.
 *
 * Twee bronnen per batterij:
 *   1. bol.com Catalog API (/products/{ean}/media) - meestal nette
 *      catalogusfoto's op witte achtergrond.
 *   2. De og:image van de productpagina van de fabrikant - wisselend van
 *      kwaliteit, soms een sfeerfoto of een bannerplaat.
 *
 * Alles belandt in assets/producten/_ruw/ met een verslag in _ruw/verslag.json.
 * Die map hoort niet in de uiteindelijke site terecht te komen.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PAD = resolve(__dirname, "../data/batterijen.json");
const UIT = resolve(__dirname, "../assets/producten/_ruw");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const BOL_BASIS = "https://api.bol.com/marketing/catalog/v1";
const ID = process.env.BOL_CLIENT_ID || "";
const SECRET = process.env.BOL_CLIENT_SECRET || "";

let bolToken = null;
async function token() {
  if (!ID || !SECRET) return null;
  if (bolToken) return bolToken;
  const res = await fetch("https://login.bol.com/token?grant_type=client_credentials", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${ID}:${SECRET}`).toString("base64"),
      Accept: "application/json",
    },
  });
  if (!res.ok) return null;
  bolToken = (await res.json()).access_token;
  return bolToken;
}

// Zoek in een willekeurige API-respons naar de grootste afbeelding-URL.
function zoekAfbeeldingen(obj, uit = []) {
  if (obj == null) return uit;
  if (typeof obj === "string") {
    if (/^https?:\/\/\S+\.(jpe?g|png|webp)(\?|$)/i.test(obj)) uit.push(obj);
    return uit;
  }
  if (typeof obj !== "object") return uit;
  for (const k of Object.keys(obj)) zoekAfbeeldingen(obj[k], uit);
  return uit;
}

async function bolMedia(ean) {
  const t = await token();
  if (!t) return [];
  const res = await fetch(`${BOL_BASIS}/products/${ean}/media?country-code=NL`, {
    headers: { Authorization: `Bearer ${t}`, Accept: "application/json", "Accept-Language": "nl" },
  });
  if (!res.ok) return [];
  return zoekAfbeeldingen(await res.json());
}

function ontsnapAf(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function ogAfbeelding(paginaUrl) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(paginaUrl, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "nl-NL,nl;q=0.9" },
    });
    if (!res.ok) return { fout: `HTTP ${res.status}` };
    const html = await res.text();
    const kandidaten = [];
    for (const re of [
      /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/gi,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/gi,
    ]) {
      for (const m of html.matchAll(re)) kandidaten.push(ontsnapAf(m[1]));
    }
    if (!kandidaten.length) return { fout: "geen og:image" };
    return { url: new URL(kandidaten[0], res.url).href };
  } catch (e) {
    return { fout: e.name === "AbortError" ? "te traag" : e.message };
  } finally {
    clearTimeout(t);
  }
}

async function download(url, basisnaam) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "image/*" },
    });
    if (!res.ok) return { fout: `HTTP ${res.status}` };
    const type = (res.headers.get("content-type") || "").split(";")[0];
    if (!/^image\//.test(type)) return { fout: `geen afbeelding (${type})` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 4000) return { fout: `te klein (${buf.length} bytes)` };
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" }[type] || "bin";
    const naam = `${basisnaam}.${ext}`;
    writeFileSync(resolve(UIT, naam), buf);
    return { bestand: naam, bytes: buf.length, type };
  } catch (e) {
    return { fout: e.name === "AbortError" ? "te traag" : e.message };
  } finally {
    clearTimeout(t);
  }
}

const data = JSON.parse(readFileSync(DATA_PAD, "utf8"));
mkdirSync(UIT, { recursive: true });

const verslag = [];
for (const b of data.batterijen || []) {
  const regel = { id: b.id, merk: b.merk, model: b.model, bronnen: [] };

  const ean = (b.aanbiedingen || []).map((a) => a.ean).find((e) => /^\d{13}$/.test(e || ""));
  if (ean) {
    const urls = await bolMedia(ean);
    if (urls.length) {
      const r = await download(urls[0], `${b.id}--bol`);
      regel.bronnen.push({ bron: "bol", herkomst: urls[0], ...r });
    } else {
      regel.bronnen.push({ bron: "bol", fout: "geen media" });
    }
  }

  if (b.product_url) {
    const og = await ogAfbeelding(b.product_url);
    if (og.url) {
      const r = await download(og.url, `${b.id}--fabrikant`);
      regel.bronnen.push({ bron: "fabrikant", pagina: b.product_url, herkomst: og.url, ...r });
    } else {
      regel.bronnen.push({ bron: "fabrikant", pagina: b.product_url, fout: og.fout });
    }
  }

  const gelukt = regel.bronnen.filter((x) => x.bestand).length;
  console.log(`${gelukt ? "+" : " "} ${b.id}: ${regel.bronnen.map((x) => `${x.bron}=${x.bestand || x.fout}`).join(", ")}`);
  verslag.push(regel);
}

writeFileSync(resolve(UIT, "verslag.json"), JSON.stringify(verslag, null, 2) + "\n", "utf8");

const totaal = verslag.reduce((n, r) => n + r.bronnen.filter((x) => x.bestand).length, 0);
const metFoto = verslag.filter((r) => r.bronnen.some((x) => x.bestand)).length;
console.log(`\n${totaal} bestand(en) opgehaald voor ${metFoto} van de ${verslag.length} batterijen.`);
