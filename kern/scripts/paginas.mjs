/**
 * De pagina's die de meetscripts bekijken, per site.
 *
 * De lijst hoort bij de site, niet bij het meetscript: batterijmaatje heeft
 * duel-pagina's, zonnestroommaatje heeft een energieplan, warmtepompmaatje
 * heeft een subsidiepagina. Daarom staat het meetscript in kern/ en de lijst
 * ernaast in de site zelf, als scripts/paginas.json.
 *
 * Vorm van dat bestand: [["naam", "/pad.html"], ...] - de naam komt terug in
 * de tabel en in de bestandsnaam van een schermafdruk, dus wijzig hem niet
 * zonder reden: dan valt de vergelijking met de vorige meting weg.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Terugval voor een site die nog geen eigen lijst heeft. Bewust kort: wat
// niet bestaat wordt overgeslagen, dus dit werkt op elke site iets.
const TERUGVAL = [
  ["vergelijker", "/index.html"],
  ["keuzehulp", "/advies.html"],
  ["rekenmodule", "/rekenmodule.html"],
  ["uitleg", "/uitleg.html"],
  ["contact", "/contact.html"],
];

export function paginasVan(root) {
  const pad = join(root, "scripts", "paginas.json");
  if (!existsSync(pad)) return TERUGVAL;
  const gelezen = JSON.parse(readFileSync(pad, "utf8"));
  if (!Array.isArray(gelezen) || !gelezen.length) {
    throw new Error(`${pad} bevat geen lijst met pagina's.`);
  }
  return gelezen;
}
