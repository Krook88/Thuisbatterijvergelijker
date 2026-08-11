#!/usr/bin/env node
/**
 * Bij hoeveel warmtepompen weten we onder welke omstandigheden hun getallen
 * gelden?
 *
 * Waarom dit bestaat: de site vergelijkt op vermogen en SCOP, en die twee
 * getallen betekenen alleen iets als erbij staat waar ze gemeten zijn. "7 kW"
 * bij 7 graden buiten is iets heel anders dan 7 kW bij min zeven, en een SCOP
 * van 4,7 bij 35 graden aanvoer is ruim een punt beter dan dezelfde 4,7 bij 55
 * graden. Zonder die vermelding vergelijkt de site appels met peren op precies
 * de twee cijfers waar iemand zijn keuze op baseert.
 *
 * De norm staat in REDACTIE.md: vermogen als Prated (EU 811/2013), SCOP bij 35
 * graden aanvoer. Beide staan per meldcode in de ISDE-lijst van RVO.
 *
 * Gebruik:
 *   node scripts/condities-status.mjs
 *   node scripts/condities-status.mjs --streng   foutcode zolang er nog
 *                                                pompen onvastgesteld zijn
 */

import { readFileSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PAD = resolve(__dirname, "../data/warmtepompen.json");
const STRENG = process.argv.includes("--streng");

const data = JSON.parse(readFileSync(DATA_PAD, "utf8"));
const pompen = data.warmtepompen || [];

function tel(pompen, veld, conditieVeld, norm) {
  const uit = { volgens_norm: [], anders: [], onbekend: [], onvastgesteld: [], geen_getal: [] };
  for (const w of pompen) {
    if (typeof w[veld] !== "number") { uit.geen_getal.push(w); continue; }
    const c = w[conditieVeld] === undefined ? null : String(w[conditieVeld]);
    if (c === norm) uit.volgens_norm.push(w);
    else if (c === "onbekend") uit.onbekend.push(w);
    else if (c === null) uit.onvastgesteld.push(w);
    else uit.anders.push(w);
  }
  return uit;
}

const v = tel(pompen, "vermogen_kw", "vermogen_conditie", "Prated");
const s = tel(pompen, "scop", "scop_conditie", "35");

function toon(naam, t, normTekst) {
  console.log(`\n${naam} (${pompen.length} pompen):`);
  console.log(`  ${String(t.volgens_norm.length).padStart(3)}  ${normTekst}`);
  console.log(`  ${String(t.anders.length).padStart(3)}  bij een andere conditie, gemarkeerd`);
  console.log(`  ${String(t.onbekend.length).padStart(3)}  nagezocht, fabrikant publiceert de conditie niet`);
  console.log(`  ${String(t.onvastgesteld.length).padStart(3)}  nog niet nagekeken`);
  if (t.geen_getal.length) console.log(`  ${String(t.geen_getal.length).padStart(3)}  geen getal opgegeven`);
  if (t.onvastgesteld.length) {
    for (const w of t.onvastgesteld) console.log(`       - ${w.id}`);
  }
}

toon("Vermogen", v, "Prated (EU 811/2013), volgens de norm");
toon("SCOP", s, "bij 35 graden aanvoer, volgens de norm");

const open = v.onvastgesteld.length + s.onvastgesteld.length;

if (open && process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    `### warmtepompmaatje: ${open} keer is niet vastgesteld waar een getal geldt`,
    "",
    "De site vergelijkt op vermogen en SCOP; die betekenen alleen iets als erbij",
    "staat bij welke buiten- en aanvoertemperatuur ze gemeten zijn. Zie REDACTIE.md.",
    "",
  ].join("\n") + "\n");
}

if (STRENG && open) {
  console.error(`\n${open} getal(len) zonder vastgestelde conditie.`);
  process.exit(1);
}
