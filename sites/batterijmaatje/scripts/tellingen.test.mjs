/**
 * Tests voor de aantallen die met de hand in de pagina's staan.
 *
 * Waarom deze er zijn: op `over-ons.html` stond "de volledige dataset (28
 * thuisbatterijen)". Dat klopte toen het er kwam te staan en is meegegroeid
 * naar 41 zonder dat iemand die zin nog eens las. Het viel op omdat een
 * zoekmachine het overnam: in het zoekresultaat en in de samenvatting die
 * AI-assistenten van de site geven stond "vergelijkt 28 batterijen".
 *
 * Dat is het vervelende aan zo'n getal. De pagina blijft werken, de tekst
 * blijft lopen, en de fout verspreidt zich juist naar de plek waar nieuwe
 * bezoekers hem het eerst zien.
 *
 * De gegenereerde pagina's hebben dit probleem niet - die tellen zelf. Deze
 * test bewaakt de handgeschreven pagina's, en meteen ook de gegenereerde,
 * want een generator die verkeerd telt hoort net zo goed op te vallen.
 *
 * Draaien: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lees = (naam) => readFileSync(resolve(ROOT, naam), "utf8");

const batterijen = JSON.parse(lees("data/batterijen.json")).batterijen;
const leveranciers = JSON.parse(lees("data/leveranciers.json")).leveranciers;

// Alleen de pagina's in de hoofdmap: /batterij en /vergelijk worden per model
// gegenereerd en noemen aantallen die bij dat ene model horen.
const paginas = readdirSync(ROOT).filter((n) => n.endsWith(".html"));

/* Een claim over het geheel herken je aan het woord dat erachter staat.
   "23 stekkerbatterijen" en "18 modellen" gaan over een deelverzameling en
   worden hier bewust niet gecontroleerd; die staan alleen op gegenereerde
   pagina's, die ze zelf tellen. */
const CLAIMS = [
  { woord: "thuisbatterijen", verwacht: () => batterijen.length },
  { woord: "energieleveranciers", verwacht: () => leveranciers.length },
];

test("de teller in de hero staat op het werkelijke aantal", () => {
  // app.js zet dit getal in de browser goed, dus op het scherm viel nooit iets
  // op. De HTML die van de server komt is wat een zoekmachine leest, en daar
  // stond 36 terwijl er 41 in de lijst staan. De generator vult hem nu.
  const teller = lees("index.html").match(/<b id="tellerBatterijen">(\d+)<\/b>/);
  assert.ok(teller, "de teller staat niet meer in index.html; dan klopt de generator niet meer");
  assert.equal(Number(teller[1]), batterijen.length);
});

for (const { woord, verwacht } of CLAIMS) {
  test(`elk genoemd aantal ${woord} klopt met de gegevens`, () => {
    const patroon = new RegExp(`(\\d+)\\s+${woord}`, "g");
    const fout = [];
    for (const pagina of paginas) {
      for (const [, getal] of lees(pagina).matchAll(patroon)) {
        if (Number(getal) !== verwacht()) fout.push(`${pagina}: ${getal} ${woord}`);
      }
    }
    assert.deepEqual(fout, [], `staat er ${verwacht()} in de gegevens, dan hoort dat ook op de pagina te staan:\n  ${fout.join("\n  ")}`);
  });
}
