/**
 * Bezoekersstatistieken: het script van Vercel Web Analytics op elke pagina.
 *
 * Waarom Vercel Web Analytics: de sites staan al bij Vercel, het script komt
 * van het eigen domein (/_vercel/insights/script.js), en het werkt zonder
 * cookies en zonder iets op het apparaat van de bezoeker op te slaan. Een
 * bezoeker wordt herkend aan een code die Vercel uit het verzoek berekent en
 * na 24 uur weggooit. Daarmee blijft de belofte op privacy.html staan:
 * geen cookies en geen advertentietrackers. Het dashboard staat in Vercel,
 * per project onder Analytics.
 *
 * Waarom hier en niet in elke kop: er zijn met de hand geschreven pagina's,
 * gegenereerde pagina's in vijf soorten en de korte pagina's van producten
 * zonder actuele prijs. Een tag die in één sjabloon ontbreekt, valt niemand
 * op; dan telt een hele groep pagina's stil niet mee. De generator loopt
 * daarom aan het eind alle pagina's van de site langs.
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const STATISTIEK_TAG = '<script defer src="/_vercel/insights/script.js"></script>';

/** De pagina met de tag erin, vlak voor </head>. Verandert niets als hij er al staat. */
export function metStatistiek(html) {
  if (html.includes(STATISTIEK_TAG) || !html.includes("</head>")) return html;
  return html.replace("</head>", `  ${STATISTIEK_TAG}\n</head>`);
}

/** Alle .html-bestanden van een site, zonder node_modules en verborgen mappen. */
export function htmlBestanden(root) {
  const uit = [];
  const loop = (map) => {
    for (const naam of readdirSync(map)) {
      if (naam === "node_modules" || naam.startsWith(".")) continue;
      const pad = join(map, naam);
      if (statSync(pad).isDirectory()) loop(pad);
      else if (naam.endsWith(".html")) uit.push(pad);
    }
  };
  loop(root);
  return uit;
}

/** Zet de tag op elke pagina van de site. Geeft het aantal aangepaste pagina's. */
export function zetStatistiekOveral(root) {
  let aangepast = 0;
  for (const pad of htmlBestanden(root)) {
    const oud = readFileSync(pad, "utf8");
    const nieuw = metStatistiek(oud);
    if (nieuw !== oud) { writeFileSync(pad, nieuw, "utf8"); aangepast++; }
  }
  return aangepast;
}
