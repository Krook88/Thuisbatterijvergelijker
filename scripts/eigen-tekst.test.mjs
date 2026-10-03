/**
 * Staat de eigen aantekening bij elk product ook op zijn eigen pagina?
 *
 * Waarom dit bestaat
 * ------------------
 * Bij het nalezen van de drie sites bleek dat warmtepompmaatje de
 * `opmerkingen` bij elke pomp wél in de gegevens had en wél op de kaart in de
 * vergelijker toonde, maar niet op de productpagina. Op alle 32 pomppagina's
 * was de enige lopende zin daardoor de sjabloonzin uit de generator - 25 keer
 * exact dezelfde en 7 keer exact dezelfde. Juist de pagina waar iemand vanuit
 * een zoekmachine binnenkomt, was de versie zonder eigen tekst.
 *
 * Niets was stuk. De pagina werkte, de controles gaven groen, en de tekst
 * bestond. Hij werd alleen nergens afgedrukt. Dat soort gat valt niet op door
 * ernaar te kijken, want je ziet een complete pagina; het valt op door te
 * tellen.
 *
 * Batterijmaatje (42 van 42) en zonnestroommaatje (17 van 17) deden het al
 * goed. Deze proef houdt dat zo voor alle drie.
 *
 * Draaien: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WORTEL = join(dirname(fileURLToPath(import.meta.url)), "..");

/* site, gegevensbestand, map met productpagina's. De omvormers van
   zonnestroommaatje staan er bewust niet bij: die hebben geen eigen pagina. */
const SETS = [
  ["batterijmaatje", "data/batterijen.json", "batterij"],
  ["warmtepompmaatje", "data/warmtepompen.json", "pomp"],
  ["zonnestroommaatje", "data/panelen.json", "paneel"],
];

/* Entiteiten en opmaak maken een letterlijke vergelijking onbruikbaar: een
   apostrof of een accent komt er anders uit dan hij erin ging. Daarom wordt er
   op een vereenvoudigde vorm vergeleken, en op een stuk uit het midden van de
   zin - het begin kan toevallig ook ergens anders staan. */
const vereenvoudig = (t) => t
  .replace(/<[^>]+>/g, " ")
  .replace(/&[a-z]+;|&#\d+;/gi, " ")
  .replace(/[^a-z0-9]+/gi, " ")
  .toLowerCase()
  .trim();

for (const [site, gegevens, map] of SETS) {
  const pad = join(WORTEL, "sites", site, gegevens);
  if (!existsSync(pad)) continue;
  const ruw = JSON.parse(readFileSync(pad, "utf8"));
  const producten = Array.isArray(ruw) ? ruw : Object.values(ruw).find(Array.isArray);

  test(`${site}: de eigen aantekening staat op elke productpagina`, () => {
    const ontbreekt = [];
    for (const p of producten) {
      const tekst = (p.opmerkingen || "").trim();
      if (!tekst) continue;
      const pagina = join(WORTEL, "sites", site, map, `${p.id}.html`);
      if (!existsSync(pagina)) { ontbreekt.push(`${p.id} (geen pagina)`); continue; }
      const naald = vereenvoudig(tekst).split(" ").slice(2, 10).join(" ");
      if (!vereenvoudig(readFileSync(pagina, "utf8")).includes(naald)) ontbreekt.push(p.id);
    }
    assert.deepEqual(
      ontbreekt,
      [],
      `Deze producten hebben wel een eigen aantekening in ${gegevens}, maar die staat niet op hun pagina: ${ontbreekt.join(", ")}`,
    );
  });
}
