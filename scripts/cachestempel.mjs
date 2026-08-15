/**
 * Zet het ?v=-nummer van alle css en js op één stempel, per site.
 *
 * Alles onder /assets/ ligt zeven dagen in de cache van de bezoeker. Verandert
 * er iets aan de opmaak of de scripts zonder dat dit nummer opschuift, dan
 * krijgt een terugkerende bezoeker de nieuwe HTML met de oude bestanden erbij.
 * Zo ontstond de onleesbare oranje link op warmtepompmaatje: beide helften
 * klopten op zichzelf, alleen niet bij elkaar.
 *
 * 'npm run kern:controleer' bewaakt dat de nummers binnen een site gelijk
 * lopen, maar kan ze niet zetten - dat doet dit. Draai het als laatste stap
 * voordat je opmaak of scripts wegzet:
 *
 *   npm run stempel                 vandaag, letter a (20260815a)
 *   npm run stempel -- 20260815b    zelf een stempel kiezen
 *
 * Of het nummer ná een wijziging omhoog moet, kan geen script weten. Dat
 * blijft mensenwerk; dit haalt alleen het handwerk en de typefouten eruit.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const WORTEL = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITES = join(WORTEL, "sites");
const PATROON = /(\.(?:css|js)\?v=)([A-Za-z0-9]+)/g;

const gegeven = process.argv.slice(2).find((a) => !a.startsWith("-"));
if (gegeven && !/^\d{8}[a-z]$/.test(gegeven)) {
  console.error(`Onbruikbare stempel: ${gegeven}\nVorm: acht cijfers en een letter, bijvoorbeeld 20260815a.`);
  process.exit(1);
}
const nu = new Date();
const vandaag = `${nu.getFullYear()}${String(nu.getMonth() + 1).padStart(2, "0")}${String(nu.getDate()).padStart(2, "0")}`;
const STEMPEL = gegeven || `${vandaag}a`;

for (const site of readdirSync(SITES)) {
  const bestanden = [];
  (function loop(map) {
    for (const naam of readdirSync(map)) {
      if (naam === "node_modules") continue;
      const pad = join(map, naam);
      if (statSync(pad).isDirectory()) loop(pad);
      else if ([".html", ".css"].includes(extname(naam))) bestanden.push(pad);
    }
  })(join(SITES, site));

  let raak = 0;
  const was = new Set();
  for (const pad of bestanden) {
    const tekst = readFileSync(pad, "utf8");
    const nieuw = tekst.replace(PATROON, (heel, kop, oud) => { was.add(oud); return oud === STEMPEL ? heel : kop + STEMPEL; });
    if (nieuw !== tekst) { writeFileSync(pad, nieuw); raak++; }
  }

  const oude = [...was].filter((w) => w !== STEMPEL).sort();
  console.log(`${site.padEnd(18)} ${String(raak).padStart(3)} bestand(en) op ${STEMPEL}${oude.length ? `, was: ${oude.join(", ")}` : " (stond al goed)"}`);
}

console.log(`\nDraai hierna de generatoren opnieuw: die lezen de stempel uit assets/style.css.`);
