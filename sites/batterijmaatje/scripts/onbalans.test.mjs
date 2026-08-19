/**
 * Tests voor het onbalans-veld in data/batterijen.json.
 *
 * Waarom deze er zijn: dit veld zegt iets waar geld aan hangt. "Ja, via Frank
 * Energie" betekent voor een bezoeker dat hij met die batterij kan gaan
 * verdienen op de onbalansmarkt, en dat is precies het soort belofte dat je
 * niet per ongeluk moet doen. Drie dingen kunnen daarbij misgaan zonder dat
 * iemand het ziet: een "ja" zonder partij erbij, een partij zonder naam, en -
 * het vervelendst - het verschil tussen "nee" en "niet uitgezocht" dat
 * langzaam vervaagt.
 *
 * Dat laatste is de reden dat een ontbrekend veld hier geen fout is. Van de
 * eenenveertig batterijen weten we het van zeven. De andere vierendertig
 * hebben geen veld, en dat hoort op de pagina ook zo te staan.
 *
 * Draaien: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const batterijen = JSON.parse(readFileSync(resolve(ROOT, "data/batterijen.json"), "utf8")).batterijen;
const metVeld = batterijen.filter((b) => b.onbalans);

const STATUSSEN = ["ja", "nee", "onbekend"];

test("elke status is er een die we kennen", () => {
  for (const b of metVeld) {
    assert.ok(STATUSSEN.includes(b.onbalans.status), `${b.id}: status "${b.onbalans.status}" bestaat niet`);
  }
});

test('een "ja" noemt altijd via wie', () => {
  // Anders staat er "ja, mee te doen" zonder dat een bezoeker weet hoe.
  for (const b of metVeld.filter((x) => x.onbalans.status === "ja")) {
    assert.ok((b.onbalans.via || []).length, `${b.id}: status ja zonder partij`);
  }
});

test("elke partij heeft een naam, en de voorwaarde is ja of nee", () => {
  for (const b of metVeld) {
    for (const v of b.onbalans.via || []) {
      assert.ok(v.partij && v.partij.trim(), `${b.id}: een partij zonder naam`);
      if ("eigen_contract" in v) {
        assert.equal(typeof v.eigen_contract, "boolean", `${b.id} @ ${v.partij}: eigen_contract moet true of false zijn`);
      }
    }
  }
});

test("een bron is een echt adres, zodat de linkcontrole hem meeneemt", () => {
  for (const b of metVeld) {
    for (const v of b.onbalans.via || []) {
      if (v.bron) assert.match(v.bron, /^https?:\/\/\S+$/, `${b.id} @ ${v.partij}: bron is geen adres`);
    }
  }
});

test('"nee" is een uitspraak en heeft dus een toelichting nodig', () => {
  // "Nee" zonder uitleg is niet te controleren en niet te weerleggen.
  for (const b of metVeld.filter((x) => x.onbalans.status === "nee")) {
    assert.ok((b.onbalans.toelichting || "").trim(), `${b.id}: status nee zonder toelichting`);
  }
});

test("geen veld is geen stilzwijgend nee", () => {
  // Deze proef bewaakt de aanname waarop de pagina leunt: wie geen veld heeft
  // krijgt "nog niet uitgezocht" te zien, niet "nee". Zou iemand het veld ooit
  // verplicht maken met een lege waarde, dan valt dat hier om.
  const zonder = batterijen.filter((b) => !b.onbalans);
  assert.ok(zonder.length, "als elke batterij een veld heeft, klopt de tekst op de pagina niet meer");
  for (const b of zonder) assert.equal(b.onbalans, undefined, `${b.id}: leeg veld in plaats van geen veld`);
});
