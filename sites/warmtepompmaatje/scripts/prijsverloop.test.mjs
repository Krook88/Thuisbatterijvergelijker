import { test } from "node:test";
import assert from "node:assert/strict";
import { laagsteWinkelprijs, voegPuntToe, snoei, verwerkDag } from "./prijsverloop.mjs";

const Prijs = {
  beste: (b) => (b.aanbiedingen.length ? b.aanbiedingen.reduce((m, a) => (a.prijs_eur < m.prijs_eur ? a : m)) : { prijs_eur: b.richtprijs_eur, is_richtprijs: true }),
  vergelijkPrijs: (a) => a.prijs_eur,
};

test("een gelijke prijs is geen nieuw punt, een andere wel", () => {
  const r = [];
  voegPuntToe(r, "2026-09-01", 999);
  voegPuntToe(r, "2026-09-02", 999);
  voegPuntToe(r, "2026-09-03", 949);
  assert.deepEqual(r, [["2026-09-01", 999], ["2026-09-03", 949]]);
});

test("twee keer dezelfde dag overschrijft, en valt weg als hij terugkomt op de vorige prijs", () => {
  const r = [["2026-09-01", 999]];
  voegPuntToe(r, "2026-09-02", 949);
  voegPuntToe(r, "2026-09-02", 999);
  assert.deepEqual(r, [["2026-09-01", 999]]);
});

test("geen winkel meer is een gat, geen richtprijs", () => {
  const item = { aanbiedingen: [], richtprijs_eur: 1200 };
  assert.equal(laagsteWinkelprijs(item, Prijs), null);
  const r = [["2026-09-01", 999]];
  voegPuntToe(r, "2026-09-05", null);
  assert.deepEqual(r.at(-1), ["2026-09-05", null]);
});

test("een reeks begint niet met een gat", () => {
  assert.deepEqual(voegPuntToe([], "2026-09-01", null), []);
});

test("snoeien houdt de prijs die aan het begin van het venster gold", () => {
  const r = [["2026-01-01", 1000], ["2026-06-01", 900], ["2026-09-20", 850]];
  assert.deepEqual(snoei(r, "2026-10-01", 30), [["2026-09-01", 900], ["2026-09-20", 850]]);
});

test("een dag verwerken legt per product de laagste winkelprijs vast", () => {
  const items = new Map([["a", { aanbiedingen: [{ prijs_eur: 500 }, { prijs_eur: 450 }] }], ["b", { aanbiedingen: [], richtprijs_eur: 9 }]]);
  const v = verwerkDag({}, items, "2026-10-07", Prijs);
  assert.deepEqual(v, { a: [["2026-10-07", 450]] });
});
