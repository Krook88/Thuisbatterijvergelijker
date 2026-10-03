#!/usr/bin/env node
/**
 * Past de kop op één regel, op elke breedte?
 *
 * Waarom dit bestaat. De navigatiebalk week pas onder 767 pixels voor een
 * menuknop, en daarboven stond het volledige menu. Alleen pástte dat menu daar
 * niet: gemeten op de voorpagina bleef de kop pas op één regel vanaf 768 pixels
 * bij batterijmaatje, 912 bij warmtepompmaatje en 976 bij zonnestroommaatje -
 * en met de terugvalfont die de bezoeker de eerste halve seconde ziet,
 * respectievelijk vanaf 864, 1056 en 1128. Daartussen wikkelde de navigatie
 * onder het logo door: twee regels, met de terugvalfont zelfs drie.
 *
 * Dat kostte twee dingen tegelijk, en geen van beide viel op bij het testen op
 * een laptop. Een kop die op een tablet verkeerd oogt. En een sprong zodra de
 * webfont binnenkomt, want dan krimpt de kop weer naar één regel en schuift
 * alles eronder omhoog - gemeten 0,24 op 768 pixels, waar Google 0,1 als grens
 * voor "goed" aanhoudt.
 *
 * De inklapgrens staat nu per site op de terugvalbreedte plus een marge. Dat
 * getal hangt aan de inhoud van het menu: komt er een item bij, of wordt een
 * label langer, dan schuift de breedte waarop het past mee omhoog en wikkelt de
 * kop weer - stil, want de pagina blijft werken en op een breed scherm ziet
 * niemand het. Daar waakt dit script over.
 *
 * Het meet met de webfont én met de font geblokkeerd, want de bezoeker ziet
 * allebei: eerst de terugvalfont, dan Figtree. Een kop die alleen met Figtree
 * past, springt bij elke eerste bezoek.
 *
 * Draaien: npm run menubreedte        (of: node scripts/menubreedte.mjs)
 *          npm run menubreedte -- batterijmaatje     voor één site
 */

import { createServer } from "node:http";
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WORTEL = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALLE = ["batterijmaatje", "warmtepompmaatje", "zonnestroommaatje"];
const GEVRAAGD = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const TE_DOEN = GEVRAAGD.length ? GEVRAAGD : ALLE;

/* Eén regel is 64 pixels (min-height op .site-header .container). Twee pixels
   speling voor afrondingen bij een niet-hele devicePixelRatio. */
const EEN_REGEL_MAX = 66;

/* Waar we meten. Onder de 768 hoort de menuknop te staan en is wikkelen
   onmogelijk; daarboven is elke breedte een kandidaat. 1600 omdat de container
   daarboven niet meer meegroeit. */
const BREEDTES = [768, 820, 880, 940, 1000, 1080, 1140, 1200, 1280, 1366, 1440, 1600];

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "Playwright ontbreekt, dus er is niets gemeten.\n" +
    "Installeren:  npm i --no-save playwright && npx playwright install chromium",
  );
  process.exit(1);
}

const EIGEN = "/opt/pw-browsers/chromium";
const START = existsSync(EIGEN) ? { executablePath: EIGEN } : {};

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".webp": "image/webp", ".png": "image/png",
  ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon",
};

function server(basis) {
  return createServer((req, res) => {
    let pad = decodeURIComponent(req.url.split("?")[0]);
    if (pad.endsWith("/")) pad += "index.html";
    const bestand = join(basis, pad);
    if (!existsSync(bestand)) { res.writeHead(404); return res.end("niet gevonden"); }
    res.writeHead(200, { "content-type": TYPES[extname(bestand)] || "application/octet-stream" });
    res.end(readFileSync(bestand));
  });
}

const browser = await chromium.launch(START);
const bevindingen = [];

for (const site of TE_DOEN) {
  const basis = join(WORTEL, "sites", site);
  if (!existsSync(basis)) {
    console.error(`${site}: die map bestaat niet.`);
    process.exit(2);
  }
  const srv = server(basis);
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const poort = srv.address().port;

  const regels = [];
  for (const breed of BREEDTES) {
    for (const font of ["Figtree", "terugvalfont"]) {
      const page = await browser.newPage({ viewport: { width: breed, height: 800 } });
      // De bezoeker ziet eerst de terugvalfont. Een kop die alleen met Figtree
      // past is dus niet goed genoeg.
      if (font === "terugvalfont") await page.route("**/*.woff2", (r) => r.abort());
      await page.goto(`http://127.0.0.1:${poort}/index.html`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
      await page.waitForTimeout(80);
      const m = await page.evaluate(() => {
        const vak = document.querySelector(".site-header .container");
        if (!vak) return null;
        const knop = document.querySelector(".menu-knop");
        const doc = document.documentElement;
        return {
          hoogte: Math.round(vak.getBoundingClientRect().height),
          menuknop: knop ? getComputedStyle(knop).display !== "none" : false,
          overloop: doc.scrollWidth - doc.clientWidth,
        };
      });
      await page.close();

      if (!m) {
        bevindingen.push({ site, breed, font, melding: "geen .site-header .container op de voorpagina" });
        continue;
      }
      // Staat de menuknop, dan is de balk ingeklapt en valt er niets te wikkelen.
      if (!m.menuknop && m.hoogte > EEN_REGEL_MAX) {
        bevindingen.push({ site, breed, font, melding: `kop is ${m.hoogte}px, dus meer dan één regel` });
      }
      if (m.overloop > 1) {
        bevindingen.push({ site, breed, font, melding: `${m.overloop}px horizontale overloop` });
      }
      regels.push({ breed, font, ...m });
    }
  }
  srv.close();

  const fout = bevindingen.filter((b) => b.site === site);
  const balkVanaf = regels.filter((r) => !r.menuknop).map((r) => r.breed);
  const vanaf = balkVanaf.length ? Math.min(...balkVanaf) : null;
  console.log(
    `  ${fout.length ? "!" : "="} ${site}: ` +
    (vanaf ? `volledige balk vanaf ${vanaf}px, ` : "altijd ingeklapt op de gemeten breedtes, ") +
    (fout.length ? `${fout.length} bevinding(en)` : "kop blijft overal één regel"),
  );
  for (const f of fout) console.log(`      ${f.breed}px met ${f.font}: ${f.melding}`);
}

await browser.close();

if (process.env.GITHUB_STEP_SUMMARY && bevindingen.length) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    `### ${bevindingen.length} keer wikkelt de kop of steekt er iets uit`,
    "",
    "| site | breedte | font | wat |",
    "| --- | --- | --- | --- |",
    ...bevindingen.map((b) => `| ${b.site} | ${b.breed}px | ${b.font} | ${b.melding} |`),
    "",
  ].join("\n") + "\n");
}

if (bevindingen.length) {
  console.error(
    `\n${bevindingen.length} bevinding(en). Een kop van twee regels duwt de inhoud omlaag en` +
    `\nspringt terug zodra de webfont binnenkomt. Twee wegen: een menu-item onder` +
    `\n"Meer ▾" zetten, of de inklapgrens in de style.css van die site omhoog.`,
  );
  process.exit(1);
}

console.log(`\nDe kop blijft één regel: ${TE_DOEN.length} site(s), ${BREEDTES.length} breedtes, met en zonder webfont.`);
