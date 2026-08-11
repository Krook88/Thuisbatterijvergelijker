#!/usr/bin/env node
/**
 * Hoeveel van onze capaciteiten zijn vastgesteld, en welke niet?
 *
 * Waarom dit bestaat: de site vergelijkt op prijs per kWh, en dat getal is
 * alleen eerlijk als de kWh voor elk model hetzelfde betekent. Fabrikanten
 * geven er twee op - de bruto pakketmaat en wat je er werkelijk uit haalt - en
 * die schelen tot twintig procent. Bij de Zendure SolarFlow 2400 ging het van
 * 420 naar 504 euro per kWh toen dat werd rechtgezet.
 *
 * De norm van deze site is de bruikbare capaciteit (zie REDACTIE.md). Dit
 * script laat zien hoe ver we daarmee zijn, zodat "nog niet nagekeken" niet
 * stilletjes doorgaat voor "klopt".
 *
 * Het meldt daarnaast welke modellen er nominaal uitzien, maar dat is
 * uitdrukkelijk een gok: LFP-pakketten worden uit cellen opgebouwd, dus een
 * nominale maat valt vaak op een veelvoud van 1,28 kWh (2,56 / 5,12 / 10,24).
 * Dat is een aanwijzing waar je het eerst moet kijken, geen bewijs, en het
 * verandert dus niets aan de gegevens.
 *
 * Gebruik:
 *   node scripts/capaciteit-status.mjs
 *   node scripts/capaciteit-status.mjs --streng   foutcode zolang er nog
 *                                                 modellen onvastgesteld zijn
 */

import { readFileSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PAD = resolve(__dirname, "../data/batterijen.json");
const STRENG = process.argv.includes("--streng");

const data = JSON.parse(readFileSync(DATA_PAD, "utf8"));
const modellen = (data.batterijen || []).filter((b) => typeof b.capaciteit_kwh === "number");

const perSoort = { bruikbaar: [], nominaal: [], onvastgesteld: [] };
for (const b of modellen) {
  const soort = b.capaciteit_soort === "bruikbaar" ? "bruikbaar"
    : b.capaciteit_soort === "nominaal" ? "nominaal"
    : "onvastgesteld";
  perSoort[soort].push(b);
}

// Een veelvoud van 1,28 kWh wijst op een bruto pakketmaat. Aanwijzing, geen bewijs.
const lijktNominaal = (b) => Math.abs(b.capaciteit_kwh / 1.28 - Math.round(b.capaciteit_kwh / 1.28)) < 0.02;
const verdacht = perSoort.onvastgesteld.filter(lijktNominaal);

console.log(`capaciteit van ${modellen.length} modellen:`);
console.log(`  ${String(perSoort.bruikbaar.length).padStart(3)}  bruikbaar, vastgesteld`);
console.log(`  ${String(perSoort.nominaal.length).padStart(3)}  nominaal, bruikbaar nog onbekend`);
console.log(`  ${String(perSoort.onvastgesteld.length).padStart(3)}  niet vastgesteld`);

if (verdacht.length) {
  console.log(`\nhier eerst kijken - de maat valt op een veelvoud van 1,28 kWh, wat op een`);
  console.log(`bruto pakketmaat wijst (aanwijzing, geen bewijs):`);
  for (const b of verdacht.sort((a, c) => a.capaciteit_kwh - c.capaciteit_kwh)) {
    console.log(`  ${String(b.capaciteit_kwh).padStart(6)} kWh  ${b.id}`);
  }
}

if (perSoort.onvastgesteld.length && process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    `### batterijmaatje: ${perSoort.onvastgesteld.length} van ${modellen.length} capaciteiten nog niet vastgesteld`,
    "",
    "De site vergelijkt op prijs per kWh; dat getal klopt pas als de kWh overal",
    "hetzelfde betekent. Norm is de bruikbare capaciteit, zie REDACTIE.md.",
    "",
  ].join("\n") + "\n");
}

if (STRENG && perSoort.onvastgesteld.length) {
  console.error(`\n${perSoort.onvastgesteld.length} model(len) zonder vastgestelde capaciteit.`);
  process.exit(1);
}
