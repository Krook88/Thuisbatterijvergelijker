/**
 * Tests voor scripts/productfotos.mjs.
 *
 * Wat hier fout kan gaan is stil en duur. Het script zet een foto bij een
 * product, en pakt het de verkeerde, dan staat er straks een sfeerbeeld of het
 * logo van de fabrikant bij een warmtepomp van 7.000 euro. Niemand ziet dat
 * aan de code, want de pagina werkt gewoon.
 *
 * Daarom liggen de twee dingen vast die het script wél zelf beslist: welke
 * adressen het als kandidaat aandraagt en in welke volgorde. De keuze tussen
 * die kandidaten blijft mensenwerk.
 *
 * Draaien: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { afbeeldingKandidaten, absoluut } from "./productfotos.mjs";

const BASIS = "https://www.fabrikant.nl/product/pomp-x";

test("een relatief adres wordt absoluut ten opzichte van de pagina", () => {
  assert.equal(absoluut("/beeld/x.jpg", BASIS), "https://www.fabrikant.nl/beeld/x.jpg");
  assert.equal(absoluut("../x.png", BASIS), "https://www.fabrikant.nl/x.png");
  assert.equal(absoluut("https://cdn.elders.nl/x.webp", BASIS), "https://cdn.elders.nl/x.webp");
  assert.equal(absoluut("", BASIS), null);
});

test("structured data gaat voor op og:image", () => {
  // De structured data wijst het product aan; og:image is wat de fabrikant als
  // visitekaartje kiest, en dat is lang niet altijd hetzelfde.
  const html = `
    <meta property="og:image" content="https://www.fabrikant.nl/sfeer.jpg">
    <script type="application/ld+json">
    {"@type":"Product","name":"Pomp X","image":"https://www.fabrikant.nl/pomp-x.jpg"}
    </script>`;
  const k = afbeeldingKandidaten(html, BASIS);
  assert.equal(k[0].url, "https://www.fabrikant.nl/pomp-x.jpg");
  assert.equal(k[0].hoe, "structured data");
  assert.equal(k[1].hoe, "og:image");
});

test("meerdere beelden in de structured data komen er allemaal in", () => {
  const html = `<script type="application/ld+json">
    {"@type":"Product","image":["https://www.fabrikant.nl/een.jpg","https://www.fabrikant.nl/twee.png"]}
    </script>`;
  assert.deepEqual(afbeeldingKandidaten(html, BASIS).map((k) => k.url),
    ["https://www.fabrikant.nl/een.jpg", "https://www.fabrikant.nl/twee.png"]);
});

test("hetzelfde adres langs twee wegen telt één keer", () => {
  const html = `
    <meta property="og:image" content="https://www.fabrikant.nl/x.jpg">
    <meta name="twitter:image" content="https://www.fabrikant.nl/x.jpg">`;
  assert.equal(afbeeldingKandidaten(html, BASIS).length, 1);
});

test("alleen beeldsoorten die de omzetter aankan", () => {
  // cwebp leest jpeg, png en webp. Een svg of een avif levert een leeg bestand
  // op, en dat zou als geslaagd worden weggeschreven.
  const html = `
    <meta property="og:image" content="https://www.fabrikant.nl/logo.svg">
    <meta name="twitter:image" content="https://www.fabrikant.nl/beeld.avif">
    <link rel="image_src" href="https://www.fabrikant.nl/goed.png">`;
  assert.deepEqual(afbeeldingKandidaten(html, BASIS).map((k) => k.url),
    ["https://www.fabrikant.nl/goed.png"]);
});

test("een adres met een queryreeks erachter telt gewoon mee", () => {
  const html = `<meta property="og:image" content="https://www.fabrikant.nl/x.jpg?w=1200&v=3">`;
  assert.equal(afbeeldingKandidaten(html, BASIS).length, 1);
});

test("logo's en pictogrammen tellen niet mee bij de gewone afbeeldingen", () => {
  const html = `
    <img src="/assets/logo.png" alt="Fabrikant">
    <img src="/assets/icon-check.png" alt="">
    <img src="/beeld/pomp-x-vooraanzicht.jpg" alt="Pomp X">`;
  assert.deepEqual(afbeeldingKandidaten(html, BASIS).map((k) => k.url),
    ["https://www.fabrikant.nl/beeld/pomp-x-vooraanzicht.jpg"]);
});

test("een pagina zonder bruikbaar beeld levert een lege lijst", () => {
  assert.deepEqual(afbeeldingKandidaten("<p>Tijdelijk niet leverbaar</p>", BASIS), []);
});

test("kapotte structured data laat de rest staan", () => {
  // Eén komma verkeerd in het ene blok mag de og:image niet meeslepen.
  const html = `
    <script type="application/ld+json">{ dit is geen json </script>
    <meta property="og:image" content="https://www.fabrikant.nl/x.jpg">`;
  assert.equal(afbeeldingKandidaten(html, BASIS).length, 1);
});
