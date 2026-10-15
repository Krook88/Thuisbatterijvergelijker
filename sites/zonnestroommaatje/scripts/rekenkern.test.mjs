/**
 * Tests voor assets/rekenkern.js - de som achter de rekenmodule en het
 * energieplan van zonnestroommaatje.
 *
 * Waarom deze er zijn: de som stond twee keer op de site, elk met eigen
 * getallen voor teruglevering (0,05 vergoeding min 0,02 kosten), terwijl
 * batterijmaatje met de aankondigingen van leveranciers voor 2027 rekent.
 *
 * Draaien: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Rekenkern = require("../assets/rekenkern.js");
const Batterij = require("../../batterijmaatje/assets/rekenkern.js");
const leveranciers = require("../../batterijmaatje/data/leveranciers.json").leveranciers;

test("teruglevering vanaf 2027 is gelijk aan batterijmaatje", () => {
  // Twee zustersites die de bezoeker een andere vergoeding voorrekenen, is
  // precies wat hier stond: 3 cent netto tegen 1 cent op batterijmaatje.
  const b = Batterij.TERUGLEVERING.vast;
  assert.equal(Rekenkern.TERUGLEVERING_2027.vergoeding, b.terugleverVergoeding);
  assert.equal(Rekenkern.TERUGLEVERING_2027.terugleverkosten, b.terugleverKosten);
});

test("de terugleverkosten in 2026 volgen de leveranciers", () => {
  // Hier stond 0,02, terwijl vaste contracten nu 0,11 tot 0,15 rekenen.
  const vast = leveranciers.filter((l) => l.contract === "vast-variabel")
    .map((l) => l.terugleverkosten_per_kwh_indicatie).filter(Number.isFinite).sort((a, b) => a - b);
  const m = Math.floor(vast.length / 2);
  const mediaan = vast.length % 2 ? vast[m] : (vast[m - 1] + vast[m]) / 2;
  assert.equal(Rekenkern.TERUGLEVERKOSTEN_2026, Math.round(mediaan * 100) / 100);
});

test("de rekenmodule en het energieplan rekenen niet zelf", () => {
  for (const bestand of ["rekenmodule.js", "energieplan.js"]) {
    const code = readFileSync(new URL(`../assets/${bestand}`, import.meta.url), "utf8");
    assert.match(code, /Rekenkern\./, `${bestand} gebruikt de rekenkern niet`);
    assert.doesNotMatch(code, /VERGOEDING = 0\.\d|function besparingMetSaldering/, `${bestand} heeft een eigen kopie`);
  }
});

test("de standaardwaarden op de pagina zijn die van de kern", () => {
  const html = readFileSync(new URL("../rekenmodule.html", import.meta.url), "utf8");
  assert.match(html, new RegExp(`id="vergoeding"[^>]*value="${Rekenkern.TERUGLEVERING_2027.vergoeding}"`));
  assert.match(html, new RegExp(`id="terugleverkosten"[^>]*value="${Rekenkern.TERUGLEVERING_2027.terugleverkosten}"`));
});

test("na de saldering telt alleen direct eigen verbruik voluit", () => {
  const s = { ...Rekenkern.STANDAARD, opwek: 3000, eigenPct: 0.3, stroomprijs: 0.3, vergoeding: 0.01, terugleverkosten: 0 };
  assert.equal(Math.round(Rekenkern.besparingZonderSaldering(3000, s)), Math.round(900 * 0.3 + 2100 * 0.01));
});

test("een aanschaf na 2026 krijgt geen saldering", () => {
  const met = Rekenkern.bereken({ kosten: 4000, startJaar: 2026 });
  const zonder = Rekenkern.bereken({ kosten: 4000, startJaar: 2027 });
  assert.ok(zonder.terugverdientijd > met.terugverdientijd);
});

test("de terugverdientijd is een bereik om het middenscenario", () => {
  const b = Rekenkern.bandbreedte({ kosten: 4000, startJaar: 2027 }, true);
  assert.ok(b.laag < b.verwacht.terugverdientijd && b.verwacht.terugverdientijd < b.hoog);
});

test("een eigen systeemprijs schuift niet mee", () => {
  const b = Rekenkern.bandbreedte({ kosten: 4000, startJaar: 2027 }, false);
  assert.equal(b.ongunstig.invoer.kosten, 4000);
  assert.equal(b.gunstig.invoer.kosten, 4000);
});
