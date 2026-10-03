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
 * En sinds kort kijkt hij er één ding bij: horizontale overloop op smalle
 * telefoons. Dat is dezelfde vraag in een ander jasje - past de opmaak in de
 * ruimte die er is - en niets ving het. Twee keer gevonden: de sorteerkeuze in
 * de resultatenbalk, en "Ander verbruik? … kWh per jaar" op de
 * productpagina's. Beide lieten je de hele pagina horizontaal schuiven, en
 * beide ontglipten de keuring: die meet 390 pixels, en op 390 paste het nog.
 *
 * Draaien: npm run menubreedte        (of: node scripts/menubreedte.mjs)
 *          npm run menubreedte -- batterijmaatje     voor één site
 */

import { createServer } from "node:http";
import { readFileSync, readdirSync, existsSync, appendFileSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WORTEL = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALLE = ["batterijmaatje", "warmtepompmaatje", "zonnestroommaatje"];
const GEVRAAGD = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const TE_DOEN = GEVRAAGD.length ? GEVRAAGD : ALLE;

/* Eén regel is 64 pixels (min-height op .site-header .container). Twee pixels
   speling voor afrondingen bij een niet-hele devicePixelRatio. */
const EEN_REGEL_MAX = 66;

/* Waar we de kop meten. Onder de 768 hoort de menuknop te staan en is wikkelen
   onmogelijk; daarboven is elke breedte een kandidaat. 1600 omdat de container
   daarboven niet meer meegroeit. */
const BREEDTES = [768, 820, 880, 940, 1000, 1080, 1140, 1200, 1280, 1366, 1440, 1600];

/* En waar we op horizontale overloop letten: de smalle telefoons.
 *
 * Dit hoort erbij omdat het dezelfde fout is in een ander jasje - past de
 * opmaak in de ruimte die er is - en omdat niets het ving. Twee keer gevonden:
 * de sorteerkeuze in de resultatenbalk stak 21 tot 56 pixels buiten de pagina
 * (een <select> krimpt niet onder zijn langste optie zolang min-width op auto
 * staat), en op de productpagina's deed "Ander verbruik? … kWh per jaar"
 * hetzelfde met white-space: nowrap. In beide gevallen kon je de hele pagina
 * horizontaal heen en weer schuiven, en in beide gevallen keek de bestaande
 * keuring er langs: die meet 390 pixels, en op 390 paste het nog.
 *
 * Alleen met de terugvalfont, want dat is de brede stand: die is ongeveer 11
 * procent breder dan Figtree, en sinds font-display: optional is het ook wat
 * een nieuwe bezoeker werkelijk ziet. Wat daar past, past met Figtree ook. */
const SMAL = [320, 360, 390];

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

  /* Eerst de smalle schermen op overloop, op de voorpagina én op een
     productpagina. Die laatste staat in geen enkele paginas.json, en juist daar
     zat de tweede vondst. */
  const smalPaginas = ["index.html"];
  for (const map of ["batterij", "pomp", "paneel"]) {
    try {
      const eerste = readdirSync(join(basis, map)).filter((f) => f.endsWith(".html")).sort()[0];
      if (eerste) smalPaginas.push(`${map}/${eerste}`);
    } catch { /* die map heeft deze site niet */ }
  }

  for (const pagina of smalPaginas) {
    for (const breed of SMAL) {
      const page = await browser.newPage({ viewport: { width: breed, height: 800 } });
      await page.route("**/*.woff2", (r) => r.abort());
      const antwoord = await page.goto(`http://127.0.0.1:${poort}/${pagina}`, { waitUntil: "networkidle" });
      if (!antwoord || antwoord.status() !== 200) {
        await page.close();
        bevindingen.push({ site, breed, font: "terugvalfont", melding: `${pagina} gaf status ${antwoord && antwoord.status()}` });
        continue;
      }
      await page.waitForTimeout(80);
      const over = await page.evaluate(() => {
        const doc = document.documentElement;
        const uit = doc.scrollWidth - doc.clientWidth;
        if (uit <= 1) return { uit, wie: [] };
        /* Welk element steekt eruit. Een element in een vak met overflow-x:
           auto telt niet mee: dat wordt netjes geclipt en mag in zijn eigen
           schuifruimte breder zijn. Zonder die uitzondering wijst dit elke
           brede tabel aan en kijk je langs de echte oorzaak heen - dat kostte
           mij een omweg. */
        const wie = [];
        for (const el of document.querySelectorAll("body *")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.right <= doc.clientWidth + 1) continue;
          if ([...el.children].some((k) => k.getBoundingClientRect().right > doc.clientWidth + 1)) continue;
          let schuift = false;
          for (let o = el.parentElement; o && o !== document.body; o = o.parentElement) {
            if (/auto|scroll|hidden/.test(getComputedStyle(o).overflowX)) { schuift = true; break; }
          }
          if (schuift) continue;
          wie.push(`${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ")[0] : ""}`);
        }
        return { uit, wie: [...new Set(wie)].slice(0, 3) };
      });
      await page.close();
      if (over.uit > 1) {
        bevindingen.push({
          site, breed, font: "terugvalfont",
          melding: `${over.uit}px horizontale overloop op ${pagina}` + (over.wie.length ? ` (${over.wie.join(", ")})` : ""),
        });
      }
    }
  }

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
  // Twee soorten bevinding, met twee verschillende vervolgen. Eén melding voor
  // beide stuurt de lezer de verkeerde kant op.
  const kop = bevindingen.filter((b) => b.melding.includes("één regel") || b.melding.includes("meer dan"));
  const overloop = bevindingen.filter((b) => b.melding.includes("overloop"));
  console.error(`\n${bevindingen.length} bevinding(en).`);
  if (kop.length) {
    console.error(
      `\n${kop.length}x een kop van meer dan één regel. Die duwt de inhoud omlaag en springt` +
      `\nterug zodra de webfont binnenkomt. Twee wegen: een menu-item onder "Meer ▾"` +
      `\nzetten, of de inklapgrens in de style.css van die site omhoog.`,
    );
  }
  if (overloop.length) {
    console.error(
      `\n${overloop.length}x iets dat buiten de pagina steekt, dus horizontaal schuiven op een` +
      `\ntelefoon. Het element staat erbij. Meestal krimpt het niet omdat min-width op` +
      `\nauto staat (flex) of omdat white-space op nowrap staat.`,
    );
  }
  const rest = bevindingen.length - kop.length - overloop.length;
  if (rest > 0) console.error(`\nEn ${rest} andere melding(en); die staan hierboven.`);
  process.exit(1);
}

console.log(
  `\nDe kop blijft één regel en niets steekt eruit: ${TE_DOEN.length} site(s), ` +
  `${BREEDTES.length} breedtes met en zonder webfont, plus ${SMAL.join("/")} px op de terugvalfont.`,
);
