#!/usr/bin/env node
/**
 * Verdeelt de gedeelde code uit kern/ over de sites, en bewaakt dat ze niet
 * uiteenlopen.
 *
 * Waarom kopiëren en niet verwijzen: Vercel neemt per project alleen de map
 * mee die als Root Directory is ingesteld. Een bestand in kern/ komt dus niet
 * mee in de deployment van een site, en "../kern/contact.js" is als URL
 * sowieso onbereikbaar. Deze sites hebben bewust geen build-stap; kopiëren met
 * een harde controle erop is dan de eerlijkste oplossing.
 *
 * Gebruik:
 *   node scripts/kern-verdelen.mjs               kopieer kern/ naar elke site
 *   node scripts/kern-verdelen.mjs --controleer  alleen kijken, foutcode als
 *                                                een site afwijkt (voor CI)
 *
 * De controle is het sluitstuk. Zonder die faalt de opzet stilletjes: iemand
 * past een bestand in één site aan, het werkt daar, en drie maanden later
 * lopen de sites weer uiteen. Dat is precies hoe het de vorige keer misging.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const KERN = resolve(ROOT, "kern");
const SITES = resolve(ROOT, "sites");

const CONTROLEER = process.argv.includes("--controleer");

function bestandenIn(map, basis = map, uit = []) {
  for (const naam of readdirSync(map)) {
    const pad = join(map, naam);
    if (statSync(pad).isDirectory()) bestandenIn(pad, basis, uit);
    else uit.push(relative(basis, pad));
  }
  return uit;
}

if (!existsSync(KERN)) {
  console.error("Er is geen kern/ om te verdelen.");
  process.exit(1);
}

const gedeeld = bestandenIn(KERN);
const sites = readdirSync(SITES).filter((s) => statSync(join(SITES, s)).isDirectory());

const afwijkend = [];
let gekopieerd = 0;

for (const site of sites) {
  for (const rel of gedeeld) {
    const bron = join(KERN, rel);
    const doel = join(SITES, site, rel);
    const gelijk = existsSync(doel) && Buffer.compare(readFileSync(bron), readFileSync(doel)) === 0;
    if (gelijk) continue;

    if (CONTROLEER) {
      afwijkend.push({ site, rel, reden: existsSync(doel) ? "wijkt af van kern" : "ontbreekt" });
    } else {
      mkdirSync(dirname(doel), { recursive: true });
      writeFileSync(doel, readFileSync(bron));
      console.log(`  ${site}/${rel} bijgewerkt vanuit kern`);
      gekopieerd++;
    }
  }
}

if (CONTROLEER) {
  if (afwijkend.length) {
    console.error(`${afwijkend.length} bestand(en) lopen uit de pas met kern/:\n`);
    for (const a of afwijkend) console.error(`  sites/${a.site}/${a.rel}  (${a.reden})`);
    console.error(
      "\nPas het bestand in kern/ aan en draai 'npm run kern:verdeel'." +
      "\nHoort de wijziging bij één site, haal dat bestand dan uit kern/ en leg" +
      "\nin de commit vast waarom het niet langer gedeeld is.",
    );
    process.exit(1);
  }
  console.log(`kern/ en de ${sites.length} sites lopen gelijk (${gedeeld.length} gedeelde bestand(en)).`);
} else {
  console.log(
    gekopieerd
      ? `\n${gekopieerd} bestand(en) bijgewerkt vanuit kern/.`
      : `Niets te doen: de ${sites.length} sites lopen al gelijk met kern/ (${gedeeld.length} gedeelde bestand(en)).`,
  );
}
