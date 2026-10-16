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

/* Eigen bezoeken uitzetten, per browser en per site. Wie een pagina opent met
   #niet-tellen achter het adres, krijgt "va-disable" in localStorage; met
   #wel-tellen gaat dat er weer af. Vercel leest het niet zelf: de beforeSend
   hieronder laat dan elk bericht vallen, zoals de uitleg van Vercel het doet
   (vercel.com/docs/analytics/redacting-sensitive-data). Dit moet vóór het
   script van Vercel staan, en niet uitgesteld, anders is de eerste
   paginaweergave al weg. assets/teller.js vraagt maatjeTeltNiet().

   De schakelaar op batterijmaatje.nl/statistieken kan de opslag van de andere
   twee domeinen niet lezen; die opent de site in een klein venster met een van
   de drie adressen hieronder. Het venster meldt de stand terug aan
   batterijmaatje.nl (postMessage, alleen naar dat domein) en sluit zich. Zo'n
   bezoek telt zelf ook niet mee. Een element met data-teller-stand (op
   privacy.html) krijgt de stand als tekst. */
const UITZET_JS = [
  '(function(){',
  'var K="va-disable",H=/^#(niet-tellen|wel-tellen|teller-stand)$/;',
  'function uit(){try{return!!localStorage.getItem(K)}catch(e){return false}}',
  'function toon(){var t=uit()?"Op dit moment tel je niet mee.":"Op dit moment tel je mee.";',
  'document.querySelectorAll("[data-teller-stand]").forEach(function(n){n.textContent=t})}',
  'function t(){var h=location.hash;',
  'try{if(h=="#niet-tellen")localStorage.setItem(K,"1");else if(h=="#wel-tellen")localStorage.removeItem(K)}catch(e){}',
  'if(H.test(h)&&window.opener){try{window.opener.postMessage({teller:uit()?"uit":"aan",site:location.hostname.replace(/^www\\./,"")},"https://batterijmaatje.nl")}catch(e){}window.close()}',
  'if(document.readyState!="loading")toon()}',
  't();addEventListener("hashchange",t);document.addEventListener("DOMContentLoaded",toon);',
  'window.maatjeTeltNiet=function(){return uit()||H.test(location.hash)};',
  'window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};',
  'window.va("beforeSend",function(e){return window.maatjeTeltNiet()?null:e})',
  '})()',
].join("");
export const UITZET_TAG = `<script>${UITZET_JS}</script>`;
/* Elke uitzetter, ook een oudere versie, zodat een nieuwe hem vervangt. */
export const UITZET_PATROON = /<script>\(function\(\)\{[^\n]*va-disable[^\n]*<\/script>/;

/* De eigen teller voor doorklikken en verblijfstijd (assets/teller.js), met
   het ?v=-stempel van de site zodat 'npm run stempel' hem meeneemt. */
export const TELLER_PATROON = /<script defer src="\/assets\/teller\.js\?v=[A-Za-z0-9]+"><\/script>/;
export const tellerTag = (versie) => `<script defer src="/assets/teller.js?v=${versie}"></script>`;

/**
 * De pagina met de tags erin, vlak voor </head>, en de uitzetter vlak voor
 * het script van Vercel. Verandert niets als ze er al staan. Zonder versie
 * komt de eigen teller er niet bij.
 */
export function metStatistiek(html, versie) {
  if (!html.includes("</head>")) return html;
  let uit = html;
  if (!uit.includes(STATISTIEK_TAG)) uit = uit.replace("</head>", `  ${STATISTIEK_TAG}\n</head>`);
  if (!uit.includes(UITZET_TAG)) {
    uit = UITZET_PATROON.test(uit)
      ? uit.replace(UITZET_PATROON, () => UITZET_TAG)
      : uit.replace(STATISTIEK_TAG, () => `${UITZET_TAG}\n  ${STATISTIEK_TAG}`);
  }
  if (versie && !TELLER_PATROON.test(uit)) uit = uit.replace("</head>", `  ${tellerTag(versie)}\n</head>`);
  return uit;
}

/* Pagina's die zelf niet meetellen: de statistiekenpagina is voor de beheerder,
   en elk bezoek daar zou de cijfers ophogen die je er komt bekijken. Paden
   relatief aan de map van de site. */
export const NIET_TELLEN = new Set(["statistieken.html"]);

/** De pagina zonder de tags van Vercel, de uitzetter en de eigen teller. */
export function zonderStatistiek(html) {
  return html
    .split("\n")
    .filter((r) => !r.includes(STATISTIEK_TAG) && !UITZET_PATROON.test(r) && !TELLER_PATROON.test(r))
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
