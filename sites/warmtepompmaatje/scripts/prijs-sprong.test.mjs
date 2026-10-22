/**
 * Tests voor prijs-sprong.mjs: wat de prijsupdate zelf doet met een prijs die
 * te ver van de vorige ligt. Draaien: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { sprong, hersteld, referentie, mediaan, DOOR, RUNS } from "./prijs-sprong.mjs";

const dagen = ["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"];

test("een sprong die niet bij de andere winkels past, gaat na drie runs uit de vergelijking", () => {
  // De Hyxi Halo: € 619 bij Stekker-batterij.nl, € 750 bij een andere winkel,
  // en ineens € 1.950.
  const a = { winkel: "Stekker-batterij.nl", prijs_eur: 619 };
  assert.equal(sprong(a, 1950, 750, dagen[0]), "wachten");
  assert.equal(sprong(a, 1950, 750, dagen[1]), "wachten");
  assert.equal(sprong(a, 1950, 750, dagen[2]), "uitgezet");
  assert.equal(a.niet_leverbaar, true);
  assert.equal(a.niet_leverbaar_door, DOOR);
  assert.equal(a.prijs_eur, 619, "de oude prijs wordt niet overschreven");
  assert.equal(sprong(a, 1950, 750, dagen[3]), "blijft");
});

test("een sprong die wel bij de andere winkels past, is een echte prijswijziging", () => {
  const a = { prijs_eur: 619 };
  sprong(a, 820, 799, dagen[0]);
  sprong(a, 820, 799, dagen[1]);
  assert.equal(sprong(a, 820, 799, dagen[2]), "overnemen");
  assert.equal(a.afwijking, undefined);
  assert.equal(a.niet_leverbaar, undefined);
});

test("een ander bedrag begint de telling opnieuw, een tweede run op dezelfde dag telt niet", () => {
  const a = { prijs_eur: 619 };
  sprong(a, 1950, 750, dagen[0]);
  sprong(a, 1950, 750, dagen[0]);
  assert.equal(a.afwijking.runs, 1);
  sprong(a, 1950, 750, dagen[1]);
  sprong(a, 1400, 750, dagen[2]);
  assert.equal(a.afwijking.runs, 1);
  assert.equal(a.afwijking.sinds, dagen[2]);
  // Binnen 3% telt als hetzelfde bedrag.
  sprong(a, 1420, 750, dagen[3]);
  assert.equal(a.afwijking.runs, 2);
});

test("zonder referentie gaat een aanhoudende sprong ook uit de vergelijking", () => {
  const a = { prijs_eur: 619 };
  for (let i = 0; i < RUNS; i++) sprong(a, 1950, null, dagen[i]);
  assert.equal(a.niet_leverbaar_door, DOOR);
});

test("komt de winkel terug op een passende prijs, dan telt hij weer mee", () => {
  const a = { prijs_eur: 619, niet_leverbaar: true, niet_leverbaar_door: DOOR, afwijking: { prijs: 1950, runs: 3 } };
  assert.equal(hersteld(a), true);
  assert.equal(a.niet_leverbaar, undefined);
  assert.equal(a.afwijking, undefined);
});

test("een markering van iets anders blijft staan", () => {
  for (const door of ["voorraad", "pagina weg", undefined]) {
    const a = { prijs_eur: 619, niet_leverbaar: true, niet_leverbaar_door: door };
    assert.equal(hersteld(a), false);
    assert.equal(a.niet_leverbaar, true);
    for (let i = 0; i < RUNS; i++) sprong(a, 1950, 750, dagen[i]);
    assert.equal(a.niet_leverbaar_door, door, "sprong neemt een andere markering niet over");
  }
});

test("de referentie is de mediaan van de andere leverbare winkels, anders de richtprijs", () => {
  const eigen = { prijs_eur: 619 };
  const lijst = [eigen, { prijs_eur: 750 }, { prijs_eur: 800 }, { prijs_eur: 9999, niet_leverbaar: true }];
  assert.equal(referentie(lijst, eigen, (a) => a.prijs_eur, 749), 775);
  assert.equal(referentie([eigen], eigen, (a) => a.prijs_eur, 749), 749);
  assert.equal(referentie([eigen], eigen, (a) => a.prijs_eur, null), null);
  assert.equal(mediaan([3, 1, 2]), 2);
});
