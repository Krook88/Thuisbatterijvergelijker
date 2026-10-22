/**
 * Preload-hints voor de stylesheets die style.css met @import binnenhaalt.
 *
 * style.css begint met @import url("maatlat.css?v=...") en
 * @import url("vergelijker.css?v=..."). Dat is bewust (zie maatlat.css): één
 * link per pagina, en een nieuw bestand hoeft niet in 175 koppen te worden
 * bijgezet. Het nadeel is dat de browser die twee pas ziet als style.css
 * binnen is, en ze dus na elkaar laadt in plaats van tegelijk. PageSpeed mat
 * op 22 oktober 2026 voor warmtepompmaatje.nl 390 ms die de eerste weergave
 * daardoor langer op zich liet wachten.
 *
 * Een <link rel="preload"> per @import vlak vóór de link naar style.css laat
 * de browser alle drie tegelijk ophalen. De @import blijft staan en bepaalt nog
 * steeds de volgorde van de regels; de preload haalt alleen het bestand
 * eerder. De lijst komt uit style.css zelf, zodat een nieuwe @import hier
 * vanzelf meekomt, en de generator zet hem op elke pagina, net als het
 * statistiekscript (zie statistiek.mjs).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { htmlBestanden } from "./statistiek.mjs";

const STYLE_LINK = /<link rel="stylesheet" href="([^"]*?)style\.css\?v=[A-Za-z0-9]+">/;
const OUDE_PRELOAD = /[ \t]*<link rel="preload" href="[^"]*?[A-Za-z0-9_-]+\.css\?v=[A-Za-z0-9]+" as="style">\n/g;

/** De bestanden die style.css bovenaan met @import binnenhaalt, met hun ?v=. */
export function importsVan(css) {
  return [...css.matchAll(/^@import url\("([^"]+\.css\?v=[A-Za-z0-9]+)"\);/gm)].map((m) => m[1]);
}

/** De pagina met een preload per import, vlak voor de link naar style.css. */
export function metVoorladen(html, imports) {
  const zonder = html.replace(OUDE_PRELOAD, "");
  const m = STYLE_LINK.exec(zonder);
  if (!m || !imports.length) return zonder;
  const inspringing = (/\n([ \t]*)<link rel="stylesheet" href="[^"]*?style\.css/.exec(zonder) || [, ""])[1];
  const hints = imports.map((i) => `${inspringing}<link rel="preload" href="${m[1]}${i}" as="style">\n`).join("");
  return zonder.replace(`${inspringing}${m[0]}`, () => `${hints}${inspringing}${m[0]}`);
}

/** Zet de hints op elke pagina van de site. Geeft het aantal aangepaste pagina's. */
export function zetVoorladenOveral(root) {
  const imports = importsVan(readFileSync(join(root, "assets", "style.css"), "utf8"));
  let aangepast = 0;
  for (const pad of htmlBestanden(root)) {
    const oud = readFileSync(pad, "utf8");
    const nieuw = metVoorladen(oud, imports);
    if (nieuw !== oud) { writeFileSync(pad, nieuw, "utf8"); aangepast++; }
  }
  return aangepast;
}
