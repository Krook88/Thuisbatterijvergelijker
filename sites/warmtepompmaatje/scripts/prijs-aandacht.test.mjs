/**
 * Tests voor prijs-aandacht.mjs - wat er nieuw is, wat er opgelost is, en wat
 * we al wisten.
 *
 * Waarom deze er zijn: de eerste versie van deze controle werd elke dag rood
 * op een werkvoorraad die deels onoplosbaar is, en de versie daarvóór draaide
 * helemaal nooit. Allebei die fouten zagen er in de workflow keurig uit. Het
 * verschil tussen "er staan 27 punten open" en "er is vandaag iets bij
 * gekomen" is het hele punt van dit bestand, dus dat verschil hoort vast te
 * liggen in proeven.
 *
 * Draaien: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { sleutelVan, vergelijk, leesBekend, schrijfBekend, dagenOpen } from "./prijs-aandacht.mjs";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const VANDAAG = "2026-08-16";
const punt = (soort, id, winkel, tekst = `${id} @ ${winkel}`) => ({ soort, id, winkel, tekst });

/* ------------------------------------------------------------------
   Nieuw, bekend, opgelost
   ------------------------------------------------------------------ */

test("zonder voorgeschiedenis is alles nieuw", () => {
  const u = vergelijk([punt("verouderd", "a", "Winkel")], new Map(), VANDAAG);
  assert.equal(u.nieuw.length, 1);
  assert.equal(u.onveranderd.length, 0);
  assert.equal(u.opgelost.length, 0);
});

test("wat we gisteren al wisten is vandaag geen alarm", () => {
  const eerste = vergelijk([punt("geweigerd", "a", "Marstek")], new Map(), "2026-08-15");
  const bekend = new Map(Object.entries(eerste.punten));
  const tweede = vergelijk([punt("geweigerd", "a", "Marstek")], bekend, VANDAAG);
  assert.equal(tweede.nieuw.length, 0, "een 403 die er gisteren ook was is geen nieuws");
  assert.equal(tweede.onveranderd.length, 1);
});

test("de datum waarop een punt voor het eerst opdook blijft staan", () => {
  const eerste = vergelijk([punt("geweigerd", "a", "Marstek")], new Map(), "2026-07-01");
  const bekend = new Map(Object.entries(eerste.punten));
  const tweede = vergelijk([punt("geweigerd", "a", "Marstek")], bekend, VANDAAG);
  assert.equal(tweede.onveranderd[0].sinds, "2026-07-01");
  assert.equal(tweede.punten[sleutelVan("geweigerd", { id: "a", winkel: "Marstek" })].sinds, "2026-07-01");
});

test("een punt dat verdwijnt heet opgelost en verdwijnt uit de lijst", () => {
  const eerste = vergelijk([punt("verouderd", "a", "Winkel")], new Map(), "2026-08-15");
  const bekend = new Map(Object.entries(eerste.punten));
  const tweede = vergelijk([], bekend, VANDAAG);
  assert.equal(tweede.opgelost.length, 1);
  assert.deepEqual(Object.keys(tweede.punten), [], "opgeloste punten horen niet in de nieuwe lijst");
});

/* ------------------------------------------------------------------
   Wat telt als hetzelfde punt
   ------------------------------------------------------------------ */

test("een bedrag dat schuift maakt geen nieuw punt", () => {
  // Anders is elke prijs die van 850 naar 860 kruipt elke dag opnieuw alarm.
  const gisteren = vergelijk([punt("te controleren", "a", "Winkel", "a @ Winkel: €850 → €480")], new Map(), "2026-08-15");
  const bekend = new Map(Object.entries(gisteren.punten));
  const vandaag = vergelijk([punt("te controleren", "a", "Winkel", "a @ Winkel: €850 → €495")], bekend, VANDAAG);
  assert.equal(vandaag.nieuw.length, 0);
});

test("hetzelfde product bij een andere winkel is wel een nieuw punt", () => {
  const gisteren = vergelijk([punt("verouderd", "a", "Winkel A")], new Map(), "2026-08-15");
  const bekend = new Map(Object.entries(gisteren.punten));
  const vandaag = vergelijk([punt("verouderd", "a", "Winkel A"), punt("verouderd", "a", "Winkel B")], bekend, VANDAAG);
  assert.equal(vandaag.nieuw.length, 1);
  assert.equal(vandaag.nieuw[0].winkel, "Winkel B");
});

test("een ander soort probleem bij dezelfde winkel is wel nieuw", () => {
  // Van "geweigerd" naar "onbereikbaar" is een verandering die iemand hoort te zien.
  const gisteren = vergelijk([punt("geweigerd", "a", "Winkel")], new Map(), "2026-08-15");
  const bekend = new Map(Object.entries(gisteren.punten));
  const vandaag = vergelijk([punt("onbereikbaar", "a", "Winkel")], bekend, VANDAAG);
  assert.equal(vandaag.nieuw.length, 1);
  assert.equal(vandaag.opgelost.length, 1);
});

test("hetzelfde punt twee keer op één dag telt één keer", () => {
  const u = vergelijk([punt("verouderd", "a", "Winkel"), punt("verouderd", "a", "Winkel")], new Map(), VANDAAG);
  assert.equal(u.nieuw.length, 1);
});

/* ------------------------------------------------------------------
   De lijst op schijf
   ------------------------------------------------------------------ */

test("de lijst overleeft een rondje schrijven en lezen", () => {
  const pad = join(mkdtempSync(join(tmpdir(), "aandacht-")), "prijs-aandacht.json");
  const eerste = vergelijk([punt("verouderd", "a", "Winkel")], new Map(), "2026-07-01");
  schrijfBekend(pad, eerste.punten, "2026-07-01");
  const terug = leesBekend(pad);
  assert.equal(terug.size, 1);
  assert.equal(vergelijk([punt("verouderd", "a", "Winkel")], terug, VANDAAG).nieuw.length, 0);
});

test("een lijst die er nog niet is levert een lege lijst, geen fout", () => {
  assert.equal(leesBekend(join(tmpdir(), `bestaat-niet-${Date.now()}.json`)).size, 0);
});

test("een stukgelopen lijst laat de run niet klappen", () => {
  // Eén dag ruis is minder erg dan een prijsupdate die niet draait.
  const pad = join(mkdtempSync(join(tmpdir(), "aandacht-")), "stuk.json");
  writeFileSync(pad, "{ dit is geen json");
  assert.equal(leesBekend(pad).size, 0);
});

test("de lijst staat op sleutelvolgorde, zodat de diff leesbaar blijft", () => {
  const pad = join(mkdtempSync(join(tmpdir(), "aandacht-")), "prijs-aandacht.json");
  const u = vergelijk([punt("verouderd", "z", "W"), punt("verouderd", "a", "W")], new Map(), VANDAAG);
  schrijfBekend(pad, u.punten, VANDAAG);
  const sleutels = Object.keys(JSON.parse(readFileSync(pad, "utf8")).punten);
  assert.deepEqual(sleutels, [...sleutels].sort());
});

/* ------------------------------------------------------------------
   Hoe lang staat iets open
   ------------------------------------------------------------------ */

test("dagenOpen rekent in hele dagen en slikt onzin", () => {
  assert.equal(dagenOpen("2026-08-01", "2026-08-16"), 15);
  assert.equal(dagenOpen("2026-08-16", "2026-08-16"), 0);
  assert.equal(dagenOpen("gisteren", "2026-08-16"), null);
});
