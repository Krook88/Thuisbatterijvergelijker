/**
 * Tests voor sitemap-datum.mjs - de module die bepaalt of een pagina echt
 * veranderd is.
 *
 * Waarom deze er zijn: als de normalisatie te veel wegpoetst, blijft een
 * gewijzigde pagina op zijn oude datum staan en vraagt niemand er ooit nog om.
 * Poetst hij te weinig weg, dan staat elke pagina weer elke dag op vandaag en
 * zijn we terug bij het probleem dat we net hebben opgelost. Allebei de fouten
 * zijn onzichtbaar: de sitemap ziet er in beide gevallen keurig uit.
 *
 * Draaien: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { vergelijkbaar, vorigeDatums } from "./sitemap-datum.mjs";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/* ------------------------------------------------------------------
   Wat de kalender schrijft telt niet als wijziging
   ------------------------------------------------------------------ */

test("een dagteller die oploopt is geen wijziging", () => {
  const a = '<p>Deze prijs is voor het laatst bevestigd op 13 juli 2026, 34 dagen geleden.</p>';
  const b = '<p>Deze prijs is voor het laatst bevestigd op 13 juli 2026, 35 dagen geleden.</p>';
  assert.equal(vergelijkbaar(a), vergelijkbaar(b));
});

test("de teller in een title-attribuut telt ook niet", () => {
  const a = '<span title="Dit bedrag is 34 dagen niet bevestigd bij de winkel">x</span>';
  const b = '<span title="Dit bedrag is 40 dagen niet bevestigd bij de winkel">x</span>';
  assert.equal(vergelijkbaar(a), vergelijkbaar(b));
});

test("het stempel laatst gecontroleerd op is geen wijziging", () => {
  // update-prices.mjs zet laatst_bijgewerkt elke geslaagde run op vandaag, ook
  // als er geen enkel bedrag veranderd is. Zonder deze regel staat elke pagina
  // daardoor elke dag als gewijzigd in de sitemap.
  const a = '<p class="datum-stempel">Dagelijks bijgewerkt · laatst gecontroleerd op 15 augustus 2026</p>';
  const b = '<p class="datum-stempel">Dagelijks bijgewerkt · laatst gecontroleerd op 16 augustus 2026</p>';
  assert.equal(vergelijkbaar(a), vergelijkbaar(b));
});

test("een opschuivende priceValidUntil is geen wijziging", () => {
  const a = '{"priceValidUntil": "2026-09-14"}';
  const b = '{"priceValidUntil": "2026-09-15"}';
  assert.equal(vergelijkbaar(a), vergelijkbaar(b));
});

/* ------------------------------------------------------------------
   Een echte wijziging telt wél
   ------------------------------------------------------------------ */

test("een ander bedrag is wel een wijziging", () => {
  const a = '<div class="prijs">€ 3.550</div>';
  const b = '<div class="prijs">€ 3.295</div>';
  assert.notEqual(vergelijkbaar(a), vergelijkbaar(b));
});

test("een andere winkel is wel een wijziging", () => {
  const a = "<div>bij Sessy.nl (direct)</div>";
  const b = "<div>bij Coolblue</div>";
  assert.notEqual(vergelijkbaar(a), vergelijkbaar(b));
});

test("de datum waarop een prijs bevestigd is telt wel mee", () => {
  // "prijs van 13 juli" naar "prijs van 2 augustus" betekent dat de winkel
  // opnieuw bevestigd heeft. Dat is nieuws voor de bezoeker en dus voor Google.
  const a = "<span>prijs van 13 juli 2026</span>";
  const b = "<span>prijs van 2 augustus 2026</span>";
  assert.notEqual(vergelijkbaar(a), vergelijkbaar(b));
});

test("nieuwe tekst op de pagina is wel een wijziging", () => {
  const a = "<p>Deze pomp heeft een buitenunit.</p>";
  const b = "<p>Deze pomp heeft een buitenunit. Het geluidsvermogen is 54 dB(A).</p>";
  assert.notEqual(vergelijkbaar(a), vergelijkbaar(b));
});

/* ------------------------------------------------------------------
   De vorige datums teruglezen
   ------------------------------------------------------------------ */

test("leest zowel de compacte als de uitgevouwen sitemapvorm", () => {
  const map = mkdtempSync(join(tmpdir(), "sitemap-"));

  const compact = join(map, "compact.xml");
  writeFileSync(compact, '<?xml version="1.0"?>\n<urlset>\n' +
    "  <url><loc>https://x.nl/</loc><lastmod>2026-08-15</lastmod><priority>1.0</priority></url>\n" +
    "</urlset>\n");
  assert.equal(vorigeDatums(compact).get("https://x.nl/"), "2026-08-15");

  const breed = join(map, "breed.xml");
  writeFileSync(breed, '<?xml version="1.0"?>\n<urlset>\n' +
    "  <url>\n    <loc>https://x.nl/a.html</loc>\n    <lastmod>2026-07-01</lastmod>\n" +
    "    <changefreq>daily</changefreq>\n  </url>\n</urlset>\n");
  assert.equal(vorigeDatums(breed).get("https://x.nl/a.html"), "2026-07-01");
});

test("een sitemap die er nog niet is levert een lege lijst, geen fout", () => {
  assert.equal(vorigeDatums(join(tmpdir(), "bestaat-niet-", String(Date.now()), "sitemap.xml")).size, 0);
});
