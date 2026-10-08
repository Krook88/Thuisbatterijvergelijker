import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { bolApiPrijs, bolProductId, zoekPrijsInRespons, bolBeschikbaar } from "./bol.mjs";

const ENV = { BOL_CLIENT_ID: "id", BOL_CLIENT_SECRET: "geheim" };
const echteFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = echteFetch; });

// Een nagebootste bol.com: antwoorden per stuk adres, en een lijst van wat er
// gevraagd is, zodat de proef ook de koppen kan nakijken.
function nepBol(antwoorden) {
  const gevraagd = [];
  globalThis.fetch = async (url, opties = {}) => {
    gevraagd.push({ url: String(url), opties });
    const sleutel = Object.keys(antwoorden).find((k) => String(url).includes(k));
    const [status, body] = sleutel ? antwoorden[sleutel] : [500, {}];
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return gevraagd;
}

test("het product-id komt ook uit een bol-link met een query erachter", () => {
  assert.equal(bolProductId("https://www.bol.com/nl/nl/p/iets/9300000150679949/?bltgh=abc"), "9300000150679949");
  assert.equal(bolProductId("https://www.bol.com/nl/nl/p/iets/9300000150679949/"), "9300000150679949");
  assert.equal(bolProductId("https://www.bol.com/nl/nl/s/?searchtext=x"), null);
});

test("de prijs moet binnen de grenzen van de site vallen", () => {
  const antwoord = { offers: [{ shipping: { price: 4.95 } }, { price: 1099.99 }] };
  assert.equal(zoekPrijsInRespons(antwoord, { min: 50, max: 30000 }), 1099.99);
  assert.equal(zoekPrijsInRespons(antwoord, { min: 20, max: 1000 }), null);
});

test("zonder inloggegevens doet bol niet mee", async () => {
  assert.equal(bolBeschikbaar({}), false);
  assert.equal(await bolApiPrijs({ url: "https://www.bol.com/nl/nl/p/x/9300000150679949/" }, { grenzen: { min: 50, max: 30000 }, env: {} }), null);
});

test("met een bewaarde EAN één aanroep, met Accept-Language, prijs afgerond", async () => {
  const gevraagd = nepBol({
    "login.bol.com": [200, { access_token: "t" }],
    "/products/6096224278213/offers/best": [200, { offer: { price: 4565.6 } }],
  });
  const aanbieding = { winkel: "bol.com", url: "https://www.bol.com/nl/nl/p/x/9300000150679949/", ean: "6096224278213" };
  const prijs = await bolApiPrijs(aanbieding, { grenzen: { min: 50, max: 30000 }, env: ENV });
  assert.equal(prijs, 4566);
  const offers = gevraagd.find((g) => g.url.includes("/offers/best"));
  // Zonder deze kop antwoordt bol met HTTP 400; dat ging mis in de kopieën
  // van warmtepompmaatje en zonnestroommaatje.
  assert.equal(offers.opties.headers["Accept-Language"], "nl");
});

test("een 404 bij bol maakt de aanbieding niet leverbaar, een prijs maakt hem weer leverbaar", async () => {
  const meldingen = [];
  const opties = {
    grenzen: { min: 50, max: 30000 },
    env: ENV,
    bijNietLeverbaar: (a) => meldingen.push(["weg", a.winkel]),
    bijWeerLeverbaar: (a) => meldingen.push(["terug", a.winkel]),
  };
  const aanbieding = { winkel: "bol.com", url: "https://www.bol.com/nl/nl/p/x/9300000150679949/", ean: "6096224278213" };

  nepBol({ "login.bol.com": [200, { access_token: "t" }], "/offers/best": [404, {}] });
  assert.equal(await bolApiPrijs(aanbieding, opties), null);
  assert.equal(aanbieding.niet_leverbaar, true);

  nepBol({ "login.bol.com": [200, { access_token: "t" }], "/offers/best": [200, { price: 999 }] });
  assert.equal(await bolApiPrijs(aanbieding, opties), 999);
  assert.equal(aanbieding.niet_leverbaar, undefined);
  assert.deepEqual(meldingen, [["weg", "bol.com"], ["terug", "bol.com"]]);
});

test("zonder EAN wordt het bol-product-ID eerst omgezet, en de EAN bewaard", async () => {
  const gevraagd = nepBol({
    "login.bol.com": [200, { access_token: "t" }],
    "/products/9300000150679949/to-ean": [200, { ean: "6096224278213" }],
    "/products/6096224278213/offers/best": [200, { price: 4566 }],
  });
  const aanbieding = { winkel: "bol.com", url: "https://www.bol.com/nl/nl/p/x/9300000150679949/" };
  assert.equal(await bolApiPrijs(aanbieding, { grenzen: { min: 50, max: 30000 }, env: ENV }), 4566);
  assert.equal(aanbieding.ean, "6096224278213");
  assert.ok(!gevraagd.some((g) => g.url.includes("/products/9300000150679949/offers")), "geen offers-aanroep op het bol-product-ID");
});
