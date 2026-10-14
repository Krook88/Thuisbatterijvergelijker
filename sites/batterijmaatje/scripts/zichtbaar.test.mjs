import { test } from "node:test";
import assert from "node:assert/strict";
import { beoordeel, verdeel, laatstePrijsdatum, verborgenPagina, aantalWinkels, HOUDBAAR_DAGEN } from "./zichtbaar.mjs";

const VANDAAG = "2026-10-14";
const winkel = (prijs, datum, extra = {}) => ({ winkel: "W", url: "https://example.nl/p", prijs_eur: prijs, datum, ...extra });

test("de grens ligt op 14 weken", () => {
  assert.equal(HOUDBAAR_DAGEN, 98);
  // 98 dagen voor 14 oktober is 8 juli: die dag telt nog mee, de dag ervoor niet.
  assert.equal(beoordeel({ aanbiedingen: [winkel(100, "2026-07-08")] }, VANDAAG).zichtbaar, true);
  assert.equal(beoordeel({ aanbiedingen: [winkel(100, "2026-07-07")] }, VANDAAG).zichtbaar, false);
});

test("de jongste leverbare aanbieding telt, een niet-leverbare niet", () => {
  const p = { aanbiedingen: [winkel(100, "2026-06-01"), winkel(90, "2026-10-13"), winkel(80, "2026-10-14", { niet_leverbaar: true })] };
  assert.equal(laatstePrijsdatum(p), "2026-10-13");
  // Alleen de niet-leverbare is vers: dan telt de richtprijs.
  const q = { richtprijs_eur: 500, prijs_datum: "2026-05-01", aanbiedingen: [winkel(80, "2026-10-14", { niet_leverbaar: true })] };
  assert.equal(laatstePrijsdatum(q), "2026-05-01");
  assert.equal(beoordeel(q, VANDAAG).zichtbaar, false);
});

test("geen prijs, of een prijs zonder datum, staat er niet op", () => {
  assert.deepEqual(beoordeel({ isde_indicatie_eur: 2125 }, VANDAAG), { zichtbaar: false, reden: "geen prijs" });
  assert.equal(beoordeel({ richtprijs_eur: 2100 }, VANDAAG).reden, "prijs zonder bevestigde datum");
  // Een leverbare aanbieding die nooit bevestigd is, telt niet als bevestigd.
  assert.equal(beoordeel({ richtprijs_eur: 900, prijs_datum: "2026-10-01", aanbiedingen: [winkel(900, null)] }, VANDAAG).zichtbaar, false);
});

test("een prijs uit een offerte blijft staan zolang er een bedrag is", () => {
  assert.equal(beoordeel({ prijs_uit_offerte: true, richtprijs_eur: 5990, prijs_datum: "2026-01-01" }, VANDAAG).zichtbaar, true);
  assert.equal(beoordeel({ prijs_uit_offerte: true }, VANDAAG).zichtbaar, false);
});

test("verdeel houdt de volgorde en geeft de reden mee", () => {
  const { zichtbaar, verborgen } = verdeel([
    { id: "a", aanbiedingen: [winkel(1, "2026-10-01")] },
    { id: "b" },
    { id: "c", richtprijs_eur: 3, prijs_datum: "2026-09-01" },
  ], VANDAAG);
  assert.deepEqual(zichtbaar.map((p) => p.id), ["a", "c"]);
  assert.deepEqual(verborgen.map((v) => [v.product.id, v.reden]), [["b", "geen prijs"]]);
});

test("de pagina van een verborgen product is noindex en verwijst absoluut", () => {
  const html404 = '<html><head><title>Niet gevonden</title>\n<link rel="stylesheet" href="assets/style.css"></head><body><a href="index.html">x</a><main class="content-pagina">oud</main></body></html>';
  const uit = verborgenPagina(html404, { titel: "T", kop: "K", alineas: ["Een."], terug: { href: "/index.html", tekst: "Terug" } });
  assert.match(uit, /<meta name="robots" content="noindex">/);
  assert.match(uit, /href="\/assets\/style\.css"/);
  assert.match(uit, /href="\/index\.html">x/);
  assert.match(uit, /<h1>K<\/h1>/);
  assert.doesNotMatch(uit, /oud/);
});

test("winkels tellen per domein, over meer lijsten", () => {
  const a = [{ aanbiedingen: [{ url: "https://www.techpunt.nl/a" }, { url: "https://techpunt.nl/b" }] }];
  const b = [{ aanbiedingen: [{ url: "https://bol.com/x" }, { url: "geen adres" }] }, {}];
  assert.equal(aantalWinkels(a, b), 2);
});
