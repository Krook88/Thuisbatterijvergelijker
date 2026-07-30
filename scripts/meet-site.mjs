#!/usr/bin/env node
/**
 * Meet de site op de punten die er voor een bezoeker toe doen, zodat een
 * verbetering aantoonbaar is in plaats van aannemelijk.
 *
 * Gemeten wordt per pagina, standaard op een telefoonscherm:
 *   - hoe hoog de navigatie is voordat de inhoud begint;
 *   - waar de eerste knop staat (hoe ver moet je scrollen voor je iets kunt);
 *   - hoeveel aanklikbare dingen kleiner zijn dan 44 pixels, de maat waarop
 *     een duim betrouwbaar raakt. Tekstlinks binnen een alinea tellen niet
 *     mee: die horen met de regelhoogte mee te lopen;
 *   - het gewicht van de pagina en het aantal verzoeken.
 *
 * Gebruik:
 *   node scripts/meet-site.mjs                 meet en toon een tabel
 *   node scripts/meet-site.mjs --bewaar        schrijf de uitkomst weg als ijkpunt
 *   node scripts/meet-site.mjs --vergelijk     zet de uitkomst naast het ijkpunt
 *   node scripts/meet-site.mjs --breed         meet op 1280 in plaats van 390
 *
 * Vereist playwright en een lokale server; beide regelt dit script zelf.
 */

import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const IJKPUNT = resolve(ROOT, "meting-ijkpunt.json");

const BEWAAR = process.argv.includes("--bewaar");
const VERGELIJK = process.argv.includes("--vergelijk");
const BREED = process.argv.includes("--breed");
const BREEDTE = BREED ? 1280 : 390;
const HOOGTE = BREED ? 900 : 844;

// De pagina's waar het meeste verkeer op landt of waar de meeste interactie
// zit. Meer meten maakt de tabel onleesbaar zonder iets toe te voegen.
const PAGINAS = [
  ["vergelijker", "/index.html"],
  ["keuzehulp", "/advies.html"],
  ["rekenmodule", "/rekenmodule.html"],
  ["uitleg", "/uitleg.html"],
  ["contact", "/contact.html"],
];

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".webp": "image/webp", ".png": "image/png",
  ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon",
};

function server() {
  return new Promise((klaar) => {
    const s = createServer((req, res) => {
      const pad = join(ROOT, decodeURIComponent(req.url.split("?")[0]));
      if (!pad.startsWith(ROOT) || !existsSync(pad) || !statSync(pad).isFile()) {
        res.writeHead(404).end("niet gevonden");
        return;
      }
      res.writeHead(200, { "Content-Type": TYPES[extname(pad)] || "application/octet-stream" });
      res.end(readFileSync(pad));
    });
    s.listen(0, "127.0.0.1", () => klaar({ s, poort: s.address().port }));
  });
}

async function meet(page, url) {
  let bytes = 0, verzoeken = 0;
  const tel = async (r) => { verzoeken++; try { bytes += (await r.body()).length; } catch { /* redirect of afgebroken */ } };
  page.on("response", tel);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  page.off("response", tel);

  const uit = await page.evaluate(() => {
    const kop = document.querySelector("header, .site-header");
    const knop = document.querySelector("a.knop, button.knop, .hero a, .knop");
    // Alleen zelfstandige aanraakvlakken. Een link midden in een zin hoort de
    // regelhoogte te volgen en is geen knop.
    const inTekst = (e) => e.closest("p, li, .disclaimer, .hint, dd, .legenda");
    const raakbaar = [...document.querySelectorAll("a,button,input,select,summary,label")]
      .filter((e) => e.getClientRects().length && !inTekst(e));
    const klein = raakbaar.filter((e) => e.getBoundingClientRect().height < 44);
    const perSoort = {};
    for (const e of klein) {
      const k = (e.className || "").toString().trim().split(/\s+/)[0] || e.tagName.toLowerCase();
      perSoort[k] = (perSoort[k] || 0) + 1;
    }
    return {
      navHoogte: kop ? Math.round(kop.getBoundingClientRect().height) : null,
      eersteKnopOp: knop ? Math.round(knop.getBoundingClientRect().top + window.scrollY) : null,
      raakbaar: raakbaar.length,
      teKlein: klein.length,
      teKleinPerSoort: Object.fromEntries(Object.entries(perSoort).sort((a, b) => b[1] - a[1]).slice(0, 5)),
      horizontaalSchuiven: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  return { ...uit, kB: Math.round(bytes / 1024), verzoeken };
}

const { chromium } = await import("playwright");
const { s, poort } = await server();
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: BREEDTE, height: HOOGTE } });

const nu = { breedte: BREEDTE, gemetenOp: new Date().toISOString().slice(0, 10), paginas: {} };
for (const [naam, pad] of PAGINAS) {
  if (!existsSync(join(ROOT, pad))) { console.log(`overgeslagen: ${pad} bestaat niet`); continue; }
  nu.paginas[naam] = await meet(page, `http://127.0.0.1:${poort}${pad}`);
}
await browser.close();
s.close();

const oud = VERGELIJK && existsSync(IJKPUNT) ? JSON.parse(readFileSync(IJKPUNT, "utf8")) : null;
if (VERGELIJK && !oud) console.log("Geen ijkpunt gevonden; draai eerst met --bewaar.\n");

const pijl = (nieuw, vorig, lagerIsBeter = true) => {
  if (vorig == null || nieuw == null || nieuw === vorig) return "";
  const beter = lagerIsBeter ? nieuw < vorig : nieuw > vorig;
  return ` (${nieuw > vorig ? "+" : ""}${nieuw - vorig}${beter ? " beter" : " slechter"})`;
};

console.log(`Gemeten op ${BREEDTE}px breed\n`);
console.log(`${"pagina".padEnd(14)} ${"nav".padStart(6)} ${"1e knop".padStart(9)} ${"te klein".padStart(12)} ${"kB".padStart(6)} ${"verzoeken".padStart(10)}`);
const px = (n) => (n == null ? "     —" : String(n).padStart(4) + "px");
for (const [naam, m] of Object.entries(nu.paginas)) {
  const v = oud?.paginas?.[naam];
  console.log(
    `${naam.padEnd(14)} ${px(m.navHoogte)} ${px(m.eersteKnopOp).padStart(9)} ` +
    `${(m.teKlein + "/" + m.raakbaar).padStart(12)} ${String(m.kB).padStart(6)} ${String(m.verzoeken).padStart(10)}` +
    (v ? `\n${"".padEnd(14)} ${pijl(m.navHoogte, v.navHoogte).trim()} ${pijl(m.eersteKnopOp, v.eersteKnopOp).trim()} ${pijl(m.teKlein, v.teKlein).trim()}` : ""),
  );
}

const schuift = Object.entries(nu.paginas).filter(([, m]) => m.horizontaalSchuiven).map(([n]) => n);
console.log(`\nhorizontaal schuiven: ${schuift.length ? schuift.join(", ") : "nergens"}`);

const soorten = {};
for (const m of Object.values(nu.paginas)) {
  for (const [k, n] of Object.entries(m.teKleinPerSoort)) soorten[k] = (soorten[k] || 0) + n;
}
console.log("\nte kleine aanraakvlakken, meest voorkomend:");
for (const [k, n] of Object.entries(soorten).sort((a, b) => b[1] - a[1]).slice(0, 6)) {
  console.log(`  ${String(n).padStart(4)}  ${k}`);
}

if (BEWAAR) {
  writeFileSync(IJKPUNT, JSON.stringify(nu, null, 2) + "\n", "utf8");
  console.log(`\nIJkpunt weggeschreven naar ${IJKPUNT.replace(ROOT + "/", "")}`);
}
