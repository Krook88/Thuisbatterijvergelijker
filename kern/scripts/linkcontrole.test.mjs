/**
 * Tests voor linkcontrole.mjs - wanneer is een link kapot.
 *
 * De aanleiding staat in het hoofdbestand: Wasco antwoordde op HEAD met 404 en
 * op GET met de pagina, en wij meldden hem als kapot terwijl de prijsupdate er
 * een minuut eerder €8812 van gelezen had. Dat geval staat hieronder als
 * proef, zodat het niet nog een keer kan.
 *
 * Draaien: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { bereikbaarheid, deelUitkomsten, gelukt, GEWEERD } from "./linkcontrole.mjs";

/** Een nep-fetch die per methode zegt wat hij teruggeeft. */
function nep(perMethode) {
  const bezocht = [];
  const haal = async (url, opties) => {
    bezocht.push(opties.method);
    const uit = perMethode[opties.method];
    if (uit instanceof Error) throw uit;
    if (uit === undefined) throw new Error(`geen antwoord voorbereid voor ${opties.method}`);
    return { status: uit, url };
  };
  return { haal, bezocht };
}

/* ------------------------------------------------------------------
   HEAD eerst, GET erachteraan
   ------------------------------------------------------------------ */

test("een pagina die op HEAD 404 geeft en op GET 200 is niet kapot", async () => {
  // Dit is Wasco, 16 augustus 2026. De prijsupdate las er een prijs van.
  const { haal, bezocht } = nep({ HEAD: 404, GET: 200 });
  const uit = await bereikbaarheid("https://www.wasco.nl/artikel/1111594", { haal });
  assert.equal(uit.status, 200);
  assert.equal(uit.methode, "GET");
  assert.deepEqual(bezocht, ["HEAD", "GET"]);
});

test("een pagina die echt weg is blijft weg", async () => {
  const { haal } = nep({ HEAD: 404, GET: 404 });
  const uit = await bereikbaarheid("https://winkel.nl/weg", { haal });
  assert.equal(uit.status, 404);
  assert.ok(deelUitkomsten([{ ...uit, herkomst: "x" }]).stuk.length === 1);
});

test("een HEAD die meteen goed antwoordt kost geen tweede verzoek", async () => {
  // Anders verdubbelen we het verkeer naar honderd winkels voor niets.
  const { haal, bezocht } = nep({ HEAD: 200 });
  const uit = await bereikbaarheid("https://winkel.nl/product", { haal });
  assert.equal(uit.status, 200);
  assert.deepEqual(bezocht, ["HEAD"]);
});

test("een omleiding telt als goed en kost ook geen tweede verzoek", async () => {
  const { haal, bezocht } = nep({ HEAD: 301 });
  assert.equal((await bereikbaarheid("https://winkel.nl/oud", { haal })).status, 301);
  assert.deepEqual(bezocht, ["HEAD"]);
});

test("een serverfout op HEAD wordt met GET nagelopen", async () => {
  const { haal, bezocht } = nep({ HEAD: 500, GET: 200 });
  assert.equal((await bereikbaarheid("https://winkel.nl/product", { haal })).status, 200);
  assert.deepEqual(bezocht, ["HEAD", "GET"]);
});

test("een HEAD die de verbinding verbreekt wordt met GET nagelopen", async () => {
  // Sommige servers hangen op bij HEAD in plaats van netjes te antwoorden.
  const { haal, bezocht } = nep({ HEAD: new Error("fetch failed"), GET: 200 });
  assert.equal((await bereikbaarheid("https://winkel.nl/product", { haal })).status, 200);
  assert.deepEqual(bezocht, ["HEAD", "GET"]);
});

test("valt allebei weg, dan is de melding van de eerste poging leidend", async () => {
  const { haal } = nep({ HEAD: new Error("getaddrinfo ENOTFOUND"), GET: new Error("fetch failed") });
  const uit = await bereikbaarheid("https://bestaatniet.nl/", { haal });
  assert.equal(uit.status, 0);
  assert.match(uit.melding, /ENOTFOUND/);
});

test("een tijdslimiet krijgt een leesbare melding", async () => {
  const stuk = new Error("de tijd is om");
  stuk.name = "TimeoutError";
  const { haal } = nep({ HEAD: stuk, GET: stuk });
  const uit = await bereikbaarheid("https://traag.nl/", { haal });
  assert.equal(uit.melding, "geen antwoord binnen 20 seconden");
});

/* ------------------------------------------------------------------
   Kapot tegenover geweerd
   ------------------------------------------------------------------ */

test("een winkel die bots weert is niet kapot", async () => {
  const uitkomsten = GEWEERD.map((status) => ({ url: "https://winkel.nl/", status, herkomst: "winkel" }));
  const { stuk, geweerd } = deelUitkomsten(uitkomsten);
  assert.equal(stuk.length, 0);
  assert.equal(geweerd.length, GEWEERD.length);
});

test("een 403 op HEAD wordt nog steeds eerst met GET geprobeerd", async () => {
  // Anders staat een winkel die alleen HEAD weert onterecht als onbereikbaar.
  const { haal, bezocht } = nep({ HEAD: 403, GET: 200 });
  assert.equal((await bereikbaarheid("https://winkel.nl/p", { haal })).status, 200);
  assert.deepEqual(bezocht, ["HEAD", "GET"]);
});

/* ------------------------------------------------------------------
   De browser als laatste woord
   ------------------------------------------------------------------ */

test("een 404 die een browser wel gewoon laadt is niet kapot", async () => {
  // Dit is bluetti.com, volt-shop.nl en memodo.nl: botbescherming die zich
  // voordoet als een verdwenen pagina.
  const { haal } = nep({ HEAD: 404, GET: 404 });
  const uit = await bereikbaarheid("https://winkel.nl/p", { haal, viaBrowser: async () => "<html>de pagina</html>" });
  assert.equal(uit.status, 200);
  assert.equal(uit.methode, "browser");
});

test("een 404 die ook in de browser een 404 is blijft kapot", async () => {
  const { haal } = nep({ HEAD: 404, GET: 404 });
  const stuk = async () => { throw new Error("HTTP 404"); };
  const uit = await bereikbaarheid("https://winkel.nl/weg", { haal, viaBrowser: stuk });
  assert.equal(uit.status, 404);
  assert.equal(deelUitkomsten([{ ...uit, herkomst: "x" }]).stuk.length, 1);
});

test("zonder browser blijft het oordeel dat van het gewone verzoek", async () => {
  const { haal } = nep({ HEAD: 404, GET: 404 });
  const uit = await bereikbaarheid("https://winkel.nl/p", { haal });
  assert.equal(uit.status, 404);
  assert.equal(uit.methode, "GET");
});

test("een browser die zelf stukloopt verandert het oordeel niet", async () => {
  // Playwright ontbreekt, of de start mislukt. Dan telt wat we wel weten.
  const { haal } = nep({ HEAD: 404, GET: 404 });
  const uit = await bereikbaarheid("https://winkel.nl/p", { haal, viaBrowser: async () => null });
  assert.equal(uit.status, 404);
  assert.equal(uit.methode, "GET");
});

test("een adres dat helemaal niet antwoordt krijgt ook een browserpoging", async () => {
  // "fetch failed" kan ook een vingerafdruk-blokkade zijn.
  const { haal } = nep({ HEAD: new Error("fetch failed"), GET: new Error("fetch failed") });
  const uit = await bereikbaarheid("https://fabrikant.com/", { haal, viaBrowser: async () => "<html>ok</html>" });
  assert.equal(uit.status, 200);
});

test("een goed antwoord kost nooit een browserpoging", async () => {
  const { haal } = nep({ HEAD: 200 });
  let geprobeerd = false;
  await bereikbaarheid("https://winkel.nl/p", { haal, viaBrowser: async () => { geprobeerd = true; return "x"; } });
  assert.equal(geprobeerd, false);
});

test("geen antwoord telt als kapot, niet als geweerd", () => {
  const { stuk, geweerd } = deelUitkomsten([{ url: "https://weg.nl/", status: 0, herkomst: "x" }]);
  assert.equal(stuk.length, 1);
  assert.equal(geweerd.length, 0);
});

test("gelukt kent de grenzen van goed", () => {
  assert.ok(gelukt(200) && gelukt(301) && gelukt(399));
  assert.ok(!gelukt(400) && !gelukt(404) && !gelukt(0));
});
