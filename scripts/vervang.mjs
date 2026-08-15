/**
 * Zoeken en vervangen over meerdere bestanden - maar eerst laten zien.
 *
 * Dit script bestaat om één gewoonte onmogelijk te maken. Een zoek-en-vervang
 * over de hele repo ging vijf keer mis, telkens op dezelfde manier: het
 * patroon raakte meer dan bedoeld, en dat bleek pas later.
 *
 *   scroll-margin-top    meegepakt door een patroon op margin-top
 *   padding-bottom:150px afgerond naar 56, terwijl het gereserveerde ruimte was
 *   een @media-accolade   opgegeten, waardoor de halve stylesheet in een
 *                         mediaquery belandde
 *   "Installatie"         43x vervangen buiten het filterblok
 *   //warmtepompmaatje.nl aangezien voor commentaar
 *
 * Daarom schrijft dit script niets tenzij je --doen meegeeft. Zonder die vlag
 * toont het wat er zou veranderen, met de regel erbij en een telling per
 * bestand. Die telling is het punt: veranderen er 43 bestanden terwijl je er
 * één bedoelde, dan zie je dat vóór het schrijven in plaats van erna.
 *
 * Gebruik:
 *   node scripts/vervang.mjs --zoek "<patroon>" --wordt "<tekst>" --map sites
 *   node scripts/vervang.mjs --zoek "..." --wordt "..." --map sites --doen
 *
 * Keuzes:
 *   --zoek    javascript-patroon (regex), altijd globaal toegepast
 *   --wordt   vervanging; $1 en $2 verwijzen naar haakjes in het patroon
 *   --map     map om in te zoeken, ten opzichte van de repo (mag vaker)
 *   --soort   extensies, met komma's (standaard: html,css,js,mjs,json,md)
 *   --letterlijk  behandel --zoek als gewone tekst in plaats van als patroon
 *   --doen    schrijf de wijzigingen echt weg
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const WORTEL = join(dirname(fileURLToPath(import.meta.url)), "..");

function keuze(naam, standaard = null) {
  const i = process.argv.indexOf(`--${naam}`);
  return i === -1 ? standaard : process.argv[i + 1];
}
function keuzes(naam) {
  const uit = [];
  process.argv.forEach((a, i) => { if (a === `--${naam}`) uit.push(process.argv[i + 1]); });
  return uit;
}
const vlag = (naam) => process.argv.includes(`--${naam}`);

const zoek = keuze("zoek");
const wordt = keuze("wordt");
const mappen = keuzes("map");
const soorten = (keuze("soort", "html,css,js,mjs,json,md")).split(",").map((s) => "." + s.trim().replace(/^\./, ""));
const doen = vlag("doen");

if (zoek === null || wordt === null || !mappen.length) {
  console.error(`Gebruik: node scripts/vervang.mjs --zoek "<patroon>" --wordt "<tekst>" --map <map> [--soort html,css] [--letterlijk] [--doen]

Zonder --doen wordt er niets geschreven; je krijgt alleen te zien wat er zou veranderen.`);
  process.exit(1);
}

const patroon = vlag("letterlijk")
  ? new RegExp(zoek.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")
  : new RegExp(zoek, "g");

const bestanden = [];
for (const map of mappen) {
  const start = join(WORTEL, map);
  (function loop(pad) {
    let inhoud;
    try { inhoud = readdirSync(pad); } catch { console.error(`Map bestaat niet: ${map}`); process.exit(1); }
    for (const naam of inhoud) {
      if (naam === "node_modules" || naam === ".git") continue;
      const vol = join(pad, naam);
      if (statSync(vol).isDirectory()) loop(vol);
      else if (soorten.includes(extname(naam))) bestanden.push(vol);
    }
  })(start);
}

let raakBestanden = 0, raakTotaal = 0;
const perBestand = [];

for (const pad of bestanden) {
  const tekst = readFileSync(pad, "utf8");
  patroon.lastIndex = 0;
  if (!patroon.test(tekst)) continue;
  patroon.lastIndex = 0;

  const regels = tekst.split("\n");
  const treffers = [];
  regels.forEach((regel, i) => {
    patroon.lastIndex = 0;
    if (!patroon.test(regel)) return;
    patroon.lastIndex = 0;
    const na = regel.replace(patroon, wordt);
    const aantal = (regel.match(patroon) || []).length;
    treffers.push({ nr: i + 1, voor: regel.trim(), na: na.trim(), aantal });
  });

  // Een patroon dat over regelgrenzen loopt telt hierboven niet mee; dan
  // valt er niets per regel te tonen, maar het bestand verandert wel.
  const nieuw = tekst.replace(patroon, wordt);
  if (nieuw === tekst) continue;

  const aantal = treffers.reduce((s, t) => s + t.aantal, 0) || 1;
  raakBestanden++;
  raakTotaal += aantal;
  perBestand.push({ pad, treffers, aantal, nieuw });
}

if (!raakBestanden) {
  console.log("Geen enkele treffer. Er verandert niets.");
  process.exit(0);
}

for (const { pad, treffers, aantal } of perBestand) {
  console.log(`\n${relative(WORTEL, pad)}  (${aantal}x)`);
  for (const t of treffers.slice(0, 4)) {
    console.log(`  ${String(t.nr).padStart(5)}  - ${t.voor.slice(0, 120)}`);
    console.log(`         + ${t.na.slice(0, 120)}`);
  }
  if (treffers.length > 4) console.log(`         ... en nog ${treffers.length - 4} regel(s)`);
}

console.log(`\n${raakTotaal} treffer(s) in ${raakBestanden} bestand(en).`);

if (!doen) {
  console.log("Er is niets geschreven. Klopt het aantal met wat je bedoelde? Draai dan hetzelfde commando met --doen erachter.");
  process.exit(0);
}

for (const { pad, nieuw } of perBestand) writeFileSync(pad, nieuw);
console.log(`Geschreven naar ${raakBestanden} bestand(en).`);
