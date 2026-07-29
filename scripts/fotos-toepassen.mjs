#!/usr/bin/env node
/**
 * Past de beoordeelde keuzes toe op de geoogste kandidaten.
 *
 * De beoordeling gebeurt met het oog en staat hieronder vastgelegd: per
 * batterij welke kandidaat het wordt (de grootste vondst of de tweede), en
 * zo nodig het kader waarop bijgesneden moet worden. Dat laatste is voor
 * platen waar het juiste product wel op staat, maar de lijst deelt met
 * bannertekst of een distributeursbadge.
 *
 * Het script kiest zelf niets en verzint niets: het voert alleen uit.
 */

import sharp from "sharp";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RUW = resolve(ROOT, "assets/producten/_ruw2");
const DOELMAP = resolve(ROOT, "assets/producten");
const DATA_PAD = resolve(ROOT, "data/batterijen.json");

// kandidaat: 1 = grootste vondst, 2 = tweede. kader: fracties [van, tot].
const KEUZES = [
  { id: "fox-ess-ep11",        kandidaat: 1, kader: { x: [0.52, 1.0], y: [0.28, 1.0] } },
  { id: "marstek-venus-c-768", kandidaat: 1, kader: { x: [0.10, 0.72], y: [0.34, 0.98] } },
  { id: "marstek-venus-e-4",   kandidaat: 2, kader: { x: [0.14, 0.88], y: [0.24, 0.98] } },
  { id: "growatt-apx-10",      kandidaat: 2 },
  { id: "sungrow-sbr096",      kandidaat: 2 },
  { id: "marstek-venus-d",     kandidaat: 2 },
];

const verslag = JSON.parse(readFileSync(resolve(RUW, "verslag.json"), "utf8"));
const data = JSON.parse(readFileSync(DATA_PAD, "utf8"));
const perId = new Map(data.batterijen.map((b) => [b.id, b]));

let gelukt = 0;
const mislukt = [];

for (const keuze of KEUZES) {
  const r = verslag.find((x) => x.id === keuze.id);
  const bron = r && r.bewaard[keuze.kandidaat - 1];
  if (!bron) {
    mislukt.push(`${keuze.id}: kandidaat ${keuze.kandidaat} niet geoogst`);
    continue;
  }
  const pad = resolve(RUW, bron.bestand);
  if (!existsSync(pad)) {
    mislukt.push(`${keuze.id}: ${bron.bestand} ontbreekt`);
    continue;
  }

  let beeld = sharp(pad);
  if (keuze.kader) {
    const m = await beeld.metadata();
    beeld = sharp(pad).extract({
      left: Math.round(keuze.kader.x[0] * m.width),
      top: Math.round(keuze.kader.y[0] * m.height),
      width: Math.round((keuze.kader.x[1] - keuze.kader.x[0]) * m.width),
      height: Math.round((keuze.kader.y[1] - keuze.kader.y[0]) * m.height),
    });
  }

  const doel = `${keuze.id}.webp`;
  const info = await beeld
    .flatten({ background: "#ffffff" })
    .resize(900, 900, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(resolve(DOELMAP, doel));

  const b = perId.get(keuze.id);
  b.afbeelding = `assets/producten/${doel}`;
  b.afbeelding_bron = `foto: ${b.merk}`;
  gelukt++;
  console.log(
    `${keuze.id.padEnd(24)} kandidaat ${keuze.kandidaat}${keuze.kader ? " bijgesneden" : "           "}` +
    `  ${info.width}x${info.height}  ${Math.round(info.size / 1024)}kB  (${bron.soort})`,
  );
}

// Nooit een verwijzing laten staan naar een bestand dat er niet is.
const zoek = data.batterijen.filter((b) => b.afbeelding && !existsSync(resolve(ROOT, b.afbeelding)));
if (zoek.length) {
  console.error("\nSTOP: data verwijst naar ontbrekende bestanden:", zoek.map((b) => b.id).join(", "));
  process.exit(1);
}

writeFileSync(DATA_PAD, JSON.stringify(data, null, 2) + "\n", "utf8");

const met = data.batterijen.filter((b) => b.afbeelding).length;
console.log(`\n${gelukt} van de ${KEUZES.length} toegepast. Nu ${met} van de ${data.batterijen.length} batterijen met foto.`);
if (mislukt.length) {
  console.log("\nNiet gelukt:");
  for (const m of mislukt) console.log("  " + m);
}
