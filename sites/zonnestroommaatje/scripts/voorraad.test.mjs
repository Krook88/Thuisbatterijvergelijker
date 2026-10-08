import { test } from "node:test";
import assert from "node:assert/strict";
import { shopifyJsonAdres, leverbaarUitShopify, voorraadVolgensWinkel, verwerkVoorraad, verwerkBereikbaarheid, meldBereikbaarheid, paginaWeg } from "./voorraad.mjs";

test("een Shopify-productpagina krijgt het adres van zijn product-JSON", () => {
  assert.equal(
    shopifyJsonAdres("https://multi-solar.nl/products/marstek-venus-d-plug-and-play?variant=1#x"),
    "https://multi-solar.nl/products/marstek-venus-d-plug-and-play.js",
  );
  assert.equal(shopifyJsonAdres("https://www.ankersolix.com/nl/products/a17c5"), "https://www.ankersolix.com/nl/products/a17c5.js");
  assert.equal(shopifyJsonAdres("https://solarkopen.nl/collections/panelen/products/jinko-440"), "https://solarkopen.nl/collections/panelen/products/jinko-440.js");
});

test("een pagina die geen Shopify-product is, wordt niet gevraagd", () => {
  assert.equal(shopifyJsonAdres("https://thuisbatterij.nl/winkel/marstek-venus-e-versie-3/"), null);
  assert.equal(shopifyJsonAdres(""), null);
});

test("alle varianten uitverkocht is niet leverbaar, een leverbare variant is genoeg", () => {
  assert.equal(leverbaarUitShopify({ variants: [{ available: false }, { available: false }] }), false);
  assert.equal(leverbaarUitShopify({ variants: [{ available: false }, { available: true }] }), true);
  assert.equal(leverbaarUitShopify({ available: false }), false);
  assert.equal(leverbaarUitShopify({ variants: [{}] }), null);
  assert.equal(leverbaarUitShopify(null), null);
});

test("geen antwoord of geen JSON betekent: weet ik niet", async () => {
  const nietGevonden = async () => ({ ok: false, text: async () => "" });
  const html = async () => ({ ok: true, text: async () => "<html>" });
  const stuk = async () => { throw new Error("fetch failed"); };
  assert.equal(await voorraadVolgensWinkel("https://x.nl/products/a", nietGevonden), null);
  assert.equal(await voorraadVolgensWinkel("https://x.nl/products/a", html), null);
  assert.equal(await voorraadVolgensWinkel("https://x.nl/products/a", stuk), null);
  assert.equal(await voorraadVolgensWinkel("https://x.nl/winkel/a", stuk), null);
});

test("de winkel die zegt dat alles op is, wordt geloofd", async () => {
  const op = async () => ({ ok: true, text: async () => JSON.stringify({ variants: [{ available: false }] }) });
  assert.equal(await voorraadVolgensWinkel("https://x.nl/products/a", op), false);
});

test("de markering gaat erop bij uitverkocht en eraf als het terug is", () => {
  const a = { winkel: "X" };
  assert.equal(verwerkVoorraad(a, false), "uitverkocht");
  assert.equal(a.niet_leverbaar, true);
  assert.equal(verwerkVoorraad(a, false), "blijft");
  assert.equal(verwerkVoorraad(a, true), "weer");
  assert.equal(a.niet_leverbaar, undefined);
  assert.equal(verwerkVoorraad(a, null), null);
});

test("een markering die een mens zette, blijft staan", () => {
  const a = { niet_leverbaar: true, niet_leverbaar_reden: "winkel gestopt met dit merk" };
  assert.equal(verwerkVoorraad(a, true), null);
  assert.equal(a.niet_leverbaar, true);
});

test("een verdwenen pagina wordt pas op de tweede dag gemarkeerd", () => {
  const a = { winkel: "x", url: "https://x.nl/a" };
  assert.equal(verwerkBereikbaarheid(a, false, "2026-10-06"), "eerste keer");
  assert.equal(a.niet_leverbaar, undefined);
  assert.equal(verwerkBereikbaarheid(a, false, "2026-10-06"), "eerste keer");
  assert.equal(verwerkBereikbaarheid(a, false, "2026-10-07"), "weg");
  assert.equal(a.niet_leverbaar, true);
  assert.equal(a.niet_leverbaar_door, "pagina weg");
  assert.equal(verwerkBereikbaarheid(a, false, "2026-10-08"), "blijft");
});

test("één slechte dag gevolgd door een goede laat geen spoor na", () => {
  const a = {};
  verwerkBereikbaarheid(a, false, "2026-10-06");
  assert.equal(verwerkBereikbaarheid(a, true, "2026-10-07"), null);
  assert.deepEqual(a, {});
});

test("een pagina die terugkomt verliest de markering die hij zelf kreeg", () => {
  const a = { niet_leverbaar: true, niet_leverbaar_door: "pagina weg", weg_sinds: "2026-10-01" };
  assert.equal(verwerkBereikbaarheid(a, true, "2026-10-07"), "terug");
  assert.deepEqual(a, {});
});

test("een markering van een mens of van de voorraadcontrole blijft staan", () => {
  const mens = { niet_leverbaar: true };
  assert.equal(verwerkBereikbaarheid(mens, true, "2026-10-07"), null);
  assert.equal(mens.niet_leverbaar, true);
  assert.equal(verwerkBereikbaarheid(mens, false, "2026-10-07"), null);
  assert.equal(mens.weg_sinds, undefined);
  const op = { niet_leverbaar: true, niet_leverbaar_door: "voorraad" };
  verwerkBereikbaarheid(op, true, "2026-10-07");
  assert.equal(op.niet_leverbaar_door, "voorraad");
});

test("alleen 404, 410 en geen antwoord tellen als verdwenen pagina", () => {
  assert.equal(paginaWeg(new Error("HTTP 404")), true);
  assert.equal(paginaWeg(new Error("HTTP 410")), true);
  assert.equal(paginaWeg(new TypeError("fetch failed")), true);
  assert.equal(paginaWeg(new Error("HTTP 403")), false);
  assert.equal(paginaWeg(new Error("HTTP 500")), false);
  assert.equal(paginaWeg(new Error("HTTP 429")), false);
});

test("meldBereikbaarheid doet hetzelfde als verwerkBereikbaarheid en geeft de uitkomst terug", () => {
  const a = { winkel: "Winkel", url: "https://example.nl/p", prijs_eur: 100, datum: "2026-10-01" };
  assert.equal(meldBereikbaarheid({ id: "x" }, a, false, "2026-10-07"), "eerste keer");
  assert.equal(meldBereikbaarheid({ id: "x" }, a, false, "2026-10-08"), "weg");
  assert.equal(a.niet_leverbaar_door, "pagina weg");
  assert.equal(meldBereikbaarheid({ id: "x" }, a, true, "2026-10-09"), "terug");
  assert.equal(a.niet_leverbaar, undefined);
});
