#!/usr/bin/env node
/**
 * Maakt schermafdrukken van de belangrijkste pagina's, zodat je een wijziging
 * naast de vorige versie kunt leggen in plaats van op je geheugen te varen.
 *
 * Werkwijze:
 *   node scripts/schermafdrukken.mjs --voor      leg de huidige site vast
 *   ... wijzig iets ...
 *   node scripts/schermafdrukken.mjs --na        leg de nieuwe situatie vast
 *   node scripts/schermafdrukken.mjs --verschil  zet ze naast elkaar
 *
 * De afdrukken belanden in .schermafdrukken/ en horen niet in de repository;
 * die map staat in .gitignore.
 *
 * Gedeeld met de zustersites via kern/. Welke pagina's er in gaan staat per
 * site in scripts/paginas.json.
 */

import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { paginasVan } from "./paginas.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const MAP = resolve(ROOT, ".schermafdrukken");

const VOOR = process.argv.includes("--voor");
const NA = process.argv.includes("--na");
const VERSCHIL = process.argv.includes("--verschil");
if (!VOOR && !NA && !VERSCHIL) {
  console.error("Geef --voor, --na of --verschil mee.");
  process.exit(1);
}

const PAGINAS = paginasVan(ROOT);
const BREEDTES = [390, 1280];

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

async function vastleggen(fase) {
  const doel = resolve(MAP, fase);
  mkdirSync(doel, { recursive: true });
  const { chromium, devices } = await import("playwright");
  const { s, poort } = await server();
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  let n = 0;
  for (const breedte of BREEDTES) {
    // De smalle afdruk krijgt een aanraakscherm mee. Zonder dat blijven de
    // regels achter @media (pointer: coarse) uit, en laat de afdruk dus iets
    // anders zien dan wat er op een telefoon staat - precies de plek waar de
    // aanraakvlakken zitten.
    const page = breedte === 390
      ? await (await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })).newPage()
      : await browser.newPage({ viewport: { width: breedte, height: 900 } });
    for (const [naam, pad] of PAGINAS) {
      if (!existsSync(join(ROOT, pad))) continue;
      await page.goto(`http://127.0.0.1:${poort}${pad}`, { waitUntil: "networkidle" });
      // Lui ladende afbeeldingen forceren, anders staan er lege vakken op de
      // afdruk. Daarna echt wachten tot ze binnen zijn: een afdruk van een lange
      // pagina vangt anders de ene keer wel en de andere keer niet een plaatje
      // dat nog aan het decoderen is, en dan verschillen twee afdrukken van
      // dezelfde onveranderde pagina.
      await page.evaluate(() => [...document.images].forEach((i) => { i.loading = "eager"; }));
      await page.evaluate(async () => {
        const wachten = [...document.images].filter((i) => !i.complete)
          .map((i) => new Promise((klaar) => { i.addEventListener("load", klaar, { once: true }); i.addEventListener("error", klaar, { once: true }); }));
        await Promise.race([Promise.all(wachten), new Promise((r) => setTimeout(r, 8000))]);
        await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
        if (document.fonts) await document.fonts.ready;
      });
      await page.waitForTimeout(400);
      await page.screenshot({ path: resolve(doel, `${naam}-${breedte}.png`), fullPage: true });
      n++;
    }
    await page.close();
  }
  await browser.close();
  s.close();
  console.log(`${n} afdrukken bewaard in .schermafdrukken/${fase}/`);
}

async function verschil() {
  const sharp = (await import("sharp")).default;
  const voor = resolve(MAP, "voor"), na = resolve(MAP, "na");
  if (!existsSync(voor) || !existsSync(na)) {
    console.error("Maak eerst --voor en --na.");
    process.exit(1);
  }
  const doel = resolve(MAP, "verschil");
  mkdirSync(doel, { recursive: true });
  let gelijk = 0, anders = 0;
  for (const naam of readdirSync(voor).filter((f) => f.endsWith(".png"))) {
    const a = resolve(voor, naam), b = resolve(na, naam);
    if (!existsSync(b)) { console.log(`  alleen in voor: ${naam}`); continue; }
    const [ma, mb] = await Promise.all([sharp(a).metadata(), sharp(b).metadata()]);
    const H = Math.max(ma.height, mb.height), B = Math.max(ma.width, mb.width);
    const same = Buffer.compare(readFileSync(a), readFileSync(b)) === 0;
    same ? gelijk++ : anders++;
    await sharp({ create: { width: B * 2 + 16, height: H + 26, channels: 3, background: "#cbd5e1" } })
      .composite([
        { input: await sharp(a).png().toBuffer(), left: 0, top: 26 },
        { input: await sharp(b).png().toBuffer(), left: B + 16, top: 26 },
        { input: Buffer.from(`<svg width="${B * 2 + 16}" height="26"><rect width="100%" height="100%" fill="#1e293b"/><text x="6" y="18" font-family="sans-serif" font-size="13" fill="#fff">${naam}  —  links: voor, rechts: na${same ? "  (identiek)" : ""}</text></svg>`), left: 0, top: 0 },
      ]).png().toFile(resolve(doel, naam));
  }
  console.log(`Vergelijkingen in .schermafdrukken/verschil/  (${anders} gewijzigd, ${gelijk} identiek)`);
}

if (VOOR) await vastleggen("voor");
if (NA) await vastleggen("na");
if (VERSCHIL) await verschil();
