/**
 * Tests voor assets/rekenkern.js - de som achter de rekenmodule en de keuzehulp.
 *
 * Waarom deze er zijn: de som stond twee keer op de site en liep uit elkaar.
 * De rekenmodule rekende met het rendement van de gekozen pomp, de keuzehulp
 * met vaste getallen, en niets testte dat. De gevallen hieronder leggen vast
 * wat er mis kon gaan.
 *
 * Draaien: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Rekenkern = require("../assets/rekenkern.js");
const pompen = require("../data/warmtepompen.json").warmtepompen;

const rond = (n, d = 0) => Math.round(n * 10 ** d) / 10 ** d;

test("de keuzehulp en de rekenmodule rekenen met dezelfde kern", () => {
  // Hier zat het: advies.js had een eigen kopie van de som met andere
  // rendementen. Geen van beide mag hem nog zelf uitrekenen.
  for (const bestand of ["advies.js", "rekenmodule.js"]) {
    const code = readFileSync(new URL(`../assets/${bestand}`, import.meta.url), "utf8");
    assert.match(code, /Rekenkern\.(bereken|bandbreedte)\(/, `${bestand} gebruikt de rekenkern niet`);
    assert.doesNotMatch(code, /\*\s*8\.8\b|KWH_PER_M3\s*=/, `${bestand} rekent zelf gas om naar warmte`);
  }
});

test("zonder pomp rekent de kern met het praktijkrendement", () => {
  const h = Rekenkern.bereken({ type: "hybride", gas: 1200 });
  assert.equal(h.scop, Rekenkern.HYBRIDE_SCOP);
  assert.equal(rond(h.gasBespaard), 720);
  assert.equal(rond(h.stroomKwh), rond(720 * 8.8 / 4.5));
  const a = Rekenkern.bereken({ type: "all-electric", gas: 1200 });
  assert.equal(a.scop, Rekenkern.ALLEL_SCOP);
  assert.equal(a.gasBespaard, 1200);
});

test("de SCOP van een pomp telt alleen mee als hij bij 35 graden geldt", () => {
  const bij35 = Rekenkern.bereken({ type: "all-electric", pomp: { scop: 5, scop_conditie: "35" } });
  assert.equal(rond(bij35.scop, 3), rond(5 * Rekenkern.PRAKTIJKFACTOR, 3));
  assert.equal(bij35.eigenScop, true);
  const onbekend = Rekenkern.bereken({ type: "all-electric", pomp: { scop: 5, scop_conditie: "55" } });
  assert.equal(onbekend.scop, Rekenkern.ALLEL_SCOP);
  assert.equal(onbekend.eigenScop, false);
});

test("zonder toestelprijs geen terugverdientijd, wel een besparing", () => {
  const r = Rekenkern.bereken({ type: "hybride", toestelPrijs: null });
  assert.equal(r.prijsOnbekend, true);
  assert.equal(r.tvt, null);
  assert.ok(r.besparingJaar > 0);
});

test("de vaste gaskosten vervallen alleen bij all-electric met opzegging", () => {
  assert.equal(Rekenkern.bereken({ type: "hybride", gasAf: true }).vastrechtBesparing, 0);
  assert.equal(Rekenkern.bereken({ type: "all-electric", gasAf: true, vastrecht: 350 }).vastrechtBesparing, 350);
});

test("tegenover een nieuwe ketel telt bij all-electric alleen de meerprijs", () => {
  // De som zette de hele investering tegenover nul, ook als de ketel op was.
  // Juist die bezoeker kreeg zo een te lange terugverdientijd voor all-electric.
  const basis = { type: "all-electric", gas: 1500, gasAf: true, toestelPrijs: 9000, isde: 3000 };
  const zonder = Rekenkern.bereken(basis);
  const met = Rekenkern.bereken({ ...basis, ketelVervangen: true, ketelprijs: 2500 });
  assert.equal(zonder.tegenoverKetel, null);
  assert.equal(met.tegenoverKetel.meerprijs, zonder.netto - 2500);
  assert.ok(met.tegenoverKetel.tvt < zonder.tvt, "de meerprijs verdient sneller terug dan het hele bedrag");
  assert.equal(met.tegenoverKetel.ketelBlijftNodig, false);
});

test("bij een hybride koop je de nieuwe ketel er hoe dan ook bij", () => {
  // Een hybride werkt naast een ketel. De meerprijs is dan de pomp zelf, maar
  // de totale uitgave is ketel plus pomp; die mag niet verdwijnen.
  const r = Rekenkern.bereken({ type: "hybride", toestelPrijs: 4000, isde: 1500, ketelVervangen: true, ketelprijs: 2500 });
  assert.equal(r.tegenoverKetel.ketelBlijftNodig, true);
  assert.equal(r.tegenoverKetel.meerprijs, r.netto);
  assert.equal(r.tegenoverKetel.totaleUitgave, r.netto + 2500);
  assert.equal(r.tegenoverKetel.tvt, r.tvt);
});

test("een meerprijs onder nul wordt nul, geen negatieve terugverdientijd", () => {
  const r = Rekenkern.bereken({ type: "all-electric", toestelPrijs: 500, installatie: 500, isde: 0, ketelVervangen: true, ketelprijs: 2500 });
  assert.equal(r.tegenoverKetel.meerprijs, 0);
  assert.equal(r.tegenoverKetel.tvt, 0);
});

test("de standaard ketelprijs ligt binnen de bandbreedte op de pagina", () => {
  const html = readFileSync(new URL("../rekenmodule.html", import.meta.url), "utf8");
  assert.match(html, /€ 1\.600 tot € 3\.400/);
  assert.ok(Rekenkern.STANDAARD.ketelprijs >= 1600 && Rekenkern.STANDAARD.ketelprijs <= 3400);
  assert.match(html, new RegExp(`id="ketelprijs"[^>]*value="${Rekenkern.STANDAARD.ketelprijs}"`));
});

test("elke pomp in de gegevens levert een rekenbare uitkomst", () => {
  for (const w of pompen) {
    const r = Rekenkern.bereken({ type: w.type, pomp: w, toestelPrijs: 5000, isde: w.isde_indicatie_eur || 0 });
    assert.ok(Number.isFinite(r.besparingJaar), `${w.id}: besparing is geen getal`);
    assert.ok(r.scop > 2 && r.scop < 6, `${w.id}: rendement ${r.scop} is onwaarschijnlijk`);
  }
});

test("de terugverdientijd is een bereik dat het middenscenario omsluit", () => {
  // Eén getal met een decimaal deed alsof de gasprijs over vijftien jaar vaststaat.
  const invoer = { type: "all-electric", gas: 1500, gasAf: true, toestelPrijs: 9000, isde: 3000 };
  const b = Rekenkern.bandbreedte(invoer);
  assert.ok(b.laag < b.verwacht.tvt && b.verwacht.tvt < b.hoog, `${b.laag} < ${b.verwacht.tvt} < ${b.hoog}`);
  assert.equal(b.verwacht.tvt, Rekenkern.bereken(invoer).tvt, "het midden is de gewone som");
});

test("een eigen installatiebedrag schuift niet mee in het bereik", () => {
  // Een bedrag uit een offerte is geen aanname meer.
  const b = Rekenkern.bandbreedte({ type: "hybride", toestelPrijs: 4000, installatie: 3000 });
  assert.equal(b.ongunstig.installatie, 3000);
  assert.equal(b.gunstig.installatie, 3000);
  const geschat = Rekenkern.bandbreedte({ type: "hybride", toestelPrijs: 4000 });
  assert.ok(geschat.ongunstig.installatie > geschat.verwacht.installatie);
});

test("het bereik geldt ook tegenover een nieuwe ketel", () => {
  const b = Rekenkern.bandbreedte({ type: "all-electric", gas: 1500, gasAf: true, toestelPrijs: 9000, isde: 3000, ketelVervangen: true });
  assert.ok(b.ketelLaag < b.verwacht.tegenoverKetel.tvt && b.verwacht.tegenoverKetel.tvt < b.ketelHoog);
});

test("verdient de ongunstige kant zich niet terug, dan is er geen bovengrens", () => {
  const b = Rekenkern.bandbreedte({ type: "hybride", gas: 400, toestelPrijs: 9000 });
  assert.equal(b.hoog, null);
});

test("toestel plus geschatte installatie komt uit bij de totaalprijs van Milieu Centraal", () => {
  // All-electric stond op 4.500 euro installatie; met de middelste
  // toestelprijs kwam de som 1.400 euro onder Milieu Centraal uit.
  for (const type of ["hybride", "all-electric"]) {
    const prijzen = pompen.filter((w) => w.type === type)
      .map((w) => { const a = (w.aanbiedingen || []).map((o) => o.prijs_eur).filter(Number.isFinite); return a.length ? Math.min(...a) : w.richtprijs_eur; })
      .filter(Number.isFinite).sort((a, b) => a - b);
    const mediaan = prijzen[Math.floor(prijzen.length / 2)];
    const totaal = mediaan + Rekenkern.INSTALLATIE[type];
    const doel = Rekenkern.MILIEU_CENTRAAL_TOTAAL[type];
    assert.ok(Math.abs(totaal - doel) / doel <= 0.15, `${type}: ${mediaan} + ${Rekenkern.INSTALLATIE[type]} = ${totaal}, Milieu Centraal ${doel}`);
  }
});
