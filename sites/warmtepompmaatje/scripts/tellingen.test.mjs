/**
 * Tests voor de aantallen die met de hand in de pagina's staan.
 *
 * Batterijmaatje heeft deze proef al, en om een goede reden: daar stond "de
 * volledige dataset (28 thuisbatterijen)" terwijl het er 41 waren, en een
 * zoekmachine nam dat over. Warmtepompmaatje had hem niet, en dus gebeurde hier
 * precies hetzelfde zonder dat iets het meldde.
 *
 * Bij het opnemen van de Stiebel WPL ACS/ICS classic bleek wat dat kost. De
 * teller "30 pompen" stond op zes plekken in index.html, elke plek twee keer
 * (één in de FAQ-markup voor Google, één in de zichtbare tekst), plus op
 * steun.html en uitleg.html. En het gaat niet alleen om het totaal: er stond
 * "17 op R290, 12 op R32 en één op R134a" - een optelling die alleen klopt als
 * niemand er een pomp bij zet - en "tussen 48 en 59 dB(A)", terwijl de nieuwe
 * binnenunit op 45 zit. Zulke zinnen blijven lopen, de pagina blijft werken, en
 * de fout verhuist naar het zoekresultaat.
 *
 * Deze proef bewaakt de claims over het geheel. De afgeleide aantallen (hoeveel
 * op R290, hoeveel met een officiële Home Assistant-koppeling) staan er los bij,
 * want die zijn niet aan één woord te herkennen.
 *
 * Draaien: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const zonderTags = (html) => html.replace(/<[^>]+>/g, "");
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lees = (naam) => readFileSync(resolve(ROOT, naam), "utf8");

const data = JSON.parse(lees("data/warmtepompen.json"));
const pompen = Object.values(data).find((v) => Array.isArray(v));

// Alleen de pagina's in de hoofdmap: /pomp wordt per model gegenereerd en noemt
// aantallen die bij dat ene model horen.
const paginas = readdirSync(ROOT).filter((n) => n.endsWith(".html"));
const alleTekst = paginas.map((n) => [n, lees(n)]);

/* Een claim over het geheel herken je aan het woord erachter. "19 pompen
   waarvoor de fabrikant een getal opgeeft" gaat over een deelverzameling en
   staat daarom niet in deze lijst maar in de proef eronder. */
const CLAIMS = ["pompen", "warmtepompen"];

// De telwoorden die in deze zinnen voorkomen: "er 17 via een omweg" is een
// deelverzameling, maar "Alle 32 pompen" en "Van de 32 pompen" zijn het geheel.
/* Let op de (?<![\d]\s) ervoor: "17 van de 20 pompen waarvan ik het
   geluidsvermogen ken" is een deelverzameling en geen totaal, en die staat
   gegenereerd op warmtepomp-geluid.html. Zonder die uitsluiting faalt deze
   proef op een zin die het juist goed doet. */
const GEHEEL = /(?<!\d\s)\b(?:alle|Alle|van de|Van de)\s+(\d+)\s+(pompen|warmtepompen)\b/g;

for (const woord of CLAIMS) {
  test(`elk genoemd totaal ${woord} klopt met de gegevens`, () => {
    const fout = [];
    for (const [pagina, html] of alleTekst) {
      // Zonder tags: in "de 14 <b>panelen</b> zelf" hield de <b> het getal
      // buiten beeld, en zo stond er 14 bij 17 panelen.
      for (const [heel, getal, gevonden] of zonderTags(html).matchAll(GEHEEL)) {
        if (gevonden !== woord) continue;
        if (Number(getal) !== pompen.length) fout.push(`${pagina}: "${heel}"`);
      }
    }
    assert.deepEqual(
      fout,
      [],
      `staan er ${pompen.length} in de gegevens, dan hoort dat ook op de pagina te staan:\n  ${fout.join("\n  ")}`,
    );
  });
}

const status = (v) => (v && typeof v === "object" ? v.status : v);
const tel = (filter) => pompen.filter(filter).length;

/* De afgeleide aantallen uit de FAQ op index.html. Deze staan niet in een
   patroon te herkennen, dus ze staan hier met de hand naast de berekening - en
   dat is precies de bedoeling: wie een pomp toevoegt komt hier langs. */
const AFGELEID = [
  ["all-electric", () => tel((w) => w.type === "all-electric")],
  ["hybride", () => tel((w) => w.type === "hybride")],
  ["op R290", () => tel((w) => /R290/i.test(w.koudemiddel || ""))],
  ["op R32", () => tel((w) => /R32/i.test(w.koudemiddel || ""))],
  ["officiële koppeling met Home Assistant", () => tel((w) => status(w.home_assistant) === "ja")],
  ["Home Assistant via een omweg", () => tel((w) => status(w.home_assistant) === "deels")],
  ["Homey met een eigen app", () => tel((w) => status(w.homey) === "ja")],
  ["Homey helemaal niets", () => tel((w) => status(w.homey) === "nee")],
  ["buitenunits met een opgegeven geluidsvermogen", () => tel((w) => w.buitenunit !== false && typeof w.geluid_db === "number")],
];

test("de afgeleide aantallen in de FAQ staan in de tekst zoals ze uit de gegevens komen", () => {
  // Deze proef rekent niet na wélk getal waar staat - dat zou de hele FAQ
  // moeten parseren - maar hij laat de berekende waarden zien zodra iets anders
  // in deze proef faalt. De echte controle zit in de regels hieronder.
  const index = lees("index.html");
  const fout = [];

  // "er 17 op R290, 12 op R32, twee op R410A en één op R134a": de optelling
  // moet op het totaal uitkomen, anders klopt de zin niet meer.
  const koudemiddelen = new Map();
  for (const w of pompen) {
    const naam = /R290/i.test(w.koudemiddel || "") ? "R290" : String(w.koudemiddel || "?").split(" ")[0];
    koudemiddelen.set(naam, (koudemiddelen.get(naam) || 0) + 1);
  }
  const som = [...koudemiddelen.values()].reduce((a, b) => a + b, 0);
  assert.equal(som, pompen.length, "de koudemiddelen tellen niet op tot het totaal");

  for (const [wat, reken] of AFGELEID) {
    const n = reken();
    if (n === 0) continue;
    if (!new RegExp(`\\b${n}\\b`).test(index)) {
      fout.push(`${wat}: ${n} staat nergens in index.html`);
    }
  }
  assert.deepEqual(fout, [], `de FAQ noemt deze aantallen niet (meer):\n  ${fout.join("\n  ")}`);
});

test("de laagste en hoogste dB(A) in de tekst komen uit de gegevens", () => {
  /* Hier ging het twee keer mis, en de tweede keer was ik het zelf.
   *
   * De zin zei "tussen 48 en 59 dB(A), voor de 19 pompen". Die 48 kwam van de
   * Inventum Ecolution Combi, en die heeft helemaal geen buitenunit - de zin
   * gaat dus over buitenunits en nam zijn ondergrens van een binnenunit. Toen ik
   * de Stiebel WPL 09 ICS toevoegde maakte ik er "45 en 59 over 21" van, en dat
   * was dezelfde fout nog een keer: die ICS staat ook helemaal binnen.
   *
   * Vandaar heeftBuitenunit, precies zoals de generator hem gebruikt
   * (`w.buitenunit !== false`). Een getal over buitenunits hoort alleen over
   * buitenunits te gaan, anders rekent de bezoeker met een afstand tot de
   * erfgrens voor een toestel dat in de bijkeuken staat. */
  const heeftBuitenunit = (w) => w.buitenunit !== false;
  const waarden = pompen
    .filter(heeftBuitenunit)
    .map((w) => w.geluid_db)
    .filter((n) => typeof n === "number");
  const laag = Math.min(...waarden);
  const hoog = Math.max(...waarden);
  const index = lees("index.html");
  const zin = /tussen (\d+) en (\d+) dB\(A\)/.exec(index);
  assert.ok(zin, "de zin over de geluidsrange staat niet meer in index.html");
  assert.equal(Number(zin[1]), laag);
  assert.equal(Number(zin[2]), hoog);
});

test("de ISDE-indicatie in de tekst dekt de werkelijke spreiding", () => {
  const bedragen = pompen.map((w) => w.isde_indicatie_eur).filter((n) => typeof n === "number");
  const index = lees("index.html");
  const zin = /loopt van (?:€\s*)?([\d.]+) tot (?:€\s*)?([\d.]+)/.exec(index);
  assert.ok(zin, "de zin over de ISDE-spreiding staat niet meer in index.html");
  const getal = (s) => Number(s.replace(/\./g, ""));
  assert.equal(getal(zin[1]), Math.min(...bedragen));
  assert.equal(getal(zin[2]), Math.max(...bedragen));
});

test("de teller in de hero staat op het werkelijke aantal", () => {
  // De proef hierboven zoekt "32 warmtepompen", maar de teller staat als
  // <b id="tellerPompen">30</b> warmtepompen in de HTML, en de tag ertussen
  // hield hem buiten beeld. Zo stond er 30 bij 32 pompen.
  const teller = lees("index.html").match(/<b id="tellerPompen">(\d+)<\/b>/);
  assert.ok(teller, "de teller staat niet meer in index.html; dan klopt de generator niet meer");
  assert.equal(Number(teller[1]), pompen.length);
});
