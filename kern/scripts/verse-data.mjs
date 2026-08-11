#!/usr/bin/env node
/**
 * Kijkt hoe vers de gegevens van deze site zijn.
 *
 * Waarom dit bestaat: de gegevens van warmtepompmaatje stonden twaalf dagen
 * stil zonder dat iemand het merkte. De dagelijkse workflow slaagde elke dag,
 * de site werd elke dag gepubliceerd, en toch stond er "Bijgewerkt: 30 juli".
 * De oorzaak lag buiten het prijsscript (bij de verhuizing naar de monorepo
 * kwam een oude momentopname mee, en de workflow draaide die ochtend nog de
 * vorige versie), en juist daarom viel het nergens op: elk onderdeel op
 * zichzelf deed het goed.
 *
 * Een groene workflow zegt dus niet dat de gegevens vers zijn. Deze controle
 * zegt dat wel, want hij kijkt naar de uitkomst in plaats van naar de stappen.
 *
 * Gebruik:
 *   node scripts/verse-data.mjs            meld de ouderdom, stop met 0
 *   node scripts/verse-data.mjs --streng   stop met een foutcode als iets te
 *                                          oud is (voor CI)
 *   node scripts/verse-data.mjs --dagen 3  wat "te oud" betekent (standaard 2)
 */

import { readFileSync, readdirSync, existsSync, appendFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA = join(ROOT, "data");

const STRENG = process.argv.includes("--streng");
const i = process.argv.indexOf("--dagen");
// Twee dagen speling: een run die net over middernacht valt of een dag
// overslaat door een storing is geen probleem dat iemand moet oplossen.
const MAX_DAGEN = i !== -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : 2;

const site = ROOT.split("/").pop();

if (!existsSync(DATA)) {
  console.log(`${site}: geen data/ om te controleren.`);
  process.exit(0);
}

const vandaag = new Date(new Date().toISOString().slice(0, 10));
const bevindingen = [];

for (const bestand of readdirSync(DATA).filter((f) => f.endsWith(".json"))) {
  let data;
  try {
    data = JSON.parse(readFileSync(join(DATA, bestand), "utf8"));
  } catch (err) {
    bevindingen.push({ bestand, ouderdom: null, melding: `onleesbaar: ${err.message}` });
    continue;
  }
  // Alleen bestanden die zelf bijhouden wanneer ze bijgewerkt zijn. Een lijst
  // met leveranciers of iconen hoort niet dagelijks te veranderen.
  if (!data || typeof data.laatst_bijgewerkt !== "string") continue;
  const toen = new Date(data.laatst_bijgewerkt);
  const ouderdom = Number.isNaN(toen.getTime())
    ? null
    : Math.round((vandaag - toen) / 86400000);
  bevindingen.push({ bestand, datum: data.laatst_bijgewerkt, ouderdom });
}

if (!bevindingen.length) {
  console.log(`${site}: geen databestand met een datum erin.`);
  process.exit(0);
}

const teOud = bevindingen.filter((b) => b.ouderdom === null || b.ouderdom > MAX_DAGEN);

for (const b of bevindingen) {
  const staat = b.melding
    ? b.melding
    : b.ouderdom === null ? "datum onleesbaar"
    : b.ouderdom === 0 ? "van vandaag"
    : b.ouderdom === 1 ? "van gisteren"
    : `${b.ouderdom} dagen oud`;
  console.log(`  ${teOud.includes(b) ? "!" : "="} ${site}/${b.bestand}: ${b.datum || "?"} (${staat})`);
}

if (teOud.length && process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    `### ${site}: ${teOud.length} databestand(en) langer dan ${MAX_DAGEN} dagen niet bijgewerkt`,
    "",
    "De site publiceert dan wel, maar toont verouderde prijzen en een datum die de bezoeker misleidt.",
    "",
    "| bestand | laatst bijgewerkt | ouderdom |",
    "| --- | --- | --- |",
    ...teOud.map((b) => `| ${b.bestand} | ${b.datum || "?"} | ${b.ouderdom === null ? "?" : b.ouderdom + " dagen"} |`),
    "",
  ].join("\n") + "\n");
}

if (teOud.length && STRENG) {
  console.error(`\n${site}: ${teOud.length} databestand(en) te oud (meer dan ${MAX_DAGEN} dagen).`);
  process.exit(1);
}
