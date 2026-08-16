/**
 * Een eerlijke <lastmod> in de sitemap.
 *
 * Waarom dit bestaat: alle drie de sitemaps zetten op elke URL dezelfde datum,
 * en die was elke dag vandaag. Eenenzestig pagina's beweerden dus elke dag
 * gewijzigd te zijn. Technisch was dat net waar - de dagelijkse prijsrun
 * herschrijft de bestanden - maar inhoudelijk niet: wat er veranderde was het
 * datumstempel en een teller "34 dagen geleden" die 35 werd.
 *
 * Google gebruikt lastmod zolang het veld betrouwbaar is en negeert het zodra
 * dat niet zo is. Een sitemap waarin alles altijd van vandaag is, leert Google
 * precies dat het niets betekent. Daarmee gooien we een van de weinige
 * signalen weg die we hebben - en juist op batterijmaatje, waar 44 van de 61
 * pagina's wel gevonden maar niet opgehaald zijn, kunnen we dat niet missen.
 *
 * Hoe het werkt: vóór het genereren lezen we de bestaande pagina's in, na het
 * genereren vergelijken we. Verschilt er niets van betekenis, dan houdt de URL
 * de datum die hij in de vorige sitemap had.
 *
 * Wat "van betekenis" niet is: de teksten die met de kalender meelopen zonder
 * dat er iets aan de pagina veranderde. Die staan hieronder, met per stuk waar
 * ze vandaan komen. Een prijs die verandert telt wél, want dan is de pagina
 * echt anders.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/* Alles wat verandert doordat de klok verspringt, niet doordat de pagina
   anders is. Vastgesteld door de generator twee keer te draaien met een dag
   ertussen en het verschil te bekijken - niet door te bedenken wat het zou
   kunnen zijn. */
const VLUCHTIG = [
  // "Deze prijs is voor het laatst bevestigd op 13 juli 2026, 34 dagen geleden."
  /\d+ dagen geleden/g,
  // title="Dit bedrag is 34 dagen niet bevestigd bij de winkel"
  /is \d+ dagen niet bevestigd/g,
  // "laatst gecontroleerd op 15 augustus 2026" - laatst_bijgewerkt wordt elke
  // geslaagde prijsrun op vandaag gezet, of er nu een bedrag veranderde of niet.
  /(laatst (?:gecontroleerd|bijgewerkt) op )[^<.]+/g,
  // JSON-LD: prijs_datum + 30 dagen. Schuift mee met de prijscontrole.
  /"priceValidUntil":\s*"[^"]*"/g,
];

/** De inhoud waarop we vergelijken: zonder de stukken die de kalender schrijft. */
export function vergelijkbaar(html) {
  let s = String(html);
  for (const patroon of VLUCHTIG) s = s.replace(patroon, "");
  return s;
}

/** Alle .html van een site, als pad => vergelijkbare inhoud. */
export function paginaStand(wortel) {
  const uit = new Map();
  (function loop(map) {
    for (const naam of readdirSync(map)) {
      if (naam === "node_modules" || naam.startsWith(".")) continue;
      const pad = join(map, naam);
      if (statSync(pad).isDirectory()) loop(pad);
      else if (naam.endsWith(".html")) uit.set(pad, vergelijkbaar(readFileSync(pad, "utf8")));
    }
  })(wortel);
  return uit;
}

/** De datums uit de sitemap die er nu ligt, als loc => lastmod. */
export function vorigeDatums(sitemapPad) {
  const uit = new Map();
  if (!existsSync(sitemapPad)) return uit;
  const xml = readFileSync(sitemapPad, "utf8");
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>\s*(?:\r?\n\s*)?<lastmod>([^<]+)<\/lastmod>/g)) {
    uit.set(m[1], m[2]);
  }
  return uit;
}

/**
 * Geeft een functie die per URL de juiste lastmod teruggeeft.
 *
 *   wortel   de map van de site
 *   site     "https://batterijmaatje.nl", om loc terug te rekenen naar een pad
 *   voor     de uitkomst van paginaStand() van vóór het genereren
 *   vandaag  "2026-08-16"
 *
 * Onbekende URL of een pagina die niet als bestand bestaat: vandaag. Dat is de
 * veilige kant - liever een keer te vers dan een datum verzinnen.
 */
export function lastmodMaker(wortel, site, voor, vandaag) {
  const na = paginaStand(wortel);
  const vorige = vorigeDatums(join(wortel, "sitemap.xml"));

  return function lastmodVoor(loc) {
    const relatief = loc.replace(site, "").replace(/^\//, "") || "index.html";
    const pad = join(wortel, ...relatief.split("/"));
    const nieuw = na.get(pad);
    if (nieuw === undefined) return vandaag;
    const oud = voor.get(pad);
    if (oud === undefined || oud !== nieuw) return vandaag;
    return vorige.get(loc) || vandaag;
  };
}

/** Voor het logregeltje: hoeveel URL's kregen vandaag als datum? */
export function telVers(urls, lastmodVoor, vandaag) {
  return urls.filter((u) => lastmodVoor(u.loc || u) === vandaag).length;
}
