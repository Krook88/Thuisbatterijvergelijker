import { test } from "node:test";
import assert from "node:assert/strict";
import { shopifyJsonAdres, leverbaarUitShopify, voorraadVolgensWinkel, verwerkVoorraad } from "./voorraad.mjs";

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
