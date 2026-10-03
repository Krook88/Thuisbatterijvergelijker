import { test } from "node:test";
import assert from "node:assert/strict";
import { verlopenVerwachtingen, zinnen } from "./verwachtingen.mjs";

const OKTOBER = new Date(2026, 9, 3);

test("een levering die in augustus verwacht werd is in oktober voorbij", () => {
  const html = "<p>De Venus E 4.0 staat in pre-order, met levering rond begin augustus 2026.</p>";
  assert.equal(verlopenVerwachtingen(html, OKTOBER).length, 1);
});

test("dezelfde zin is in juli nog gewoon waar", () => {
  const html = "<p>De Venus E 4.0 staat in pre-order, met levering rond begin augustus 2026.</p>";
  assert.equal(verlopenVerwachtingen(html, new Date(2026, 6, 20)).length, 0);
});

test("een zin die terugkijkt blijft waar", () => {
  const html = "<p>Zendure verkocht dit model in augustus 2026 nog als pre-order.</p>";
  assert.equal(verlopenVerwachtingen(html, OKTOBER).length, 0);
});

test("een kwartaal telt tot het einde van dat kwartaal", () => {
  const html = "<p>De modules worden in Q3 2026 verwacht.</p><p>De modules worden in Q4 2026 verwacht.</p>";
  const uit = verlopenVerwachtingen(html, OKTOBER);
  assert.equal(uit.length, 1);
  assert.match(uit[0].zin, /Q3/);
});

test("zonder jaartal in de zin gokt hij niet", () => {
  const html = "<p>De eerste leveringen worden rond begin augustus verwacht.</p>";
  assert.equal(verlopenVerwachtingen(html, OKTOBER).length, 0);
});

test("een maand zonder verwachting erbij is gewoon een datum", () => {
  const html = "<p>Prijzen gecontroleerd op 2 augustus 2026.</p>";
  assert.equal(verlopenVerwachtingen(html, OKTOBER).length, 0);
});

test("een punt in een modelnaam of bedrag breekt de zin niet", () => {
  assert.equal(zinnen("<p>De Venus E 3.0 kost € 1.199 en is leverbaar. Hij is wit.</p>").length, 2);
});
