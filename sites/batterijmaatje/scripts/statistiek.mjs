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
import { join, relative } from "node:path";

export const STATISTIEK_TAG = '<script defer src="/_vercel/insights/script.js"></script>';

/* De eigen teller voor doorklikken en verblijfstijd (assets/teller.js), met
   het ?v=-stempel van de site zodat 'npm run stempel' hem meeneemt. */
export const TELLER_PATROON = /<script defer src="\/assets\/teller\.js\?v=[A-Za-z0-9]+"><\/script>/;
export const tellerTag = (versie) => `<script defer src="/assets/teller.js?v=${versie}"></script>`;

/**
 * De pagina met beide tags erin, vlak voor </head>. Verandert niets als ze er
 * al staan. Zonder versie komt alleen de tag van Vercel erin.
 */
export function metStatistiek(html, versie) {
  if (!html.includes("</head>")) return html;
  let uit = html;
  if (!uit.includes(STATISTIEK_TAG)) uit = uit.replace("</head>", `  ${STATISTIEK_TAG}\n</head>`);
  if (versie && !TELLER_PATROON.test(uit)) uit = uit.replace("</head>", `  ${tellerTag(versie)}\n</head>`);
  return uit;
}

/* Pagina's die zelf niet meetellen: de statistiekenpagina is voor de beheerder,
   en elk bezoek daar zou de cijfers ophogen die je er komt bekijken. Paden
   relatief aan de map van de site. */
export const NIET_TELLEN = new Set(["statistieken.html"]);

/** De pagina zonder de tags van Vercel en de eigen teller. */
export function zonderStatistiek(html) {
  return html
    .split("\n")
    .filter((r) => !r.includes(STATISTIEK_TAG) && !TELLER_PATROON.test(r))
    .join("\n");
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

/** Zet de tags op elke pagina van de site, behalve op die in NIET_TELLEN. Geeft het aantal aangepaste pagina's. */
export function zetStatistiekOveral(root, versie) {
  let aangepast = 0;
  for (const pad of htmlBestanden(root)) {
    const oud = readFileSync(pad, "utf8");
    const telt = !NIET_TELLEN.has(relative(root, pad).replaceAll("\\", "/"));
    const nieuw = telt ? metStatistiek(oud, versie) : zonderStatistiek(oud);
    if (nieuw !== oud) { writeFileSync(pad, nieuw, "utf8"); aangepast++; }
  }
  return aangepast;
}
