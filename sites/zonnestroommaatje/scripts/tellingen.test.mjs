/**
 * Tests voor de aantallen die met de hand in de pagina's staan.
 *
 * De derde van drie: batterijmaatje had deze proef al, warmtepompmaatje kreeg
 * hem toen daar hetzelfde misging, en hier bleek bij het opnemen van drie
 * panelen precies weer dat patroon. "Alle 14 panelen hier" op uitleg.html, "De
 * 14 zonnepanelen hier" op steun.html, en in de generator een vaste "7 van de
 * 14 panelen op deze site zijn glas-glas" - een optelling die alleen klopt
 * zolang er niets bij komt.
 *
 * Zulke zinnen blijven lopen en de pagina blijft werken, dus niemand ziet het.
 * Erger: het verhuist naar het zoekresultaat en naar de samenvatting die
 * AI-assistenten van de site geven, en daar zien nieuwe bezoekers het eerst.
 *
 * Draaien: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lees = (naam) => readFileSync(resolve(ROOT, naam), "utf8");

const panelen = JSON.parse(lees("data/panelen.json")).panelen;
const omvormers = JSON.parse(lees("data/omvormers.json")).omvormers;

// Alleen de pagina's in de hoofdmap: /paneel en /vergelijk worden per model
// gegenereerd en noemen aantallen die bij dat ene model horen.
const paginas = readdirSync(ROOT).filter((n) => n.endsWith(".html"));
const alles = paginas.map((n) => [n, lees(n)]);

/* Een claim over het geheel herken je aan het telwoord ervoor. "circa 8 panelen
   nodig" en "een installatie van 10 panelen" gaan over een gemiddeld dak en
   niet over onze lijst; die blijven dus buiten deze proef, en daarom staat het
   telwoord in het patroon en niet alleen het zelfstandig naamwoord. */
const GEHEEL = /(?<!\d\s)\b(?:alle|Alle|van de|Van de|De|de)\s+(\d+)\s+(panelen|zonnepanelen|omvormers)\b/g;

const VERWACHT = {
  panelen: () => panelen.length,
  zonnepanelen: () => panelen.length,
  omvormers: () => omvormers.length,
};

for (const woord of Object.keys(VERWACHT)) {
  test(`elk genoemd totaal ${woord} klopt met de gegevens`, () => {
    const fout = [];
    for (const [pagina, html] of alles) {
      for (const [heel, getal, gevonden] of html.matchAll(GEHEEL)) {
        if (gevonden !== woord) continue;
        if (Number(getal) !== VERWACHT[woord]()) fout.push(`${pagina}: "${heel}"`);
      }
    }
    assert.deepEqual(
      fout,
      [],
      `staan er ${VERWACHT[woord]()} in de gegevens, dan hoort dat ook op de pagina te staan:\n  ${fout.join("\n  ")}`,
    );
  });
}

test("de glas-glas telling op de overzichtspagina klopt", () => {
  // Deze stond als vast getal in de generator. Nu wordt hij geteld, en deze
  // proef let erop dat dat zo blijft - ook als iemand de zin herschrijft.
  const glasGlas = panelen.filter((p) => p.uitvoering === "glas-glas").length;
  const html = lees("beste-glas-glas-zonnepanelen.html");
  const zin = /(\d+) van de (\d+) panelen op deze site zijn glas-glas/.exec(html);
  assert.ok(zin, "de zin over glas-glas staat niet meer op de overzichtspagina");
  assert.equal(Number(zin[1]), glasGlas);
  assert.equal(Number(zin[2]), panelen.length);
});

test("elk paneel heeft de velden die de Zeker-score en de dakscore nodig hebben", () => {
  /* Deze twee scores rekenen met `|| 0`, dus een ontbrekend veld levert geen
     fout op maar een stil te lage score - en dan staat een paneel onterecht
     onderaan. Bij het opnemen van de AIKO Neostar 3S liep ik hier tegenaan:
     de winkel geeft het vermogensbehoud na 30 jaar en niet na 25, terwijl dat
     laatste veld de score bepaalt. */
  const nodig = ["vermogen_wp", "rendement_pct", "garantie_product_jaar", "vermogen_behoud_25j_pct", "uitvoering"];
  const fout = [];
  for (const p of panelen) {
    for (const veld of nodig) {
      if (p[veld] === null || p[veld] === undefined) fout.push(`${p.id}: ${veld} ontbreekt`);
    }
  }
  assert.deepEqual(fout, [], `deze velden bepalen een score en mogen niet leeg zijn:\n  ${fout.join("\n  ")}`);
});
