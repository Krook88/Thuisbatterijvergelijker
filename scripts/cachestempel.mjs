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
 * Of het nummer omhoog moest, stond hier eerst als mensenwerk, en dat ging
 * mis: van 2 tot 7 oktober 2026 veranderden vergelijker.css en een handvol
 * scripts zonder nieuwe stempel, en op een telefoon die de site eerder had
 * bezocht stond de prijsgrafiek op een productpagina als losse tekst onder
 * elkaar. Nu legt dit script bij het stempelen een vingerafdruk vast van alle
 * css en js per site (scripts/stempels.json), en faalt
 *
 *   npm run stempel -- --controleer
 *
 * zodra die vingerafdruk niet meer klopt. Dat loopt mee in 'npm run controle'.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const WORTEL = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITES = join(WORTEL, "sites");
const PATROON = /(\.(?:css|js)\?v=)([A-Za-z0-9]+)/g;

const VINGERAFDRUKKEN = join(WORTEL, "scripts", "stempels.json");

/* De vingerafdruk van alle css en js onder assets/, met de stempels zelf
   weggelaten: anders verandert de afdruk door het stempelen. */
function vingerafdruk(site) {
  const map = join(SITES, site, "assets");
  const hash = createHash("sha1");
  for (const naam of readdirSync(map).filter((n) => [".css", ".js"].includes(extname(n))).sort()) {
    hash.update(naam + "\0" + readFileSync(join(map, naam), "utf8").replace(PATROON, "$1") + "\0");
  }
  return hash.digest("hex").slice(0, 16);
}

const opgeslagen = existsSync(VINGERAFDRUKKEN) ? JSON.parse(readFileSync(VINGERAFDRUKKEN, "utf8")) : {};

if (process.argv.includes("--controleer")) {
  const fout = readdirSync(SITES).filter((site) => (opgeslagen[site] || {}).afdruk !== vingerafdruk(site));
  if (fout.length) {
    console.error(`Css of js veranderd sinds de laatste stempel op: ${fout.join(", ")}.`);
    console.error("Een terugkerende bezoeker krijgt dan tot zeven dagen de oude bestanden bij de nieuwe HTML.");
    console.error("Draai 'npm run stempel' en daarna de generatoren.");
    process.exit(1);
  }
  console.log(`Stempels kloppen met de css en js op ${readdirSync(SITES).length} site(s).`);
  process.exit(0);
}

const gegeven = process.argv.slice(2).find((a) => !a.startsWith("-"));
if (gegeven && !/^\d{8}[a-z]$/.test(gegeven)) {
  console.error(`Onbruikbare stempel: ${gegeven}\nVorm: acht cijfers en een letter, bijvoorbeeld 20260815a.`);
  process.exit(1);
}
const nu = new Date();
const vandaag = `${nu.getFullYear()}${String(nu.getMonth() + 1).padStart(2, "0")}${String(nu.getDate()).padStart(2, "0")}`;
/* Al eerder vandaag gestempeld? Dan de volgende letter, anders krijgt de
   tweede wijziging van de dag hetzelfde nummer als de eerste. */
const vandaagGebruikt = Object.values(opgeslagen).map((o) => o.stempel || "").filter((st) => st.startsWith(vandaag)).sort().pop();
const STEMPEL = gegeven || (vandaagGebruikt ? vandaag + String.fromCharCode(vandaagGebruikt.charCodeAt(8) + 1) : `${vandaag}a`);

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

  opgeslagen[site] = { stempel: STEMPEL, afdruk: vingerafdruk(site) };
  const oude = [...was].filter((w) => w !== STEMPEL).sort();
  console.log(`${site.padEnd(18)} ${String(raak).padStart(3)} bestand(en) op ${STEMPEL}${oude.length ? `, was: ${oude.join(", ")}` : " (stond al goed)"}`);
}

writeFileSync(VINGERAFDRUKKEN, JSON.stringify(opgeslagen, null, 2) + "\n");
console.log(`\nDraai hierna de generatoren opnieuw: die lezen de stempel uit assets/style.css.`);
