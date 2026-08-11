/* ==========================================================================
   Warmtepompmaatje - generator voor productpagina's (pomp/<id>.html)
   Zelfde opzet als de paneelpagina's van Zonnestroommaatje en de
   batterijpagina's van Batterijmaatje. Draaien: node scripts/genereer-warmtepomppaginas.mjs
   Herbouwt ook sitemap.xml.
   ========================================================================== */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// Dezelfde icoonset als de browser gebruikt, zodat een pomppagina nooit een
// ander icoon toont dan de vergelijker.
const vereis = createRequire(import.meta.url);
const Iconen = vereis("../assets/iconen.js");
// En dezelfde prijslogica, zodat een pomppagina nooit een ander bedrag
// noemt dan de kaart in de vergelijker.
const Prijs = vereis("../assets/prijs.js");
// En dezelfde kaartopmaak, zodat de voorgerenderde kaarten in index.html niet
// kunnen afwijken van wat de browser tekent.
const Kaart = vereis("../assets/kaart.js");

// Het merkicoon staat in de kop en de voet van elke pagina.
const ICOON_LOGO = Iconen.svg("warmte", { klasse: "icoon-groot" });

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://warmtepompmaatje.nl";
const ASSET_VERSIE = "20260729c";
const VANDAAG = new Date().toISOString().slice(0, 10);

const data = JSON.parse(readFileSync(join(ROOT, "data", "warmtepompen.json"), "utf8"));
const pompen = data.warmtepompen;

const esc = (s) => String(s == null ? "" : s)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const eur = (n) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const datumNL = (iso) => { const d = new Date(`${iso}T12:00:00`); return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat("nl-NL", { dateStyle: "long" }).format(d); };

function driewaardig(v) {
  if (v && typeof v === "object") return { status: v.status || "deels", tekst: v.tekst || "" };
  if (typeof v === "string" && v.trim()) return { status: "deels", tekst: v };
  return { status: "nee", tekst: "Nee" };
}
const punt = (v) => { const s = driewaardig(v).status; return s === "ja" ? 2 : s === "deels" ? 1 : 0; };
const koppelScore = (w) => punt(w.sturing) + punt(w.home_assistant) + punt(w.homey);
const d3html = (v) => { const d = driewaardig(v); const icoon = Iconen.svg(d.status === "ja" ? "ja" : d.status === "deels" ? "deels" : "nee"); return `<b>${icoon}</b> ${esc(d.tekst)}`; };

const bestePrijs = (w) => Prijs.beste(w);
const vergelijkPrijs = (a) => Prijs.vergelijkPrijs(a);

// JSON-LD: Product (met prijs/aanbieding) + BreadcrumbList, gelijk aan de zustersites
/**
 * De maten waarin deze reeks op de ISDE-lijst staat, met het bedrag per maat.
 * Het vermogen is dat van RVO (EU 811/2013) en ligt vaak een stap lager dan de
 * maat in de modelnaam; dat staat er expliciet bij, anders lijkt de tabel de
 * kop van de pagina tegen te spreken.
 */
function variantenBlok(w) {
  const v = w.varianten || [];
  if (v.length < 2) return "";
  return `
  <h2>Ook in andere maten</h2>
  <p>Deze reeks staat in ${v.length} uitvoeringen op de meldcodelijst van RVO. Het vermogen hieronder is het opgegeven vermogen volgens EU 811/2013, zoals RVO dat hanteert; dat ligt vaak een stap lager dan de maat in de modelnaam.</p>
  <div class="tabel-wrap">
    <table class="vergelijk-tabel compact">
      <thead><tr><th>Vermogen (ISDE-lijst)</th><th>ISDE-subsidie</th><th>Meldcode</th></tr></thead>
      <tbody>${v.map((x) => `<tr><td>${x.vermogen_kw} kW</td><td class="tabel-prijs">${x.isde_eur ? eur(x.isde_eur) : "?"}</td><td>${esc(x.meldcode)}</td></tr>`).join("")}</tbody>
    </table>
  </div>`;
}

function productLd(w) {
  const naam = `${w.merk} ${w.model}`;
  const beste = bestePrijs(w);
  // Alleen aanbiedingen die het complete toestel dekken: een losse buitenunit
  // als "price" van dit product opvoeren zou in de zoekresultaten een bedrag
  // tonen waarvoor je de pomp niet kunt kopen. En altijd de vergelijkprijs,
  // want schema.org gaat bij consumentenverkoop uit van een bedrag incl. btw.
  const aanbiedingen = Prijs.geldigeAanbiedingen(w).filter(Prijs.zelfdeSamenstelling);
  const ld = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": naam,
    "brand": { "@type": "Brand", "name": w.merk },
    "category": w.type === "hybride" ? "Hybride warmtepomp" : "All-electric warmtepomp",
    "description": `${naam}: ${w.type === "hybride" ? "hybride" : "all-electric"} warmtepomp${w.vermogen_kw ? ` van ${String(w.vermogen_kw).replace(".", ",")} kW` : ""}${w.scop ? `, SCOP ${String(w.scop).replace(".", ",")}` : ""}. Koppel-score ${koppelScore(w)}/6.`.slice(0, 300),
    "url": `${SITE}/pomp/${w.id}.html`,
  };
  if (aanbiedingen.length === 1) {
    ld.offers = { "@type": "Offer", "price": vergelijkPrijs(aanbiedingen[0]), "priceCurrency": "EUR", "url": aanbiedingen[0].affiliate_url || aanbiedingen[0].url, "availability": "https://schema.org/InStock" };
  } else if (aanbiedingen.length > 1) {
    const prijzen = aanbiedingen.map(vergelijkPrijs);
    ld.offers = { "@type": "AggregateOffer", "lowPrice": Math.min(...prijzen), "highPrice": Math.max(...prijzen), "priceCurrency": "EUR", "offerCount": aanbiedingen.length };
  } else if (beste && Prijs.zelfdeSamenstelling(beste)) {
    ld.offers = { "@type": "Offer", "price": vergelijkPrijs(beste), "priceCurrency": "EUR", "url": beste.url, "availability": "https://schema.org/InStock" };
  }
  const kruimel = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Warmtepompen", "item": `${SITE}/` },
      { "@type": "ListItem", "position": 2, "name": naam, "item": `${SITE}/pomp/${w.id}.html` },
    ],
  };
  return `<script type="application/ld+json">\n${JSON.stringify(ld, null, 2)}\n  </script>\n  <script type="application/ld+json">\n${JSON.stringify(kruimel, null, 2)}\n  </script>`;
}

function kop(actief, diepte) {
  const p = diepte ? "../" : "";
  return `<header class="site-header">
  <div class="container">
    <a class="logo" href="${p}index.html">
      <span class="logo-icoon">${ICOON_LOGO}</span>
      <span>Warmtepomp<b>maatje</b></span>
    </a>
    <button class="menu-knop" type="button" aria-expanded="false" aria-controls="hoofdnav" aria-label="Menu openen"><svg class="icoon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></svg></button>
    <nav class="hoofdnav" id="hoofdnav">
      <a href="${p}index.html"${actief === "index" ? ' class="actief"' : ""}>Warmtepompen</a>
      <a href="${p}advies.html">Keuzehulp</a>
      <a href="${p}rekenmodule.html">Terugverdientijd</a>
      <a href="${p}uitleg.html">Uitleg</a>
      <a href="${p}subsidie.html">Subsidie</a>
      <details class="nav-meer">
        <summary>Meer ${Iconen.svg("chevron")}</summary>
        <div class="nav-meer-paneel">
          <a href="${p}over-ons.html">Over ons</a>
          <a href="${p}contact.html">Contact</a>
          <a href="${p}privacy.html">Privacy &amp; disclaimer</a>
        </div>
      </details>
    </nav>
  </div>
</header>`;
}

function voet(diepte) {
  const p = diepte ? "../" : "";
  return `<footer class="site-footer">
  <div class="container">
    <b>${Iconen.svg("warmte")} Warmtepompmaatje</b>
    <p>Onafhankelijke vergelijking van warmtepompen voor Nederlandse huishoudens. Zustersite van <a href="https://zonnestroommaatje.nl/" target="_blank" rel="noopener">Zonnestroommaatje</a> (zonnepanelen en omvormers) en <a href="https://batterijmaatje.nl/" target="_blank" rel="noopener">Batterijmaatje.nl</a> (thuisbatterijen).</p>
    <p><a href="${p}index.html">Warmtepompen</a> · <a href="${p}advies.html">Keuzehulp</a> · <a href="${p}rekenmodule.html">Terugverdientijd</a> · <a href="${p}uitleg.html">Uitleg</a> · <a href="${p}subsidie.html">Subsidie</a> · <a href="${p}over-ons.html">Over ons</a> · <a href="${p}contact.html">Contact</a> · <a href="${p}privacy.html">Privacy &amp; disclaimer</a></p>
    <p class="disclaimer">Disclaimer: prijzen en specificaties zijn indicaties; er kunnen geen rechten aan worden ontleend. De prijs en voorwaarden op de website van de aanbieder zijn altijd leidend.</p>
  </div>
</footer>`;
}

function pompPagina(w) {
  const naam = `${w.merk} ${w.model}`;
  const beste = bestePrijs(w);
  const uitWinkel = !!(beste && !beste.is_richtprijs);
  const score = koppelScore(w);
  const aanbiedingen = Prijs.geldigeAanbiedingen(w);
  const specRij = (label, waarde) => waarde == null || waarde === "" ? "" : `<tr><th>${label}</th><td>${waarde}</td></tr>`;

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(naam)}: prijs, subsidie, geluid en slimme koppeling | Warmtepompmaatje.nl</title>
  <meta name="description" content="Alles over de ${esc(naam)} (${esc(w.type)}): actuele prijs, ISDE-subsidie, geluid van de buitenunit, rendement en of hij koppelt met Home Assistant en Homey (Koppel-score ${score}/6).">
  <link rel="canonical" href="${SITE}/pomp/${esc(w.id)}.html">
  <meta property="og:title" content="${esc(naam)}: prijs, subsidie en slimme koppeling">
  <meta property="og:description" content="${esc(w.type === "hybride" ? "Hybride warmtepomp" : "All-electric warmtepomp")}, Koppel-score ${score}/6, ISDE-indicatie ${w.isde_indicatie_eur ? eur(w.isde_indicatie_eur) : "onbekend"}.">
  <meta property="og:type" content="product">
  <meta property="og:url" content="${SITE}/pomp/${esc(w.id)}.html">
  <meta property="og:locale" content="nl_NL">
  <meta property="og:site_name" content="Warmtepompmaatje.nl">
  <meta property="og:image" content="${SITE}/assets/og-image.png">
  <meta name="twitter:card" content="summary_large_image">
  ${productLd(w)}
  <link rel="stylesheet" href="../assets/style.css?v=${ASSET_VERSIE}">
  <script src="../assets/iconen.js?v=${ASSET_VERSIE}" defer></script>
  <script src="../assets/nav.js?v=${ASSET_VERSIE}" defer></script>
  <link rel="icon" href="../assets/favicon.svg?v=1" type="image/svg+xml">
  <style>
    .product-indeling { display: grid; grid-template-columns: 1fr 340px; gap: 24px; align-items: start; margin: 20px 0 40px; }
    @media (max-width: 860px) { .product-indeling { grid-template-columns: 1fr; } }
    .product-indeling > * { min-width: 0; }
    .product-paneel { background: var(--kleur-wit); border: 1px solid var(--kleur-rand); border-radius: var(--radius); box-shadow: var(--schaduw); padding: 22px; }
    .spec-tabel { width: 100%; border-collapse: collapse; font-size: 0.95rem; table-layout: fixed; }
    .spec-tabel th { text-align: left; padding: 9px 12px 9px 0; color: var(--kleur-tekst-licht); font-weight: 600; vertical-align: top; width: 42%; overflow-wrap: anywhere; }
    .spec-tabel td { padding: 9px 0; border-bottom: 1px dotted var(--kleur-rand); vertical-align: top; overflow-wrap: anywhere; }
    .spec-tabel tr:last-child td { border-bottom: none; }
    .prijs-groot { font-size: 1.9rem; font-weight: 800; color: var(--kleur-primair-donker); }
    .breadcrumb { font-size: 0.85rem; color: var(--kleur-tekst-licht); margin: 16px 0 0; }
    .koppel-blok dt { font-weight: 700; margin-top: 10px; }
    .koppel-blok dd { margin: 2px 0 0; font-size: 0.93rem; color: var(--kleur-tekst-licht); }
  </style>
</head>
<body>

${kop("index", true)}

<main class="container">
  <p class="breadcrumb"><a href="../index.html">Warmtepompen</a> › ${esc(naam)}</p>
  <h1 class="pomp-titel">${esc(naam)}</h1>
  <p class="pomp-ondertitel">${w.type === "hybride" ? "Hybride warmtepomp (werkt samen met je cv-ketel)" : "All-electric warmtepomp (vervangt de cv-ketel volledig)"}${w.voorbeeld_variant ? ` · prijzen voor: ${esc(w.voorbeeld_variant)}` : ""}</p>
  <div class="koppel-meter koppel-meter-groot op-pagina">
    <div class="koppel-meter-kop">
      <span class="koppel-meter-label">${Iconen.svg("koppeling")} Koppel-score</span>
      <span class="koppel-meter-cijfer"><b>${score}</b><span class="van">/6</span></span>
    </div>
    <div class="meter-spoor" role="img" aria-label="Koppel-score ${score} van 6">${
      Array.from({ length: 6 }, (_, i) => `<span class="meter-vak${i < score ? " vol" : ""}"></span>`).join("")
    }</div>
  </div>

  <div class="product-indeling">
    <div class="product-paneel">
      <h2 class="kop-aansluitend">Specificaties</h2>
      <table class="spec-tabel">
        ${specRij("Type", w.type === "hybride" ? "Hybride (naast de cv-ketel)" : "All-electric (van het gas af)")}
        ${specRij("Vermogen", w.vermogen_kw ? `${String(w.vermogen_kw).replace(".", ",")} kW` : null)}
        ${specRij("Rendement (SCOP)", w.scop ? `${String(w.scop).replace(".", ",")}${w.scop_toelichting ? ` <small>(${esc(w.scop_toelichting)})</small>` : ""}` : (w.scop_toelichting ? esc(w.scop_toelichting) : null))}
        ${specRij("Geluid buitenunit", w.geluid_db ? `${w.geluid_db} dB(A)${w.geluid_toelichting ? ` <small>(${esc(w.geluid_toelichting)})</small>` : ""}` : null)}
        ${specRij("Koudemiddel", w.koudemiddel ? esc(w.koudemiddel) : null)}
        ${specRij("Warm tapwater", typeof w.tapwater === "string" ? esc(w.tapwater) : d3html(w.tapwater))}
        ${specRij("Maximale aanvoertemperatuur", w.max_aanvoer_c ? `${w.max_aanvoer_c} °C` : null)}
        ${specRij("ISDE-subsidie", w.isde_indicatie_eur ? `${eur(w.isde_indicatie_eur)} <small>${w.isde_meldcode ? `bij meldcode ${esc(w.isde_meldcode)} op de <a href="https://www.rvo.nl/subsidies-financiering/isde/meldcodelijsten/warmtepompen" target="_blank" rel="noopener">meldcodelijst van RVO</a>` : `(check de meldcode bij <a href="https://www.rvo.nl/subsidies-financiering/isde/woningeigenaren/warmtepomp" target="_blank" rel="noopener">RVO</a>)`}</small>` : null)}
      </table>

      <div class="info-kader los">
        <b>Wat je nodig hebt voor je ISDE-aanvraag</b>
        <p class="onder-kop">De ISDE-subsidie loopt per goedgekeurd apparaat, elk met een eigen meldcode. Wij vermelden die meldcode bewust niet: RVO werkt de lijst regelmatig bij en één model heeft vaak meerdere codes per vermogensvariant. Zoek de juiste meldcode op met deze gegevens van deze warmtepomp:</p>
        <ul class="onder-lijst">
          <li><b>Merk:</b> ${esc(w.merk)}</li>
          <li><b>Model:</b> ${esc(w.model)}</li>
          <li><b>Uitvoering:</b> ${w.type === "hybride" ? "hybride" : "all-electric"}</li>
          ${w.vermogen_kw ? `<li><b>Vermogen:</b> ${String(w.vermogen_kw).replace(".", ",")} kW${w.voorbeeld_variant ? ` <small>(variant: ${esc(w.voorbeeld_variant)})</small>` : ""}</li>` : ""}
        </ul>
        <p class="onder-lijst">Zoek dit apparaat op de <a href="https://www.rvo.nl/subsidies-financiering/isde/woningeigenaren/warmtepomp" target="_blank" rel="noopener">apparatenlijst bij RVO</a>. De meldcode en het exacte subsidiebedrag daar zijn leidend.</p>
      </div>

      <h2>Slim koppelen (Koppel-score ${score}/6)</h2>
      <dl class="koppel-blok">
        <dt>${Iconen.svg(driewaardig(w.sturing).status === "ja" ? "ja" : driewaardig(w.sturing).status === "deels" ? "deels" : "nee")} Slimme aansturing</dt><dd>${esc(driewaardig(w.sturing).tekst)}</dd>
        <dt>${Iconen.svg(driewaardig(w.home_assistant).status === "ja" ? "ja" : driewaardig(w.home_assistant).status === "deels" ? "deels" : "nee")} Home Assistant</dt><dd>${esc(driewaardig(w.home_assistant).tekst)}</dd>
        <dt>${Iconen.svg(driewaardig(w.homey).status === "ja" ? "ja" : driewaardig(w.homey).status === "deels" ? "deels" : "nee")} Homey</dt><dd>${esc(driewaardig(w.homey).tekst)}</dd>
      </dl>
      <p class="hint los">Integraties veranderen per firmware- en appversie; controleer de actuele status vóór aankoop. <a href="../index.html#koppel-score">Zo werkt de Koppel-score ${Iconen.svg("pijl-rechts")}</a></p>
    </div>

    <div class="product-paneel">
      <h2 class="kop-aansluitend">Prijs</h2>
      <div class="prijs-groot">${beste ? eur(vergelijkPrijs(beste)) : "Prijs op aanvraag"}</div>
      <p class="hint prijs-hint">${uitWinkel ? `laagste prijs, bij ${esc(beste.winkel)}` : "richtprijs (indicatie), exclusief installatie"}${w.prijs_toelichting ? `<br>${esc(w.prijs_toelichting)}` : ""}${Prijs.prijsToelichting(beste) ? `<br>${esc(Prijs.prijsToelichting(beste))}` : ""}</p>
      ${aanbiedingen.length ? `<ul class="winkel-lijst">${aanbiedingen.map((a) => `<li><span class="winkel-naam">${esc(a.winkel)}${Prijs.prijsToelichting(a) ? `<br><small class="hint">${esc(Prijs.prijsToelichting(a))}</small>` : ""}</span><span class="winkel-bedrag"><b>${eur(vergelijkPrijs(a))}</b> <a href="${esc(a.affiliate_url || a.url)}" target="_blank" rel="noopener${a.affiliate_url ? " sponsored" : ""}">bekijk</a></span></li>`).join("")}</ul>` : ""}
      ${w.prijs_datum ? `<p class="datum-stempel onder-lijst-strak">Prijzen gecontroleerd: ${esc(datumNL(w.prijs_datum))}. Zonder controledatum is de prijs een indicatie.</p>` : ""}
      <p class="knoppen-kolom">
        ${beste && (beste.url || beste.affiliate_url) ? `<a class="knop" href="${esc(beste.affiliate_url || beste.url)}" target="_blank" rel="noopener">${uitWinkel ? `Bekijk aanbieding ${Iconen.svg("pijl-rechts")}` : `Naar fabrikant ${Iconen.svg("pijl-rechts")}`}</a>` : ""}
        <a class="knop knop-secundair" href="../rekenmodule.html?pomp=${encodeURIComponent(w.id)}">Bereken je terugverdientijd ${Iconen.svg("pijl-rechts")}</a>
        <a class="knop knop-secundair" href="../advies.html">Past deze pomp bij mijn huis? ${Iconen.svg("pijl-rechts")}</a>
      </p>
    </div>
  </div>

  <section class="content-pagina aansluitend">
    ${variantenBlok(w)}
    <h2>Over de ${esc(naam)}</h2>
    <p>${esc(w.omschrijving || `${naam} is een ${w.type === "hybride" ? "hybride warmtepomp die samenwerkt met je cv-ketel: de pomp doet het gros van de verwarming, de ketel vangt piekkou en warm water op" : "all-electric warmtepomp die de cv-ketel volledig vervangt, inclusief warm tapwater via een boilervat"}.`)}</p>
    <p>Twijfel je nog over het type of het merk? Doe de <a href="../advies.html">keuzehulp</a>, of zet deze pomp naast twee andere in de <a href="../index.html">vergelijker</a> (vink "vergelijk" aan op maximaal drie kaarten).</p>
  </section>
</main>

${voet(true)}

</body>
</html>
`;
}

mkdirSync(join(ROOT, "pomp"), { recursive: true });
for (const w of pompen) {
  writeFileSync(join(ROOT, "pomp", `${w.id}.html`), pompPagina(w));
}
console.log(`${pompen.length} productpagina's gegenereerd in /pomp/`);

// Sitemap herbouwen

/* ------------------------------------------------------------------
   De vergelijker voorrenderen in index.html

   De kaarten werden pas in de browser getekend. In de HTML die een bezoeker of
   een zoekmachine binnenkrijgt stond alleen "Warmtepompen laden...": geen
   merknamen, geen prijzen, en geen enkele link naar de dertig pomppagina's.
   Zoekmachines voeren JavaScript wel uit, maar later en minder betrouwbaar, en
   interne links bepalen mede hoe goed die pagina's gevonden worden.

   De opmaak komt uit assets/kaart.js, dezelfde module die de browser gebruikt,
   dus er kan geen verschil ontstaan.
   ------------------------------------------------------------------ */

const BEGIN = "<!-- kaarten:begin -->";
const EIND = "<!-- kaarten:eind -->";

const gesorteerdePompen = Kaart.standaardVolgorde(data.warmtepompen);

const kaarten = gesorteerdePompen
  .map((w) => Kaart.kaartHtml(w, { pompen: data.warmtepompen }))
  .join("\n");

const itemLijst = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "Warmtepompen vergeleken",
  description: "Alle vergeleken warmtepompen, gerangschikt op Koppel-score.",
  numberOfItems: gesorteerdePompen.length,
  itemListElement: gesorteerdePompen.map((w, i) => ({
    "@type": "ListItem",
    position: i + 1,
    url: `${SITE}/pomp/${w.id}.html`,
    name: `${w.merk} ${w.model}`,
  })),
};

let index = readFileSync(join(ROOT, "index.html"), "utf8");
const beginPositie = index.indexOf(BEGIN);
const eindPositie = index.indexOf(EIND);
if (beginPositie === -1 || eindPositie === -1) {
  throw new Error(`index.html mist de markeringen ${BEGIN} en ${EIND}; de kaarten kunnen er niet in gezet worden.`);
}

index =
  index.slice(0, beginPositie + BEGIN.length) +
  "\n" + kaarten + "\n    " +
  index.slice(eindPositie);

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

writeFileSync(join(ROOT, "index.html"), index, "utf8");
console.log(`index.html: ${gesorteerdePompen.length} kaarten voorgerenderd en ItemList bijgewerkt`);

const vast = [
  { loc: `${SITE}/`, prio: "1.0" },
  { loc: `${SITE}/advies.html`, prio: "0.9" },
  { loc: `${SITE}/rekenmodule.html`, prio: "0.9" },
  { loc: `${SITE}/uitleg.html`, prio: "0.8" },
  { loc: `${SITE}/subsidie.html`, prio: "0.8" },
  { loc: `${SITE}/over-ons.html`, prio: "0.4" },
  { loc: `${SITE}/contact.html`, prio: "0.4" },
  { loc: `${SITE}/privacy.html`, prio: "0.2" },
];
const urls = [...vast, ...pompen.map((w) => ({ loc: `${SITE}/pomp/${w.id}.html`, prio: "0.7" }))];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${VANDAAG}</lastmod><priority>${u.prio}</priority></url>`).join("\n") +
  `\n</urlset>\n`;
writeFileSync(join(ROOT, "sitemap.xml"), sitemap);
console.log(`sitemap.xml herbouwd met ${urls.length} URL's`);
