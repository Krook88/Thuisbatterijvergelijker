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
 * Sinds 27 augustus telt er een derde geval mee: iets wat één run opduikt en
 * daarna weer weg is. Zes van de zeven meldingen van die ochtend waren dat.
 * Een punt is dus pas nieuws als het de volgende run nóg opduikt, en de proeven
 * hieronder draaien daarom vaak drie runs in plaats van twee.
 *
 * Draaien: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { sleutelVan, vergelijk, leesBekend, schrijfBekend, dagenOpen, isBevestigd } from "./prijs-aandacht.mjs";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const VANDAAG = "2026-08-16";
const punt = (soort, id, winkel, tekst = `${id} @ ${winkel}`) => ({ soort, id, winkel, tekst });

/**
 * Draait een reeks runs achter elkaar en geeft de uitkomst van de laatste.
 * Elke run is [datum, punten], net als in het echt: de lijst van de vorige run
 * is de voorkennis van de volgende.
 */
function runs(...dagen) {
  let bekend = new Map();
  let uit;
  for (const [dag, punten] of dagen) {
    uit = vergelijk(punten, bekend, dag);
    bekend = new Map(Object.entries(uit.punten));
  }
  return uit;
}

/* ------------------------------------------------------------------
   Eén run afwachten voordat iets nieuws heet
   ------------------------------------------------------------------ */

test("wat voor het eerst opduikt is nog geen nieuws", () => {
  // Winkels haperen. Op 27 augustus gaven vier omvormers bij Zonnige Winkel
  // 's middags geen bedrag en een uur later weer wel.
  const u = runs(["2026-08-15", [punt("zonder bedrag", "a", "Zonnige Winkel")]]);
  assert.equal(u.afwachten.length, 1);
  assert.equal(u.nieuw.length, 0, "hier wordt de run niet rood van");
  assert.equal(u.onveranderd.length, 0);
});

test("wat er de volgende run nóg staat is wél nieuws", () => {
  const u = runs(
    ["2026-08-15", [punt("zonder bedrag", "a", "Zonnige Winkel")]],
    [VANDAAG, [punt("zonder bedrag", "a", "Zonnige Winkel")]],
  );
  assert.equal(u.nieuw.length, 1);
  assert.equal(u.afwachten.length, 0);
  assert.equal(u.nieuw[0].sinds, "2026-08-15", "de dag dat het begon, niet de dag dat het nieuws werd");
});

test("wat weg is voordat het nieuws werd verdwijnt stil", () => {
  const u = runs(
    ["2026-08-15", [punt("geweigerd", "a", "Stroomwinkel")]],
    [VANDAAG, []],
  );
  assert.equal(u.vervallen.length, 1);
  assert.equal(u.opgelost.length, 0, "nooit gemeld, dus ook niet opgelost te noemen");
  assert.deepEqual(Object.keys(u.punten), []);
});

test("een punt dat blijft staan is daarna werkvoorraad, geen alarm", () => {
  const u = runs(
    ["2026-08-14", [punt("geweigerd", "a", "Marstek")]],
    ["2026-08-15", [punt("geweigerd", "a", "Marstek")]],
    [VANDAAG, [punt("geweigerd", "a", "Marstek")]],
  );
  assert.equal(u.nieuw.length, 0, "een 403 die er gisteren ook al was is geen nieuws meer");
  assert.equal(u.onveranderd.length, 1);
});

test("een punt dat een run overslaat begint opnieuw met afwachten", () => {
  // Anders zou een winkel die om de dag hapert alsnog elke twee dagen rood geven.
  const u = runs(
    ["2026-08-14", [punt("zonder bedrag", "a", "Winkel")]],
    ["2026-08-15", []],
    [VANDAAG, [punt("zonder bedrag", "a", "Winkel")]],
  );
  assert.equal(u.nieuw.length, 0);
  assert.equal(u.afwachten.length, 1);
  assert.equal(u.afwachten[0].sinds, VANDAAG, "en de teller begint opnieuw");
});

/* ------------------------------------------------------------------
   Nieuw, bekend, opgelost
   ------------------------------------------------------------------ */

test("de datum waarop een punt voor het eerst opdook blijft staan", () => {
  const u = runs(
    ["2026-07-01", [punt("geweigerd", "a", "Marstek")]],
    ["2026-07-02", [punt("geweigerd", "a", "Marstek")]],
    [VANDAAG, [punt("geweigerd", "a", "Marstek")]],
  );
  assert.equal(u.onveranderd[0].sinds, "2026-07-01");
  assert.equal(u.punten[sleutelVan("geweigerd", { id: "a", winkel: "Marstek" })].sinds, "2026-07-01");
});

test("een bevestigd punt dat verdwijnt heet opgelost en gaat uit de lijst", () => {
  const u = runs(
    ["2026-08-14", [punt("verouderd", "a", "Winkel")]],
    ["2026-08-15", [punt("verouderd", "a", "Winkel")]],
    [VANDAAG, []],
  );
  assert.equal(u.opgelost.length, 1);
  assert.deepEqual(Object.keys(u.punten), [], "opgeloste punten horen niet in de nieuwe lijst");
});

/* ------------------------------------------------------------------
   Wat telt als hetzelfde punt
   ------------------------------------------------------------------ */

test("een bedrag dat schuift maakt geen nieuw punt", () => {
  // Anders is elke prijs die van 850 naar 860 kruipt elke dag opnieuw alarm.
  const u = runs(
    ["2026-08-14", [punt("te controleren", "a", "Winkel", "a @ Winkel: €850 → €480")]],
    ["2026-08-15", [punt("te controleren", "a", "Winkel", "a @ Winkel: €850 → €488")]],
    [VANDAAG, [punt("te controleren", "a", "Winkel", "a @ Winkel: €850 → €495")]],
  );
  assert.equal(u.nieuw.length, 0);
  assert.equal(u.onveranderd.length, 1);
});

test("hetzelfde product bij een andere winkel is wel een nieuw punt", () => {
  const u = runs(
    ["2026-08-14", [punt("verouderd", "a", "Winkel A")]],
    ["2026-08-15", [punt("verouderd", "a", "Winkel A"), punt("verouderd", "a", "Winkel B")]],
    [VANDAAG, [punt("verouderd", "a", "Winkel A"), punt("verouderd", "a", "Winkel B")]],
  );
  assert.equal(u.nieuw.length, 1);
  assert.equal(u.nieuw[0].winkel, "Winkel B");
});

test("een ander soort probleem bij dezelfde winkel is wel nieuws", () => {
  // Van "geweigerd" naar "onbereikbaar" is een verandering die iemand hoort te
  // zien: dan moet er een nieuwe URL komen. Ook die wacht één run, want ook
  // een 404 kan een hik zijn.
  const eerst = runs(
    ["2026-08-14", [punt("geweigerd", "a", "Winkel")]],
    ["2026-08-15", [punt("geweigerd", "a", "Winkel")]],
    [VANDAAG, [punt("onbereikbaar", "a", "Winkel")]],
  );
  assert.equal(eerst.opgelost.length, 1, "de weigering is weg");
  assert.equal(eerst.afwachten.length, 1, "en de verdwenen pagina wacht één run");
  assert.equal(eerst.nieuw.length, 0);

  const daarna = runs(
    ["2026-08-14", [punt("geweigerd", "a", "Winkel")]],
    ["2026-08-15", [punt("geweigerd", "a", "Winkel")]],
    [VANDAAG, [punt("onbereikbaar", "a", "Winkel")]],
    ["2026-08-17", [punt("onbereikbaar", "a", "Winkel")]],
  );
  assert.equal(daarna.nieuw.length, 1);
  assert.equal(daarna.nieuw[0].soort, "onbereikbaar");
});

test("een winkel die wisselt tussen weigeren en geen bedrag tonen is één punt", () => {
  // Dit is de AEG bij AH Voordeelshop: die maakte de run in zijn eentje elke
  // dag rood, terwijl er niets veranderde aan wat een mens ermee moest.
  const u = runs(
    ["2026-08-14", [punt("geweigerd", "aeg", "AH")]],
    ["2026-08-15", [punt("geweigerd", "aeg", "AH")]],
    [VANDAAG, [punt("zonder bedrag", "aeg", "AH")]],
  );
  assert.equal(u.nieuw.length, 0, "geen alarm");
  assert.equal(u.opgelost.length, 0, "en ook geen vals goed nieuws");
  assert.equal(u.vervallen.length, 0);
  assert.equal(u.onveranderd.length, 1);
  assert.equal(u.onveranderd[0].sinds, "2026-08-14", "de dag dat het begon blijft staan");
});

test("het rapport noemt wel de soort van vandaag", () => {
  // De sleutel is hetzelfde, maar het verschil tussen "ze houden ons buiten"
  // en "we mogen binnen maar er staat niets" hoort een mens wel te zien.
  const u = runs(
    ["2026-08-14", [punt("geweigerd", "aeg", "AH")]],
    ["2026-08-15", [punt("geweigerd", "aeg", "AH")]],
    [VANDAAG, [punt("zonder bedrag", "aeg", "AH")]],
  );
  assert.equal(Object.values(u.punten)[0].soort, "zonder bedrag");
});

test("hetzelfde punt twee keer op één dag telt één keer", () => {
  const u = runs([VANDAAG, [punt("verouderd", "a", "Winkel"), punt("verouderd", "a", "Winkel")]]);
  assert.equal(u.afwachten.length, 1);
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
  const tweede = vergelijk([punt("verouderd", "a", "Winkel")], terug, VANDAAG);
  assert.equal(tweede.afwachten.length, 0, "het punt is herkend, niet opnieuw voor het eerst gezien");
  assert.equal(tweede.nieuw.length, 1);
});

test("een punt uit een lijst van vóór deze regel geldt als bevestigd", () => {
  // Anders zou de eerste run na de wijziging alles opnieuw als onbevestigd
  // wegschrijven, en de run erna eenendertig punten in één klap melden.
  const pad = join(mkdtempSync(join(tmpdir(), "aandacht-")), "oud.json");
  writeFileSync(pad, JSON.stringify({
    bijgewerkt: "2026-08-15",
    punten: { "verouderd|a|Winkel": { sinds: "2026-07-01", soort: "verouderd", tekst: "a @ Winkel" } },
  }));
  const bekend = leesBekend(pad);
  assert.equal(isBevestigd(bekend.get("verouderd|a|Winkel")), true);

  const blijft = vergelijk([punt("verouderd", "a", "Winkel")], bekend, VANDAAG);
  assert.equal(blijft.onveranderd.length, 1, "werkvoorraad, geen nieuws");
  assert.equal(blijft.nieuw.length, 0);

  const weg = vergelijk([], bekend, VANDAAG);
  assert.equal(weg.opgelost.length, 1, "en verdwijnt hij, dan is dat gewoon goed nieuws");
  assert.equal(weg.vervallen.length, 0);
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
