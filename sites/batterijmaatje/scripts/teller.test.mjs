/**
 * De ontvanger van de eigen teller (api/teller.js) telt alleen wat hij
 * herkent. Een bericht met een vreemd veld of een pad met een sluisteken erin
 * zou anders een eigen rij in de opslag maken, of de rij van iets anders.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const vereis = createRequire(import.meta.url);
const { teOpdrachten, blokje } = vereis("../api/teller.js");

test("een klik naar een winkel telt op onder site, domein, product en pagina", () => {
  const uit = teOpdrachten({ s: "bat", t: "klik", w: "marstek.nl", p: "marstek-venus-e-3", b: "/index.html" }, "2026-10-15");
  assert.deepEqual(uit[0], ["HINCRBY", "klik:2026-10-15", "bat|marstek.nl|marstek-venus-e-3|/index.html", 1]);
  assert.equal(uit[1][0], "EXPIRE");
});

test("de leestijd telt in een blokje, en een nacht open telt als een half uur", () => {
  assert.equal(blokje(3), "0-10s");
  assert.equal(blokje(45), "30s-2m");
  assert.equal(blokje(1800), "10m+");
  const uit = teOpdrachten({ s: "zon", t: "tijd", b: "/uitleg.html", d: 36000 }, "2026-10-15");
  assert.deepEqual(uit.find((o) => o[2].endsWith("|sec")), ["HINCRBY", "tijd:2026-10-15", "zon|/uitleg.html|sec", 1800]);
});

test("wat de teller niet herkent, telt niet", () => {
  assert.equal(teOpdrachten({ s: "x", t: "klik", w: "a.nl", p: "", b: "/" }, "d"), null);
  assert.equal(teOpdrachten({ s: "bat", t: "klik", w: "a.nl", p: "", b: "/a|b" }, "d"), null);
  assert.equal(teOpdrachten({ s: "bat", t: "tijd", b: "/a", d: -5 }, "d"), null);
  assert.equal(teOpdrachten({ s: "bat", t: "iets", b: "/a" }, "d"), null);
  assert.equal(teOpdrachten(null, "d"), null);
});

test("de statistiekenpagina telt niet mee", () => {
  assert.equal(teOpdrachten({ s: "bat", t: "tijd", b: "/statistieken.html", d: 20 }, "d"), null);
  assert.equal(teOpdrachten({ s: "bat", t: "klik", w: "a.nl", p: "", b: "/statistieken" }, "d"), null);
  assert.notEqual(teOpdrachten({ s: "bat", t: "tijd", b: "/statistieken-uitleg.html", d: 20 }, "d"), null);
});
