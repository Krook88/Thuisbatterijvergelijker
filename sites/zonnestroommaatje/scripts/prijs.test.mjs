/**
 * Tests voor assets/prijs.js van zonnestroommaatje.
 *
 * Naast de btw-logica die alle drie de sites delen, staat hier de rekenregel
 * die deze site eigen is: wat kost een omvormer voor een dak van n panelen.
 * Micro-omvormers worden per stuk verkocht - een Enphase per paneel, een
 * APsystems per twee - terwijl een string-omvormer een apparaat voor de hele
 * installatie is. Met de kale stuksprijs stond Enphase op 109 euro naast een
 * SolarEdge van 1.050 en won hij elk scenario in de keuzehulp, ook voor daken
 * zonder een tak in de buurt.
 *
 * Draaien: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const Prijs = createRequire(import.meta.url)("../assets/prijs.js");

/* ------------------------------------------------------------------
   Btw
   ------------------------------------------------------------------ */

test("een prijs excl. btw wordt omgerekend, een prijs incl. btw blijft staan", () => {
  assert.equal(Prijs.vergelijkPrijs({ prijs_eur: 100, btw_inbegrepen: false }), 121);
  assert.equal(Prijs.vergelijkPrijs({ prijs_eur: 100 }), 100);
});

test("een aanbieding die de winkel niet meer voert telt niet mee", () => {
  const p = { aanbiedingen: [
    { winkel: "weg", prijs_eur: 50, niet_leverbaar: true },
    { winkel: "wel", prijs_eur: 70 },
  ] };
  assert.equal(Prijs.beste(p).winkel, "wel");
});

/* ------------------------------------------------------------------
   Stuksprijs tegenover systeemprijs
   ------------------------------------------------------------------ */

test("een string-omvormer kost hetzelfde, ongeacht het aantal panelen", () => {
  const o = { richtprijs_eur: 1050, panelen_per_eenheid: null };
  assert.equal(Prijs.systeemPrijs(o, 6), 1050);
  assert.equal(Prijs.systeemPrijs(o, 12), 1050);
  assert.equal(Prijs.systeemPrijs(o, 24), 1050);
});

test("een micro-omvormer per paneel schaalt mee, plus de gateway", () => {
  const enphase = { richtprijs_eur: 109, panelen_per_eenheid: 1, systeem_toeslag_eur: 250 };
  assert.equal(Prijs.systeemPrijs(enphase, 12), 109 * 12 + 250);
  assert.equal(Prijs.systeemPrijs(enphase, 6), 109 * 6 + 250);
});

test("een micro die twee panelen bedient heeft er half zoveel nodig", () => {
  const aps = { richtprijs_eur: 149, panelen_per_eenheid: 2, systeem_toeslag_eur: 150 };
  assert.equal(Prijs.systeemPrijs(aps, 12), 149 * 6 + 150);
});

test("bij een oneven aantal panelen wordt naar boven afgerond", () => {
  // Elf panelen op een duo-micro: zes stuks, want vijf en een half bestaat niet.
  const aps = { richtprijs_eur: 100, panelen_per_eenheid: 2, systeem_toeslag_eur: 0 };
  assert.equal(Prijs.systeemPrijs(aps, 11), 600);
});

test("de stuksprijs is nooit hoger dan de systeemprijs, en dat is het hele punt", () => {
  const enphase = { richtprijs_eur: 109, panelen_per_eenheid: 1, systeem_toeslag_eur: 250 };
  const solaredge = { richtprijs_eur: 1050, panelen_per_eenheid: null };
  // Los lijkt Enphase tien keer goedkoper; voor twaalf panelen is hij duurder.
  assert.ok(Prijs.vergelijkPrijs(Prijs.beste(enphase)) < Prijs.vergelijkPrijs(Prijs.beste(solaredge)));
  assert.ok(Prijs.systeemPrijs(enphase, 12) > Prijs.systeemPrijs(solaredge, 12));
});

test("zonder prijs geen systeemprijs", () => {
  assert.equal(Prijs.systeemPrijs({ panelen_per_eenheid: 1 }, 12), null);
});

test("een ontbrekend aantal panelen levert minstens één eenheid op", () => {
  const o = { richtprijs_eur: 100, panelen_per_eenheid: 1, systeem_toeslag_eur: 0 };
  assert.equal(Prijs.systeemPrijs(o, 0), 100);
  assert.equal(Prijs.systeemPrijs(o, undefined), 100);
});
