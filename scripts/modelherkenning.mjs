/**
 * De proef op de modelherkenning, voor alle sites tegelijk.
 *
 * Het herkennen van modelnamen faalt stil: staat het patroon te ruim, dan
 * meldt het script niets meer, en "geen kandidaten" ziet er precies zo uit
 * als "alles is al bekend". Elke site heeft daarom een lijstje echte
 * winkeltitels waar de uitkomst van vastligt.
 *
 * Dit liep eerst als een lus in de workflow. Nu is het een commando dat je
 * ook zelf kunt draaien, zodat wat CI doet en wat jij doet hetzelfde is.
 */
import { readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const WORTEL = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITES = join(WORTEL, "sites");

let mis = 0;
for (const site of readdirSync(SITES)) {
  const map = join(SITES, site);
  const proef = join(map, "scripts", "nieuwe-modellen.mjs");
  if (!existsSync(proef)) { console.log(`${site}: geen proef aanwezig, overgeslagen.`); continue; }

  const r = spawnSync(process.execPath, ["scripts/nieuwe-modellen.mjs", "--proef"], { cwd: map, encoding: "utf8" });
  const laatste = (r.stdout || "").trim().split("\n").filter(Boolean).pop() || "";
  if (r.status === 0) {
    console.log(`  ${laatste}`);
  } else {
    mis++;
    console.error(`\n=== ${site}\n${r.stdout || ""}${r.stderr || ""}`);
  }
}

if (mis) { console.error(`\nDe modelherkenning klopt niet op ${mis} site(s).`); process.exit(1); }
