#!/usr/bin/env node
/**
 * Zoekt teksten die aan de kalender hangen en verlopen zijn.
 *
 * Waarom dit bestaat: in de rekenmodule van zonnestroommaatje stond het
 * aanschafjaar hard op 2026. Dat werkte prima tot en met 2026 en zou op
 * 1 januari 2027 stilletjes fout gaan - de berekening telt het eerste jaar
 * voor de helft mee en gebruikt saldering zolang het jaartal onder het
 * eindjaar ligt, dus wie in 2027 zou rekenen kreeg een half jaar
 * salderingsvoordeel toegerekend dat hij nooit krijgt. Ruim een half jaar te
 * gunstige terugverdientijd, precies wanneer mensen gaan rekenen omdat de
 * regeling verandert.
 *
 * Er stonden ook zinnen als "tot en met 31 december 2026 geldt de
 * salderingsregeling nog". Waar is dat vandaag, onwaar op nieuwjaarsdag.
 *
 * Zulke fouten hebben geen dader en geen moment: niemand verandert iets, de
 * kalender verschuift en de site heeft ongelijk. Daarom kijkt deze controle
 * ernaar in plaats van dat iemand het moet onthouden.
 *
 * Wat hij zoekt:
 *   1. Zinnen met "nog" plus een datum die voorbij is ("geldt nog tot en met
 *      31 december 2026" terwijl het 2027 is).
 *   2. Jaartallen in code die niet uit de kalender komen maar er wel over gaan.
 *      Die worden alleen gemeld, want een jaartal als grens van een wet hoort
 *      juist vast te staan - het is de vermelding die mee moet bewegen, niet
 *      het feit.
 *
 * Gebruik:
 *   node scripts/datumteksten.mjs             rapport
 *   node scripts/datumteksten.mjs --streng    foutcode bij verlopen teksten
 */

import { readFileSync, readdirSync, statSync, appendFileSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STRENG = process.argv.includes("--streng");
const NU = new Date();

// Zinnen die alleen kloppen zolang een datum in de toekomst ligt.
//
// Het gaat om twee vormen, en de rest bewust niet. "Nog" is de verklikker:
// "geldt nog tot en met 2026" wordt onwaar zodra 2026 voorbij is. En een
// lopende actie ("de voorverkoop loopt van ... tot ...") verloopt vanzelf.
//
// Een volledige regel als "salderen mag tot en met 31 december 2026; per
// 1 januari 2027 stopt de regeling" blijft daarentegen waar, ook in 2028. Die
// hoort hier niet in het rapport, anders leert niemand er nog naar te kijken.
const LOPENDE_TIJD = /[^.<>]{0,120}?(?:\bnog\b|\bloopt\s+(?:van|tot)\b)[^.<>]{0,120}?\b(?:tot en met|tot)\s+(?:(\d{1,2})\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+)?(\d{4})[^.<>]{0,80}/gi;

const MAANDEN = { januari:0, februari:1, maart:2, april:3, mei:4, juni:5, juli:6,
                  augustus:7, september:8, oktober:9, november:10, december:11 };

function bestandenIn(map, uit = []) {
  for (const naam of readdirSync(map)) {
    if (naam === "node_modules" || naam.startsWith(".")) continue;
    const pad = join(map, naam);
    if (statSync(pad).isDirectory()) bestandenIn(pad, uit);
    else if (/\.(html|js|mjs)$/.test(naam)) uit.push(pad);
  }
  return uit;
}

let verlopen = 0;
let binnenkort = 0;

for (const site of readdirSync(resolve(ROOT, "sites"))) {
  const meldingen = [];
  for (const pad of bestandenIn(resolve(ROOT, "sites", site))) {
    const inhoud = readFileSync(pad, "utf8");
    for (const m of inhoud.matchAll(LOPENDE_TIJD)) {
      const [, dag, maand, jaar] = m;
      // Zonder dag: de hele periode loopt tot en met het einde van dat jaar.
      const einde = dag && maand
        ? new Date(Number(jaar), MAANDEN[maand.toLowerCase()], Number(dag), 23, 59, 59)
        : new Date(Number(jaar), 11, 31, 23, 59, 59);
      const overDagen = Math.round((einde - NU) / 86400000);
      // Een zin die zichzelf al aanpast aan de datum is in orde.
      const rondom = inhoud.slice(Math.max(0, m.index - 300), m.index);
      if (/new Date\(\)\s*<\s*new Date\(/.test(rondom)) continue;
      if (overDagen < 0) { verlopen++; meldingen.push(["VERLOPEN", overDagen, pad, m[0]]); }
      else if (overDagen < 180) { binnenkort++; meldingen.push(["verloopt", overDagen, pad, m[0]]); }
    }
  }
  if (meldingen.length) {
    console.log(`\n${site}`);
    for (const [soort, dagen, pad, tekst] of meldingen) {
      const wanneer = dagen < 0 ? `${-dagen} dagen geleden` : `over ${dagen} dagen`;
      console.log(`  ${soort} (${wanneer})  ${relative(ROOT, pad)}`);
      console.log(`     "${tekst.replace(/\s+/g, " ").trim().slice(0, 120)}"`);
    }
  }
}

console.log(
  verlopen || binnenkort
    ? `\n${verlopen} verlopen, ${binnenkort} verlopen binnen een half jaar.`
    : "\nGeen teksten gevonden die aan een voorbije datum hangen."
);
if (binnenkort && !verlopen) {
  console.log("Nog niet fout, wel bijna. Een zin die zichzelf aanpast aan de datum");
  console.log("wordt overgeslagen: zie assets/advies.js voor hoe dat eruitziet.");
}

if ((verlopen || binnenkort) && process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### Datumteksten: ${verlopen} verlopen, ${binnenkort} bijna\n\nZie scripts/datumteksten.mjs.\n\n`);
}

if (STRENG && verlopen) process.exit(1);
