/**
 * Controleert de productbestanden van de drie sites tegen DATASCHEMA.md.
 *
 * Waarom: een tikfout in de gegevens faalt stil. "btw_inbegrepen": "false"
 * (als tekst) is voor JavaScript waar, dus een prijs excl. btw wordt dan
 * gewoon als inclusief getoond. "niet_leverbaar_door": "pagina-weg" haalt de
 * prijsupdate nooit meer weg, want die zoekt "pagina weg". En een aanbieding
 * met "prijs-route" in plaats van "prijs_route" doet niets, zonder dat iemand
 * het merkt. De proeven vangen veel, maar lezen de gegevens alleen voor zover
 * ze ze nodig hebben.
 *
 * Wat hier staat is bewust de kleine kern van DATASCHEMA.md: de vorm van een
 * aanbieding (gedeeld door alle sites), het id, de datums en de velden met een
 * vaste reeks waarden. Wat een veld betekent staat in DATASCHEMA.md; dit
 * script houdt alleen bij dat de vorm klopt.
 *
 *   node scripts/dataschema.mjs     (ook onderdeel van npm run controle)
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WORTEL = join(dirname(fileURLToPath(import.meta.url)), "..");

export const BESTANDEN = [
  { site: "batterijmaatje", bestand: "batterijen.json", lijst: "batterijen" },
  { site: "warmtepompmaatje", bestand: "warmtepompen.json", lijst: "warmtepompen" },
  { site: "zonnestroommaatje", bestand: "panelen.json", lijst: "panelen" },
  { site: "zonnestroommaatje", bestand: "omvormers.json", lijst: "omvormers" },
];

const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Alle velden die een aanbieding mag hebben (DATASCHEMA.md, deel 2). Een
// onbekende sleutel is bijna altijd een tikfout, en die doet stil niets.
const AANBIEDING_VELDEN = new Set([
  "winkel", "url", "prijs_eur", "datum", "btw_inbegrepen", "omvat",
  "prijs_controle", "prijs_controle_reden", "niet_leverbaar", "niet_leverbaar_door",
  "niet_leverbaar_reden", "weg_sinds", "prijs_route", "prijs_variant", "ean", "affiliate_url",
]);

const ROUTES = new Set([
  "structured data", "json in de pagina", "meta-tag", "prijsveld in de pagina",
  "zichtbare tekst", "gekozen variant", "bij variant",
]);

// Velden met een vaste reeks waarden, per site. Een nieuwe waarde is prima,
// maar dan hoort de code die het veld leest hem te kennen; voeg hem hier toe
// en in DATASCHEMA.md tegelijk.
const VASTE_WAARDEN = {
  batterijmaatje: {
    vermogen_conditie: ["continu", "max", "stopcontact", "vaste-aansluiting", "onbekend"],
    capaciteit_soort: ["bruikbaar", "nominaal", "onbekend"],
    rendement_soort: ["ac", "accu", "zonzijde"],
    type: ["plug-in", "ac-gekoppeld", "hybride"],
    installatie: ["zelf", "installateur"],
  },
  warmtepompmaatje: {
    vermogen_conditie: ["Prated", "A7/W35", "onbekend"],
    scop_conditie: ["35", "55", "onbekend"],
    type: ["hybride", "all-electric"],
  },
  zonnestroommaatje: {
    type: ["micro", "optimizer", "hybride", "string"],
  },
};

function isDatum(w) {
  return typeof w === "string" && DATUM.test(w) && !Number.isNaN(Date.parse(`${w}T12:00:00Z`));
}

function isHttps(w) {
  return typeof w === "string" && /^https:\/\/[^\s]+$/.test(w);
}

/** Geeft een lijst met bevindingen voor één aanbieding. */
export function controleerAanbieding(o, site) {
  const fout = [];
  if (!o || typeof o !== "object") return ["is geen object"];
  for (const k of Object.keys(o)) if (!AANBIEDING_VELDEN.has(k)) fout.push(`onbekend veld "${k}"`);
  if (typeof o.winkel !== "string" || !o.winkel.trim()) fout.push("winkel ontbreekt");
  if (!isHttps(o.url)) fout.push(`url is geen https-adres (${JSON.stringify(o.url)})`);
  if ("prijs_eur" in o && o.prijs_eur !== null && !(Number.isInteger(o.prijs_eur) && o.prijs_eur > 0)) {
    fout.push(`prijs_eur is geen positief geheel getal (${JSON.stringify(o.prijs_eur)})`);
  }
  if ("datum" in o && o.datum !== null && !isDatum(o.datum)) fout.push(`datum is geen JJJJ-MM-DD (${JSON.stringify(o.datum)})`);
  if ("btw_inbegrepen" in o && o.btw_inbegrepen !== false) fout.push("btw_inbegrepen mag alleen false zijn (of weg)");
  if ("niet_leverbaar" in o && o.niet_leverbaar !== true) fout.push("niet_leverbaar mag alleen true zijn (of weg)");
  if ("niet_leverbaar_door" in o) {
    if (!["voorraad", "pagina weg"].includes(o.niet_leverbaar_door)) fout.push(`niet_leverbaar_door onbekend (${JSON.stringify(o.niet_leverbaar_door)})`);
    if (o.niet_leverbaar !== true) fout.push("niet_leverbaar_door zonder niet_leverbaar");
  }
  if ("weg_sinds" in o && !isDatum(o.weg_sinds)) fout.push("weg_sinds is geen JJJJ-MM-DD");
  if ("prijs_controle" in o && o.prijs_controle !== "handmatig") fout.push(`prijs_controle mag alleen "handmatig" zijn`);
  if ("prijs_route" in o) {
    if (!ROUTES.has(o.prijs_route)) fout.push(`prijs_route onbekend (${JSON.stringify(o.prijs_route)})`);
    // De prijsscripts van de andere twee sites geven het veld niet door.
    if (site !== "batterijmaatje") fout.push("prijs_route werkt alleen op batterijmaatje");
    if (o.prijs_route === "bij variant" && !(typeof o.prijs_variant === "string" && o.prijs_variant.trim())) {
      fout.push('prijs_route "bij variant" zonder prijs_variant');
    }
  }
  if ("ean" in o && !(typeof o.ean === "string" && /^\d{13}$/.test(o.ean))) fout.push("ean is geen tekst van 13 cijfers");
  if ("affiliate_url" in o && !isHttps(o.affiliate_url)) fout.push("affiliate_url is geen https-adres");
  return fout;
}

/** Geeft een lijst met bevindingen voor een heel productbestand. */
export function controleerBestand(data, { site, lijst }) {
  const fout = [];
  if (!data || !Array.isArray(data[lijst])) return [`lijst "${lijst}" ontbreekt`];
  if ("laatst_bijgewerkt" in data && !isDatum(data.laatst_bijgewerkt)) fout.push("laatst_bijgewerkt is geen JJJJ-MM-DD");
  const ids = new Set();
  const vast = VASTE_WAARDEN[site] || {};
  for (const [i, p] of data[lijst].entries()) {
    const naam = p && typeof p.id === "string" ? p.id : `#${i}`;
    const meld = (t) => fout.push(`${naam}: ${t}`);
    if (!p || typeof p !== "object") { meld("is geen object"); continue; }
    if (typeof p.id !== "string" || !ID.test(p.id)) meld("id mag alleen kleine letters, cijfers en koppeltekens bevatten");
    else if (ids.has(p.id)) meld("id komt twee keer voor");
    ids.add(p.id);
    for (const veld of ["merk", "model"]) if (typeof p[veld] !== "string" || !p[veld].trim()) meld(`${veld} ontbreekt`);
    if ("richtprijs_eur" in p && p.richtprijs_eur !== null && !(Number.isInteger(p.richtprijs_eur) && p.richtprijs_eur > 0)) {
      meld(`richtprijs_eur is geen positief geheel getal (${JSON.stringify(p.richtprijs_eur)})`);
    }
    if ("prijs_datum" in p && p.prijs_datum !== null && !isDatum(p.prijs_datum)) meld("prijs_datum is geen JJJJ-MM-DD");
    if ("prijs_controle" in p && p.prijs_controle !== "handmatig") meld(`prijs_controle mag alleen "handmatig" zijn`);
    for (const [veld, waarden] of Object.entries(vast)) {
      if (veld in p && p[veld] !== null && !waarden.includes(p[veld])) meld(`${veld} heeft een onbekende waarde (${JSON.stringify(p[veld])})`);
    }
    if (typeof p.afbeelding === "string" && !/^https?:\/\//.test(p.afbeelding) && site) {
      if (!existsSync(join(WORTEL, "sites", site, p.afbeelding))) meld(`afbeelding ${p.afbeelding} bestaat niet`);
    }
    if ("aanbiedingen" in p) {
      if (!Array.isArray(p.aanbiedingen)) { meld("aanbiedingen is geen lijst"); continue; }
      const winkels = new Set();
      for (const o of p.aanbiedingen) {
        for (const t of controleerAanbieding(o, site)) meld(`${o?.winkel ?? "aanbieding"}: ${t}`);
        // De winkelnaam is deel van de sleutel in prijsverloop.json en
        // prijs-aandacht.json; twee keer dezelfde winkel loopt daar door elkaar.
        if (o && winkels.has(o.winkel)) meld(`winkel "${o.winkel}" staat er twee keer`);
        if (o) winkels.add(o.winkel);
      }
    }
  }
  return fout;
}

function hoofd() {
  let totaal = 0;
  for (const b of BESTANDEN) {
    const pad = join(WORTEL, "sites", b.site, "data", b.bestand);
    const data = JSON.parse(readFileSync(pad, "utf8"));
    const fout = controleerBestand(data, b);
    totaal += fout.length;
    if (fout.length) {
      console.error(`\n${b.site}/data/${b.bestand}: ${fout.length} bevinding(en)`);
      for (const f of fout) console.error(`  - ${f}`);
    } else {
      console.log(`${b.site}/data/${b.bestand}: in orde (${data[b.lijst].length} producten)`);
    }
  }
  if (totaal) {
    console.error(`\n${totaal} bevinding(en). Zie DATASCHEMA.md voor wat elk veld mag bevatten.`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) hoofd();
