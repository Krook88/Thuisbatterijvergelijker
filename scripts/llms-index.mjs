#!/usr/bin/env node
/**
 * Controleert of llms.txt gelijk loopt met het menu van de site.
 *
 * Waarom dit bestaat: llms.txt is de index die assistenten en zoekmachines
 * lezen om te weten wat een site te bieden heeft. Hij wordt met de hand
 * bijgehouden, en dat ging precies zoals dat gaat - er kwamen zes pagina's bij
 * en llms.txt bleef op de oude negen staan. De sitemap klopte wel, want die
 * wordt gegenereerd; llms.txt niet, want die is geschreven. Dat verschil zie
 * je nergens aan, want beide bestanden zijn op zichzelf in orde.
 *
 * Waarom tegen het menu en niet tegen de sitemap: llms.txt is bewust een
 * selectie. De 40 productpagina's en de 8 vergelijkingspagina's staan in de
 * sitemap en horen niet in llms.txt, anders is het geen index meer maar een
 * opsomming. Het menu is precies de selectie die de site zelf belangrijk
 * vindt, dus dat is de eerlijke maatstaf.
 *
 * Wat er bewust buiten valt: privacy en de foutpagina. Die horen in het menu
 * omdat het moet, niet omdat een lezer ernaar op zoek is.
 *
 * Gebruik:
 *   node scripts/llms-index.mjs
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SITES = join(ROOT, "sites");

// Staan in het menu omdat een site ze moet hebben, niet omdat iemand ze zoekt.
const BUITEN_BESCHOUWING = new Set(["privacy.html", "404.html"]);

/**
 * De pagina's uit het hoofdmenu. Dat menu staat op elke pagina; we lezen het
 * van index.html, want die heeft het altijd en is nooit een uitzondering.
 */
function menuVan(wortel) {
  const index = readFileSync(join(wortel, "index.html"), "utf8");
  const begin = index.indexOf('<nav class="hoofdnav"');
  const eind = index.indexOf("</nav>", begin);
  if (begin === -1 || eind === -1) return null;
  const nav = index.slice(begin, eind);
  const uit = new Set();
  for (const m of nav.matchAll(/href="\/?([a-z0-9-]+\.html)"/g)) {
    if (!BUITEN_BESCHOUWING.has(m[1])) uit.add(m[1]);
  }
  return uit;
}

function llmsVan(wortel) {
  const pad = join(wortel, "llms.txt");
  if (!existsSync(pad)) return null;
  const uit = new Set();
  for (const m of readFileSync(pad, "utf8").matchAll(/\/([a-z0-9-]+\.html)\)/g)) uit.add(m[1]);
  return uit;
}

const gebreken = [];
let gecontroleerd = 0;

for (const site of readdirSync(SITES)) {
  const wortel = join(SITES, site);
  if (!existsSync(join(wortel, "index.html"))) continue;

  const menu = menuVan(wortel);
  const llms = llmsVan(wortel);
  if (!menu) { gebreken.push({ site, melding: "index.html heeft geen <nav class=\"hoofdnav\">" }); continue; }
  if (!llms) { gebreken.push({ site, melding: "llms.txt ontbreekt" }); continue; }

  gecontroleerd++;
  const ontbreekt = [...menu].filter((p) => !llms.has(p)).sort();
  if (ontbreekt.length) gebreken.push({ site, ontbreekt });
}

if (gebreken.length) {
  console.error("llms.txt loopt achter op het menu:\n");
  for (const g of gebreken) {
    if (g.melding) { console.error(`  ${g.site}: ${g.melding}`); continue; }
    console.error(`  ${g.site}: ${g.ontbreekt.length} pagina(s) staan in het menu maar niet in llms.txt`);
    for (const p of g.ontbreekt) console.error(`    ${p}`);
  }
  console.error(
    "\nllms.txt is de index die assistenten lezen. De sitemap wordt gegenereerd" +
    "\nen klopt dus vanzelf; llms.txt is handwerk en blijft achter zonder dat" +
    "\niemand het ziet. Zet de pagina in de passende sectie, met een zin erbij" +
    "\nwaarom hij bestaat - een kale link zegt een lezer niets.",
  );
  process.exit(1);
}

console.log(`llms.txt loopt gelijk met het menu op ${gecontroleerd} site(s).`);
