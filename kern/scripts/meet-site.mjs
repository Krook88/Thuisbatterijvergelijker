#!/usr/bin/env node
/**
 * Meet de site op de punten die er voor een bezoeker toe doen, zodat een
 * verbetering aantoonbaar is in plaats van aannemelijk.
 *
 * Gemeten wordt per pagina, standaard op een telefoonscherm:
 *   - hoe hoog de navigatie is voordat de inhoud begint;
 *   - waar de eerste knop staat (hoe ver moet je scrollen voor je iets kunt);
 *   - hoeveel aanklikbare dingen te klein zijn, tegen twee grenzen: 24 pixels
 *     (WCAG 2.5.8, niveau AA - hieronder is het een gebrek) en 44 pixels
 *     (niveau AAA en de Apple-richtlijn - de maat waarop een duim betrouwbaar
 *     raakt). Tekstlinks binnen een alinea tellen niet mee: die horen met de
 *     regelhoogte mee te lopen. Elementen die alleen voor een schermlezer
 *     bestaan ook niet;
 *   - het gewicht van de pagina en het aantal verzoeken.
 *
 * Gebruik:
 *   node scripts/meet-site.mjs                 meet en toon een tabel
 *   node scripts/meet-site.mjs --bewaar        schrijf de uitkomst weg als ijkpunt
 *   node scripts/meet-site.mjs --vergelijk     zet de uitkomst naast het ijkpunt
 *   node scripts/meet-site.mjs --breed         meet op 1280 in plaats van 390
 *
 * Vereist playwright en een lokale server; beide regelt dit script zelf.
 *
 * Gedeeld met de zustersites via kern/. Wat per site verschilt is alleen de
 * lijst pagina's, en die staat in scripts/paginas.json naast dit script.
 */

import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { paginasVan } from "./paginas.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const IJKPUNT = resolve(ROOT, "meting-ijkpunt.json");

const BEWAAR = process.argv.includes("--bewaar");
const VERGELIJK = process.argv.includes("--vergelijk");
const BREED = process.argv.includes("--breed");
const BREEDTE = BREED ? 1280 : 390;
const HOOGTE = BREED ? 900 : 844;

// Welke pagina's: zie scripts/paginas.json in de site zelf.
const PAGINAS = paginasVan(ROOT);

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
    const inTekst = (e) => {
      if (e.closest("p, li, .disclaimer, .hint, dd, .legenda")) return true;
      // Niet elke lap tekst zit in een <p>. Een gewone link met veel tekst
      // omheen is een tekstlink, ook als de opmaak dat niet zegt; WCAG 2.5.8
      // maakt daar met zoveel woorden een uitzondering voor ("in a sentence
      // or block of text"). Een knop valt daar niet onder: die is een
      // zelfstandig bedieningselement, ook midden in een alinea. Vandaar de
      // beperking tot <a> zonder knop-opmaak.
      if (e.tagName !== "A" || e.classList.contains("knop")) return false;
      const ouder = e.parentElement;
      if (!ouder) return false;
      return ouder.textContent.length - e.textContent.length >= 40;
    };
    // Een element dat alleen voor een schermlezer bestaat is geen aanraakvlak.
    // Het heeft wel een rechthoek van een pixel, en telde daardoor mee als de
    // allerkleinste van de pagina.
    const alleenVoorLezer = (e) => e.closest(".visueel-verborgen");
    const raakbaar = [...document.querySelectorAll("a,button,input,select,summary,label")]
      .filter((e) => e.getClientRects().length && !inTekst(e) && !alleenVoorLezer(e));
    // Een vinkje in een label is niet zelf het aanraakvlak: het label eromheen
    // vangt de tik. Het label wordt hieronder los gemeten, dus het vinkje
    // meetellen zou hetzelfde raakvlak twee keer tellen - en de tweede keer
    // met een hoogte (13 pixels) die niemand ooit aanraakt.
    const gedektDoorLabel = (e) => {
      const l = e.closest("label");
      return !!l && l !== e;
    };
    const hoogteVan = (e) => e.getBoundingClientRect().height;
    // Twee grenzen, want ze betekenen niet hetzelfde.
    //
    //   24px  WCAG 2.5.8, niveau AA. Hieronder is het een gebrek.
    //   44px  WCAG 2.5.5 (AAA) en de Apple-richtlijn: de maat waarop een duim
    //         betrouwbaar raakt. Ertussenin is het te verdedigen.
    //
    // Op één hoop gooien stuurt de verkeerde kant op: een link van 16 pixels
    // en een van 38 tellen dan even zwaar, terwijl alleen de eerste stuk is en
    // de tweede oprekken de buurman kan gaan overlappen.
    const bruikbaar = raakbaar.filter((e) => !gedektDoorLabel(e));
    const klein = bruikbaar.filter((e) => hoogteVan(e) < 44);
    const teKlein = bruikbaar.filter((e) => hoogteVan(e) < 24);
    // Alleen tellen hoeveel er onder de grens zitten verbergt vooruitgang: een
    // raakvlak dat van 17 naar 35 pixels groeit telt nog steeds mee. De
    // mediaan laat zien of het de goede kant op gaat.
    const hoogtes = klein.map((e) => Math.round(hoogteVan(e))).sort((a, b) => a - b);
    const mediaan = hoogtes.length ? hoogtes[Math.floor(hoogtes.length / 2)] : null;
    const soort = (e) => (e.className || "").toString().trim().split(/\s+/)[0] || e.tagName.toLowerCase();
    const perSoort = {};
    for (const e of teKlein) perSoort[soort(e)] = (perSoort[soort(e)] || 0) + 1;
    return {
      navHoogte: kop ? Math.round(kop.getBoundingClientRect().height) : null,
      eersteKnopOp: knop ? Math.round(knop.getBoundingClientRect().top + window.scrollY) : null,
      raakbaar: raakbaar.length,
      onderAA: teKlein.length,
      teKlein: klein.length,
      mediaanTeKlein: mediaan,
      teKleinPerSoort: Object.fromEntries(Object.entries(perSoort).sort((a, b) => b[1] - a[1]).slice(0, 5)),
      horizontaalSchuiven: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  return { ...uit, kB: Math.round(bytes / 1024), verzoeken };
}

const { chromium, devices } = await import("playwright");
const { s, poort } = await server();
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
// Een telefoon meten zonder aanraakscherm te emuleren geeft een verkeerd
// beeld: de regels achter @media (pointer: coarse) blijven dan uit, terwijl
// ze op een echt toestel juist gelden.
const context = await browser.newContext(
  BREED
    ? { viewport: { width: BREEDTE, height: HOOGTE } }
    : { ...devices["Pixel 7"], viewport: { width: BREEDTE, height: HOOGTE } },
);
const page = await context.newPage();

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
console.log(`${"pagina".padEnd(14)} ${"nav".padStart(6)} ${"1e knop".padStart(9)} ${"< 24px".padStart(8)} ${"< 44px".padStart(12)} ${"mediaan".padStart(9)} ${"kB".padStart(6)}`);
const px = (n) => (n == null ? "     —" : String(n).padStart(4) + "px");
for (const [naam, m] of Object.entries(nu.paginas)) {
  const v = oud?.paginas?.[naam];
  console.log(
    `${naam.padEnd(14)} ${px(m.navHoogte)} ${px(m.eersteKnopOp).padStart(9)} ` +
    `${String(m.onderAA ?? "?").padStart(8)} ${(m.teKlein + "/" + m.raakbaar).padStart(12)} ${(m.mediaanTeKlein == null ? "—" : m.mediaanTeKlein + "px").padStart(9)} ${String(m.kB).padStart(6)}` +
    (v ? `\n${"".padEnd(14)} ${pijl(m.navHoogte, v.navHoogte).trim()} ${pijl(m.eersteKnopOp, v.eersteKnopOp).trim()} ${pijl(m.onderAA, v.onderAA).trim()} ${pijl(m.teKlein, v.teKlein).trim()} ${pijl(m.mediaanTeKlein, v.mediaanTeKlein, false).trim()}` : ""),
  );
}

const schuift = Object.entries(nu.paginas).filter(([, m]) => m.horizontaalSchuiven).map(([n]) => n);
console.log(`\nhorizontaal schuiven: ${schuift.length ? schuift.join(", ") : "nergens"}`);

const soorten = {};
for (const m of Object.values(nu.paginas)) {
  for (const [k, n] of Object.entries(m.teKleinPerSoort)) soorten[k] = (soorten[k] || 0) + n;
}
console.log("\naanraakvlakken onder de 24 pixels (WCAG AA), meest voorkomend:");
for (const [k, n] of Object.entries(soorten).sort((a, b) => b[1] - a[1]).slice(0, 6)) {
  console.log(`  ${String(n).padStart(4)}  ${k}`);
}

if (BEWAAR) {
  writeFileSync(IJKPUNT, JSON.stringify(nu, null, 2) + "\n", "utf8");
  console.log(`\nIJkpunt weggeschreven naar ${IJKPUNT.replace(ROOT + "/", "")}`);
}
