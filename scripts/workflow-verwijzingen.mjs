#!/usr/bin/env node
/**
 * Controleert of een workflow naar stappen verwijst die in hetzelfde blok
 * bestaan.
 *
 * Waarom dit bestaat: een stap die "Prijzen die aandacht vragen" heette werd
 * onderaan het bestand geplakt, en belandde daarmee in het verkeerde blok. Hij
 * keek naar steps.keuze en steps.prijzen, en die twee bestaan alleen in het
 * blok erboven. GitHub maakt daar geen fout van: een verwijzing naar een stap
 * die niet bestaat wordt een lege tekst, de voorwaarde is dan onwaar, en de
 * stap slaat zichzelf elke dag stilletjes over. De workflow blijft groen, de
 * controle draait nooit, en dat is precies wat die controle moest voorkomen.
 *
 * Het gemene eraan is dat er niets rood wordt. Een stap die faalt zie je; een
 * stap die zichzelf overslaat ziet niemand, want in de lijst staat hij netjes
 * grijs alsof dat de bedoeling was.
 *
 * Gebruik:
 *   node scripts/workflow-verwijzingen.mjs
 *
 * Dit leest de bestanden regel voor regel in plaats van de YAML te ontleden,
 * omdat deze repository geen afhankelijkheden heeft en er geen YAML-lezer in
 * Node zit. Dat kan omdat we maar twee dingen hoeven te weten: waar een blok
 * begint en welke stap-namen erin staan.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORTEL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAP = join(WORTEL, ".github", "workflows");

if (!existsSync(MAP)) {
  console.log("Geen .github/workflows/ om te controleren.");
  process.exit(0);
}

/**
 * Deelt een workflow op in blokken (jobs) met hun stap-namen en hun
 * verwijzingen. Een blok is een sleutel op twee spaties inspringing, maar pas
 * nadat "jobs:" langsgekomen is - "schedule:" onder "on:" springt net zo ver in
 * en is geen blok.
 */
function blokkenVan(tekst) {
  const regels = tekst.split("\n");
  const blokken = [];
  let inJobs = false;
  let huidig = null;

  regels.forEach((regel, nr) => {
    if (/^jobs:\s*$/.test(regel)) { inJobs = true; return; }
    if (!inJobs) return;

    const nieuw = regel.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (nieuw) {
      huidig = { naam: nieuw[1], regel: nr + 1, ids: new Set(), verwijzingen: [] };
      blokken.push(huidig);
      return;
    }
    if (!huidig) return;

    const id = regel.match(/^\s*id:\s*["']?([A-Za-z0-9_-]+)["']?\s*$/);
    if (id) huidig.ids.add(id[1]);

    for (const m of regel.matchAll(/steps\.([A-Za-z0-9_-]+)\./g)) {
      huidig.verwijzingen.push({ naam: m[1], regel: nr + 1, tekst: regel.trim() });
    }
  });

  return blokken;
}

const bestanden = readdirSync(MAP).filter((f) => /\.ya?ml$/.test(f));
const fouten = [];
let gecontroleerd = 0;

for (const bestand of bestanden) {
  for (const blok of blokkenVan(readFileSync(join(MAP, bestand), "utf8"))) {
    for (const v of blok.verwijzingen) {
      gecontroleerd++;
      if (!blok.ids.has(v.naam)) {
        fouten.push({ bestand, blok: blok.naam, ...v, bekend: [...blok.ids] });
      }
    }
  }
}

if (fouten.length) {
  console.error(`${fouten.length} verwijzing(en) naar een stap die in dat blok niet bestaat:\n`);
  for (const f of fouten) {
    console.error(`  ${f.bestand}:${f.regel}  blok "${f.blok}" verwijst naar steps.${f.naam}`);
    console.error(`    ${f.tekst}`);
    console.error(`    bekend in dit blok: ${f.bekend.length ? f.bekend.map((i) => `steps.${i}`).join(", ") : "geen enkele stap heeft een id"}`);
  }
  console.error(
    "\nGitHub maakt hier geen fout van: zo'n verwijzing wordt een lege tekst," +
    "\nwaardoor een 'if' altijd onwaar is en de stap zichzelf elke run overslaat." +
    "\nZet de stap in het blok waar de stappen staan waar hij naar kijkt, of geef" +
    "\ndie stappen een id in dit blok.",
  );
  process.exit(1);
}

console.log(`${gecontroleerd} verwijzing(en) naar stappen gecontroleerd in ${bestanden.length} workflow(s): allemaal binnen hun eigen blok.`);
