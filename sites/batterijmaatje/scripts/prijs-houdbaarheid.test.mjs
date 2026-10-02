/**
 * Tests voor kern/scripts/prijs-houdbaarheid.mjs.
 *
 * Deze regel stond in drie generatoren en had nergens een proef. Dat is een
 * ongelukkige combinatie: wat hier fout gaat is onzichtbaar op de pagina - die
 * werkt gewoon - en het kost precies wat deze sites willen laten zien, namelijk
 * de prijs in het zoekresultaat.
 *
 * Draaien: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { houdbaarTot } from "./prijs-houdbaarheid.mjs";

const VANDAAG = new Date("2026-08-28T12:00:00Z");

test("dertig dagen na de prijscontrole", () => {
  assert.equal(houdbaarTot("2026-08-20", VANDAAG), "2026-09-19");
});

test("een prijs van langer dan dertig dagen geleden levert geen datum op", () => {
  // Een verstreken datum publiceren is erger dan er geen zetten: Google negeert
  // de prijs dan actief.
  assert.equal(houdbaarTot("2026-07-13", VANDAAG), null);
});

test("precies op de grens telt niet meer mee", () => {
  // Dertig dagen terug geeft vandaag, en vandaag is niet groter dan vandaag.
  assert.equal(houdbaarTot("2026-07-29", VANDAAG), null);
  assert.equal(houdbaarTot("2026-07-30", VANDAAG), "2026-08-29");
});

test("zonder datum geen belofte", () => {
  // Hier stond ooit new Date() als terugval, waardoor de datum elke dag een dag
  // opschoof voor een prijs die nooit bevestigd was.
  assert.equal(houdbaarTot(null, VANDAAG), null);
  assert.equal(houdbaarTot("", VANDAAG), null);
  assert.equal(houdbaarTot(undefined, VANDAAG), null);
});

test("een datum die geen datum is levert null en geen NaN", () => {
  assert.equal(houdbaarTot("binnenkort", VANDAAG), null);
});

test("zonder tweede argument geldt de echte klok", () => {
  // De generatoren roepen hem met één argument aan; die weg moet blijven werken.
  const ruim = new Date();
  ruim.setDate(ruim.getDate() - 1);
  assert.match(houdbaarTot(ruim.toISOString().slice(0, 10)), /^\d{4}-\d{2}-\d{2}$/);
});
