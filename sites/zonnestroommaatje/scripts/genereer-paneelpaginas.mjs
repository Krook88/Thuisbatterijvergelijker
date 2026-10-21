#!/usr/bin/env node
/**
 * Genereert statische detailpagina's per zonnepaneel in /paneel/<id>.html
 * op basis van data/panelen.json, plus de overzichtspagina's (klein dak,
 * glas-glas), de vergelijkingspagina's (X vs Y) en sitemap.xml.
 *
 * Wordt lokaal gedraaid bij wijzigingen en periodiek door de
 * prijsupdate-workflow, zodat prijzen op de pagina's actueel blijven.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { paginaStand, lastmodMaker } from "./sitemap-datum.mjs";
import { houdbaarTot } from "./prijs-houdbaarheid.mjs";
import { verdeel, verborgenPagina, aantalWinkels } from "./zichtbaar.mjs";
import { zetStatistiekOveral } from "./statistiek.mjs";
import * as Uitleg from "./uitleg.mjs";
import { deelbeeldMaker, delenHtml } from "./delen.mjs";

// Dezelfde icoonset als de browser gebruikt, zodat een icoon op een
// gegenereerde pagina identiek is aan datzelfde icoon in de vergelijker.
const vereis = createRequire(import.meta.url);
const Iconen = vereis("../assets/iconen.js");
// En dezelfde prijslogica als de browser, zodat een bedrag op een
// gegenereerde pagina niet anders kan uitpakken dan in de vergelijker.
const Prijs = vereis("../assets/prijs.js");
// En dezelfde kaartopmaak, zodat de voorgerenderde kaarten in index.html niet
// kunnen afwijken van wat de browser tekent.
const Kaart = vereis("../assets/kaart.js");
const PrijsGrafiek = vereis("../assets/prijsgrafiek.js");
PrijsGrafiek.laad(JSON.parse(readFileSync(new URL("../data/prijsverloop.json", import.meta.url), "utf8")));

/* ------------------------------------------------------------------
   Titels en omschrijvingen binnen de ruimte die Google toont

   Google kapt een titel af rond de 60 tekens en een omschrijving rond de 155.
   Wat daarna komt ziet niemand, en juist het achtervoegsel met de sitenaam
   duwde hier de inhoud eruit: " | Zonnestroommaatje" kost al 20 tekens.

   Dezelfde aanpak als op batterijmaatje: de naam staat vooraan want daar zoekt
   de bezoeker op, en het achtervoegsel wijkt als het niet past. besteTitel
   krijgt varianten van lang naar kort en pakt de eerste die past.
   ------------------------------------------------------------------ */

const TITEL_MAX = 60;
const OMSCHRIJVING_MAX = 155;
const MERK_ACHTERVOEGSEL = " | Zonnestroommaatje";

function titelMetMerk(kern) {
  return kern.length + MERK_ACHTERVOEGSEL.length <= TITEL_MAX ? kern + MERK_ACHTERVOEGSEL : kern;
}

function besteTitel(varianten) {
  for (const variant of varianten) {
    const metMerk = titelMetMerk(variant);
    if (metMerk.length <= TITEL_MAX) return metMerk;
  }
  return varianten[varianten.length - 1];
}

function kortOmschrijving(tekst, maximum = OMSCHRIJVING_MAX) {
  if (tekst.length <= maximum) return tekst;
  const geknipt = tekst.slice(0, maximum - 1);
  const spatie = geknipt.lastIndexOf(" ");
  return (spatie > maximum * 0.6 ? geknipt.slice(0, spatie) : geknipt).replace(/[,.;:]$/, "") + "\u2026";
}


const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SITE = "https://zonnestroommaatje.nl";
const deelbeeld = deelbeeldMaker(ROOT, SITE);
const VANDAAG = new Date().toISOString().slice(0, 10);
/* Het jaartal in een titel is een verskeurmerk: "(2026)" nodigt uit tot
   klikken zolang het 2026 is, en werkt op 1 januari tegen ons. Daarom komt het
   uit de kalender en niet uit de tekst - de dagelijkse prijsrun bouwt deze
   pagina's toch al opnieuw, dus rolt het vanzelf om.

   Alleen voor titels die "de stand van nu" betekenen. Een jaartal dat bij een
   wet of een subsidiebedrag hoort blijft staan waar het staat: dat is een
   feit, geen keurmerk, en dat mag niet meebewegen. */
const JAAR = new Date().getFullYear();
/* Versienummer achter css/js-links: dwingt browsers om na een wijziging het
   nieuwe bestand op te halen in plaats van een oude kopie uit de cache.

   Het stond hier als losse constante, en dat ging een keer mis: de stylesheet
   werd verbouwd, de handgeschreven pagina's kregen een nieuw nummer, en de
   pagina's die dit script maakt zetten er stilletjes het oude nummer weer in.
   Bezoekers kregen daardoor nieuwe HTML met een stylesheet van maximaal zeven
   dagen oud - hier leverde dat een onleesbare link op in de opening.

   Nu is style.css de enige plek waar het nummer staat: dit script leest het
   daar uit de @import. Bumpen doe je dus in style.css, en dan pakt zowel de
   pagina als de generator hetzelfde op. kern-verdelen --controleer bewaakt
   dat ze gelijk blijven. */
function assetVersie() {
  const css = readFileSync(resolve(ROOT, "assets/style.css"), "utf8");
  const m = css.match(/@import url\("[^"]*\.css\?v=([A-Za-z0-9]+)"\)/);
  if (!m) throw new Error("Geen ?v= gevonden in de @import van assets/style.css.");
  return m[1];
}

const ASSET_VERSIE = assetVersie();

const data = JSON.parse(readFileSync(resolve(ROOT, "data/panelen.json"), "utf8"));
const omvormerData = JSON.parse(readFileSync(resolve(ROOT, "data/omvormers.json"), "utf8"));

/* Alleen panelen en omvormers met een prijs die in de afgelopen 14 weken
   bevestigd is staan op de site; zie kern/scripts/zichtbaar.mjs. Vanaf hier
   ziet het script alleen die lijsten, en de browser krijgt ze via data/site/. */
const { zichtbaar: ZICHTBAAR, verborgen: VERBORGEN } = verdeel(data.panelen || [], VANDAAG);
data.panelen = ZICHTBAAR;
const omvormerVerdeling = verdeel(omvormerData.omvormers || [], VANDAAG);
omvormerData.omvormers = omvormerVerdeling.zichtbaar;
for (const { product, reden } of [...VERBORGEN, ...omvormerVerdeling.verborgen]) console.log(`  ~ ${product.id} staat er niet op: ${reden}`);

/* De stand van de pagina's vóór dit script ze overschrijft. Daarmee kan de
   sitemap straks zeggen welke pagina's echt veranderd zijn, in plaats van elke
   dag alles als vers te melden. Zie kern/scripts/sitemap-datum.mjs. */
const STAND_VOOR = paginaStand(ROOT);
mkdirSync(resolve(ROOT, "paneel"), { recursive: true });

/* ------------------------------------------------------------------ */

// Interne links worden relatief gemaakt aan de hand van de map-diepte van de
// pagina. Zo werkt de site zowel op het eigen domein (zonnestroommaatje.nl)
// als op een preview-URL of in een submap.
const relativeer = (html, diepte) => {
  const prefix = diepte > 0 ? "../".repeat(diepte) : "";
  return html.replaceAll('href="/', `href="${prefix}`).replaceAll('src="/', `src="${prefix}`);
};

const esc = (s) => String(s == null ? "" : s)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const eur = (n) => "€ " + Number(n).toLocaleString("nl-NL", { maximumFractionDigits: 0 });
const eurWp = (n) => "€ " + Number(n).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nl = (n) => String(n).replace(".", ",");
// Hele getallen met een punt als duizendtalscheiding: 3783 leest als 3.783.
const getal = (n) => Number(n).toLocaleString("nl-NL", { maximumFractionDigits: 0 });

// ISO-datum (2026-07-21) leesbaar maken als "21 juli 2026"
const datumNL = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
};

const bestePrijs = (p) => Prijs.beste(p);
const prijsPerWp = (p) => Prijs.prijsPerWp(p);

const CELTYPE_LABEL = {
  "topcon": "TOPCon (N-type)",
  "hjt": "HJT (heterojunctie)",
  "back-contact": "Back-contact",
  "perc": "PERC",
};
const celtypeLabel = (p) => CELTYPE_LABEL[p.celtype] || p.celtype;

// Zeker-score: zelfde formule als assets/app.js en uitleg.html#zeker-score.
// Productgarantie, vermogensbehoud na 25 jaar en glas-glas tellen elk 0-2 punten.
function zekerScore(p) {
  let score = 0;
  const g = p.garantie_product_jaar || 0;
  score += g >= 25 ? 2 : g >= 20 ? 1 : 0;
  const b = p.vermogen_behoud_25j_pct || 0;
  score += b >= 90 ? 2 : b >= 88.5 ? 1 : 0;
  score += p.uitvoering === "glas-glas" ? 2 : 0;
  return score;
}

/* Hoe een paneel het doet tegenover de rest van de vergelijker. Een
   datasheet staat overal; de plaats tussen de andere panelen staat alleen
   hier, en die verschuift vanzelf mee als er panelen of prijzen bijkomen. */
const MAATSTAVEN = [
  { naam: "Prijs per Wp", waarde: (p) => prijsPerWp(p), hoger: false, toon: (v) => eurWp(v) },
  { naam: "Rendement", waarde: (p) => p.rendement_pct, hoger: true, toon: (v) => `${nl(v)}%` },
  { naam: "Productgarantie", waarde: (p) => p.garantie_product_jaar, hoger: true, toon: (v) => `${v} jaar` },
  { naam: "Vermogen na 25 jaar", waarde: (p) => p.vermogen_behoud_25j_pct, hoger: true, toon: (v) => `${nl(v)}%` },
  { naam: "Warmteverlies per °C", waarde: (p) => p.temp_coefficient, hoger: true, toon: (v) => `${nl(v)}%` },
];

function verhoudingHtml(p) {
  const rijen = MAATSTAVEN.map((m) => {
    const eigen = m.waarde(p);
    const met = data.panelen.filter((x) => typeof m.waarde(x) === "number");
    if (typeof eigen !== "number" || met.length < 3) return null;
    const beter = (a, b) => (m.hoger ? a > b : a < b);
    const plaats = 1 + met.filter((x) => beter(m.waarde(x), eigen)).length;
    const top = met.reduce((a, b) => (beter(m.waarde(b), m.waarde(a)) ? b : a));
    return { m, eigen, plaats, n: met.length, top };
  }).filter(Boolean);
  if (!rijen.length) return "";
  const sterkst = rijen.reduce((a, b) => (b.plaats / b.n < a.plaats / a.n ? b : a));
  const zwakst = rijen.reduce((a, b) => (b.plaats / b.n > a.plaats / a.n ? b : a));
  const eigenPerWp = prijsPerWp(p);
  const voordeliger = eigenPerWp ? data.panelen
    .filter((x) => x.id !== p.id && prijsPerWp(x) && prijsPerWp(x) < eigenPerWp && (x.rendement_pct || 0) >= (p.rendement_pct || 0))
    .sort((a, b) => prijsPerWp(a) - prijsPerWp(b)).slice(0, 2) : [];
  const naam = esc(volledigeNaam(p));
  const link = (x) => `de <a href="/paneel/${esc(x.id)}.html">${esc(volledigeNaam(x))}</a> (${eurWp(prijsPerWp(x))} per Wp, ${nl(x.rendement_pct)}%)`;
  return `<h2>Zo verhoudt hij zich tot de andere ${data.panelen.length - 1}</h2>
  <div class="tabel-wrap">
    <table class="vergelijk-tabel compact">
      <thead><tr><th>Eigenschap</th><th>Dit paneel</th><th>Plaats</th><th>Beste in de vergelijker</th></tr></thead>
      <tbody>${rijen.map((r) => `
        <tr><td>${r.m.naam}</td><td>${r.m.toon(r.eigen)}</td><td>${r.plaats} van ${r.n}</td><td>${r.plaats === 1 ? "dit paneel" : `<a href="/paneel/${esc(r.top.id)}.html">${esc(volledigeNaam(r.top))}</a>, ${r.m.toon(r.m.waarde(r.top))}`}</td></tr>`).join("")}
      </tbody>
    </table>
  </div>
  <p>Het sterkste punt van de ${naam} is ${sterkst.m.naam.toLowerCase()} (plaats ${sterkst.plaats} van ${sterkst.n}), het zwakste ${zwakst.m.naam.toLowerCase()} (plaats ${zwakst.plaats} van ${zwakst.n}). ${voordeliger.length
    ? `Per wattpiek goedkoper met minstens hetzelfde rendement zijn ${voordeliger.map(link).join(" en ")}.`
    : `Geen enkel ander paneel in de vergelijker is per wattpiek goedkoper met minstens hetzelfde rendement van ${nl(p.rendement_pct)}%.`}</p>`;
}

function zekerScoreBadge(p) {
  const score = zekerScore(p);
  const klasse = score >= 5 ? "zeker-hoog" : score >= 3 ? "zeker-midden" : "zeker-laag";
  return `<span class="badge zeker-score ${klasse}" title="Punten voor productgarantie, vermogensbehoud en glas-glas">${Iconen.svg("veiligheid")} Zeker-score ${score}/6</span>`;
}

// Sterren voor opbrengst per m² dak: zelfde drempels als assets/app.js
function dakSterren(p) {
  const r = p.rendement_pct || 0;
  return r >= 22.8 ? 5 : r >= 22.4 ? 4 : r >= 22.0 ? 3 : r >= 21.5 ? 2 : 1;
}

/* Eén vorm voor elk oordeel op een schaal, gelijk aan de kaart en de tabel.
   Sterren stonden hier eerder; die lezen als een recensiecijfer van gebruikers
   terwijl dit een rekensom is die op uitleg.html wordt uitgelegd. */
function waardering(score, max) {
  const n = Math.max(0, Math.min(max, Math.round(Number(score) || 0)));
  const deel = n / max;
  const niveau = deel >= 0.8 ? "hoog" : deel >= 0.5 ? "midden" : "laag";
  return `<span class="waardering niveau-${niveau}" role="img" aria-label="${n} van ${max}"><b>${n}</b><span class="van">/${max}</span></span>`;
}

function sterren(score) {
  const s = Math.max(0, Math.min(5, Math.round(score || 0)));
  // Gevulde en lege ster komen uit dezelfde icoonset, zodat ze precies
  // dezelfde vorm hebben in plaats van twee losse tekens.
  const ster = (gevuld) => Iconen.svg("ster", { gevuld });
  return `<span class="sterren-rij" role="img" aria-label="${s} van 5 sterren">${ster(true).repeat(s)}${ster(false).repeat(5 - s)}</span>`;
}

// Merklogo: officiële logo's uit assets/logos/, geregistreerd in data (merk_logos)
function merkLogoHtml(merk) {
  const logo = (data.merk_logos || {})[merk];
  return logo ? `<img class="merk-logo" src="/${esc(logo)}" alt="" loading="lazy"> ` : "";
}

// Mini-illustraties per celtype, in de huisstijl (nachtblauw, lucht, amber).
// Eigen tekeningen, dus geen rechtenkwesties.
function typeIllustratie(celtype) {
  const paneel = (x, y, extra = "") => `
      <rect x="${x}" y="${y}" width="64" height="44" rx="4" fill="#0b3a5c" ${extra}/>
      <line x1="${x + 21}" y1="${y + 2}" x2="${x + 21}" y2="${y + 42}" stroke="#7dd3fc" stroke-width="2"/>
      <line x1="${x + 43}" y1="${y + 2}" x2="${x + 43}" y2="${y + 42}" stroke="#7dd3fc" stroke-width="2"/>
      <line x1="${x + 2}" y1="${y + 22}" x2="${x + 62}" y2="${y + 22}" stroke="#7dd3fc" stroke-width="2"/>`;
  const zon = `
      <circle cx="34" cy="30" r="13" fill="#fbbf24"/>
      <g stroke="#f59e0b" stroke-width="3.5" stroke-linecap="round">
        <line x1="34" y1="9" x2="34" y2="14"/><line x1="18" y1="16" x2="22" y2="20"/>
        <line x1="50" y1="16" x2="46" y2="20"/><line x1="13" y1="30" x2="18" y2="30"/>
        <line x1="55" y1="30" x2="50" y2="30"/>
      </g>`;
  const svgs = {
    "topcon": `<svg viewBox="0 0 170 120" role="img" aria-label="TOPCon-paneel: de huidige standaard met hoog rendement" class="type-illustratie">
      ${zon}${paneel(70, 55)}
      <text x="14" y="110" font-size="11" font-weight="700" fill="#0b3a5c">TOPCon: de standaard</text>
    </svg>`,
    "hjt": `<svg viewBox="0 0 170 120" role="img" aria-label="HJT-paneel: presteert het best bij warmte" class="type-illustratie">
      ${zon}${paneel(70, 55)}
      <path d="M 96 40 q 4 -8 0 -14 M 106 42 q 4 -8 0 -14 M 116 40 q 4 -8 0 -14" fill="none" stroke="#f59e0b" stroke-width="3" stroke-linecap="round"/>
      <text x="14" y="110" font-size="11" font-weight="700" fill="#0b3a5c">HJT: sterk bij warmte</text>
    </svg>`,
    "back-contact": `<svg viewBox="0 0 170 120" role="img" aria-label="Back-contact paneel: contacten aan de achterkant, egaal zwart en hoogste rendement" class="type-illustratie">
      ${zon}
      <rect x="70" y="55" width="64" height="44" rx="4" fill="#111827"/>
      <rect x="70" y="55" width="64" height="44" rx="4" fill="none" stroke="#374151" stroke-width="2"/>
      <text x="14" y="110" font-size="11" font-weight="700" fill="#0b3a5c">strak, egaal zwart</text>
    </svg>`,
    "perc": `<svg viewBox="0 0 170 120" role="img" aria-label="PERC-paneel: de vorige generatie" class="type-illustratie">
      ${zon}${paneel(70, 55)}
      <text x="14" y="110" font-size="11" font-weight="700" fill="#0b3a5c">PERC: vorige generatie</text>
    </svg>`,
  };
  return svgs[celtype] || "";
}

/* ------------------------------------------------------------------ */

const paneelById = Object.fromEntries(data.panelen.map((p) => [p.id, p]));
// "Denim" + model "Denim 440 Wp" wordt anders "Denim Denim 440 Wp"
const volledigeNaam = (p) => p.model.toLowerCase().startsWith(p.merk.toLowerCase()) ? p.model : `${p.merk} ${p.model}`;


/* Winkels die dit artikel nog voeren.
 *
 * Hier stond `p.aanbiedingen` onverkort, en dat betekende dat een winkel die
 * het artikel niet meer verkoopt gewoon onder "Verkrijgbaar bij" bleef staan,
 * met een werkende link erbij. Bij de AEG SolarCube wees die naar een pagina
 * van AH die doorverwijst naar de homepage; bij de Canadian Solar naar een 404.
 * De markup eronder klopte wel - die gebruikt Prijs.geldigeAanbiedingen - dus
 * de pagina sprak zichzelf tegen: geen aanbieding in de structured data, wel
 * een winkel in de lijst.
 *
 * Niet Prijs.geldigeAanbiedingen gebruiken: die eist ook een bedrag, en een
 * winkel zonder bedrag is hier wel degelijk een adres waar je terecht kunt.
 * Die krijgt "(prijsindicatie; klik voor de actuele prijs)" mee. */
function teKoop(product) {
  return (product.aanbiedingen || []).filter((a) => a && !Prijs.nietLeverbaar(a));
}

/* De winkels voor de tabel onder het prijsverloop. Ook een winkel die het
 * artikel niet meer voert staat erin, zonder link (die wees bij zo'n winkel
 * naar een 404 of de homepage) maar met de prijs die hij het laatst vroeg.
 * Daarmee is de oude lijst "Verkrijgbaar bij" opgegaan in deze tabel. */
function winkelRijen(product) {
  return (product.aanbiedingen || []).filter((a) => a && a.winkel && !a.is_richtprijs).map((a) => ({
    winkel: a.winkel,
    url: a.affiliate_url || a.url,
    sponsored: !!a.affiliate_url,
    leverbaar: !Prijs.nietLeverbaar(a),
    prijs: Prijs.nietLeverbaar(a) ? null : Prijs.vergelijkPrijs(a),
    datum: a.datum,
    toelichting: [a.omvat, Prijs.isOmgerekend(a) ? `de winkel noemt ${eur(a.prijs_eur)} excl. btw` : ""].filter(Boolean).join("; "),
  }));
}

function productLd(p) {
  // Prijs.geldigeAanbiedingen en niet een eigen filter: dat sluit ook de
  // aanbiedingen uit die de winkel niet meer voert.
  const offers = Prijs.geldigeAanbiedingen(p);
  const ld = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": `${volledigeNaam(p)}`,
    ...(p.afbeelding ? { "image": /^https?:/i.test(p.afbeelding) ? p.afbeelding : `${SITE}/${p.afbeelding.replace(/^\//, "")}` } : {}),
    "brand": { "@type": "Brand", "name": p.merk },
    "description": `${volledigeNaam(p)}: zonnepaneel van ${p.vermogen_wp} Wp met ${nl(p.rendement_pct)}% rendement. ${p.opmerkingen || ""}`.slice(0, 300),
    "url": `${SITE}/paneel/${p.id}.html`,
  };
  if (offers.length === 1) {
    ld.offers = {
      "@type": "Offer",
      "price": Prijs.vergelijkPrijs(offers[0]),
      "priceCurrency": "EUR",
      "url": offers[0].url,
      "availability": "https://schema.org/InStock",
      "itemCondition": "https://schema.org/NewCondition",
      ...(houdbaarTot(offers[0].datum || p.prijs_datum) ? { "priceValidUntil": houdbaarTot(offers[0].datum || p.prijs_datum) } : {}),
    };
  } else if (offers.length > 1) {
    const prijzen = offers.map((o) => Prijs.vergelijkPrijs(o));
    ld.offers = {
      "@type": "AggregateOffer",
      "lowPrice": Math.min(...prijzen),
      "highPrice": Math.max(...prijzen),
      "priceCurrency": "EUR",
      "offerCount": offers.length,
      "availability": "https://schema.org/InStock",
      "itemCondition": "https://schema.org/NewCondition",
      ...(houdbaarTot(p.prijs_datum) ? { "priceValidUntil": houdbaarTot(p.prijs_datum) } : {}),
    };
  }
  return JSON.stringify(ld, null, 2);
}

// BreadcrumbList voor de productpagina (Zonnepanelen › <paneel>)
function breadcrumbLd(p) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Zonnepanelen", "item": `${SITE}/` },
      { "@type": "ListItem", "position": 2, "name": volledigeNaam(p), "item": `${SITE}/paneel/${p.id}.html` },
    ],
  }, null, 2);
}

const NAV = `
<header class="site-header">
  <div class="container">
    <a class="logo" href="/">
      <span class="logo-icoon">${Iconen.svg("zon")}</span>
      <span>Zonnestroom<b>maatje</b></span>
    </a>
    <button class="menu-knop" type="button" aria-expanded="false" aria-controls="hoofdnav" aria-label="Menu openen"><svg class="icoon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></svg></button>
    <nav class="hoofdnav" id="hoofdnav">
      <a href="/">Zonnepanelen</a>
      <a href="/omvormers.html">Omvormers</a>
      <a href="/systeem.html">Samenstellen</a>
      <a href="/advies.html">Keuzehulp</a>
      <a href="/rekenmodule.html">Terugverdientijd</a>
      <details class="nav-meer">
        <summary>Meer ${Iconen.svg("chevron")}</summary>
        <div class="nav-meer-paneel">
          <a href="/energieplan.html">Jouw energieplan</a>
          <a href="/uitleg.html">Uitleg</a>
          <a href="/waar-zonnepanelen-kopen.html">Waar koop je panelen?</a>
          <a href="/hebben-zonnepanelen-nog-zin.html">Loont het nog?</a>
          <a href="/regelgeving.html">Regels &amp; subsidies</a>
          <a href="/beste-zonnepanelen-klein-dak.html">Beste voor een klein dak</a>
          <a href="/beste-glas-glas-zonnepanelen.html">Beste glas-glas panelen</a>
          <a href="/over-ons.html">Over mij</a>
          <a href="/contact.html">Contact</a>
          <a href="/steun.html" class="nav-steun"><svg class="icoon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2v2" /> <path d="M14 2v2" /> <path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1" /> <path d="M6 2v2" /></svg> Steun deze site</a>
        </div>
      </details>
    </nav>
  </div>
</header>`;

const FOOTER = `
<footer class="site-footer">
  <div class="container">
    <b>${Iconen.svg("zon")} Zonnestroommaatje</b>
    <p>Onafhankelijke vergelijking van zonnepanelen voor Nederlandse huishoudens. Zustersite van <a href="https://batterijmaatje.nl/" target="_blank" rel="noopener">Batterijmaatje.nl</a> (thuisbatterijen) en <a href="https://warmtepompmaatje.nl/" target="_blank" rel="noopener">Warmtepompmaatje</a> (warmtepompen).</p>
    <p><a href="/">Zonnepanelen</a> · <a href="/omvormers.html">Omvormers</a> · <a href="/systeem.html">Samenstellen</a> · <a href="/advies.html">Keuzehulp</a> · <a href="/rekenmodule.html">Terugverdientijd</a> · <a href="/energieplan.html">Jouw energieplan</a> · <a href="/uitleg.html">Uitleg</a> · <a href="/waar-zonnepanelen-kopen.html">Waar koop je panelen?</a> · <a href="/hebben-zonnepanelen-nog-zin.html">Loont het nog?</a> · <a href="/regelgeving.html">Regels &amp; subsidies</a> · <a href="/#veelgestelde-vragen">Veelgestelde vragen</a> · <a href="/beste-zonnepanelen-klein-dak.html">Beste voor een klein dak</a> · <a href="/beste-glas-glas-zonnepanelen.html">Beste glas-glas panelen</a> · <a href="/over-ons.html">Over mij</a> · <a href="/contact.html">Contact</a> · <a href="/steun.html">Steun deze site</a> · <a href="/privacy.html">Privacy &amp; disclaimer</a></p>
    <p class="disclaimer">Disclaimer: prijzen en specificaties veranderen regelmatig; er kunnen geen rechten aan worden ontleend. Prijzen zijn indicatief; de prijs en voorwaarden op de website van de aanbieder zijn altijd leidend.</p>
  </div>
</footer>`;

// Wikkelt een of meer JSON-LD-strings elk in een eigen <script>-blok
const wrapLd = (...jsons) => jsons.filter(Boolean).map((j) => `<script type="application/ld+json">\n${j}\n  </script>`).join("\n  ");

function kop(titel, metaDesc, canoniek, ld = "", product = null) {
  // titel mag een reeks varianten zijn, van lang naar kort: besteTitel pakt de
  // eerste die binnen de ruimte van Google past. Een enkele string blijft
  // werken en krijgt hooguit het achtervoegsel als het past.
  const paginaTitel = Array.isArray(titel) ? besteTitel(titel) : titelMetMerk(titel);
  const socialTitel = Array.isArray(titel) ? titel[0] : titel;
  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(paginaTitel)}</title>
  <meta name="description" content="${esc(kortOmschrijving(metaDesc))}">
  <link rel="canonical" href="${canoniek}">
  <meta property="og:title" content="${esc(socialTitel)}">
  <meta property="og:description" content="${esc(metaDesc)}">
  <meta property="og:type" content="${product ? "product" : "website"}">
  <meta property="og:url" content="${canoniek}">
  <meta property="og:locale" content="nl_NL">
  ${product ? deelbeeld(product.id, product.alt) : `<meta property="og:image" content="${SITE}/assets/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">`}
  <meta property="og:site_name" content="Zonnestroommaatje.nl">
  <meta name="twitter:card" content="summary_large_image">
  ${ld}
  <script>document.documentElement.classList.add("js")</script>
  <link rel="stylesheet" href="/assets/style.css?v=${ASSET_VERSIE}">
  <link rel="icon" href="/assets/favicon.svg?v=1" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png?v=1">
</head>
<body>
${NAV}`;
}

const staart = `
${FOOTER}

<script src="/assets/prijsgrafiek.js?v=${ASSET_VERSIE}" defer></script>
<script src="/assets/nav.js?v=${ASSET_VERSIE}" defer></script>
</body>
</html>
`;

// Productpagina's krijgen de deelknoppen; die hebben assets/delen.js nodig.
const staartProduct = staart.replace("</body>", `<script src="/assets/delen.js?v=${ASSET_VERSIE}" defer></script>\n</body>`);

/* ------------------------------------------------------------------
   Productpagina per paneel
   ------------------------------------------------------------------ */

function pagina(p) {
  const beste = bestePrijs(p);
  const perWp = prijsPerWp(p);
  const wpPerM2 = p.rendement_pct ? Math.round(p.rendement_pct * 10) : null;
  // Indicatieve jaaropbrengst per paneel (kWh) voor twee gangbare daken
  const opbrengstZuid = Math.round(p.vermogen_wp * 0.9);
  const opbrengstOW = Math.round(p.vermogen_wp * 0.8);

  const metaDesc = `${volledigeNaam(p)}: zonnepaneel van ${p.vermogen_wp} Wp met ${nl(p.rendement_pct)}% rendement` +
    (beste ? `, richtprijs ${eur(Prijs.vergelijkPrijs(beste))}` : "") +
    `. Bekijk specificaties, garanties, Zeker-score en bereken de opbrengst voor jouw dak.`;

  const specRij = (label, waarde) => waarde == null || waarde === "" ? "" :
    `<tr><th>${esc(label)}</th><td>${waarde}</td></tr>`;

  return `${kop(
    /* Paneelnamen zijn lang - "DMEGC DM450M10RT-B54HBT 450 Wp Full Black
       (glas-glas)" is er in zijn eentje al 53 - en daardoor viel de ladder bij
       elf van de veertien panelen door tot de kale naam. Een titel zonder
       "prijs" erin mist precies het woord waarop iemand zoekt die dit paneel
       al bij naam kent. Deze sport past bij dertien van de veertien. */
    [`${volledigeNaam(p)}: prijs, specificaties en garantie`,
     `${volledigeNaam(p)}: prijs en specificaties`,
     `${volledigeNaam(p)}: prijs`,
     volledigeNaam(p)],
    metaDesc,
    `${SITE}/paneel/${esc(p.id)}.html`,
    wrapLd(productLd(p), breadcrumbLd(p)),
    { id: p.id, alt: `${volledigeNaam(p)}, zonnepaneel van ${p.vermogen_wp} Wp` }
  )}

<main class="content-pagina">

  <p class="datum-stempel"><a href="/">Zonnepanelen</a> › ${esc(volledigeNaam(p))}</p>
  <div class="product-kop">
    <div class="product-kop-tekst">
      <h1>${merkLogoHtml(p.merk)}${esc(volledigeNaam(p))}</h1>
      <p class="intro">${esc(celtypeLabel(p))} zonnepaneel van ${p.vermogen_wp} Wp, ${esc(p.uitvoering)}${p.full_black ? ", full black" : ""}${p.bifaciaal ? ", bifaciaal" : ""}. Prijzen laatst gecontroleerd op ${esc(datumNL(p.prijs_datum || data.laatst_bijgewerkt))}.</p>
    </div>
    ${p.afbeelding
      ? `<div class="kaart-foto paneel-foto-groot">
      <img src="/${esc(p.afbeelding.replace(/^\//, ""))}" alt="${esc(volledigeNaam(p))}" loading="lazy" decoding="async" width="900" height="600">
      ${p.afbeelding_bron ? `<span class="foto-bron">${esc(p.afbeelding_bron)}</span>` : ""}
    </div>`
      : typeIllustratie(p.celtype)}
  </div>

  <div class="info-kader">
    ${beste ? `<div class="info-prijs">${eur(Prijs.vergelijkPrijs(beste))} <span class="info-prijs-bron">${perWp ? `${eurWp(perWp)} per Wp` : ""} · ${esc(beste.winkel)}</span></div>` : "<div><b>Prijs op aanvraag</b></div>"}
    ${p.prijs_omvat ? `<div class="info-dekking">${esc(p.prijs_omvat)}</div>` : ""}
    <p class="info-acties">
      ${beste && beste.url && !String(beste.winkel || "").startsWith("richtprijs") ? `<a class="knop" href="${esc(beste.affiliate_url || beste.url)}" target="_blank" rel="noopener${beste.affiliate_url ? " sponsored" : ""}">Bekijk bij ${esc(beste.winkel)} ${Iconen.svg("pijl-rechts")}</a>&nbsp;` : ""}
      <a class="knop knop-secundair" href="/rekenmodule.html?paneel=${encodeURIComponent(p.id)}">Bereken terugverdientijd</a>
    </p>
  </div>

  ${delenHtml({
    url: `${SITE}/paneel/${p.id}.html`,
    bericht: `Kijk, de ${volledigeNaam(p)}: ${p.vermogen_wp} Wp, ${nl(p.rendement_pct)}% rendement${beste ? `, vanaf ${eur(Prijs.vergelijkPrijs(beste))}` : ""}. Prijzen per winkel en garantie:`,
  })}

  ${(() => {
    const g = PrijsGrafiek.grafiekHtml(p.id, { naam: `${p.merk} ${p.model}` });
    const t = PrijsGrafiek.winkelTabel(p.id, winkelRijen(p));
    if (!g && !t) return "";
    return `<h2>${g ? "Prijsverloop" : "Prijzen per winkel"}</h2>
  ${g}${g && t ? `\n  <h3>Prijzen per winkel</h3>` : ""}
  ${t}${t ? `\n  <p class="datum-stempel">De prijs op de website van de winkel is altijd leidend.${teKoop(p).some((a) => a.affiliate_url) ? " Sommige links zijn commissielinks: koop je via die link, dan ontvang ik een kleine vergoeding van de winkel. Dit kost jou niets en beïnvloedt mijn scores en volgorde niet." : ""}</p>` : ""}`;
  })()}

  <h2>Specificaties</h2>
  <div class="tabel-blok">
  <table class="data-tabel spec-tabel">
    ${specRij("Vermogen", `${p.vermogen_wp} <a class="term-link" href="/uitleg.html#wattpiek" title="Wat is wattpiek? Lees de uitleg">Wp</a>`)}
    ${specRij("Rendement", `${nl(p.rendement_pct)}%${wpPerM2 ? ` <small>(circa ${wpPerM2} Wp per m²)</small>` : ""}`)}
    ${specRij("Celtype", `<a class="term-link" href="/uitleg.html#${esc(p.celtype)}" title="Wat betekent dit celtype? Lees de uitleg">${esc(celtypeLabel(p))}</a>`)}
    ${specRij("Uitvoering", `<a class="term-link" href="/uitleg.html#glas-glas" title="Glas-glas of glas-folie? Lees de uitleg">${esc(p.uitvoering)}</a>`)}
    ${specRij("Full black", p.full_black ? "Ja" : "Nee")}
    ${specRij("Bifaciaal", p.bifaciaal ? `Ja <small>(<a class="term-link" href="/uitleg.html#bifaciaal">wat is dat?</a>)</small>` : "Nee")}
    ${specRij("Afmetingen", p.afmetingen_mm ? `${esc(p.afmetingen_mm)} mm` : null)}
    ${specRij("Gewicht", p.gewicht_kg ? `circa ${nl(p.gewicht_kg)} kg` : null)}
    ${specRij("Temperatuurcoëfficiënt", p.temp_coefficient ? `<a class="term-link" href="/uitleg.html#temperatuurcoefficient">${nl(p.temp_coefficient)}% per °C</a> <small>(dichter bij nul is beter)</small>` : null)}
    ${specRij("Productgarantie", p.garantie_product_jaar ? `${p.garantie_product_jaar} jaar` : null)}
    ${specRij("Vermogensgarantie", p.garantie_vermogen_jaar ? `${p.garantie_vermogen_jaar} jaar; minimaal ${nl(p.vermogen_behoud_eind_pct || "?")}% aan het einde` : null)}
    ${specRij("Vermogensbehoud na 25 jaar", p.vermogen_behoud_25j_pct ? `circa ${nl(p.vermogen_behoud_25j_pct)}% (volgens fabrieksgarantie)` : null)}
  </table>
  </div>
  <p class="datum-stempel">Onbekende term (zoals Wp of bifaciaal)? Alle woorden staan uitgelegd in de <a href="/uitleg.html#woordenlijst">woordenlijst</a>. Specificaties op basis van de fabrikantendatasheet; controleer vóór aankoop de actuele versie.</p>

  <h2>Wat levert dit paneel op?</h2>
  <p>${waardering(dakSterren(p), 5)} <span class="waardering-uitleg">opbrengst per m² dak</span></p>
  <p>Op een gunstig zuiddak levert dit paneel circa <b>${opbrengstZuid} kWh per jaar</b>; op een oost-westdak circa <b>${opbrengstOW} kWh</b>. Tien panelen komen dan uit op zo'n ${Math.round(opbrengstZuid * 10 / 100) * 100} respectievelijk ${Math.round(opbrengstOW * 10 / 100) * 100} kWh per jaar. <a href="/rekenmodule.html?paneel=${encodeURIComponent(p.id)}">Bereken de opbrengst en terugverdientijd voor jouw situatie</a>.</p>

  <h2>Degelijkheid en garanties</h2>
  <p class="badge-rij">${zekerScoreBadge(p)}
    <span class="badge ${p.uitvoering === "glas-glas" ? "ja" : "nee"}">${p.uitvoering === "glas-glas" ? "" + Iconen.svg("ja") + "" : "" + Iconen.svg("nee") + ""} Glas-glas</span>
    <span class="badge ${(p.garantie_product_jaar || 0) >= 25 ? "ja" : "nee"}">${(p.garantie_product_jaar || 0) >= 25 ? "" + Iconen.svg("ja") + "" : "" + Iconen.svg("nee") + ""} 25+ jaar productgarantie</span>
  </p>
  <p class="datum-stempel">De <a href="/uitleg.html#zeker-score">Zeker-score</a> telt productgarantie, vermogensbehoud na 25 jaar en glas-glas uitvoering op: 2 punten per onderdeel.</p>

  ${p.opmerkingen ? `<h2>Goed om te weten</h2><p>${esc(p.opmerkingen)}</p>` : ""}

  ${verhoudingHtml(p)}

  ${VERGELIJKINGEN.filter((v) => v.a === p.id || v.b === p.id).length ? `<h2>Vergelijk met alternatieven</h2>
  <ul>
    ${VERGELIJKINGEN.filter((v) => v.a === p.id || v.b === p.id).map((v) => {
      const ander = paneelById[v.a === p.id ? v.b : v.a];
      return `<li><a href="/vergelijk/${esc(v.slug)}.html">${esc(volledigeNaam(p))} vs ${esc(volledigeNaam(ander))}</a></li>`;
    }).join("\n    ")}
  </ul>` : ""}

  <p>Twijfel je of dit paneel bij je past? Doe de <a href="/advies.html">keuzehulp</a> voor een advies op maat, of <a href="/">vergelijk alle zonnepanelen</a> op prijs per Wp, rendement en Zeker-score.</p>

  ${p.product_url ? `<p>De gegevens van de fabrikant zelf vind je op de <a href="${esc(p.product_url)}" target="_blank" rel="noopener">officiële website van ${esc(p.merk)}</a>.</p>` : ""}

</main>
${staartProduct}`;
}

/* ------------------------------------------------------------------
   Overzichtspagina's (SEO-landingspagina's). Worden mee-gegenereerd,
   zodat prijzen en volgorde automatisch actueel blijven.
   ------------------------------------------------------------------ */

/* Rekenwerk voor de twee gidsen. Alles komt uit data.panelen, zodat de tekst
   meebeweegt met prijzen en nieuwe panelen in plaats van stil te verouderen. */
const mediaan = (getallen) => {
  const g = getallen.filter((n) => typeof n === "number").sort((a, b) => a - b);
  if (!g.length) return null;
  const m = Math.floor(g.length / 2);
  return g.length % 2 ? g[m] : (g[m - 1] + g[m]) / 2;
};
const oppervlak = (p) => {
  const [l, b] = String(p.afmetingen_mm || "").split(/\s*[×x]\s*/).map(Number);
  return l && b ? (l * b) / 1e6 : null;
};
const m2 = (n) => n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const KWH_PER_WP_ZUID = 0.9; // dezelfde aanname als "Wat levert dit paneel op?"
const STROOMPRIJS = 0.3;
const paneelLink = (p) => `<a href="/paneel/${esc(p.id)}.html">${esc(volledigeNaam(p))}</a>`;

function kleinDak(lijst) {
  const DAK = 15;
  const metMaat = lijst.filter((p) => oppervlak(p) && prijsPerWp(p));
  const hoog = metMaat[0];
  const laag = metMaat[metMaat.length - 1];
  const opp = metMaat.map(oppervlak);
  const [amin, amax] = [Math.min(...opp), Math.max(...opp)];
  const passen = Math.floor(DAK / amax);
  const wpHoog = passen * hoog.vermogen_wp;
  const wpLaag = passen * laag.vermogen_wp;
  const kwhVerschil = Math.round((wpHoog - wpLaag) * KWH_PER_WP_ZUID);
  const kostHoog = passen * Prijs.vergelijkPrijs(bestePrijs(hoog));
  const kostLaag = passen * Prijs.vergelijkPrijs(bestePrijs(laag));
  const meer = kostHoog - kostLaag;
  const perJaar = kwhVerschil * STROOMPRIJS;
  const topgroep = metMaat.filter((p) => p.rendement_pct >= 22.5);
  const voordelig = [...topgroep].sort((a, b) => prijsPerWp(a) - prijsPerWp(b))[0];
  const terugMeer = meer > 0 && perJaar > 0 ? `De meerprijs van ${eur(meer)} heb je bij ${eurWp(STROOMPRIJS)} per kWh die je zelf verbruikt in ongeveer ${nl(Math.round(meer / perJaar * 10) / 10)} jaar terug.`
    : `De panelen met het hoogste rendement zijn hier zelfs ${eur(-meer)} goedkoper, dus dan is de keuze snel gemaakt.`;
  const extra = `<h2>Wat een hoger rendement oplevert op ${DAK} m²</h2>
  <p>De panelen in deze lijst zijn bijna even groot, van ${m2(amin)} tot ${m2(amax)} m² per stuk. Op een dakvlak van ${DAK} m² passen er dus ongeveer evenveel, zo'n ${passen}, en het verschil zit in de wattpiek per paneel. Met ${passen} keer de ${paneelLink(hoog)} (${nl(hoog.rendement_pct)}%) kom je op ${getal(wpHoog)} Wp, met ${passen} keer de ${paneelLink(laag)} (${nl(laag.rendement_pct)}%) op ${getal(wpLaag)} Wp. Op een gunstig zuiddak scheelt dat ongeveer ${getal(kwhVerschil)} kWh per jaar.</p>
  <p>Die ${passen} panelen kosten samen ${eur(kostHoog)} tegen ${eur(kostLaag)}. ${terugMeer} Hoeveel panelen er echt op jouw dak passen, hangt af van de vorm, de randafstand en schoorstenen of dakramen.</p>
  ${voordelig ? `<p>Wil je veel vermogen zonder de hoofdprijs, kijk dan naar de ${paneelLink(voordelig)}. Hij is het goedkoopst per wattpiek onder de ${topgroep.length} modellen met 22,5% rendement of meer, met ${eurWp(prijsPerWp(voordelig))} per Wp bij ${nl(voordelig.rendement_pct)}% rendement.</p>` : ""}`;
  const vragen = [
    { v: "Hoeveel zonnepanelen passen op een klein dak?", a: `Een paneel in deze vergelijker meet ${m2(amin)} tot ${m2(amax)} m². Op ${DAK} m² bruikbaar dakvlak passen er zo'n ${passen}. Houd rekening met een randafstand van enkele tientallen centimeters en met dakramen of een schoorsteen; een installateur meet dat ter plekke in.` },
    { v: "Is een zonnepaneel met een hoger rendement de meerprijs waard?", a: `Op ${DAK} m² levert de ${volledigeNaam(hoog)} ongeveer ${getal(kwhVerschil)} kWh per jaar meer op dan de ${volledigeNaam(laag)}. ${terugMeer.replace(/<[^>]+>/g, "")} Op een groot dak, waar ruimte geen grens is, kun je beter goedkopere panelen bijleggen.` },
    { v: "Wat is het verschil tussen het vermogen en het rendement van een zonnepaneel?", a: `Het vermogen in wattpiek zegt wat één paneel levert onder testomstandigheden, het rendement hoeveel daarvan per vierkante meter. De ${volledigeNaam(hoog)} haalt ${nl(hoog.rendement_pct)}%, ongeveer ${Math.round(hoog.rendement_pct * 10)} Wp per m². Op een klein dak telt het rendement, op een groot dak de prijs per wattpiek.` },
  ];
  return { extra, vragen };
}

function glasGlas() {
  const gg = data.panelen.filter((p) => p.uitvoering === "glas-glas");
  const gf = data.panelen.filter((p) => p.uitvoering !== "glas-glas");
  const med = (lijst, f) => mediaan(lijst.map(f));
  const r = {
    perWp: [med(gg, prijsPerWp), med(gf, prijsPerWp)],
    garantie: [med(gg, (p) => p.garantie_product_jaar), med(gf, (p) => p.garantie_product_jaar)],
    behoud: [med(gg, (p) => p.vermogen_behoud_25j_pct), med(gf, (p) => p.vermogen_behoud_25j_pct)],
    gewicht: [med(gg, (p) => p.gewicht_kg), med(gf, (p) => p.gewicht_kg)],
  };
  const rij = (label, [a, b], toon) => `<tr><td>${label}</td><td>${toon(a)}</td><td>${toon(b)}</td></tr>`;
  const jr = (n) => `${nl(n)} jaar`;
  const pct = (n) => `${nl(Math.round(n * 10) / 10)}%`;
  const kg = (n) => `${nl(Math.round(n * 10) / 10)} kg`;
  const SET_WP = 4400;
  const prijsVerschil = Math.round((r.perWp[0] - r.perWp[1]) * SET_WP);
  const kgVerschil = Math.round((r.gewicht[0] - r.gewicht[1]) * 10 * 10) / 10;
  // Of glas-glas hier ook op papier beter scoort, hangt van de data af; de zin
  // volgt wat er staat in plaats van te herhalen wat er vaak over gezegd wordt.
  const gelijk = r.garantie[0] === r.garantie[1] && Math.abs(r.behoud[0] - r.behoud[1]) < 0.3;
  const zekerheidZin = gelijk
    ? `Op productgarantie en vermogen na 25 jaar maakt de uitvoering in deze vergelijker weinig uit, met in de mediaan ${jr(r.garantie[0])} tegen ${jr(r.garantie[1])} en ${pct(r.behoud[0])} tegen ${pct(r.behoud[1])}. Het voordeel van glas-glas zit dus in de bouw zelf, want glas aan twee kanten houdt vocht beter buiten dan folie.`
    : `In de mediaan is de productgarantie ${jr(r.garantie[0])} voor glas-glas tegen ${jr(r.garantie[1])} voor glas-folie, en het vermogen na 25 jaar ${pct(r.behoud[0])} tegen ${pct(r.behoud[1])}.`;
  const goedkoopst = [...gg].filter(prijsPerWp).sort((a, b) => prijsPerWp(a) - prijsPerWp(b))[0];
  const langst = [...gg].sort((a, b) => (b.garantie_product_jaar || 0) - (a.garantie_product_jaar || 0) || prijsPerWp(a) - prijsPerWp(b))[0];
  const prijsZin = prijsVerschil > 0 ? `Voor een set van ${getal(SET_WP)} Wp, tien panelen van 440 Wp, betaal je bij de mediaanprijs zo'n ${eur(prijsVerschil)} meer voor glas-glas.`
    : `Voor een set van ${getal(SET_WP)} Wp, tien panelen van 440 Wp, is glas-glas bij de mediaanprijs zelfs ${eur(-prijsVerschil)} goedkoper.`;
  const extra = `<h2>Glas-glas tegenover glas-folie in deze vergelijker</h2>
  <div class="tabel-wrap">
    <table class="vergelijk-tabel compact">
      <thead><tr><th>Mediaan</th><th>Glas-glas (${gg.length})</th><th>Glas-folie (${gf.length})</th></tr></thead>
      <tbody>
        ${rij("Prijs per Wp", r.perWp, eurWp)}
        ${rij("Productgarantie", r.garantie, jr)}
        ${rij("Vermogen na 25 jaar", r.behoud, pct)}
        ${rij("Gewicht per paneel", r.gewicht, kg)}
      </tbody>
    </table>
  </div>
  <p>${prijsZin} ${zekerheidZin} Tien glas-glas panelen wegen samen ongeveer ${nl(kgVerschil)} kg ${kgVerschil >= 0 ? "meer" : "minder"}, wat op een plat dak met ballast kan meetellen.</p>
  <p>De goedkoopste glas-glas per wattpiek is nu de ${paneelLink(goedkoopst)} met ${eurWp(prijsPerWp(goedkoopst))} per Wp. De langste productgarantie onder de glas-glas panelen heeft de ${paneelLink(langst)}, ${langst.garantie_product_jaar} jaar.</p>`;
  const vragen = [
    { v: "Zijn glas-glas zonnepanelen beter?", a: `Ze zijn steviger gebouwd, want glas aan beide kanten houdt vocht beter buiten en beschermt de cellen tegen microscheurtjes. Of dat terugkomt in de garantie, verschilt per fabrikant. In deze vergelijker is de mediaan productgarantie voor glas-glas ${jr(r.garantie[0])} tegen ${jr(r.garantie[1])} voor glas-folie, en het vermogen na 25 jaar ${pct(r.behoud[0])} tegen ${pct(r.behoud[1])}.` },
    { v: "Wat kost een glas-glas zonnepaneel extra?", a: `De mediaanprijs is ${eurWp(r.perWp[0])} per Wp voor glas-glas tegen ${eurWp(r.perWp[1])} voor glas-folie. ${prijsZin}` },
    { v: "Zijn glas-glas zonnepanelen zwaarder?", a: `In deze vergelijker weegt een glas-glas paneel in de mediaan ${kg(r.gewicht[0])}, een glas-folie paneel ${kg(r.gewicht[1])}. Voor tien panelen is dat ongeveer ${nl(Math.abs(kgVerschil))} kg verschil. Op een schuin pannendak maakt dat zelden uit, op een plat dak met ballast laat je de dakbelasting nakijken.` },
  ];
  return { extra, vragen };
}

const OVERZICHTEN = [
  {
    bestand: "beste-zonnepanelen-klein-dak.html",
    titel: `Beste zonnepanelen voor een klein dak (${JAAR})`,
    metaDesc: "Weinig dakruimte? Deze zonnepanelen leveren de meeste opbrengst per vierkante meter. Vergelijking op rendement, Wp per m², prijs en garanties.",
    intro: "Past je gewenste vermogen niet zomaar op je dak, dan telt elke vierkante meter. Het rendement van een paneel bepaalt direct hoeveel wattpiek er per m² past: 22% rendement is circa 220 Wp per m². Back-contact panelen zijn hier de koningen, maar je betaalt er iets meer voor. Hieronder alle panelen uit mijn vergelijker, gesorteerd op opbrengst per vierkante meter.",
    selecteer: (lijst) => [...lijst].sort((a, b) => (b.rendement_pct || 0) - (a.rendement_pct || 0)),
    voetnoot: "Tip: reken eerst uit hoeveel wattpiek je nodig hebt met de keuzehulp; misschien past een gewone middenklasser prima en bespaar je honderden euro's.",
    verdieping: kleinDak,
  },
  {
    bestand: "beste-glas-glas-zonnepanelen.html",
    titel: `Beste glas-glas zonnepanelen (${JAAR})`,
    metaDesc: "Glas-glas zonnepanelen vergeleken op prijs per Wp, garanties en rendement. Waarom glas-glas langer meegaat en wat het tegenwoordig kost.",
    // Geteld in plaats van opgeschreven: hier stond "7 van de 14", en dat klopte
    // tot er een paneel bij kwam.
    intro: `Bij een glas-glas paneel liggen de cellen tussen twee lagen glas in plaats van glas en kunststof folie. Dat beschermt beter tegen vocht en microscheurtjes en vertraagt veroudering. Sinds fabrikanten dun gehard glas gebruiken, is het verschil in prijs en gewicht met foliepanelen klein; ${data.panelen.filter((p) => p.uitvoering === "glas-glas").length} van de ${data.panelen.length} panelen op deze site zijn glas-glas. Hieronder alle glas-glas panelen uit mijn vergelijker, gesorteerd op prijs per wattpiek.`,
    selecteer: (lijst) => lijst.filter((p) => p.uitvoering === "glas-glas").sort((a, b) => (prijsPerWp(a) || Infinity) - (prijsPerWp(b) || Infinity)),
    voetnoot: "Lees ook de uitleg over glas-glas en glas-folie in mijn woordenlijst.",
    verdieping: glasGlas,
  },
];

function overzichtTabel(lijst) {
  return `<div class="tabel-blok los">
  <table class="data-tabel brede-tabel overzicht-tabel kolom-vast">
    <thead><tr>
      <th>Paneel</th>
      <th>Wp</th>
      <th>Rendement</th>
      <th>Prijs</th>
      <th>€/Wp</th>
      <th>Uitvoering</th>
      <th>Zeker-score</th>
    </tr></thead>
    <tbody>${lijst.map((p) => {
      const beste = bestePrijs(p);
      const perWp = prijsPerWp(p);
      return `
      <tr>
        <td>${merkLogoHtml(p.merk)}<a href="/paneel/${esc(p.id)}.html"><b>${esc(volledigeNaam(p))}</b></a></td>
        <td class="niet-afbreken">${p.vermogen_wp}</td>
        <td class="niet-afbreken">${nl(p.rendement_pct)}% <small>(${Math.round((p.rendement_pct || 0) * 10)} Wp/m²)</small></td>
        <td class="niet-afbreken">${beste ? `<b>${eur(Prijs.vergelijkPrijs(beste))}</b>` : "op aanvraag"}</td>
        <td class="niet-afbreken">${perWp ? eurWp(perWp) : "n.b."}</td>
        <td class="niet-afbreken">${esc(p.uitvoering)}${p.full_black ? "<br><small>full black</small>" : ""}</td>
        <td class="niet-afbreken"><b>${zekerScore(p)}/6</b></td>
      </tr>`;
    }).join("")}</tbody>
  </table>
  </div>`;
}

function overzichtsPagina(cfg) {
  const lijst = cfg.selecteer(data.panelen);
  const { extra = "", vragen = [] } = cfg.verdieping ? cfg.verdieping(lijst) : {};
  const faqLd = vragen.length ? JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": vragen.map((q) => ({ "@type": "Question", "name": q.v, "acceptedAnswer": { "@type": "Answer", "text": q.a } })),
  }, null, 2) : "";
  const itemList = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": cfg.titel,
    "itemListElement": lijst.map((p, i) => ({
      "@type": "ListItem",
      "position": i + 1,
      "name": volledigeNaam(p),
      "url": `${SITE}/paneel/${p.id}.html`,
    })),
  }, null, 2);

  return `${kop(cfg.titel, cfg.metaDesc, `${SITE}/${cfg.bestand}`, wrapLd(itemList, faqLd))}

<main class="container leespagina">
  <p class="datum-stempel"><a href="/">${Iconen.svg("pijl-links")} Alle zonnepanelen vergelijken</a></p>
  <h1>${esc(cfg.titel)}</h1>
  <p class="datum-stempel">Automatisch samengesteld uit mijn vergelijker · laatst bijgewerkt op ${datumNL(data.laatst_bijgewerkt || VANDAAG)}</p>
  <p>${esc(cfg.intro)}</p>
  ${overzichtTabel(lijst)}
  ${extra}
  ${vragen.length ? `<h2 id="veelgestelde-vragen">Veelgestelde vragen</h2>
  ${vragen.map((q) => `<details class="faq-item">
    <summary>${esc(q.v)}</summary>
    <p>${esc(q.a)}</p>
  </details>`).join("\n  ")}` : ""}
  <p>${esc(cfg.voetnoot)} Zie de <a href="/advies.html">keuzehulp</a> en de <a href="/uitleg.html#woordenlijst">woordenlijst</a>.</p>
  <div class="noot">Prijzen zijn indicatieve richtprijzen; de prijs en specificaties op de website van de aanbieder zijn altijd leidend. Deze pagina wordt automatisch herbouwd vanuit mijn <a href="/">vergelijker</a>.</div>
</main>
${staart}`;
}

/* ------------------------------------------------------------------
   "Hebben zonnepanelen nog zin?"

   Dit is de vraag waarmee mensen in 2026 zoeken. De verkoop van zonnepanelen
   daalde in het eerste halfjaar met bijna veertig procent terwijl het aantal
   thuisbatterijen verdubbelde, en dat is dezelfde beweging: het publiek is
   niet weg, het vraagt iets anders. Niet meer "welke panelen koop ik" maar
   "wat doe ik met de panelen die ik al heb".

   Deze pagina beantwoordt die vraag en verwijst voor de regels zelf naar
   regelgeving.html. Die twee moeten uit elkaar blijven: daar staat wat er
   geldt, hier staat wat je ermee doet. De cijfers zijn bewust dezelfde als op
   regelgeving.html (0,30 euro per kWh eigen verbruik, circa 0,07 euro
   teruglevering, grofweg een derde eigen verbruik zonder maatregelen), zodat
   de twee pagina's elkaar niet tegenspreken.
   ------------------------------------------------------------------ */

const NOG_ZIN_BESTAND = "hebben-zonnepanelen-nog-zin.html";

function nogZinPagina() {
  const opPrijs = [...data.panelen]
    .filter((p) => prijsPerWp(p))
    .sort((a, b) => prijsPerWp(a) - prijsPerWp(b));
  const goedkoopste = opPrijs[0];
  const perWpGoedkoopst = prijsPerWp(goedkoopste);

  /* Rekenvoorbeeld, met dezelfde aannames als de rekenmodule: 0,85 kWh per Wp
     per jaar voor een gunstig dak, een derde eigen verbruik zonder maatregelen.
     Alles wordt hier uitgerekend en niet uitgeschreven, zodat het voorbeeld
     meebeweegt als de prijzen in de vergelijker veranderen. */
  const PANELEN = 10;
  const KWH_PER_WP = 0.85;
  const EIGEN_DEEL = 0.3;
  const TARIEF = 0.3;
  const TERUGLEVER = 0.07;
  const opwek = Math.round(goedkoopste.vermogen_wp * PANELEN * KWH_PER_WP);
  const eigen = Math.round(opwek * EIGEN_DEEL);
  const terug = opwek - eigen;
  const opbrengstNu = Math.round(opwek * TARIEF);
  const opbrengstStraks = Math.round(eigen * TARIEF + terug * TERUGLEVER);
  const opbrengstHalf = Math.round(opwek * 0.5 * TARIEF + opwek * 0.5 * TERUGLEVER);

  const titel = `Hebben zonnepanelen nog zin in ${JAAR}?`;
  const metaDesc = `Ja, maar de rekensom verandert. Wat het einde van de salderingsregeling betekent, wat je panelen straks opleveren en de drie manieren om meer zelf te gebruiken.`;

  const itemList = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": "Zonnepanelen op prijs per wattpiek",
    "itemListElement": opPrijs.map((p, i) => ({
      "@type": "ListItem",
      "position": i + 1,
      "name": volledigeNaam(p),
      "url": `${SITE}/paneel/${p.id}.html`,
    })),
  }, null, 2);

  return `${kop([titel, "Hebben zonnepanelen nog zin?"], metaDesc, `${SITE}/${NOG_ZIN_BESTAND}`, wrapLd(itemList))}

<main class="container leespagina">
  <p class="datum-stempel"><a href="/">${Iconen.svg("pijl-links")} Alle zonnepanelen vergelijken</a></p>
  <h1>${esc(titel)}</h1>
  <p class="datum-stempel">Automatisch bijgewerkt vanuit mijn vergelijker · laatst bijgewerkt op ${datumNL(data.laatst_bijgewerkt || VANDAAG)}</p>

  <p class="intro"><b>Ja, maar de som verandert wel.</b> Op 1 januari 2027 stopt de salderingsregeling, en daarmee verdwijnt het wegstrepen van wat je teruglevert tegen wat je verbruikt. Panelen blijven zichzelf terugverdienen, alleen verschuift het rendement van <i>opwekken</i> naar <i>zelf gebruiken</i>. Wie daar iets aan doet, merkt er weinig van. Wie niets doet, ziet de opbrengst dalen.</p>

  <h2>Wat er precies verandert</h2>
  <p>Tot en met 31 december 2026 mag je nog volledig salderen. Vanaf 1 januari 2027 krijg je voor teruggeleverde stroom een terugleververgoeding van je energieleverancier, en die is een stuk lager dan wat je voor stroom betaalt. Tot 2030 geldt als wettelijke ondergrens de helft van het kale leveringstarief. Daar kunnen bij veel leveranciers nog terugleverkosten vanaf. De regels zelf staan uitgebreider op <a href="/regelgeving.html">regels en subsidies</a>.</p>

  <h2>Wat dat scheelt, in getallen</h2>
  <p>Neem ${PANELEN} panelen van ${goedkoopste.vermogen_wp} Wp op een gunstig dak. Dat is ongeveer ${getal(opwek)} kWh per jaar. Zonder maatregelen gebruik je daarvan grofweg een derde direct zelf; de rest gaat het net op.</p>
  <div class="tabel-wrap">
    <table class="vergelijk-tabel compact">
      <thead><tr><th>Situatie</th><th>Eigen verbruik</th><th>Teruglevering</th><th>Opbrengst per jaar</th></tr></thead>
      <tbody>
        <tr><td>Nu, met saldering</td><td>${getal(eigen)} kWh</td><td>${getal(terug)} kWh</td><td class="tabel-prijs"><b>${eur(opbrengstNu)}</b></td></tr>
        <tr><td>Vanaf 2027, niets veranderd</td><td>${getal(eigen)} kWh</td><td>${getal(terug)} kWh</td><td class="tabel-prijs"><b>${eur(opbrengstStraks)}</b></td></tr>
        <tr><td>Vanaf 2027, helft zelf gebruikt</td><td>${getal(Math.round(opwek * 0.5))} kWh</td><td>${getal(Math.round(opwek * 0.5))} kWh</td><td class="tabel-prijs"><b>${eur(opbrengstHalf)}</b></td></tr>
      </tbody>
    </table>
  </div>
  <p class="datum-stempel">Gerekend met ${nl(KWH_PER_WP)} kWh per Wp per jaar, ${eurWp(TARIEF)} per kWh voor stroom die je zelf gebruikt en ${eurWp(TERUGLEVER)} per kWh terugleververgoeding. Jouw tarieven wijken af; reken je eigen situatie door in de <a href="/rekenmodule.html">rekenmodule</a>.</p>
  <p>Het verschil tussen de tweede en de derde regel is het hele punt, want dat is ${eur(opbrengstHalf - opbrengstStraks)} per jaar, en daar hoef je geen paneel voor bij te kopen.</p>

  <h2>Drie manieren om meer zelf te gebruiken</h2>
  <ul>
    <li><b>Verschuif je verbruik naar de dag.</b> De goedkoopste maatregel, want hij kost niets. Was, droog en vaatwas overdag, laad je auto als de zon schijnt, zet een warmtepompboiler op een dagprogramma.</li>
    <li><b>Kijk naar je energiecontract.</b> Bij een dynamisch contract krijg je voor teruglevering de marktprijs, en die kan ook negatief zijn; dan betaal je voor wat je teruglevert. Terugleverkosten of een vergoeding per kWh verschillen per leverancier, ook bij dynamische contracten. Vergelijk niet alleen het tarief maar ook de terugleverkosten en de terugleververgoeding.</li>
    <li><b>Sla het op.</b> Een thuisbatterij tilt je eigen verbruik van een derde naar de helft of meer: overdag laden, 's avonds gebruiken. Dat is precies het verschil in de tabel hierboven. Op mijn zustersite <a href="https://batterijmaatje.nl/" target="_blank" rel="noopener">Batterijmaatje</a> staan de modellen naast elkaar; met de <a href="/energieplan.html">energieplan-pagina</a> kijk je naar zon, batterij en warmtepomp in één keer.</li>
  </ul>

  <h2>Je hebt al panelen. Wat kun je nu doen?</h2>
  <ul>
    <li><b>Een batterij bijplaatsen kan op twee manieren.</b> Met een hybride omvormer wordt je omvormer vervangen en gaat de batterij aan de gelijkstroomkant; dat is efficiënter maar duurder en een ingreep. Met een stekkerbatterij of een AC-gekoppelde batterij blijft je bestaande omvormer gewoon hangen. Welke omvormers batterijklaar zijn, staat op <a href="/omvormers.html">omvormers vergelijken</a>.</li>
    <li><b>Zet je omvormer op nulteruglevering.</b> Veel moderne omvormers kunnen de opwek terugregelen zodat er niets het net op gaat. Dat is zinnig als je leverancier per teruggeleverde kWh rekent, maar je gooit er wel opbrengst mee weg. Doe het alleen als de terugleverkosten hoger zijn dan de vergoeding.</li>
    <li><b>Laat je panelen niet uitzetten.</b> Bij aanhoudend negatieve prijzen schakelen sommige omvormers uit. Dat is normaal en tijdelijk; het is geen reden om een installatie te verbouwen.</li>
    <li><b>Overdimensioneer niet alsnog.</b> Bijplaatsen "omdat het nu nog kan" loont zelden, want na 2026 is elke kWh die je niet zelf gebruikt nog maar een fractie waard.</li>
  </ul>

  <h2>En als je nog moet kopen?</h2>
  <p>Dan is er geen haast, maar ook geen reden om te wachten. Panelen gaan 25 jaar mee en de terugverdientijd wordt vooral bepaald door je eigen verbruik, niet door de datum van aanschaf. Belangrijker dan snelheid is de maat. Stem het aantal panelen af op wat je zelf kunt gebruiken. De <a href="/advies.html">keuzehulp</a> rekent dat uit, en op <a href="/waar-zonnepanelen-kopen.html">waar koop je zonnepanelen</a> staan de vier routes naast elkaar.</p>

  <h2>De panelen uit mijn vergelijker, op prijs per wattpiek</h2>
  <p>Van goedkoop naar duur. Dit is de prijs van het paneel zelf; installatie, omvormer en montagemateriaal komen daar bovenop. De goedkoopste is op dit moment de ${esc(volledigeNaam(goedkoopste))} op ${eurWp(perWpGoedkoopst)} per Wp.</p>
  ${overzichtTabel(opPrijs)}

  <div class="noot">De bedragen hierboven zijn rekenvoorbeelden met vaste aannames, geen voorspelling. Tarieven, terugleverkosten en terugleververgoedingen verschillen per leverancier en veranderen; controleer ze in je eigen contract.</div>
</main>
${staart}`;
}

/* ------------------------------------------------------------------
   Vergelijkingspagina's "X vs Y" (SEO-landingspagina's voor veel
   gezochte duels). Volledig uit de data gegenereerd en herbouwd,
   zodat prijzen en scores actueel blijven.
   ------------------------------------------------------------------ */

const VERGELIJKINGEN_ALLE = [
  { a: "dmegc-440-glas-glas", b: "ulica-440-full-black" },
  { a: "aiko-neostar-2p-455", b: "longi-himo-x6-440" },
  { a: "jinko-tiger-neo-440", b: "ja-solar-jam54d41-440" },
  { a: "trina-vertex-s-plus-450", b: "denim-440-full-black" },
  { a: "rec-alpha-pure-2-420", b: "maxeon-6-440" },
  { a: "qcells-qtron-430", b: "canadian-solar-tophiku6-435" },
].map((v) => ({ ...v, slug: `${v.a}-vs-${v.b}` }));
// Een vergelijking met een paneel dat er nu niet op staat, verdwijnt mee.
const VERGELIJKINGEN_WEG = VERGELIJKINGEN_ALLE.filter((v) => !paneelById[v.a] || !paneelById[v.b]);
const VERGELIJKINGEN = VERGELIJKINGEN_ALLE.filter((v) => paneelById[v.a] && paneelById[v.b]);

// Feitelijke pluspunten van x ten opzichte van y, alleen op basis van de data.
function pluspunten(x, y) {
  const p = [];
  const px = prijsPerWp(x), py = prijsPerWp(y);
  if (px && py && px < py * 0.97) p.push(`is per wattpiek goedkoper (${eurWp(px)} tegenover ${eurWp(py)} per Wp)`);
  if ((x.rendement_pct || 0) > (y.rendement_pct || 0) + 0.15) p.push(`heeft een hoger rendement (${nl(x.rendement_pct)}% tegenover ${nl(y.rendement_pct)}%), dus meer opbrengst per m² dak`);
  if (zekerScore(x) > zekerScore(y)) p.push(`scoort hoger op degelijkheid (Zeker-score ${zekerScore(x)}/6 tegenover ${zekerScore(y)}/6)`);
  if ((x.garantie_product_jaar || 0) > (y.garantie_product_jaar || 0)) p.push(`heeft langere productgarantie (${x.garantie_product_jaar} tegenover ${y.garantie_product_jaar || "?"} jaar)`);
  if (x.uitvoering === "glas-glas" && y.uitvoering !== "glas-glas") p.push("is glas-glas uitgevoerd (beter bestand tegen vocht en microscheurtjes)");
  if ((x.vermogen_behoud_25j_pct || 0) > (y.vermogen_behoud_25j_pct || 0) + 0.5) p.push(`behoudt volgens de garantie meer vermogen na 25 jaar (${nl(x.vermogen_behoud_25j_pct)}% tegenover ${nl(y.vermogen_behoud_25j_pct)}%)`);
  if ((x.temp_coefficient || -1) > (y.temp_coefficient || -1) + 0.015) p.push(`presteert beter bij warmte (temperatuurcoëfficiënt ${nl(x.temp_coefficient)} tegenover ${nl(y.temp_coefficient)}% per °C)`);
  if (x.bifaciaal && !y.bifaciaal) p.push("is bifaciaal en vangt ook licht via de achterkant (interessant bij een plat dak)");
  return p;
}

function vergelijkingsPagina(v) {
  const A = paneelById[v.a], B = paneelById[v.b];
  const naam = volledigeNaam;
  const besteA = bestePrijs(A), besteB = bestePrijs(B);

  const rij = (label, wa, wb, winnaar = -1) =>
    `<tr><th>${esc(label)}</th>` +
    `<td>${winnaar === 0 ? `<b>${wa}</b>` : wa}</td>` +
    `<td>${winnaar === 1 ? `<b>${wb}</b>` : wb}</td></tr>`;

  const laagWint = (x, y) => (x == null || y == null || x === y) ? -1 : (x < y ? 0 : 1);
  const hoogWint = (x, y) => (x == null || y == null || x === y) ? -1 : (x > y ? 0 : 1);
  const perA = prijsPerWp(A), perB = prijsPerWp(B);
  const jaNee = (w) => (w ? `${Iconen.svg("ja")} Ja` : `${Iconen.svg("nee")} Nee`);

  const plusA = pluspunten(A, B), plusB = pluspunten(B, A);
  const titel = `${naam(A)} vs ${naam(B)}: welk zonnepaneel?`;
  const metaDesc = `${naam(A)} of ${naam(B)}? Vergelijk prijs per Wp, rendement, glas-glas, garanties en Zeker-score.`;

  const itemList = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": titel,
    "itemListElement": [A, B].map((p, i) => ({
      "@type": "ListItem", "position": i + 1, "name": naam(p), "url": `${SITE}/paneel/${p.id}.html`,
    })),
  }, null, 2);

  // Twee volledige paneelnamen zijn samen al negentig tekens ("AIKO Neostar 2S+
  // 455 Wp Full Black (glas-glas)"). Voor de titel volstaat merk plus vermogen:
  // dat is waar iemand op zoekt en het past wel.
  const kortePaneelnaam = (x) => `${x.merk} ${x.vermogen_wp} Wp`;
  return `${kop([`${titel} (${JAAR})`, titel,
                 `${kortePaneelnaam(A)} vs ${kortePaneelnaam(B)}: welk paneel?`,
                 `${kortePaneelnaam(A)} vs ${kortePaneelnaam(B)}`], metaDesc, `${SITE}/vergelijk/${esc(v.slug)}.html`, wrapLd(itemList))}

<main class="container leespagina">
  <p class="datum-stempel"><a href="/">${Iconen.svg("pijl-links")} Alle zonnepanelen vergelijken</a></p>
  <h1>${esc(naam(A))} vs ${esc(naam(B))}</h1>
  <p class="datum-stempel">Op basis van dezelfde feiten als mijn vergelijker · laatst bijgewerkt op ${datumNL(data.laatst_bijgewerkt || VANDAAG)}</p>
  <p>Twee veelvergeleken zonnepanelen naast elkaar. Onder de tabel staan de belangrijkste verschillen op een rij. Vetgedrukt betekent: op dit punt objectief in het voordeel.</p>

  <div class="tabel-blok los">
  <table class="data-tabel brede-tabel duel-tabel kolom-vast">
    <thead><tr>
      <th></th>
      <th><a href="/paneel/${esc(A.id)}.html">${esc(naam(A))}</a></th>
      <th><a href="/paneel/${esc(B.id)}.html">${esc(naam(B))}</a></th>
    </tr></thead>
    <tbody>
      ${rij("Prijs", besteA ? eur(Prijs.vergelijkPrijs(besteA)) : "op aanvraag", besteB ? eur(Prijs.vergelijkPrijs(besteB)) : "op aanvraag")}
      ${rij("Prijs per Wp", perA ? eurWp(perA) : "n.b.", perB ? eurWp(perB) : "n.b.", laagWint(perA, perB))}
      ${rij("Vermogen", `${A.vermogen_wp} Wp`, `${B.vermogen_wp} Wp`, hoogWint(A.vermogen_wp, B.vermogen_wp))}
      ${rij("Rendement", `${nl(A.rendement_pct)}%`, `${nl(B.rendement_pct)}%`, hoogWint(A.rendement_pct, B.rendement_pct))}
      ${rij("Celtype", esc(celtypeLabel(A)), esc(celtypeLabel(B)))}
      ${rij("Uitvoering", esc(A.uitvoering), esc(B.uitvoering))}
      ${rij("Full black", jaNee(A.full_black), jaNee(B.full_black))}
      ${rij("Bifaciaal", jaNee(A.bifaciaal), jaNee(B.bifaciaal))}
      ${rij("Zeker-score", `${zekerScore(A)}/6`, `${zekerScore(B)}/6`, hoogWint(zekerScore(A), zekerScore(B)))}
      ${rij("Productgarantie", A.garantie_product_jaar ? `${A.garantie_product_jaar} jaar` : "n.b.", B.garantie_product_jaar ? `${B.garantie_product_jaar} jaar` : "n.b.", hoogWint(A.garantie_product_jaar, B.garantie_product_jaar))}
      ${rij("Vermogensgarantie", `${A.garantie_vermogen_jaar} jaar (${nl(A.vermogen_behoud_eind_pct)}%)`, `${B.garantie_vermogen_jaar} jaar (${nl(B.vermogen_behoud_eind_pct)}%)`)}
      ${rij("Behoud na 25 jaar", `circa ${nl(A.vermogen_behoud_25j_pct)}%`, `circa ${nl(B.vermogen_behoud_25j_pct)}%`, hoogWint(A.vermogen_behoud_25j_pct, B.vermogen_behoud_25j_pct))}
      ${rij("Temperatuurcoëfficiënt", `${nl(A.temp_coefficient)}%/°C`, `${nl(B.temp_coefficient)}%/°C`, hoogWint(A.temp_coefficient, B.temp_coefficient))}
      ${rij("Afmetingen (mm)", esc(A.afmetingen_mm || "n.b."), esc(B.afmetingen_mm || "n.b."))}
      ${rij("Gewicht", A.gewicht_kg ? `circa ${nl(A.gewicht_kg)} kg` : "n.b.", B.gewicht_kg ? `circa ${nl(B.gewicht_kg)} kg` : "n.b.")}
    </tbody>
  </table>
  </div>

  <h2>De belangrijkste verschillen</h2>
  <ul>
    ${plusA.length ? `<li><b>De ${esc(naam(A))}</b> ${plusA.join(", ")}.</li>` : ""}
    ${plusB.length ? `<li><b>De ${esc(naam(B))}</b> ${plusB.join(", ")}.</li>` : ""}
    ${!plusA.length && !plusB.length ? "<li>Op de vergeleken punten ontlopen deze panelen elkaar weinig; kijk vooral naar prijs en beschikbaarheid.</li>" : ""}
  </ul>
  <p class="datum-stempel">Deze verschillen worden automatisch afgeleid uit de specificaties hierboven.</p>

  <h2>Verder kijken</h2>
  <ul>
    <li>Alle details en specificaties: <a href="/paneel/${esc(A.id)}.html">${esc(naam(A))}</a> · <a href="/paneel/${esc(B.id)}.html">${esc(naam(B))}</a></li>
    <li>Wat leveren ze op voor jouw dak? <a href="/rekenmodule.html?paneel=${encodeURIComponent(A.id)}">opbrengst ${esc(naam(A))}</a> · <a href="/rekenmodule.html?paneel=${encodeURIComponent(B.id)}">opbrengst ${esc(naam(B))}</a></li>
    <li>Twijfel je over het aantal panelen? Doe de <a href="/advies.html">keuzehulp</a>.</li>
  </ul>

  <div class="noot">Prijzen en specificaties veranderen regelmatig; deze pagina wordt automatisch herbouwd. De prijs en voorwaarden op de website van de aanbieder zijn altijd leidend.</div>
</main>
${staart}`;
}

/* ------------------------------------------------------------------
   Pagina's schrijven
   ------------------------------------------------------------------ */

for (const p of data.panelen) {
  writeFileSync(resolve(ROOT, "paneel", `${p.id}.html`), relativeer(pagina(p), 1), "utf8");
}
console.log(`${data.panelen.length} paneelpagina's gegenereerd in /paneel/`);

/* De pagina's van de panelen die er nu niet op staan. Het adres blijft
   bestaan, want er kan elders naar gelinkt zijn, maar met noindex. */
const HTML_404 = readFileSync(resolve(ROOT, "404.html"), "utf8");
for (const { product: p } of VERBORGEN) {
  const naam = volledigeNaam(p);
  writeFileSync(resolve(ROOT, "paneel", `${p.id}.html`), verborgenPagina(HTML_404, {
    titel: `${naam} | Zonnestroommaatje.nl`,
    kop: `Het ${naam} staat er nu niet op`,
    alineas: [
      `Ik zet een paneel alleen in de vergelijker als er een prijs bij hoort die in de afgelopen 14 weken nog is bevestigd. Voor het ${esc(naam)} heb ik die nu niet, en een prijs per wattpiek van maanden terug zegt weinig naast die van de ${ZICHTBAAR.length} andere panelen.`,
      "Bevestigt een winkel de prijs weer, dan staat het paneel er de volgende dag vanzelf weer tussen.",
    ],
    terug: { href: "/", tekst: "Naar alle panelen" },
  }), "utf8");
}
if (VERBORGEN.length) console.log(`${VERBORGEN.length} paneelpagina's zonder actuele prijs als korte pagina geschreven`);

// De browser leest dezelfde lijsten als deze generator.
mkdirSync(resolve(ROOT, "data/site"), { recursive: true });
writeFileSync(resolve(ROOT, "data/site/panelen.json"), JSON.stringify(data, null, 2) + "\n", "utf8");
writeFileSync(resolve(ROOT, "data/site/omvormers.json"), JSON.stringify(omvormerData, null, 2) + "\n", "utf8");

for (const cfg of OVERZICHTEN) {
  writeFileSync(resolve(ROOT, cfg.bestand), relativeer(overzichtsPagina(cfg), 0), "utf8");
}
console.log(`${OVERZICHTEN.length} overzichtspagina's gegenereerd (klein dak, glas-glas)`);

writeFileSync(resolve(ROOT, NOG_ZIN_BESTAND), nogZinPagina(), "utf8");
console.log(`${NOG_ZIN_BESTAND} gegenereerd`);

mkdirSync(resolve(ROOT, "vergelijk"), { recursive: true });
for (const v of VERGELIJKINGEN) {
  writeFileSync(resolve(ROOT, "vergelijk", `${v.slug}.html`), relativeer(vergelijkingsPagina(v), 1), "utf8");
}
console.log(`${VERGELIJKINGEN.length} vergelijkingspagina's gegenereerd in /vergelijk/`);
for (const v of VERGELIJKINGEN_WEG) {
  writeFileSync(resolve(ROOT, "vergelijk", `${v.slug}.html`), verborgenPagina(HTML_404, {
    titel: "Vergelijking | Zonnestroommaatje.nl",
    kop: "Deze vergelijking staat er nu niet op",
    alineas: ["Voor een van de twee panelen heb ik geen prijs die in de laatste 14 weken bij een winkel is bevestigd, dus naast elkaar zetten heeft nu geen zin."],
    terug: { href: "/", tekst: "Naar alle panelen" },
  }), "utf8");
}

/* ------------------------------------------------------------------
   Sitemap herbouwen (vaste pagina's + paneelpagina's)
   ------------------------------------------------------------------ */


/* ------------------------------------------------------------------
   De vergelijker voorrenderen in index.html

   De kaarten werden pas in de browser getekend. In de HTML die een bezoeker of
   een zoekmachine binnenkrijgt stond daardoor geen enkele paneelnaam, geen
   prijs, en geen enkele link naar de veertien paneelpagina's. Zoekmachines
   voeren JavaScript wel uit, maar later en minder betrouwbaar, en interne
   links bepalen mede hoe goed die pagina's gevonden worden.

   De opmaak komt uit assets/kaart.js, dezelfde module die de browser gebruikt,
   dus er kan geen verschil ontstaan. Zodra de bezoeker gaat filteren of
   sorteren neemt app.js het over.
   ------------------------------------------------------------------ */

const BEGIN = "<!-- kaarten:begin -->";
const EIND = "<!-- kaarten:eind -->";

const gesorteerdePanelen = Kaart.standaardVolgorde(data.panelen);

// De vergelijker opent in lijstweergave, dus dat is ook wat hier in de HTML
// komt te staan. Zet je hier kaarten neer terwijl de browser meteen daarna
// regels tekent, dan ziet de bezoeker het beeld een keer omklappen en krijgt
// een zoekmachine iets anders te zien dan een mens.
const kaarten = Kaart.lijstHtml(gesorteerdePanelen, { merkLogos: data.merk_logos });

// ItemList vertelt de zoekmachine dat dit een gerangschikte lijst producten is
// en welke pagina bij elk item hoort.
const itemLijst = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "Zonnepanelen vergeleken",
  description: "Alle vergeleken zonnepanelen, gerangschikt op prijs per wattpiek.",
  numberOfItems: gesorteerdePanelen.length,
  itemListElement: gesorteerdePanelen.map((p, i) => ({
    "@type": "ListItem",
    position: i + 1,
    url: `${SITE}/paneel/${p.id}.html`,
    name: Kaart.naamVan(p),
  })),
};

let index = readFileSync(resolve(ROOT, "index.html"), "utf8");
const beginPositie = index.indexOf(BEGIN);
const eindPositie = index.indexOf(EIND);
if (beginPositie === -1 || eindPositie === -1) {
  throw new Error(`index.html mist de markeringen ${BEGIN} en ${EIND}; de kaarten kunnen er niet in gezet worden.`);
}

index =
  index.slice(0, beginPositie + BEGIN.length) +
  "\n" + kaarten + "\n    " +
  index.slice(eindPositie);

// De lijst-markup vervangen of toevoegen, zodat er nooit twee in de pagina staan
const LD_BEGIN = '<script type="application/ld+json" data-lijst>';
const LD_EIND = "</script>";
const ldBlok = `${LD_BEGIN}\n${JSON.stringify(itemLijst, null, 2)}\n  ${LD_EIND}`;
if (index.includes(LD_BEGIN)) {
  const a = index.indexOf(LD_BEGIN);
  const b = index.indexOf(LD_EIND, a) + LD_EIND.length;
  index = index.slice(0, a) + ldBlok + index.slice(b);
} else {
  index = index.replace("</head>", `  ${ldBlok}\n</head>`);
}

/* De tellerregel stond in de HTML op "Laden…", boven een lijst die er al
   helemaal stond. Wie javascript traag of niet krijgt, las dus "Laden…" bij
   een compleet gevulde vergelijker. Hier komt het echte aantal in te staan,
   met dezelfde zin die app.js er later van maakt, zodat er niets verspringt. */
{
  const sorteerKeuze = index.match(/<option value="[^"]*" selected>([^<]*)</);
  if (sorteerKeuze) {
    const noot = sorteerKeuze[1].charAt(0).toLowerCase() + sorteerKeuze[1].slice(1);
    index = index.replace(
      /(<span class="resultaten-telling" id="resultatenTelling">)[^<]*(<\/span>)/,
      `$1${gesorteerdePanelen.length} van ${gesorteerdePanelen.length} zonnepanelen, gesorteerd op ${noot}$2`,
    );
  }
}

/* De datum achter "gecontroleerd" stond in de HTML als "…" en werd pas in de
   browser door app.js gevuld. Dat is één teken dat verandert in "2 oktober
   2026", en die badge staat in een rij die afbreekt: de rij herverdeelt, wordt
   hoger of lager, en alles eronder schuift mee. Gemeten op de voorpagina een
   verschuiving van 0,23 bij warmtepompmaatje en 0,68 bij zonnestroommaatje,
   waar Google 0,1 als grens voor "goed" aanhoudt.

   Dezelfde reden als bij de teller en de resultatenregel hierboven: wat de
   generator al weet, hoort in de HTML te staan. app.js schrijft er daarna
   precies hetzelfde in - de opmaak is aan beide kanten nagerekend
   (toLocaleDateString met day/month/year tegen Intl met dateStyle "long",
   allebei "2 oktober 2026") - dus er verspringt niets meer. En wie javascript
   traag of niet krijgt, ziet nu een datum in plaats van drie puntjes. */
index = index.replace(
  /(<b id="updateDatum">)[^<]*(<\/b>)/,
  `$1${datumNL(data.laatst_bijgewerkt || VANDAAG)}$2`,
);

/* De teller in de hero stond in de HTML op 14 terwijl er 17 in de data
   staan. app.js zet hem in de browser goed, dus op het scherm viel het niet op,
   maar een zoekmachine en wie zonder javascript leest zag het oude getal.
   Batterijmaatje telde hem al mee in de generator; hier nu ook. */
index = index.replace(
  /(<b id="tellerPanelen">)\d+(<\/b>)/,
  `$1${data.panelen.length}$2`,
);

writeFileSync(resolve(ROOT, "index.html"), index, "utf8");
console.log(`index.html: ${gesorteerdePanelen.length} kaarten voorgerenderd en ItemList bijgewerkt`);

/* ------------------------------------------------------------------
   uitleg.html: getallen, de markt in cijfers, de rekenhulp "hoeveel
   panelen" en de markup voor zoekmachines. Zie kern/scripts/uitleg.mjs.
   ------------------------------------------------------------------ */
let CIJFERS = null;
{
  const panelen = data.panelen;
  const nlGetal = (n, d = 1) => Number(n).toLocaleString("nl-NL", { maximumFractionDigits: d });
  const centen = (n) => `€ ${n.toFixed(2).replace(".", ",")}`;
  const prijsVan = (p) => { const a = bestePrijs(p); return a ? Prijs.vergelijkPrijs(a) : null; };
  const perWp = panelen.map((p) => ({ p, w: Prijs.prijsPerWp(p), echt: bestePrijs(p) && !bestePrijs(p).is_richtprijs })).filter((x) => x.w && x.echt);
  const goedkoopst = perWp.slice().sort((a, b) => a.w - b.w)[0];
  const wps = panelen.map((p) => p.vermogen_wp).filter((n) => typeof n === "number");
  const tel = (f) => panelen.filter(f).length;
  const prodGar = panelen.map((p) => p.garantie_product_jaar).filter((n) => typeof n === "number");
  const vermGar = panelen.map((p) => p.garantie_vermogen_jaar).filter((n) => typeof n === "number");
  const omvormers = omvormerData.omvormers;
  // Gewicht per uitvoering, voor de zin over glas-glas op de voorpagina.
  const gewichten = (f) => panelen.filter(f).map((p) => p.gewicht_kg).filter((n) => typeof n === "number");
  const gg = gewichten((p) => p.uitvoering === "glas-glas");
  const gf = gewichten((p) => p.uitvoering !== "glas-glas");
  const centPerWp = panelen.map((p) => Prijs.prijsPerWp(p)).filter(Boolean).map((w) => Math.round(w * 100));
  const verloop = JSON.parse(readFileSync(resolve(ROOT, "data/prijsverloop.json"), "utf8"));
  const beweging = Uitleg.prijsbeweging(verloop, { dagen: 30 });

  /* De rekenhulp neemt de dakliggingen over uit rekenmodule.html, zodat
     "zuid, schuin dak" hier dezelfde kWh per Wp betekent als daar. */
  const rmHtml = readFileSync(resolve(ROOT, "rekenmodule.html"), "utf8");
  const select = /<select id="dakligging">([\s\S]*?)<\/select>/.exec(rmHtml);
  if (!select) throw new Error("rekenmodule.html mist de keuzelijst dakligging; de rekenhulp op uitleg.html leunt erop");
  const liggingen = [...select[1].matchAll(/<option value="([0-9.]+)"( selected)?>([^<]+)<\/option>/g)].map((m) => ({ f: Number(m[1]), naam: m[3], gekozen: !!m[2] }));
  const mediaanWp = Uitleg.mediaan(wps);
  const mediaanPaneel = Uitleg.mediaan(panelen.map(prijsVan).filter(Boolean));
  const reken = { wp: mediaanWp, paneelprijs: mediaanPaneel, verbruik: 2900 };
  const standaardLigging = liggingen.find((l) => l.gekozen) || liggingen[0];
  const aantalVoor = (kwh, f) => Math.ceil(kwh / (reken.wp * f));

  const cijfers = {
    "aantal": panelen.length,
    "omvormers": omvormers.length,
    "winkels": aantalWinkels(panelen, omvormers),
    "gg-n": gg.length,
    "gg-min": nlGetal(Math.min(...gg)),
    "gg-max": nlGetal(Math.max(...gg)),
    "gf-n": gf.length,
    "gf-min": nlGetal(Math.min(...gf)),
    "gf-max": nlGetal(Math.max(...gf)),
    "cent-wp-min": Math.min(...centPerWp),
    "cent-wp-max": Math.max(...centPerWp),
    "cent-wp-factor": nlGetal(Math.max(...centPerWp) / Math.min(...centPerWp)),
    "wp-min": Math.min(...wps),
    "wp-max": Math.max(...wps),
    "wp-mediaan": mediaanWp,
    "glas-glas": tel((p) => p.uitvoering === "glas-glas"),
    "full-black": tel((p) => p.full_black),
    "back-contact": tel((p) => p.celtype === "back-contact"),
    "topcon": tel((p) => p.celtype === "topcon"),
    "prod-gar-min": Math.min(...prodGar),
    "prod-gar-max": Math.max(...prodGar),
    "verm-gar-min": Math.min(...vermGar),
    "verm-gar-max": Math.max(...vermGar),
    "rh-aantal": aantalVoor(reken.verbruik, standaardLigging.f),
    "kwh-laag": Math.round(mediaanWp * 0.85 / 10) * 10,
    "kwh-hoog": Math.round(mediaanWp * 0.95 / 10) * 10,
    "tien-panelen": eur(Math.round(10 * mediaanPaneel / 10) * 10),
    "rh-opwek": nlGetal(Math.round(aantalVoor(reken.verbruik, standaardLigging.f) * reken.wp * standaardLigging.f / 10) * 10, 0),
    "rh-kosten": eur(Math.round(aantalVoor(reken.verbruik, standaardLigging.f) * mediaanPaneel / 10) * 10),
  };

  const marktCijfers = [
    { id: "cijfer-aantal", label: "Panelen in de vergelijker", getal: String(panelen.length), toelichting: `plus ${omvormers.length} omvormers en systemen` },
    { id: "cijfer-per-wp", label: "Mediaanprijs per Wp", getal: centen(Uitleg.mediaan(perWp.map((x) => x.w))), toelichting: `over ${perWp.length} panelen met een winkelprijs, incl. btw` },
    goedkoopst && { id: "cijfer-goedkoopst-per-wp", label: "Goedkoopste per Wp", getal: centen(goedkoopst.w), toelichting: `<a href="paneel/${esc(goedkoopst.p.id)}.html">${esc(volledigeNaam(goedkoopst.p))}</a>` },
    { id: "cijfer-vermogen", label: "Vermogen per paneel", getal: `${Math.min(...wps)} tot ${Math.max(...wps)} Wp`, toelichting: `de middelste ${mediaanWp} Wp` },
    { id: "cijfer-glas-glas", label: "Glas-glas", getal: `${cijfers["glas-glas"]} van ${panelen.length}`, toelichting: `${cijfers["full-black"]} zijn full black` },
    { id: "cijfer-celtype", label: "Celtype", getal: `${cijfers.topcon} TOPCon`, toelichting: `${cijfers["back-contact"]} back-contact, ${tel((p) => p.celtype === "hjt")} HJT` },
    beweging && beweging.gemeten && { id: "cijfer-prijsbeweging", label: `Prijzen in ${beweging.dagen} dagen`, getal: `${beweging.goedkoper} goedkoper, ${beweging.duurder} duurder`,
      toelichting: `van ${beweging.gemeten} producten die al ${beweging.dagen} dagen gevolgd worden, per winkel` },
  ].filter(Boolean);

  const pad = resolve(ROOT, "uitleg.html");
  const oud = readFileSync(pad, "utf8");
  const titel = "Zo werken zonnepanelen: hoeveel heb je nodig na 2027?";
  const beschrijving = `Hoe zonnepanelen werken, hoeveel je er nodig hebt en wat er verandert als salderen stopt. Met de cijfers van ${panelen.length} panelen, elke dag bijgewerkt.`;
  const uit = Uitleg.bouwMetEerlijkeDatum(oud, VANDAAG, (datum) => {
    let h = Uitleg.vulCijfers(oud, cijfers);
    h = Uitleg.vervangBlok(h, "markt", Uitleg.marktBlok({
      kop: "Zonnepanelen in cijfers", iso: datum, datumTekst: datumNL(datum), cijfers: marktCijfers,
      voet: "Prijzen incl. btw uit de dagelijkse prijscontrole, alleen het paneel. Elk cijfer heeft een eigen link.",
    }));
    h = Uitleg.vervangBlok(h, "rekenhulp-data", `  <script type="application/json" id="rekenhulp-panelen">${JSON.stringify({ ...reken, liggingen })}</script>`);
    h = Uitleg.vervangBlok(h, "rekenhulp-ligging", liggingen.map((l) => `      <option value="${l.f}"${l === standaardLigging ? " selected" : ""}>${esc(l.naam)}</option>`).join("\n"));
    h = Uitleg.vervangBlok(h, "inhoud", Uitleg.inhoudsopgave(h, { zonder: ["markt-kop"] }));
    h = Uitleg.zetBijgewerkt(h, datum, datumNL(datum));
    h = h.replace(/<title>[^<]*<\/title>/, `<title>${esc(titel)}</title>`)
      .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(beschrijving)}$2`)
      .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(beschrijving)}$2`);
    return Uitleg.zetSchema(h, Uitleg.uitlegSchema(h, {
      url: `${SITE}/uitleg.html`, titel, beschrijving, iso: datum, uitgever: { naam: "Zonnestroommaatje", url: `${SITE}/` },
    }));
  });
  writeFileSync(pad, uit.html, "utf8");
  CIJFERS = cijfers;
  console.log(`uitleg.html: ${marktCijfers.length} marktcijfers, ${Uitleg.begrippen(uit.html).length} begrippen, ${uit.veranderd ? "bijgewerkt" : "ongewijzigd sinds"} ${uit.iso}`);
}

/* De met de hand geschreven pagina's met aantallen erin. Die tellen wat er nu
   op staat, dus ze worden elke dag ingevuld, en de FAQ-markup volgt de
   zichtbare antwoorden. */
for (const bestand of ["index.html", "steun.html", "omvormers.html"]) {
  const pad = resolve(ROOT, bestand);
  const oud = readFileSync(pad, "utf8");
  const nieuw = Uitleg.faqVolgensTekst(Uitleg.vulCijfers(oud, CIJFERS, bestand));
  if (nieuw !== oud) writeFileSync(pad, nieuw, "utf8");
}

const vast = [
  { loc: `${SITE}/`, freq: "daily", prio: "1.0" },
  { loc: `${SITE}/uitleg.html`, freq: "monthly", prio: "0.8" },
  { loc: `${SITE}/omvormers.html`, freq: "weekly", prio: "0.9" },
  { loc: `${SITE}/advies.html`, freq: "weekly", prio: "0.9" },
  { loc: `${SITE}/systeem.html`, freq: "weekly", prio: "0.9" },
  { loc: `${SITE}/rekenmodule.html`, freq: "weekly", prio: "0.8" },
  { loc: `${SITE}/energieplan.html`, freq: "weekly", prio: "0.8" },
  { loc: `${SITE}/regelgeving.html`, freq: "monthly", prio: "0.8" },
  { loc: `${SITE}/waar-zonnepanelen-kopen.html`, freq: "monthly", prio: "0.8" },
  { loc: `${SITE}/beste-zonnepanelen-klein-dak.html`, freq: "weekly", prio: "0.8" },
  { loc: `${SITE}/beste-glas-glas-zonnepanelen.html`, freq: "weekly", prio: "0.8" },
  { loc: `${SITE}/${NOG_ZIN_BESTAND}`, freq: "weekly", prio: "0.9" },
  { loc: `${SITE}/over-ons.html`, freq: "monthly", prio: "0.4" },
  { loc: `${SITE}/contact.html`, freq: "yearly", prio: "0.3" },
  { loc: `${SITE}/privacy.html`, freq: "yearly", prio: "0.2" },
  { loc: `${SITE}/steun.html`, freq: "yearly", prio: "0.3" },
];

const urls = [
  ...vast,
  ...data.panelen.map((p) => ({ loc: `${SITE}/paneel/${p.id}.html`, freq: "weekly", prio: "0.7" })),
  ...VERGELIJKINGEN.map((v) => ({ loc: `${SITE}/vergelijk/${v.slug}.html`, freq: "weekly", prio: "0.7" })),
];

// Het statistiekscript op elke pagina, ook op de pagina's die hierboven niet
// geschreven zijn (zie kern/scripts/statistiek.mjs). Vóór de sitemap, want die
// vergelijkt de pagina's met gisteren, en zonder tag zou elke gegenereerde
// pagina elke dag als veranderd gelden.
const metTag = zetStatistiekOveral(ROOT, ASSET_VERSIE);
if (metTag) console.log(`statistiekscript op ${metTag} pagina('s) gezet`);
const lastmodVoor = lastmodMaker(ROOT, SITE, STAND_VOOR, VANDAAG);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${lastmodVoor(u.loc)}</lastmod>\n    <changefreq>${u.freq}</changefreq>\n    <priority>${u.prio}</priority>\n  </url>`).join("\n") +
  `\n</urlset>\n`;

writeFileSync(resolve(ROOT, "sitemap.xml"), sitemap, "utf8");
const vers = urls.filter((u) => lastmodVoor(u.loc) === VANDAAG).length;
console.log(`sitemap.xml herbouwd met ${urls.length} URL's, waarvan ${vers} met lastmod van vandaag`);
