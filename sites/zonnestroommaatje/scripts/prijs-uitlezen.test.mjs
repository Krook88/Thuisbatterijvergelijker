/**
 * Tests voor scripts/prijs-uitlezen.mjs.
 *
 * De gevallen hieronder zijn geen bedachte randgevallen. Het zijn de vier
 * manieren waarop het prijsscript van batterijmaatje er de afgelopen maand
 * naast zat, met de schade erbij:
 *
 *   - Zonneplan: 5.990 euro werd 664, want dat bedrag stond het vaakst op de
 *     overzichtspagina.
 *   - SolarEdge bij Thuisbatterij Nederland: 6.200 werd 1.495, om dezelfde
 *     reden.
 *   - Sessy en HomeWizard: "geen prijs gevonden", terwijl het bedrag in een
 *     JSON-blok in de pagina stond.
 *   - Twaalf prijzen stonden een maand stil zonder dat één van die twaalf een
 *     scriptfout was: zes hadden helemaal geen winkelpagina.
 *
 * Alle vier zaten in de extractie, en die is nu gedeeld. Gaat hij stuk, dan
 * gaat hij op drie sites tegelijk stuk en verandert elke prijs op elke pagina.
 *
 * Draaien: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ankerWoorden,
  parsePrijsWaarde,
  prijsUitJsonLd,
  prijsUitScriptJson,
  prijsUitJsonVeld,
  prijsUitTekst,
  prijsUitPagina,
  toontExclBtw,
  controleerbaar,
} from "./prijs-uitlezen.mjs";

/* ------------------------------------------------------------------
   Bedragen lezen
   ------------------------------------------------------------------ */

test("Nederlandse en Engelse schrijfwijzen leveren hetzelfde bedrag op", () => {
  assert.equal(parsePrijsWaarde("€ 1.299,00"), 1299);
  assert.equal(parsePrijsWaarde("1299.00"), 1299);
  assert.equal(parsePrijsWaarde("1.299"), 1299);
  assert.equal(parsePrijsWaarde("5990,-"), 5990);
  assert.equal(parsePrijsWaarde(""), null);
  assert.equal(parsePrijsWaarde(null), null);
});

/* ------------------------------------------------------------------
   De productnaam als anker
   ------------------------------------------------------------------ */

test("het anker houdt alleen de woorden over waarmee dit product zich onderscheidt", () => {
  const a = ankerWoorden("Zonneplan Nexus (10 kWh)");
  assert.ok(a.includes("zonneplan"));
  assert.ok(a.includes("nexus"));
  assert.ok(!a.includes("kwh"), "kWh staat bij elk product op een overzichtspagina");
});

test("een naam zonder onderscheidende woorden levert geen anker op", () => {
  assert.deepEqual(ankerWoorden("Thuisbatterij set"), []);
  assert.deepEqual(ankerWoorden(""), []);
});

/* ------------------------------------------------------------------
   Meerdere producten op één pagina
   Zonneplan gaf 664 voor een batterij van 5.990; SolarEdge 1.495 voor 6.200.
   ------------------------------------------------------------------ */

const OVERZICHTSPAGINA = `
  <h2>Zonneplan Nexus</h2>
  <p>Vanaf € 5.990 inclusief installatie.</p>
  <section>
    <h3>Zonneplan Thuisaccu klein</h3><p>€ 664</p>
    <h3>Slimme meter</h3><p>€ 664</p>
    <h3>Laadpaal</h3><p>€ 664</p>
  </section>`;

test("het bedrag bij de productnaam wint van het bedrag dat het vaakst voorkomt", () => {
  assert.equal(prijsUitTekst(OVERZICHTSPAGINA, ankerWoorden("Zonneplan Nexus")), 5990);
});

test("zonder anker wint het vaakst voorkomende bedrag nog steeds, zoals vroeger", () => {
  assert.equal(prijsUitTekst(OVERZICHTSPAGINA, []), 664);
});

test("op een pagina met veel losse bedragen en geen anker zwijgt het script", () => {
  const rommel = ["100", "200", "300", "400", "500", "600", "700", "800", "900", "1000"]
    .map((p) => `<p>€ ${p}</p>`).join("");
  assert.equal(prijsUitTekst(rommel, ["bestaatniet"]), null);
});

test("een bedrag verderop de pagina hoort niet meer bij het product", () => {
  const ver = `<h1>Marstek Venus</h1><p>€ 1.299</p>${"x".repeat(4000)}<p>€ 49</p><p>€ 49</p>`;
  assert.equal(prijsUitTekst(ver, ankerWoorden("Marstek Venus")), 1299);
});

test("bij twee bedragen even dicht bij de naam telt het laagste, dat is wat je betaalt", () => {
  const korting = `<h1>Marstek Venus</h1><p>van € 1.499 voor € 1.299</p>`;
  assert.equal(prijsUitTekst(korting, ankerWoorden("Marstek Venus")), 1299);
});

/* ------------------------------------------------------------------
   Structured data met meer dan één product
   ------------------------------------------------------------------ */

function ld(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
}

test("één product in de structured data telt zonder meer", () => {
  const html = ld({ "@type": "Product", name: "Iets", offers: { price: "1299.00" } });
  assert.equal(prijsUitJsonLd(html, ankerWoorden("Marstek Venus")).prijs, 1299);
});

test("bij meerdere producten kiest de naam, niet de volgorde", () => {
  const html =
    ld({ "@type": "Product", name: "Zonneplan Thuisaccu klein", offers: { price: "664" } }) +
    ld({ "@type": "Product", name: "Zonneplan Nexus 10 kWh", offers: { price: "5990" } });
  assert.equal(prijsUitJsonLd(html, ankerWoorden("Zonneplan Nexus")).prijs, 5990);
});

test("wijst de naam niets aan, dan neemt het script niets over", () => {
  const html =
    ld({ "@type": "Product", name: "Laadpaal", offers: { price: "664" } }) +
    ld({ "@type": "Product", name: "Slimme meter", offers: { price: "199" } });
  assert.equal(prijsUitJsonLd(html, ankerWoorden("Zonneplan Nexus")), null);
});

test("een lowPrice van een AggregateOffer telt niet mee, tenzij de site erom vraagt", () => {
  // Bij een batterij is dat de goedkoopste variant op de pagina - een kleiner
  // model, of zonder P1-meter - en niet de prijs van dit product. Bij een
  // paneel dat tien winkels voeren is het juist wél wat je betaalt.
  const html = ld({ "@type": "Product", name: "Marstek Venus", offers: { "@type": "AggregateOffer", lowPrice: "899" } });
  assert.equal(prijsUitJsonLd(html, ankerWoorden("Marstek Venus")), null);
  assert.equal(prijsUitJsonLd(html, ankerWoorden("Marstek Venus"), { lowPriceTelt: true }).prijs, 899);
});

test("een bedrag in dollars is niet de prijs die wij zoeken", () => {
  const html = ld({ "@type": "Product", name: "Marstek Venus", offers: { price: "1299", priceCurrency: "USD" } });
  assert.equal(prijsUitJsonLd(html, ankerWoorden("Marstek Venus")), null);
});

test("een uitverkocht product houdt vaak een oude prijs in de markup", () => {
  const html = ld({
    "@type": "Product", name: "Marstek Venus",
    offers: { price: "1299", availability: "https://schema.org/OutOfStock" },
  });
  assert.equal(prijsUitJsonLd(html, ankerWoorden("Marstek Venus")), null);
});

test("zegt de markup zelf dat de btw er niet in zit, dan telt dat zwaarder dan de tekst", () => {
  const html = ld({
    "@type": "Product", name: "GoodWe Lynx",
    offers: { price: "2383", priceSpecification: { price: "2383", valueAddedTaxIncluded: false } },
  }) + "<p>Alle prijzen inclusief btw.</p>";
  assert.equal(prijsUitPagina(html, "GoodWe Lynx").btw, "excl");
});

/* ------------------------------------------------------------------
   De prijs in een JSON-blok
   Sessy, HomeWizard en Vattenfall meldden elke dag "geen prijs gevonden".
   ------------------------------------------------------------------ */

test("een prijs uit een JSON-blok in de pagina wordt gevonden", () => {
  const html = `<script>window.__NUXT__ = ${JSON.stringify({
    data: { product: { title: "Sessy 5 kWh thuisbatterij", price: 3550 } },
  })}</script>`;
  assert.equal(prijsUitScriptJson(html, ankerWoorden("Sessy 5 kWh")), 3550);
});

test("centen worden herkend als centen", () => {
  const html = `<script type="application/json">${JSON.stringify({
    product: { title: "HomeWizard Plug-In Battery", price: 119500 },
  })}</script>`;
  assert.equal(prijsUitScriptJson(html, ankerWoorden("HomeWizard Plug-In Battery")), 1195);
});

test("een bedrag zonder productnaam ernaast wordt niet overgenomen", () => {
  // Anders pakt het script het eerste beste getal uit een verzendtarief of
  // een winkelwagen.
  const html = `<script type="application/json">${JSON.stringify({
    cart: { price: 9 }, verzending: { price: 695 },
  })}</script>`;
  assert.equal(prijsUitScriptJson(html, ankerWoorden("Sessy 5 kWh")), null);
});

test("zonder anker kijkt het script niet in JSON-blokken", () => {
  const html = `<script type="application/json">{"name":"iets","price":1234}</script>`;
  assert.equal(prijsUitScriptJson(html, []), null);
});

/* ------------------------------------------------------------------
   Het prijsveld zonder productnaam: de laatste, grofste weg
   ------------------------------------------------------------------ */

test("een benoemd prijsveld volstaat, ook zonder productnaam ernaast", () => {
  // Bij warmtepompmaatje haalt deze route elke dag prijzen binnen bij winkels
  // waar geen enkele andere weg iets oplevert.
  assert.equal(prijsUitJsonVeld(`<script>{"unitPrice":"4199,00"}</script>`), 4199);
});

test("de grenzen van de site houden centen en centenbedragen buiten de deur", () => {
  assert.equal(prijsUitJsonVeld(`<script>{"price":419900}</script>`), null);
  assert.equal(prijsUitJsonVeld(`<script>{"price":49}</script>`), null);
  assert.equal(prijsUitJsonVeld(`<script>{"price":800}</script>`, { min: 1500 }), null);
});

test("bij evenveel treffers wint het laagste bedrag, want dat is de kale prijs", () => {
  // Het hogere bedrag is doorgaans een set of een variant met toebehoren.
  assert.equal(prijsUitJsonVeld(`<script>{"price":4199,"salePrice":5299}</script>`), 4199);
});

/* ------------------------------------------------------------------
   Btw volgens de tekst op de pagina
   ------------------------------------------------------------------ */

test("alleen een eenduidige pagina levert een oordeel over btw", () => {
  assert.equal(toontExclBtw("<p>Prijzen excl. btw</p>"), true);
  assert.equal(toontExclBtw("<p>Prijzen incl. btw</p>"), false);
  // Toont de winkel beide bedragen, dan is wat wij oppikken vrijwel altijd
  // het bedrag inclusief.
  assert.equal(toontExclBtw("<p>€ 1.000 excl. btw, € 1.210 incl. btw</p>"), false);
  assert.equal(toontExclBtw("<p>Geen woord over belasting.</p>"), false);
});

/* ------------------------------------------------------------------
   De volgorde van de wegen
   ------------------------------------------------------------------ */

test("structured data gaat voor op de zichtbare tekst, en het logboek zegt welke weg het was", () => {
  const html =
    ld({ "@type": "Product", name: "Marstek Venus E", offers: { price: "1299" } }) +
    "<p>Actie! € 49 korting op accessoires. € 49</p>";
  const uit = prijsUitPagina(html, "Marstek Venus E");
  assert.equal(uit.prijs, 1299);
  assert.equal(uit.hoe, "structured data");
});

test("een pagina zonder enig bedrag levert geen prijs en geen weg op", () => {
  const uit = prijsUitPagina("<p>Vraag een offerte aan.</p>", "Zonneplan Nexus");
  assert.equal(uit.prijs, null);
  assert.equal(uit.hoe, null);
});

/* ------------------------------------------------------------------
   Wat een script überhaupt kan controleren
   Zes van de twaalf stilstaande prijzen hadden geen winkelpagina.
   ------------------------------------------------------------------ */

test("zonder adres valt er niets te controleren", () => {
  assert.equal(controleerbaar({ prijs_eur: 5990 }), false);
  assert.equal(controleerbaar(null), false);
  assert.equal(controleerbaar({ url: "https://winkel.nl/product" }), true);
  assert.equal(controleerbaar({ prijs_bron_url: "https://winkel.nl/product" }), true);
});

test("een prijs die als handmatig is aangemerkt blijft handmatig, ook met een adres erbij", () => {
  // Een offerteprijs staat niet op de pagina waar hij vandaan komt.
  assert.equal(controleerbaar({ url: "https://zonneplan.nl/thuisbatterij", prijs_controle: "handmatig" }), false);
});
