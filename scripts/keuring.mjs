/**
 * Keuring: klopt het nog, op elke pagina van de drie sites?
 *
 * Vier dingen die door een verbouwing stuk kunnen gaan en die je niet ziet
 * door naar één pagina te kijken:
 *
 *  1. contrast (WCAG 1.4.3 AA: 4,5:1, of 3:1 voor grote tekst)
 *  2. aanraakvlakken (WCAG 2.5.8 AA: 24 bij 24 pixels)
 *  3. tekstmaten en hoekrondingen buiten de maatlat
 *  4. javascriptfouten
 *
 * Dit script stond maandenlang in een tijdelijke map en is drie keer
 * weggegooid bij een herstart van de omgeving. Het gereedschap dat de fouten
 * vangt, hoort in de repo te staan, niet naast je bureau.
 *
 * Draaien: npm run keuring        (of: node scripts/keuring.mjs)
 *          npm run keuring -- batterijmaatje      voor één site
 *
 * Playwright is de enige afhankelijkheid van de hele repo en staat er bewust
 * niet standaard in. Ontbreekt hij, dan stopt dit script met een uitleg -
 * niet met een stille overslag, want "niets gevonden" en "niets gekeken"
 * horen er niet hetzelfde uit te zien.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { paginasVan } from "../kern/scripts/paginas.mjs";

const WORTEL = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITES = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const ALLE = ["batterijmaatje", "warmtepompmaatje", "zonnestroommaatje"];
const TE_DOEN = SITES.length ? SITES : ALLE;

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "Playwright ontbreekt, dus er is niets gekeurd.\n" +
    "Installeren:  npm i --no-save playwright && npx playwright install chromium",
  );
  process.exit(1);
}

// In deze omgeving staat de browser al klaar; elders haalt playwright hem
// zelf op en weet hij het pad beter dan wij.
const EIGEN = "/opt/pw-browsers/chromium";
const START = existsSync(EIGEN) ? { executablePath: EIGEN } : {};

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".webp": "image/webp", ".png": "image/png",
  ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon",
};
const LADDER_TEKST = [12, 15, 17, 19, 22, 28, 36, 46];
const LADDER_ROND = ["0px", "4px", "10px", "16px", "999px", "50%"];
const BREEDTES = [1280, 390];

const browser = await chromium.launch(START);
let totaalMis = 0;

for (const site of TE_DOEN) {
  const root = join(WORTEL, "sites", site);
  if (!existsSync(root)) { console.error(`Onbekende site: ${site}`); totaalMis++; continue; }

  const srv = createServer((q, r) => {
    const pad = join(root, decodeURIComponent(q.url.split("?")[0]));
    if (!pad.startsWith(root) || !existsSync(pad) || pad.endsWith("/")) { r.writeHead(404).end(); return; }
    r.writeHead(200, { "Content-Type": TYPES[extname(pad)] || "application/octet-stream" });
    r.end(readFileSync(pad));
  });
  await new Promise((r) => srv.listen(0, r));
  const poort = srv.address().port;

  const bevindingen = { contrast: new Map(), raakvlak: new Map(), tekst: new Map(), ronding: new Map(), tabelbreedte: new Map() };
  const fouten = [];

  for (const [, pad] of paginasVan(root)) {
    if (!existsSync(join(root, pad))) continue;
    for (const breed of BREEDTES) {
      const page = await browser.newPage({ viewport: { width: breed, height: 900 }, isMobile: breed < 600, hasTouch: breed < 600 });
      page.on("pageerror", (e) => fouten.push(`${pad} @${breed}: ${e.message}`));
      await page.goto(`http://127.0.0.1:${poort}${pad}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);

      const uit = await page.evaluate(([ladder, rondingen]) => {
        const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
        const rgb = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
        // Op een verloop is de achtergrond geen enkele kleur. Een berekening
        // op de bovenste laag geeft daar een uitkomst die nergens op slaat,
        // dus daar meten we niet.
        const opVerloop = (e) => { let n = e; while (n && n !== document.documentElement) { if (getComputedStyle(n).backgroundImage !== "none") return true; n = n.parentElement; } return false; };
        const achter = (e) => { let n = e; while (n && n !== document.documentElement) { const c = getComputedStyle(n).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return rgb(c); n = n.parentElement; } return [255, 255, 255]; };
        const naam = (e) => e.tagName.toLowerCase() + (typeof e.className === "string" && e.className.trim() ? "." + e.className.trim().split(/\s+/)[0] : "");

        const r = { contrast: [], raakvlak: [], tekst: [], ronding: [] };
        for (const e of document.querySelectorAll("body *")) {
          // getClientRects() liegt bij content-visibility: hidden; dit niet.
          if (!e.checkVisibility || !e.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true })) continue;
          const st = getComputedStyle(e);
          const heeftTekst = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());

          if (heeftTekst) {
            const px = Math.round(parseFloat(st.fontSize) * 10) / 10;
            // Twee gedocumenteerde uitzonderingen: <small> is bewust een
            // verhouding en geen trede, en <text> in een svg is een
            // grafieklabel in gebruikerseenheden, geen typografie.
            const inSmall = e.closest("small") || e.tagName === "SMALL" || e.tagName === "SUP";
            const inSvg = e.ownerSVGElement || e.tagName.toLowerCase() === "text";
            if (!ladder.includes(px) && !inSmall && !inSvg) r.tekst.push(`${px}px ${naam(e)} in <${(e.parentElement || {}).tagName}>`);
            if (!opVerloop(e)) {
              const groot = px >= 24 || (px >= 18.66 && Number(st.fontWeight) >= 700);
              const a = lum(rgb(st.color)), c = lum(achter(e));
              const v = (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05);
              if (v < (groot ? 3 : 4.5)) r.contrast.push(`${naam(e)} ${v.toFixed(2)}:1`);
            }
          }

          const rad = st.borderRadius.split(" ")[0];
          if (rad && !rondingen.includes(rad)) r.ronding.push(`${rad} ${naam(e)}`);

          if (e.matches("a[href], button, input, select, summary, label")) {
            // WCAG 2.5.8 kent twee uitzonderingen die hier gelden:
            //  - een link in een lopende zin: die kun je niet vergroten
            //    zonder de regelafstand te slopen
            //  - een besturing binnen een groter label: dat label is wat je
            //    aanraakt, dus dat is wat telt
            const inZin = e.tagName === "A" && st.display.startsWith("inline") &&
              e.parentElement && [...e.parentElement.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
            // Een <label for="..."> boven een veld is geen doel op zichzelf:
            // het veld eronder is het doel, en dat is groot genoeg.
            if (e.tagName === "LABEL" && e.htmlFor) {
              const veld = document.getElementById(e.htmlFor);
              if (veld && veld.getBoundingClientRect().height >= 24) continue;
            }
            const label = e.closest("label");
            const doel = label && label !== e ? label : e;
            const d = doel.getBoundingClientRect();
            if (!inZin && d.width && d.height && (d.width < 24 || d.height < 24)) {
              r.raakvlak.push(`${naam(doel)} ${Math.round(d.width)}x${Math.round(d.height)}  "${(doel.textContent || "").trim().slice(0, 34)}"`);
            }
          }
        }
        return r;
      }, [LADDER_TEKST, LADDER_ROND]);

      for (const soort of ["contrast", "raakvlak", "tekst", "ronding"]) {
        for (const x of uit[soort]) {
          const sleutel = soort === "raakvlak" ? `${pad}  ${x}` : x;
          bevindingen[soort].set(sleutel, (bevindingen[soort].get(sleutel) || 0) + 1);
        }
      }
      /* Pas hier de tabelweergave openen, ná de meting hierboven. Die knop
         bouwt een halve pagina bij, en dat hoort niet stilletjes de omvang van
         de andere controles te veranderen; wat daar mis is, is een eigen klus.
         Waarom hij überhaupt gekeurd moet worden: de tabel zat achter een knop,
         dus niemand keek ernaar, en zo stond hij maanden 311 pixels te breed
         voor zijn kader terwijl de keuring "schoon" meldde. Alleen op 1280 -
         op een telefoon hóórt hij te schuiven, daar is dat kader voor. */
      if (breed >= 1280 && (await page.locator("#knopTabel").count())) {
        await page.click("#knopTabel").catch(() => {});
        await page.waitForTimeout(300);
        const te = await page.evaluate(() => {
          const w = document.querySelector(".tabel-wrap");
          if (!w) return null;
          const tekort = Math.round(w.scrollWidth - w.clientWidth);
          return tekort > 1 ? `${tekort}px te breed voor zijn kader (${Math.round(w.scrollWidth)} in ${Math.round(w.clientWidth)})` : null;
        });
        if (te) bevindingen.tabelbreedte.set(`${pad}  ${te}`, 1);
      }

      await page.close();
    }
  }
  srv.close();

  console.log(`\n=== ${site}`);
  for (const soort of ["contrast", "raakvlak", "tekst", "ronding", "tabelbreedte"]) {
    const lijst = [...bevindingen[soort].entries()].sort((a, c) => c[1] - a[1]);
    console.log(`  ${soort.padEnd(10)} ${lijst.length ? lijst.length + " soort(en)" : "schoon"}`);
    for (const [k, n] of lijst.slice(0, 8)) console.log(`      ${k}  (${n}x)`);
    if (lijst.length > 8) console.log(`      ... en nog ${lijst.length - 8}`);
    totaalMis += lijst.length;
  }
  console.log(`  javascript ${fouten.length ? fouten.length + " fout(en)" : "schoon"}`);
  for (const f of fouten.slice(0, 5)) console.log(`      ${f}`);
  totaalMis += fouten.length;
}

await browser.close();

if (totaalMis) {
  console.error(`\nDe keuring vond ${totaalMis} soort(en) afwijking. Zie hierboven.`);
  process.exit(1);
}
console.log(`\nDe keuring is schoon: ${TE_DOEN.length} site(s), ${BREEDTES.join(" en ")} pixels breed.`);
