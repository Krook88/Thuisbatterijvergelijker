/**
 * Tests voor assets/condities.js - de module die vastlegt onder welke
 * omstandigheden een getal geldt.
 *
 * Waarom deze er zijn: bij een warmtepomp betekent hetzelfde getal
 * verschillende dingen. "7 kW" is meestal gemeten bij zeven graden buiten - een
 * milde dag - en niet bij de ontwerptemperatuur waarvoor je hem koopt. De NIBE
 * S2125-8 heet acht kilowatt en levert er vijf. Een SCOP van 4,7 bij 35 graden
 * aanvoer is ruim een punt beter dan dezelfde 4,7 bij 55 graden.
 *
 * Die conditie stuurt sinds kort ook de rekenmodule: alleen een SCOP waarvan
 * vaststaat dat hij bij 35 graden geldt, mag de besparing bepalen. Gaat dat
 * stuk, dan krijgt elke pomp weer dezelfde uitkomst zonder dat iemand het ziet.
 *
 * Draaien: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const Condities = createRequire(import.meta.url)("../assets/condities.js");

/* ------------------------------------------------------------------
   Vermogen
   ------------------------------------------------------------------ */

test("alleen Prated geldt als vastgesteld vermogen", () => {
  assert.equal(Condities.vermogenBevestigd({ vermogen_kw: 5, vermogen_conditie: "Prated" }), true);
  assert.equal(Condities.vermogenBevestigd({ vermogen_kw: 5, vermogen_conditie: "A7/W35" }), false);
  assert.equal(Condities.vermogenBevestigd({ vermogen_kw: 5, vermogen_conditie: "onbekend" }), false);
  assert.equal(Condities.vermogenBevestigd({ vermogen_kw: 5 }), false);
});

test("een vermogen bij zeven graden krijgt een waarschuwende toelichting", () => {
  assert.equal(Condities.vermogenToelichting({ vermogen_kw: 5, vermogen_conditie: "Prated" }), null);
  assert.match(Condities.vermogenToelichting({ vermogen_kw: 5, vermogen_conditie: "A7/W35" }), /koude dag levert hij minder/);
  assert.match(Condities.vermogenToelichting({ vermogen_kw: 5, vermogen_conditie: "onbekend" }), /publiceert niet/);
  assert.match(Condities.vermogenToelichting({ vermogen_kw: 5 }), /niet vastgesteld/);
});

test("het label zegt koude dag bij Prated en niets bij een onbekende conditie", () => {
  assert.match(Condities.labelHtml("vermogen", { vermogen_kw: 5, vermogen_conditie: "Prated" }), /koude dag/);
  assert.match(Condities.labelHtml("vermogen", { vermogen_kw: 5, vermogen_conditie: "A7/W35" }), /bij 7/);
  assert.equal(Condities.labelHtml("vermogen", { vermogen_kw: 5, vermogen_conditie: "onbekend" }), "");
});

/* ------------------------------------------------------------------
   SCOP - stuurt sinds kort de terugverdientijd
   ------------------------------------------------------------------ */

test("alleen een SCOP bij 35 graden geldt als vastgesteld", () => {
  assert.equal(Condities.scopBevestigd({ scop: 4.7, scop_conditie: "35" }), true);
  assert.equal(Condities.scopBevestigd({ scop: 4.7, scop_conditie: 35 }), true, "een getal telt net zo goed als de tekst");
  assert.equal(Condities.scopBevestigd({ scop: 4.7, scop_conditie: "55" }), false);
  assert.equal(Condities.scopBevestigd({ scop: 4.7, scop_conditie: "onbekend" }), false);
  assert.equal(Condities.scopBevestigd({ scop: 4.7 }), false);
});

test("een SCOP bij 55 graden wordt als zodanig benoemd", () => {
  assert.equal(Condities.scopToelichting({ scop: 4.7, scop_conditie: "35" }), null);
  assert.match(Condities.scopToelichting({ scop: 4.7, scop_conditie: "55" }), /ruim een punt hoger/);
  assert.match(Condities.scopToelichting({ scop: 4.7, scop_conditie: "onbekend" }), /publiceert niet/);
});

test("zonder getal geen toelichting en geen label", () => {
  assert.equal(Condities.vermogenToelichting({}), null);
  assert.equal(Condities.scopToelichting({}), null);
  assert.equal(Condities.labelHtml("vermogen", {}), "");
  assert.equal(Condities.labelHtml("scop", {}), "");
});

test("het label is klaar om in HTML te zetten en bevat geen invoer van buiten", () => {
  const html = Condities.labelHtml("scop", { scop: 4.7, scop_conditie: "35" });
  assert.match(html, /^ <small class="[a-z-]+" title="[^"]*">[^<]*<\/small>$/);
});
