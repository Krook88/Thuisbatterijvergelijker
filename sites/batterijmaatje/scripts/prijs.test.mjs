/**
 * Tests voor assets/prijs.js - de module die bepaalt wat vergelijkbaar is.
 *
 * Waarom deze er zijn: prijs.js beslist wat een vergelijkbare prijs is, wat een
 * capaciteit betekent en waar een vermogen op slaat. Dat voedt de vergelijker,
 * de keuzehulp, de rekenmodule en de generator. Een stille fout hier verandert
 * elke prijs op elke pagina zonder dat iets het merkt: de controles die we
 * hebben kijken naar de gegevens, niet naar de logica.
 *
 * De gevallen hieronder zijn geen bedachte randgevallen. Het zijn de fouten die
 * op deze site echt zijn gemaakt, elk met de schade erbij. Ze staan hier zodat
 * ze niet nog eens kunnen gebeuren.
 *
 * Draaien: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const Prijs = createRequire(import.meta.url)("../assets/prijs.js");

/* ------------------------------------------------------------------
   Btw: de aanleiding voor deze module
   ------------------------------------------------------------------ */

test("een prijs excl. btw wordt omgerekend, een prijs incl. btw blijft staan", () => {
  assert.equal(Prijs.vergelijkPrijs({ prijs_eur: 100, btw_inbegrepen: false }), 121);
  assert.equal(Prijs.vergelijkPrijs({ prijs_eur: 100 }), 100);
  assert.equal(Prijs.vergelijkPrijs({ prijs_eur: 100, btw_inbegrepen: true }), 100);
});

test("weggelaten btw_inbegrepen betekent incl. btw, de veiligste aanname", () => {
  // Andersom zou de site 21% bij elke consumentenprijs optellen.
  assert.equal(Prijs.isOmgerekend({ prijs_eur: 100 }), false);
  assert.equal(Prijs.isOmgerekend({ prijs_eur: 100, btw_inbegrepen: false }), true);
});

test("de goedkoopste wordt gekozen op vergelijkprijs, niet op het rauwe getal", () => {
  // Zonder omrekenen wint 95 excl. btw (= 115) van 100 incl. btw.
  const b = { aanbiedingen: [
    { winkel: "A", prijs_eur: 95, btw_inbegrepen: false },
    { winkel: "B", prijs_eur: 100 },
  ] };
  assert.equal(Prijs.beste(b).winkel, "B");
});

/* ------------------------------------------------------------------
   Niet-leverbaar: stond wel in de structured data
   ------------------------------------------------------------------ */

test("een aanbieding die de winkel niet meer voert telt niet mee", () => {
  const b = { aanbiedingen: [
    { winkel: "bol", prijs_eur: 500, niet_leverbaar: true },
    { winkel: "shop", prijs_eur: 700 },
  ] };
  assert.equal(Prijs.geldigeAanbiedingen(b).length, 1);
  assert.equal(Prijs.beste(b).winkel, "shop");
});

test("de aanbieding blijft wel in de gegevens staan, zodat de winkel-URL niet verdwijnt", () => {
  const b = { aanbiedingen: [{ winkel: "bol", prijs_eur: 500, url: "https://bol.com/x", niet_leverbaar: true }] };
  assert.equal(b.aanbiedingen.length, 1);
  assert.equal(Prijs.geldigeAanbiedingen(b).length, 0);
});

/* ------------------------------------------------------------------
   Korting: alleen tussen vergelijkbare bedragen
   ------------------------------------------------------------------ */

test("geen korting als de aanbieding iets anders omvat dan de richtprijs", () => {
  const b = {
    richtprijs_eur: 2000,
    aanbiedingen: [{ winkel: "A", prijs_eur: 1200, omvat: "excl. P1-meter" }],
  };
  assert.equal(Prijs.heeftKorting(b), false);
  assert.equal(Prijs.vanPrijs(b), null);
});

test("wel korting bij dezelfde samenstelling en een echt lager bedrag", () => {
  const b = { richtprijs_eur: 2000, aanbiedingen: [{ winkel: "A", prijs_eur: 1500 }] };
  assert.equal(Prijs.heeftKorting(b), true);
  assert.equal(Prijs.vanPrijs(b), 2000);
});

/* ------------------------------------------------------------------
   Capaciteit: bruto tegenover bruikbaar
   De Zendure SolarFlow 2400 ging van 420 naar 504 euro per kWh toen dit
   werd rechtgezet.
   ------------------------------------------------------------------ */

test("alleen een vastgestelde bruikbare capaciteit geldt als bevestigd", () => {
  assert.equal(Prijs.capaciteitBevestigd({ capaciteit_soort: "bruikbaar" }), true);
  assert.equal(Prijs.capaciteitBevestigd({ capaciteit_soort: "nominaal" }), false);
  assert.equal(Prijs.capaciteitBevestigd({ capaciteit_soort: "onbekend" }), false);
  assert.equal(Prijs.capaciteitBevestigd({}), false);
});

test("een niet-bevestigde capaciteit krijgt een toelichting, een bevestigde niet", () => {
  assert.equal(Prijs.capaciteitToelichting({ capaciteit_kwh: 5, capaciteit_soort: "bruikbaar" }), null);
  assert.match(Prijs.capaciteitToelichting({ capaciteit_kwh: 5, capaciteit_soort: "nominaal" }), /bruto/);
  assert.match(Prijs.capaciteitToelichting({ capaciteit_kwh: 5, capaciteit_soort: "onbekend" }), /publiceert/);
  assert.match(Prijs.capaciteitToelichting({ capaciteit_kwh: 5 }), /niet vastgesteld/);
});

test("het label verschijnt alleen waar er iets over vaststaat", () => {
  assert.equal(Prijs.capaciteitLabelHtml({ capaciteit_kwh: 5 }), "");
  assert.equal(Prijs.capaciteitLabelHtml({ capaciteit_kwh: 5, capaciteit_soort: "onbekend" }), "");
  assert.match(Prijs.capaciteitLabelHtml({ capaciteit_kwh: 5, capaciteit_soort: "bruikbaar" }), /bruikbaar/);
  assert.match(Prijs.capaciteitLabelHtml({ capaciteit_kwh: 5, capaciteit_soort: "nominaal" }), /bruto/);
});

test("prijs per kWh rekent over de bruikbare capaciteit", () => {
  const b = { capaciteit_kwh: 2.4, aanbiedingen: [{ winkel: "A", prijs_eur: 1210 }] };
  assert.equal(Prijs.prijsPerKwh(b), 504);
});

/* ------------------------------------------------------------------
   Vermogen: continu, piek of de stopcontactgrens
   De keuzehulp beweerde dat een Marstek een avondpiek van 2,2 kW dekte,
   terwijl hij er in huis 0,8 levert.
   ------------------------------------------------------------------ */

test("alleen een continu vermogen mag een dekkende uitspraak dragen", () => {
  assert.equal(Prijs.vermogenDektIets({ vermogen_kw: 5, vermogen_conditie: "continu" }), true);
  assert.equal(Prijs.vermogenDektIets({ vermogen_kw: 2.5, vermogen_conditie: "max" }), false);
  assert.equal(Prijs.vermogenDektIets({ vermogen_kw: 0.8, vermogen_conditie: "stopcontact" }), false);
  assert.equal(Prijs.vermogenDektIets({ vermogen_kw: 5, vermogen_conditie: "onbekend" }), false);
  assert.equal(Prijs.vermogenDektIets({ vermogen_kw: 5 }), false);
});

test("een maximum en een stopcontactgrens krijgen allebei een eigen label", () => {
  assert.match(Prijs.vermogenLabelHtml({ vermogen_kw: 2.5, vermogen_conditie: "max" }), /maximum/);
  assert.match(Prijs.vermogenLabelHtml({ vermogen_kw: 0.8, vermogen_conditie: "stopcontact" }), /stopcontactgrens/);
  assert.match(Prijs.vermogenLabelHtml({ vermogen_kw: 5, vermogen_conditie: "continu" }), /continu/);
  assert.equal(Prijs.vermogenLabelHtml({ vermogen_kw: 5, vermogen_conditie: "onbekend" }), "");
});

/* ------------------------------------------------------------------
   Zonder prijs geen uitspraak
   ------------------------------------------------------------------ */

test("een batterij zonder prijs levert geen bedrag en geen prijs per kWh", () => {
  assert.equal(Prijs.beste({}), null);
  assert.equal(Prijs.vergelijkPrijs(null), null);
  assert.equal(Prijs.prijsPerKwh({ capaciteit_kwh: 5 }), null);
});

test("een richtprijs telt als aanbieding, maar is als zodanig herkenbaar", () => {
  const b = { richtprijs_eur: 999, product_url: "https://voorbeeld.nl" };
  const beste = Prijs.beste(b);
  assert.equal(beste.is_richtprijs, true);
  assert.equal(Prijs.vergelijkPrijs(beste), 999);
});
