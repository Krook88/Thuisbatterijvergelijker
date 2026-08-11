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

// Dezelfde icoonset als de browser gebruikt, zodat een icoon op een
// gegenereerde pagina identiek is aan datzelfde icoon in de vergelijker.
const vereis = createRequire(import.meta.url);
const Iconen = vereis("../assets/iconen.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SITE = "https://zonnestroommaatje.nl";
const VANDAAG = new Date().toISOString().slice(0, 10);
// Versienummer achter css/js-links: dwingt browsers om na een wijziging
// het nieuwe bestand op te halen in plaats van een oude kopie uit de cache.
const ASSET_VERSIE = "20260728a";

const data = JSON.parse(readFileSync(resolve(ROOT, "data/panelen.json"), "utf8"));
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

// ISO-datum (2026-07-21) leesbaar maken als "21 juli 2026"
const datumNL = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
};

function bestePrijs(p) {
  const a = (p.aanbiedingen || []).filter((x) => x && x.prijs_eur);
  if (a.length) return a.reduce((m, x) => (x.prijs_eur < m.prijs_eur ? x : m));
  if (p.richtprijs_eur) return { winkel: p.prijs_bron || "richtprijs (indicatie)", prijs_eur: p.richtprijs_eur, url: p.product_url };
  return null;
}

const prijsPerWp = (p) => {
  const beste = bestePrijs(p);
  return beste && p.vermogen_wp ? beste.prijs_eur / p.vermogen_wp : null;
};

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

function productLd(p) {
  const offers = (p.aanbiedingen || []).filter((a) => a && a.prijs_eur);
  const ld = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": `${volledigeNaam(p)}`,
    "brand": { "@type": "Brand", "name": p.merk },
    "description": `${volledigeNaam(p)}: zonnepaneel van ${p.vermogen_wp} Wp met ${nl(p.rendement_pct)}% rendement. ${p.opmerkingen || ""}`.slice(0, 300),
    "url": `${SITE}/paneel/${p.id}.html`,
  };
  if (offers.length === 1) {
    ld.offers = { "@type": "Offer", "price": offers[0].prijs_eur, "priceCurrency": "EUR", "url": offers[0].url };
  } else if (offers.length > 1) {
    const prijzen = offers.map((o) => o.prijs_eur);
    ld.offers = {
      "@type": "AggregateOffer",
      "lowPrice": Math.min(...prijzen),
      "highPrice": Math.max(...prijzen),
      "priceCurrency": "EUR",
      "offerCount": offers.length,
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
    <a class="logo" href="/index.html">
      <span class="logo-icoon">${Iconen.svg("zon")}</span>
      <span>Zonnestroom<b>maatje</b></span>
    </a>
    <nav class="hoofdnav">
      <a href="/index.html">Zonnepanelen</a>
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
          <a href="/regelgeving.html">Regels &amp; subsidies</a>
          <a href="/beste-zonnepanelen-klein-dak.html">Beste voor een klein dak</a>
          <a href="/beste-glas-glas-zonnepanelen.html">Beste glas-glas panelen</a>
          <a href="/over-ons.html">Over ons</a>
          <a href="/contact.html">Contact</a>
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
    <p><a href="/index.html">Zonnepanelen</a> · <a href="/omvormers.html">Omvormers</a> · <a href="/systeem.html">Samenstellen</a> · <a href="/advies.html">Keuzehulp</a> · <a href="/rekenmodule.html">Terugverdientijd</a> · <a href="/energieplan.html">Jouw energieplan</a> · <a href="/uitleg.html">Uitleg</a> · <a href="/waar-zonnepanelen-kopen.html">Waar koop je panelen?</a> · <a href="/regelgeving.html">Regels &amp; subsidies</a> · <a href="/index.html#veelgestelde-vragen">Veelgestelde vragen</a> · <a href="/beste-zonnepanelen-klein-dak.html">Beste voor een klein dak</a> · <a href="/beste-glas-glas-zonnepanelen.html">Beste glas-glas panelen</a> · <a href="/over-ons.html">Over ons</a> · <a href="/contact.html">Contact</a> · <a href="/privacy.html">Privacy &amp; disclaimer</a></p>
    <p class="disclaimer">Disclaimer: prijzen en specificaties veranderen regelmatig; er kunnen geen rechten aan worden ontleend. Prijzen zijn indicatief; de prijs en voorwaarden op de website van de aanbieder zijn altijd leidend.</p>
  </div>
</footer>`;

// Wikkelt een of meer JSON-LD-strings elk in een eigen <script>-blok
const wrapLd = (...jsons) => jsons.filter(Boolean).map((j) => `<script type="application/ld+json">\n${j}\n  </script>`).join("\n  ");

function kop(titel, metaDesc, canoniek, ld = "") {
  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(titel)} | Zonnestroommaatje.nl</title>
  <meta name="description" content="${esc(metaDesc)}">
  <link rel="canonical" href="${canoniek}">
  <meta property="og:title" content="${esc(titel)}">
  <meta property="og:description" content="${esc(metaDesc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${canoniek}">
  <meta property="og:locale" content="nl_NL">
  <meta property="og:image" content="${SITE}/assets/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name" content="Zonnestroommaatje.nl">
  <meta name="twitter:card" content="summary_large_image">
  ${ld}
  <link rel="stylesheet" href="/assets/style.css?v=${ASSET_VERSIE}">
  <link rel="icon" href="/assets/favicon.svg?v=1" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png?v=1">
</head>
<body>
${NAV}`;
}

const staart = `
${FOOTER}

<script src="/assets/nav.js?v=${ASSET_VERSIE}" defer></script>
</body>
</html>
`;

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
    (beste ? `, richtprijs ${eur(beste.prijs_eur)}` : "") +
    `. Bekijk specificaties, garanties, Zeker-score en bereken de opbrengst voor jouw dak.`;

  const specRij = (label, waarde) => waarde == null || waarde === "" ? "" :
    `<tr><th style="text-align:left;padding:10px 14px;background:var(--kleur-achtergrond);white-space:nowrap;width:40%;">${esc(label)}</th><td style="padding:10px 14px;">${waarde}</td></tr>`;

  return `${kop(
    `${volledigeNaam(p)}: prijs, specificaties en garantie`,
    metaDesc,
    `${SITE}/paneel/${esc(p.id)}.html`,
    wrapLd(productLd(p), breadcrumbLd(p))
  )}

<main class="content-pagina">

  <p class="datum-stempel"><a href="/index.html">Zonnepanelen</a> › ${esc(volledigeNaam(p))}</p>
  <div style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap;">
    <div style="flex:1;min-width:250px;">
      <h1>${merkLogoHtml(p.merk)}${esc(volledigeNaam(p))}</h1>
      <p class="intro">${esc(celtypeLabel(p))} zonnepaneel van ${p.vermogen_wp} Wp, ${esc(p.uitvoering)}${p.full_black ? ", full black" : ""}${p.bifaciaal ? ", bifaciaal" : ""}. Prijzen laatst gecontroleerd op ${esc(datumNL(p.prijs_datum || data.laatst_bijgewerkt))}.</p>
    </div>
    ${typeIllustratie(p.celtype)}
  </div>

  <div class="info-kader">
    ${beste ? `<div style="font-size:1.6rem;font-weight:800;">${eur(beste.prijs_eur)} <span style="font-size:0.95rem;font-weight:400;color:var(--kleur-tekst-licht);">${perWp ? `${eurWp(perWp)} per Wp` : ""} · ${esc(beste.winkel)}</span></div>` : "<div><b>Prijs op aanvraag</b></div>"}
    ${p.prijs_omvat ? `<div style="font-size:0.9rem;color:var(--kleur-tekst-licht);">${esc(p.prijs_omvat)}</div>` : ""}
    <p style="margin:14px 0 0;">
      ${beste && beste.url && !String(beste.winkel || "").startsWith("richtprijs") ? `<a class="knop" href="${esc(beste.affiliate_url || beste.url)}" target="_blank" rel="noopener${beste.affiliate_url ? " sponsored" : ""}">Bekijk bij ${esc(beste.winkel)} ${Iconen.svg("pijl-rechts")}</a>&nbsp;` : ""}
      <a class="knop knop-secundair" href="/rekenmodule.html?paneel=${encodeURIComponent(p.id)}">Bereken terugverdientijd</a>
    </p>
  </div>

  <h2>Specificaties</h2>
  <div style="overflow-x:auto;background:var(--kleur-wit);border:1px solid var(--kleur-rand);border-radius:var(--radius);">
  <table style="width:100%;border-collapse:collapse;font-size:0.95rem;">
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
  <p><span style="color:var(--kleur-accent);letter-spacing:2px;">${sterren(dakSterren(p))}</span> (opbrengst per m² dak: ${dakSterren(p)} van 5)</p>
  <p>Op een gunstig zuiddak levert dit paneel circa <b>${opbrengstZuid} kWh per jaar</b>; op een oost-westdak circa <b>${opbrengstOW} kWh</b>. Tien panelen komen dan uit op zo'n ${Math.round(opbrengstZuid * 10 / 100) * 100} respectievelijk ${Math.round(opbrengstOW * 10 / 100) * 100} kWh per jaar. <a href="/rekenmodule.html?paneel=${encodeURIComponent(p.id)}">Bereken de opbrengst en terugverdientijd voor jouw situatie</a>.</p>

  <h2>Degelijkheid en garanties</h2>
  <p style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">${zekerScoreBadge(p)}
    <span class="badge ${p.uitvoering === "glas-glas" ? "ja" : "nee"}">${p.uitvoering === "glas-glas" ? "" + Iconen.svg("ja") + "" : "" + Iconen.svg("nee") + ""} Glas-glas</span>
    <span class="badge ${(p.garantie_product_jaar || 0) >= 25 ? "ja" : "nee"}">${(p.garantie_product_jaar || 0) >= 25 ? "" + Iconen.svg("ja") + "" : "" + Iconen.svg("nee") + ""} 25+ jaar productgarantie</span>
  </p>
  <p class="datum-stempel">De <a href="/uitleg.html#zeker-score">Zeker-score</a> telt productgarantie, vermogensbehoud na 25 jaar en glas-glas uitvoering op: 2 punten per onderdeel.</p>

  ${p.opmerkingen ? `<h2>Goed om te weten</h2><p>${esc(p.opmerkingen)}</p>` : ""}

  ${(p.aanbiedingen || []).length ? `<h2>Verkrijgbaar bij</h2>
  <ul>
    ${p.aanbiedingen.map((a) => `<li><a href="${esc(a.affiliate_url || a.url)}" target="_blank" rel="noopener${a.affiliate_url ? " sponsored" : ""}">${esc(a.winkel)}</a>: <b>${eur(a.prijs_eur)}</b> <span class="datum-stempel">${a.datum ? `(gecontroleerd ${esc(datumNL(a.datum))})` : "(prijsindicatie; klik voor de actuele prijs)"}</span></li>`).join("\n    ")}
  </ul>
  <p class="datum-stempel">De prijs op de website van de winkel is altijd leidend.${(p.aanbiedingen || []).some((a) => a.affiliate_url) ? " Sommige links zijn commissielinks: koop je via die link, dan ontvangen wij een kleine vergoeding van de winkel. Dit kost jou niets en beïnvloedt onze scores en volgorde niet." : ""}</p>` : ""}

  ${VERGELIJKINGEN.filter((v) => v.a === p.id || v.b === p.id).length ? `<h2>Vergelijk met alternatieven</h2>
  <ul>
    ${VERGELIJKINGEN.filter((v) => v.a === p.id || v.b === p.id).map((v) => {
      const ander = paneelById[v.a === p.id ? v.b : v.a];
      return `<li><a href="/vergelijk/${esc(v.slug)}.html">${esc(volledigeNaam(p))} vs ${esc(volledigeNaam(ander))}</a></li>`;
    }).join("\n    ")}
  </ul>` : ""}

  <div class="waarschuwing-kader">Twijfel je of dit paneel bij je past? Doe de <a href="/advies.html">keuzehulp</a> voor een advies op maat, of <a href="/index.html">vergelijk alle zonnepanelen</a> op prijs per Wp, rendement en Zeker-score.</div>

  ${p.product_url ? `<p>Meer informatie: <a href="${esc(p.product_url)}" target="_blank" rel="noopener">officiële website van ${esc(p.merk)}</a>.</p>` : ""}

</main>
${staart}`;
}

/* ------------------------------------------------------------------
   Overzichtspagina's (SEO-landingspagina's). Worden mee-gegenereerd,
   zodat prijzen en volgorde automatisch actueel blijven.
   ------------------------------------------------------------------ */

const OVERZICHTEN = [
  {
    bestand: "beste-zonnepanelen-klein-dak.html",
    titel: "Beste zonnepanelen voor een klein dak (2026)",
    metaDesc: "Weinig dakruimte? Deze zonnepanelen leveren de meeste opbrengst per vierkante meter. Vergelijking op rendement, Wp per m², prijs en garanties.",
    intro: "Past je gewenste vermogen niet zomaar op je dak, dan telt elke vierkante meter. Het rendement van een paneel bepaalt direct hoeveel wattpiek er per m² past: 22% rendement is circa 220 Wp per m². Back-contact panelen zijn hier de koningen, maar je betaalt er iets meer voor. Hieronder alle panelen uit onze vergelijker, gesorteerd op opbrengst per vierkante meter.",
    selecteer: (lijst) => [...lijst].sort((a, b) => (b.rendement_pct || 0) - (a.rendement_pct || 0)),
    voetnoot: "Tip: reken eerst uit hoeveel wattpiek je nodig hebt met de keuzehulp; misschien past een gewone middenklasser prima en bespaar je honderden euro's.",
  },
  {
    bestand: "beste-glas-glas-zonnepanelen.html",
    titel: "Beste glas-glas zonnepanelen (2026)",
    metaDesc: "Glas-glas zonnepanelen vergeleken op prijs per Wp, garanties en rendement. Waarom glas-glas langer meegaat en wat het tegenwoordig kost.",
    intro: "Bij een glas-glas paneel liggen de cellen tussen twee lagen glas in plaats van glas en kunststof folie. Dat beschermt beter tegen vocht en microscheurtjes, vertraagt veroudering en levert vaak langere garanties op. Sinds fabrikanten dun gehard glas gebruiken, is het verschil in prijs en gewicht met foliepanelen klein. Hieronder alle glas-glas panelen uit onze vergelijker, gesorteerd op prijs per wattpiek.",
    selecteer: (lijst) => lijst.filter((p) => p.uitvoering === "glas-glas").sort((a, b) => (prijsPerWp(a) || Infinity) - (prijsPerWp(b) || Infinity)),
    voetnoot: "Lees ook de uitleg over glas-glas en glas-folie in onze woordenlijst.",
  },
];

function overzichtTabel(lijst) {
  return `<div style="overflow-x:auto;background:var(--kleur-wit);border:1px solid var(--kleur-rand);border-radius:var(--radius);margin:14px 0;">
  <table style="width:100%;border-collapse:collapse;font-size:0.93rem;min-width:680px;">
    <thead><tr>
      <th style="text-align:left;padding:10px 14px;background:var(--kleur-achtergrond);position:sticky;left:0;z-index:1;box-shadow:2px 0 0 var(--kleur-rand);">Paneel</th>
      <th style="text-align:left;padding:10px 14px;background:var(--kleur-achtergrond);">Wp</th>
      <th style="text-align:left;padding:10px 14px;background:var(--kleur-achtergrond);">Rendement</th>
      <th style="text-align:left;padding:10px 14px;background:var(--kleur-achtergrond);">Prijs</th>
      <th style="text-align:left;padding:10px 14px;background:var(--kleur-achtergrond);">€/Wp</th>
      <th style="text-align:left;padding:10px 14px;background:var(--kleur-achtergrond);">Uitvoering</th>
      <th style="text-align:left;padding:10px 14px;background:var(--kleur-achtergrond);">Zeker-score</th>
    </tr></thead>
    <tbody>${lijst.map((p) => {
      const beste = bestePrijs(p);
      const perWp = prijsPerWp(p);
      return `
      <tr>
        <td style="padding:10px 14px;border-top:1px solid var(--kleur-rand);position:sticky;left:0;z-index:1;background:var(--kleur-wit);box-shadow:2px 0 0 var(--kleur-rand);">${merkLogoHtml(p.merk)}<a href="/paneel/${esc(p.id)}.html"><b>${esc(volledigeNaam(p))}</b></a></td>
        <td style="padding:10px 14px;border-top:1px solid var(--kleur-rand);white-space:nowrap;">${p.vermogen_wp}</td>
        <td style="padding:10px 14px;border-top:1px solid var(--kleur-rand);white-space:nowrap;">${nl(p.rendement_pct)}% <small>(${Math.round((p.rendement_pct || 0) * 10)} Wp/m²)</small></td>
        <td style="padding:10px 14px;border-top:1px solid var(--kleur-rand);white-space:nowrap;">${beste ? `<b>${eur(beste.prijs_eur)}</b>` : "op aanvraag"}</td>
        <td style="padding:10px 14px;border-top:1px solid var(--kleur-rand);white-space:nowrap;">${perWp ? eurWp(perWp) : "n.b."}</td>
        <td style="padding:10px 14px;border-top:1px solid var(--kleur-rand);white-space:nowrap;">${esc(p.uitvoering)}${p.full_black ? "<br><small>full black</small>" : ""}</td>
        <td style="padding:10px 14px;border-top:1px solid var(--kleur-rand);white-space:nowrap;"><b>${zekerScore(p)}/6</b></td>
      </tr>`;
    }).join("")}</tbody>
  </table>
  </div>`;
}

function overzichtsPagina(cfg) {
  const lijst = cfg.selecteer(data.panelen);
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

  return `${kop(cfg.titel, cfg.metaDesc, `${SITE}/${cfg.bestand}`, wrapLd(itemList))}

<main class="container" style="max-width:900px;">
  <p class="datum-stempel" style="margin-top:22px;"><a href="/index.html">${Iconen.svg("pijl-links")} Alle zonnepanelen vergelijken</a></p>
  <h1>${esc(cfg.titel)}</h1>
  <p class="datum-stempel">Automatisch samengesteld uit onze vergelijker · laatst bijgewerkt op ${datumNL(data.laatst_bijgewerkt || VANDAAG)}</p>
  <p>${esc(cfg.intro)}</p>
  ${overzichtTabel(lijst)}
  <p>${esc(cfg.voetnoot)} Zie de <a href="/advies.html">keuzehulp</a> en de <a href="/uitleg.html#woordenlijst">woordenlijst</a>.</p>
  <div class="waarschuwing-kader">Prijzen zijn indicatieve richtprijzen; de prijs en specificaties op de website van de aanbieder zijn altijd leidend. Deze pagina wordt automatisch herbouwd vanuit onze <a href="/index.html">vergelijker</a>.</div>
</main>
${staart}`;
}

/* ------------------------------------------------------------------
   Vergelijkingspagina's "X vs Y" (SEO-landingspagina's voor veel
   gezochte duels). Volledig uit de data gegenereerd en herbouwd,
   zodat prijzen en scores actueel blijven.
   ------------------------------------------------------------------ */

const VERGELIJKINGEN = [
  { a: "dmegc-440-glas-glas", b: "ulica-440-full-black" },
  { a: "aiko-neostar-2p-455", b: "longi-himo-x6-440" },
  { a: "jinko-tiger-neo-440", b: "ja-solar-jam54d41-440" },
  { a: "trina-vertex-s-plus-450", b: "denim-440-full-black" },
  { a: "rec-alpha-pure-2-420", b: "maxeon-6-440" },
  { a: "qcells-qtron-430", b: "canadian-solar-tophiku6-435" },
].map((v) => ({ ...v, slug: `${v.a}-vs-${v.b}` }));

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

  const celStijl = 'style="padding:10px 14px;border-top:1px solid var(--kleur-rand);vertical-align:top;"';
  const rij = (label, wa, wb, winnaar = -1) =>
    `<tr><th style="text-align:left;padding:10px 14px;border-top:1px solid var(--kleur-rand);background:var(--kleur-achtergrond);white-space:normal;min-width:110px;vertical-align:top;position:sticky;left:0;z-index:1;box-shadow:2px 0 0 var(--kleur-rand);">${esc(label)}</th>` +
    `<td ${celStijl}>${winnaar === 0 ? `<b>${wa}</b>` : wa}</td>` +
    `<td ${celStijl}>${winnaar === 1 ? `<b>${wb}</b>` : wb}</td></tr>`;

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

  return `${kop(`${titel} (2026)`, metaDesc, `${SITE}/vergelijk/${esc(v.slug)}.html`, wrapLd(itemList))}

<main class="container" style="max-width:900px;">
  <p class="datum-stempel" style="margin-top:22px;"><a href="/index.html">${Iconen.svg("pijl-links")} Alle zonnepanelen vergelijken</a></p>
  <h1>${esc(naam(A))} vs ${esc(naam(B))}</h1>
  <p class="datum-stempel">Op basis van dezelfde feiten als onze vergelijker · laatst bijgewerkt op ${datumNL(data.laatst_bijgewerkt || VANDAAG)}</p>
  <p>Twee veelvergeleken zonnepanelen naast elkaar. Onder de tabel staan de belangrijkste verschillen op een rij. Vetgedrukt betekent: op dit punt objectief in het voordeel.</p>

  <div style="overflow-x:auto;background:var(--kleur-wit);border:1px solid var(--kleur-rand);border-radius:var(--radius);margin:14px 0;">
  <table style="width:100%;border-collapse:collapse;font-size:0.93rem;min-width:560px;">
    <thead><tr>
      <th style="text-align:left;padding:10px 14px;background:var(--kleur-achtergrond);position:sticky;left:0;z-index:1;"></th>
      <th style="text-align:left;padding:10px 14px;background:var(--kleur-achtergrond);"><a href="/paneel/${esc(A.id)}.html">${esc(naam(A))}</a></th>
      <th style="text-align:left;padding:10px 14px;background:var(--kleur-achtergrond);"><a href="/paneel/${esc(B.id)}.html">${esc(naam(B))}</a></th>
    </tr></thead>
    <tbody>
      ${rij("Prijs", besteA ? eur(besteA.prijs_eur) : "op aanvraag", besteB ? eur(besteB.prijs_eur) : "op aanvraag")}
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

  <div class="waarschuwing-kader">Prijzen en specificaties veranderen regelmatig; deze pagina wordt automatisch herbouwd. De prijs en voorwaarden op de website van de aanbieder zijn altijd leidend.</div>
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

for (const cfg of OVERZICHTEN) {
  writeFileSync(resolve(ROOT, cfg.bestand), relativeer(overzichtsPagina(cfg), 0), "utf8");
}
console.log(`${OVERZICHTEN.length} overzichtspagina's gegenereerd (klein dak, glas-glas)`);

mkdirSync(resolve(ROOT, "vergelijk"), { recursive: true });
for (const v of VERGELIJKINGEN) {
  writeFileSync(resolve(ROOT, "vergelijk", `${v.slug}.html`), relativeer(vergelijkingsPagina(v), 1), "utf8");
}
console.log(`${VERGELIJKINGEN.length} vergelijkingspagina's gegenereerd in /vergelijk/`);

/* ------------------------------------------------------------------
   Sitemap herbouwen (vaste pagina's + paneelpagina's)
   ------------------------------------------------------------------ */

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
  { loc: `${SITE}/over-ons.html`, freq: "monthly", prio: "0.4" },
  { loc: `${SITE}/contact.html`, freq: "yearly", prio: "0.3" },
  { loc: `${SITE}/privacy.html`, freq: "yearly", prio: "0.2" },
];

const urls = [
  ...vast,
  ...data.panelen.map((p) => ({ loc: `${SITE}/paneel/${p.id}.html`, freq: "weekly", prio: "0.7" })),
  ...VERGELIJKINGEN.map((v) => ({ loc: `${SITE}/vergelijk/${v.slug}.html`, freq: "weekly", prio: "0.7" })),
];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${VANDAAG}</lastmod>\n    <changefreq>${u.freq}</changefreq>\n    <priority>${u.prio}</priority>\n  </url>`).join("\n") +
  `\n</urlset>\n`;

writeFileSync(resolve(ROOT, "sitemap.xml"), sitemap, "utf8");
console.log(`sitemap.xml herbouwd met ${urls.length} URL's (lastmod ${VANDAAG})`);
