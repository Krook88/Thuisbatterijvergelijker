/**
 * Tests voor het vergelijken van onze waarde met de bronpagina.
 *
 * De zinnen hieronder zijn niet verzonnen: ze komen uit het logboek van de
 * werkstroom die de Stiebel-specificaties ophaalde, inclusief de manier waarop
 * die pagina getallen schrijft. Een proef op nagemaakte tekst zou hier weinig
 * zeggen, want de vraag is juist of dit op echte pagina's werkt.
 *
 * Draaien: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { schrijfwijzen, koudemiddelCode, staatErin } from "./bron-vergelijken.mjs";

// Letterlijk uit de run van 2 oktober op stiebel-eltron.nl.
const STIEBEL_13 = "productnummer: 239044 scop 35 °c (en 14825): 4,50 energierendementsklasse ru";
const STIEBEL_GELUID = "koelrendement bij a35/w18: 3,28 geluidsniveau (en 12102): 57 db(a) min./max. werkingsgeb";
const STIEBEL_KOUDE = "gewicht: 91 kg koudemiddel: r410a alles ton";
const STIEBEL_ICS = "productnummer: 236375 scop 35 °c (en 14825): 4,525 energierendementsklasse r";

test("4,5 bij ons vindt 4,50 op de pagina", () => {
  assert.ok(staatErin(STIEBEL_13, schrijfwijzen(4.5)));
});

test("4,525 bij ons vindt 4,525 op de pagina", () => {
  assert.ok(staatErin(STIEBEL_ICS, schrijfwijzen(4.525)));
});

test("een afronding op twee decimalen telt als dezelfde opgave", () => {
  // Zou de pagina 4,53 schrijven waar wij 4,525 hebben, dan is dat hetzelfde
  // getal anders afgerond en geen afwijking om iemand voor te laten opdraven.
  assert.ok(staatErin("scop 35 °c: 4,53 energierendementsklasse", schrijfwijzen(4.525)));
});

test("een heel getal vindt zichzelf in dB(A) en in graden", () => {
  assert.ok(staatErin(STIEBEL_GELUID, schrijfwijzen(57)));
  assert.ok(staatErin("aanvoertemperatuur tot en met 60 °c voor uw warmwatercomfort", schrijfwijzen(60)));
});

test("een pagina die 60,0 schrijft bevestigt onze 60", () => {
  assert.ok(staatErin("aanvoertemperatuur: 60,0 °c", schrijfwijzen(60)));
});

test("een ander getal in dezelfde zin bevestigt niets", () => {
  // De 13 heeft SCOP 4,50; de 09 heeft 4,15. Haalt iemand die door elkaar, dan
  // moet deze controle dat zien en niet wegpoetsen.
  assert.equal(staatErin(STIEBEL_13, schrijfwijzen(4.15)), false);
  assert.equal(staatErin(STIEBEL_GELUID, schrijfwijzen(52)), false);
});

test("onze waarde mag geen stuk van een groter getal zijn", () => {
  // Dit is het ene geval dat echt kwaad kan: een valse bevestiging ziet
  // niemand meer terug. "4,5" zit letterlijk in "14,52".
  assert.equal(staatErin("vermogen: 14,52 kw", schrijfwijzen(4.5)), false);
  assert.equal(staatErin("productnummer: 239044", schrijfwijzen(4)), false);
  assert.equal(staatErin("geluidsniveau: 157 db(a)", schrijfwijzen(57)), false);
});

test("het koudemiddel komt zonder ons GWP-achtervoegsel terug", () => {
  assert.equal(koudemiddelCode("R410A (GWP 2088)"), "R410A");
  assert.equal(koudemiddelCode("R290 (propaan)"), "R290");
  assert.equal(koudemiddelCode("R32"), "R32");
  assert.equal(koudemiddelCode("R454C"), "R454C");
});

test("de koudemiddelcode wordt in de zin teruggevonden", () => {
  assert.ok(staatErin(STIEBEL_KOUDE, [koudemiddelCode("R410A (GWP 2088)").toLowerCase()]));
  assert.equal(staatErin(STIEBEL_KOUDE, [koudemiddelCode("R290 (propaan)").toLowerCase()]), false);
});

test("een koudemiddel zonder R-code valt terug op het eerste woord", () => {
  assert.equal(koudemiddelCode("propaan"), "propaan");
});

test("geen getal levert geen schrijfwijzen op", () => {
  assert.deepEqual(schrijfwijzen(NaN), []);
  assert.deepEqual(schrijfwijzen(Infinity), []);
});

test("een lege schrijfwijze bevestigt nooit iets", () => {
  // Anders zou indexOf("") op 0 uitkomen en elke zin alles bevestigen.
  assert.equal(staatErin("wat dan ook", [""]), false);
});
