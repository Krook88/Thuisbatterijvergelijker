#!/usr/bin/env node
/**
 * Tweede ronde kandidaat-productfoto's, alleen voor batterijen die er nog geen
 * hebben. De eerste ronde keek uitsluitend naar og:image en pakte bij bol de
 * eerste de beste afbeelding-URL; dat bleken miniatuurtjes van ruim 1 kB.
 *
 * Nu per batterij meerdere bronnen, en per bron de grootste die er te vinden is:
 *   1. bol-catalogus (/products/{ean}/media) - alle varianten, grootste wint
 *   2. de productpagina van de fabrikant
 *   3. de winkelpagina's uit de aanbiedingen
 *
 * Per pagina wordt gekeken naar og:image, de image-velden in schema.org-markup,
 * en de gewone <img>-tags inclusief srcset. Duidelijke niet-producten (logo,
 * icoon, vlag, spinner) vallen meteen af.
 *
 * Het script kiest niets: het bewaart per batterij de twee grootste vondsten,
 * zodat er daarna met het oog beoordeeld kan worden.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PAD = resolve(__dirname, "../data/batterijen.json");
const UIT = resolve(__dirname, "../assets/producten/_ruw2");
const ALLEEN = process.argv.slice(2);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const BOL_BASIS = "https://api.bol.com/marketing/catalog/v1";
const ID = process.env.BOL_CLIENT_ID || "";
const SECRET = process.env.BOL_CLIENT_SECRET || "";

const MINIMUM_BYTES = 12000;   // kleiner dan dit is een pictogram, geen productfoto
const MAX_PER_PAGINA = 8;      // niet elke afbeelding van een webshop ophalen

const ROMMEL = /(logo|icon|sprite|favicon|spinner|loader|placeholder|avatar|vlag|flag|badge|keurmerk|betaal|payment|trustpilot|social|pixel|banner|header|footer)/i;

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

function isAfbeelding(u) {
  return /^https?:\/\/[^\s"']+\.(jpe?g|png|webp)(\?[^\s"']*)?$/i.test(u);
}

function verzamelUitJson(obj, uit = []) {
  if (obj == null) return uit;
  if (typeof obj === "string") {
    if (isAfbeelding(obj)) uit.push(obj);
    return uit;
  }
  if (typeof obj !== "object") return uit;
  for (const k of Object.keys(obj)) verzamelUitJson(obj[k], uit);
  return uit;
}

async function bolMedia(ean) {
  const t = await token();
  if (!t) return [];
  const res = await fetch(`${BOL_BASIS}/products/${ean}/media?country-code=NL`, {
    headers: { Authorization: `Bearer ${t}`, Accept: "application/json", "Accept-Language": "nl" },
  });
  if (!res.ok) return [];
  return verzamelUitJson(await res.json());
}

function ontsnap(s) {
  return s
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

// Uit een srcset de variant met de grootste breedte halen.
function grootsteUitSrcset(srcset) {
  let beste = null;
  let besteBreedte = -1;
  for (const deel of srcset.split(",")) {
    const stukken = deel.trim().split(/\s+/);
    if (!stukken[0]) continue;
    const breedte = parseInt((stukken[1] || "").replace(/\D/g, ""), 10) || 0;
    if (breedte >= besteBreedte) { besteBreedte = breedte; beste = stukken[0]; }
  }
  return beste;
}

async function kandidatenVanPagina(paginaUrl) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(paginaUrl, {
      signal: ctrl.signal, redirect: "follow",
      headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "nl-NL,nl;q=0.9" },
    });
    if (!res.ok) return { fout: `HTTP ${res.status}`, urls: [] };
    const html = await res.text();
    const rauw = [];

    for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]+content=["']([^"']+)["']/gi)) {
      rauw.push(m[1]);
    }
    for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try { verzamelUitJson(JSON.parse(m[1].trim()), rauw); } catch { /* onleesbare markup overslaan */ }
    }
    for (const m of html.matchAll(/<img[^>]+>/gi)) {
      const tag = m[0];
      const srcset = (tag.match(/(?:data-)?srcset=["']([^"']+)["']/i) || [])[1];
      if (srcset) { const g = grootsteUitSrcset(ontsnap(srcset)); if (g) rauw.push(g); }
      const src = (tag.match(/(?:data-src|data-original|src)=["']([^"']+)["']/i) || [])[1];
      if (src) rauw.push(src);
    }

    const uniek = [];
    for (const r of rauw) {
      let u;
      try { u = new URL(ontsnap(r), res.url).href; } catch { continue; }
      if (!isAfbeelding(u) || ROMMEL.test(u) || uniek.includes(u)) continue;
      uniek.push(u);
      if (uniek.length >= MAX_PER_PAGINA) break;
    }
    return { urls: uniek };
  } catch (e) {
    return { fout: e.name === "AbortError" ? "te traag" : e.message, urls: [] };
  } finally {
    clearTimeout(t);
  }
}

async function download(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal, redirect: "follow",
      headers: { "User-Agent": UA, Accept: "image/*" },
    });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") || "").split(";")[0];
    if (!/^image\//.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < MINIMUM_BYTES) return null;
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[type];
    if (!ext) return null;
    return { buf, ext, bytes: buf.length, url };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const data = JSON.parse(readFileSync(DATA_PAD, "utf8"));
mkdirSync(UIT, { recursive: true });

const verslag = [];
for (const b of data.batterijen || []) {
  if (b.afbeelding) continue; // deze heeft er al een
  // Met id's als argument alleen die batterijen ophalen; scheelt de andere
  // winkels een onnodig bezoek.
  if (ALLEEN.length && !ALLEEN.includes(b.id)) continue;

  const bronnen = [];
  const ean = (b.aanbiedingen || []).map((a) => a.ean).find((e) => /^\d{13}$/.test(e || ""));
  if (ean) bronnen.push({ soort: "bol", urls: await bolMedia(ean) });
  if (b.product_url) {
    const r = await kandidatenVanPagina(b.product_url);
    bronnen.push({ soort: "fabrikant", pagina: b.product_url, ...r });
  }
  for (const a of (b.aanbiedingen || []).slice(0, 2)) {
    if (!a.url || /bol\.com/.test(a.url)) continue;
    const r = await kandidatenVanPagina(a.url);
    bronnen.push({ soort: `winkel (${a.winkel})`, pagina: a.url, ...r });
  }

  const vondsten = [];
  for (const bron of bronnen) {
    for (const url of (bron.urls || []).slice(0, MAX_PER_PAGINA)) {
      const d = await download(url);
      if (d) vondsten.push({ ...d, soort: bron.soort });
    }
  }
  vondsten.sort((x, y) => y.bytes - x.bytes);

  const bewaard = [];
  for (const [i, v] of vondsten.slice(0, 2).entries()) {
    const naam = `${b.id}--${i + 1}.${v.ext}`;
    writeFileSync(resolve(UIT, naam), v.buf);
    bewaard.push({ bestand: naam, bytes: v.bytes, soort: v.soort, herkomst: v.url });
  }

  verslag.push({
    id: b.id, merk: b.merk, model: b.model,
    bekeken: bronnen.map((x) => `${x.soort}=${x.fout || (x.urls || []).length + " kandidaten"}`),
    bewaard,
  });
  console.log(`${bewaard.length ? "+" : " "} ${b.id}: ${bewaard.map((x) => `${Math.round(x.bytes / 1024)}kB via ${x.soort}`).join(", ") || "niets bruikbaars"}`);
}

writeFileSync(resolve(UIT, "verslag.json"), JSON.stringify(verslag, null, 2) + "\n", "utf8");
const raak = verslag.filter((r) => r.bewaard.length).length;
console.log(`\n${raak} van de ${verslag.length} batterijen zonder foto leverde een kandidaat op.`);
