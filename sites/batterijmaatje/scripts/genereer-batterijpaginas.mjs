#!/usr/bin/env node
/**
 * Genereert statische detailpagina's per batterij in /batterij/<id>.html
 * op basis van data/batterijen.json, en herbouwt sitemap.xml.
 *
 * Wordt lokaal gedraaid bij wijzigingen en dagelijks door de
 * prijsupdate-workflow, zodat prijzen op de pagina's actueel blijven.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// Dezelfde prijslogica en iconen als de browser gebruikt, zodat een
// batterijpagina nooit een ander bedrag of ander icoon toont dan de vergelijker.
const vereis = createRequire(import.meta.url);
const Prijs = vereis("../assets/prijs.js");
const Iconen = vereis("../assets/iconen.js");
const Kaart = vereis("../assets/kaart.js");

// Het merkicoon staat in de kop en de voet van elke pagina.
const ICOON_LOGO = Iconen.svg("batterij", { klasse: "icoon-groot" });

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SITE = "https://batterijmaatje.nl";
const VANDAAG = new Date().toISOString().slice(0, 10);
// Versienummer achter css/js-links: dwingt browsers om na een wijziging
// het nieuwe bestand op te halen in plaats van een oude kopie uit de cache.
const ASSET_VERSIE = "20260727a";

const data = JSON.parse(readFileSync(resolve(ROOT, "data/batterijen.json"), "utf8"));
mkdirSync(resolve(ROOT, "batterij"), { recursive: true });

/* ------------------------------------------------------------------ */

const esc = (s) => String(s == null ? "" : s)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const eur = (n) => "€ " + Number(n).toLocaleString("nl-NL", { maximumFractionDigits: 0 });
const nl = (n) => String(n).replace(".", ",");

// ISO-datum (2026-07-13) leesbaar maken als "13 juli 2026"
const datumNL = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
};

// Zoekmachines tonen ongeveer 60 tekens van een titel en 155 van een
// omschrijving; de rest wordt afgekapt. Dat is meestal net de merknaam of de
// zin die de bezoeker moest overhalen. Deze functies houden daar rekening mee
// in plaats van te hopen dat het past.
const TITEL_MAX = 60;
const OMSCHRIJVING_MAX = 155;
const MERK_ACHTERVOEGSEL = " | Batterijmaatje";

// De merknaam achteraan is prettig voor herkenning, maar niet ten koste van de
// inhoud: past hij niet, dan valt hij weg in plaats van de titel af te kappen.
function titelMetMerk(kern) {
  return kern.length + MERK_ACHTERVOEGSEL.length <= TITEL_MAX ? kern + MERK_ACHTERVOEGSEL : kern;
}

// Kiest de eerste variant die binnen de ruimte past. De modelnaam staat altijd
// vooraan, want daar zoekt de bezoeker op; het achtervoegsel mag wijken.
function besteTitel(varianten) {
  for (const variant of varianten) {
    const metMerk = titelMetMerk(variant);
    if (metMerk.length <= TITEL_MAX) return metMerk;
  }
  return varianten[varianten.length - 1];
}

// Afkappen op een woordgrens, zodat er geen half woord blijft staan.
function kortOmschrijving(tekst, maximum = OMSCHRIJVING_MAX) {
  if (tekst.length <= maximum) return tekst;
  const geknipt = tekst.slice(0, maximum - 1);
  const spatie = geknipt.lastIndexOf(" ");
  return (spatie > maximum * 0.6 ? geknipt.slice(0, spatie) : geknipt).replace(/[,.;:]$/, "") + "\u2026";
}

// Voor titels: de capaciteit tussen haakjes achter een modelnaam is nuttig op
// de pagina zelf, maar vreet de ruimte op in een zoekresultaat.
const naamZonderHaakjes = (b) => volledigeNaam(b).replace(/\s*\([^)]*\)\s*$/, "").trim();

const bestePrijs = Prijs.beste;
const perKwhInclBtw = Prijs.prijsPerKwh;

function driewaardig(v) {
  // Objectvorm {status, tekst}: officiële ondersteuning ("ja") mét uitlegtekst
  if (v && typeof v === "object") return { status: v.status || "deels", tekst: v.tekst || "" };
  if (v === true) return { status: "ja", tekst: "Ja" };
  if (typeof v === "string" && v.trim()) return { status: "deels", tekst: v };
  return { status: "nee", tekst: "Nee" };
}

function vierwaardig(v) {
  if (v === undefined || v === null) return { status: "onbekend", tekst: "Onbekend; controleer dit bij de leverancier" };
  return driewaardig(v);
}

function totaalprijsTekst(b) {
  if (!b.totaalprijs_van_eur) return null;
  return eur(b.totaalprijs_van_eur) + (b.totaalprijs_tot_eur ? " tot " + eur(b.totaalprijs_tot_eur) : "");
}

function sterren(score) {
  const s = Math.max(0, Math.min(5, Math.round(score || 0)));
  const ster = (gevuld) => Iconen.svg("ster", { gevuld });
  return `<span class="sterren-rij" role="img" aria-label="${s} van 5 sterren">${ster(true).repeat(s)}${ster(false).repeat(5 - s)}</span>`;
}

// Koppel-score: zelfde formule als assets/app.js en uitleg.html#koppel-score.
// Homey, Home Assistant en dynamisch contract tellen elk: ja = 2, deels = 1, nee = 0.
function koppelScore(b) {
  const punt = (v) => { const s = driewaardig(v).status; return s === "ja" ? 2 : s === "deels" ? 1 : 0; };
  return punt(b.homey) + punt(b.home_assistant) + punt(b.dynamisch_contract);
}

function koppelScoreBadge(b) {
  const score = koppelScore(b);
  const klasse = score >= 5 ? "koppel-hoog" : score >= 3 ? "koppel-midden" : "koppel-laag";
  return `<span class="badge koppel-score ${klasse}" title="Punten voor Homey, Home Assistant en dynamisch contract">${Iconen.svg("koppeling")} Koppel-score ${score}/6</span>`;
}

// Merklogo: officiële logo's uit assets/logos/, geregistreerd in data (merk_logos)
function merkLogoHtml(merk) {
  const logo = (data.merk_logos || {})[merk];
  return logo ? `<img class="merk-logo" src="/${esc(logo)}" alt="" loading="lazy"> ` : "";
}

// Mini-illustraties per batterijtype, in de huisstijl (inkt-teal, teal, amber).
// Eigen tekeningen, dus geen rechtenkwesties.
function typeIllustratie(type) {
  const svgs = {
    "plug-in": `<svg viewBox="0 0 170 120" role="img" aria-label="Stekkerbatterij: batterij met stekker in een gewoon stopcontact" class="type-illustratie">
      <rect x="14" y="26" width="58" height="82" rx="9" fill="#0e4f49"/>
      <rect x="24" y="84" width="38" height="11" rx="3" fill="#2dd4bf"/>
      <rect x="24" y="68" width="38" height="11" rx="3" fill="#2dd4bf"/>
      <rect x="24" y="52" width="38" height="11" rx="3" fill="#2dd4bf" opacity="0.45"/>
      <circle cx="43" cy="38" r="4" fill="#f59e0b"/>
      <path d="M 72 60 C 100 60, 104 74, 124 74" fill="none" stroke="#0a3733" stroke-width="4" stroke-linecap="round"/>
      <rect x="124" y="66" width="14" height="16" rx="3" fill="#0a3733"/>
      <rect x="142" y="52" width="22" height="44" rx="6" fill="#ffffff" stroke="#0a3733" stroke-width="3"/>
      <circle cx="153" cy="68" r="2.6" fill="#0a3733"/>
      <circle cx="153" cy="80" r="2.6" fill="#0a3733"/>
      <text x="14" y="16" font-size="11" font-weight="700" fill="#0a3733">zelf aansluiten</text>
    </svg>`,
    "ac-gekoppeld": `<svg viewBox="0 0 170 120" role="img" aria-label="AC-gekoppelde batterij: aangesloten op de meterkast, werkt naast elk zonnepanelensysteem" class="type-illustratie">
      <rect x="14" y="26" width="58" height="82" rx="9" fill="#0e4f49"/>
      <rect x="24" y="84" width="38" height="11" rx="3" fill="#2dd4bf"/>
      <rect x="24" y="68" width="38" height="11" rx="3" fill="#2dd4bf"/>
      <rect x="24" y="52" width="38" height="11" rx="3" fill="#2dd4bf" opacity="0.45"/>
      <circle cx="43" cy="38" r="4" fill="#f59e0b"/>
      <path d="M 72 66 L 116 66" fill="none" stroke="#0a3733" stroke-width="4" stroke-linecap="round" stroke-dasharray="8 6"/>
      <rect x="116" y="30" width="42" height="78" rx="6" fill="#ffffff" stroke="#0a3733" stroke-width="3"/>
      <circle cx="137" cy="52" r="10" fill="none" stroke="#0f766e" stroke-width="3"/>
      <line x1="137" y1="52" x2="143" y2="46" stroke="#0f766e" stroke-width="3" stroke-linecap="round"/>
      <rect x="126" y="74" width="22" height="8" rx="2" fill="#f59e0b"/>
      <rect x="126" y="88" width="22" height="8" rx="2" fill="#0f766e" opacity="0.4"/>
      <text x="14" y="16" font-size="11" font-weight="700" fill="#0a3733">via de meterkast</text>
    </svg>`,
    "hybride": `<svg viewBox="0 0 170 120" role="img" aria-label="Hybride systeem: zonnepanelen en batterij delen één omvormer" class="type-illustratie">
      <g transform="rotate(-14 40 44)">
        <rect x="16" y="30" width="24" height="17" rx="2" fill="#0f766e" stroke="#0a3733" stroke-width="2"/>
        <rect x="43" y="30" width="24" height="17" rx="2" fill="#0f766e" stroke="#0a3733" stroke-width="2"/>
        <rect x="16" y="50" width="24" height="17" rx="2" fill="#0f766e" stroke="#0a3733" stroke-width="2"/>
        <rect x="43" y="50" width="24" height="17" rx="2" fill="#0f766e" stroke="#0a3733" stroke-width="2"/>
      </g>
      <path d="M 72 52 L 92 52" fill="none" stroke="#f59e0b" stroke-width="4" stroke-linecap="round" stroke-dasharray="7 6"/>
      <rect x="92" y="34" width="34" height="36" rx="6" fill="#ffffff" stroke="#0a3733" stroke-width="3"/>
      <path d="M 99 52 q 5 -8 10 0 q 5 8 10 0" fill="none" stroke="#0f766e" stroke-width="3" stroke-linecap="round"/>
      <path d="M 109 70 L 109 82" fill="none" stroke="#0a3733" stroke-width="4" stroke-linecap="round"/>
      <rect x="82" y="82" width="54" height="30" rx="7" fill="#0e4f49"/>
      <rect x="92" y="90" width="34" height="9" rx="3" fill="#2dd4bf"/>
      <circle cx="130" cy="89" r="3" fill="#f59e0b"/>
      <text x="92" y="16" font-size="11" font-weight="700" fill="#0a3733">één omvormer</text>
      <text x="92" y="28" font-size="11" font-weight="700" fill="#0a3733">voor alles</text>
    </svg>`,
  };
  return svgs[type] || "";
}

/* ------------------------------------------------------------------ */

function productLd(b) {
  const offers = (b.aanbiedingen || []).filter((a) => a && a.prijs_eur);
  const ld = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": `${volledigeNaam(b)}`,
    "brand": { "@type": "Brand", "name": b.merk },
    "description": `${volledigeNaam(b)}: thuisbatterij van ${nl(b.capaciteit_kwh)} kWh. ${b.zonnepanelen_koppeling || ""}`.slice(0, 300),
    "url": `${SITE}/batterij/${b.id}.html`,
  };
  if (b.afbeelding) {
    ld.image = /^https?:/i.test(b.afbeelding) ? b.afbeelding : `${SITE}/${b.afbeelding.replace(/^\//, "")}`;
  }
  if (offers.length === 1) {
    ld.offers = { "@type": "Offer", "price": Prijs.vergelijkPrijs(offers[0]), "priceCurrency": "EUR", "url": offers[0].url };
  } else if (offers.length > 1) {
    const prijzen = offers.map((o) => Prijs.vergelijkPrijs(o));
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

function breadcrumbLd(b) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Thuisbatterijen", "item": `${SITE}/index.html` },
      { "@type": "ListItem", "position": 2, "name": volledigeNaam(b), "item": `${SITE}/batterij/${b.id}.html` },
    ],
  }, null, 2);
}

function pagina(b) {
  const beste = bestePrijs(b);
  const totaal = totaalprijsTekst(b);
  const perKwh = perKwhInclBtw(b);
  const homey = driewaardig(b.homey);
  const ha = driewaardig(b.home_assistant);
  const dyn = driewaardig(b.dynamisch_contract);
  const nood = vierwaardig(b.noodstroom);
  const typeLabel = { "plug-in": "Plug-in (stopcontact)", "ac-gekoppeld": "AC-gekoppeld", "hybride": "Hybride omvormer" }[b.type] || b.type;

  const metaDesc = kortOmschrijving(
    `${naamZonderHaakjes(b)}: ${nl(b.capaciteit_kwh)} kWh thuisbatterij` +
    (beste ? `, vanaf ${eur(Prijs.vergelijkPrijs(beste)).replace(" ", " ")} incl. btw` : "") +
    ". Specificaties, koppeling met Homey en Home Assistant, en je terugverdientijd."
  );
  const kortenaam = naamZonderHaakjes(b);
  const paginaTitel = besteTitel([
    `${kortenaam}: prijs en specificaties`,
    `${kortenaam}: prijs en specs`,
    `${kortenaam}: prijs`,
    kortenaam,
  ]);

  const specRij = (label, waarde) => waarde == null || waarde === "" ? "" :
    `<tr><th style="text-align:left;padding:10px 14px;background:var(--kleur-achtergrond);white-space:nowrap;width:40%;">${esc(label)}</th><td style="padding:10px 14px;">${waarde}</td></tr>`;

  const badgeIcoon = { ja: Iconen.svg("ja"), deels: Iconen.svg("deels"), nee: Iconen.svg("nee"), onbekend: Iconen.svg("onbekend") };
  const badge = (label, d) =>
    `<span class="badge ${d.status}" title="${esc(d.tekst || "")}">${badgeIcoon[d.status] || "?"} ${esc(label)}</span>`;

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(paginaTitel)}</title>
  <meta name="description" content="${esc(metaDesc)}">
  <link rel="canonical" href="${SITE}/batterij/${esc(b.id)}.html">
  <meta property="og:title" content="${esc(volledigeNaam(b))}: prijs en specificaties">
  <meta property="og:description" content="${esc(metaDesc)}">
  <meta property="og:type" content="product">
  <meta property="og:url" content="${SITE}/batterij/${esc(b.id)}.html">
  <meta property="og:locale" content="nl_NL">
  <meta property="og:image" content="${SITE}/assets/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name" content="Batterijmaatje.nl">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">
${productLd(b)}
  </script>
  <script type="application/ld+json">
${breadcrumbLd(b)}
  </script>
  <link rel="preload" href="/assets/fonts/figtree-variable.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/style.css?v=${ASSET_VERSIE}">
  <link rel="icon" href="/assets/favicon.svg?v=2" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png?v=2">
</head>
<body>

<header class="site-header">
  <div class="container">
    <a class="logo" href="/index.html">
      <span class="logo-icoon">${ICOON_LOGO}</span>
      <span>Batterij<b>maatje</b></span>
    </a>
    <button class="menu-knop" type="button" aria-expanded="false" aria-controls="hoofdnav" aria-label="Menu openen"><svg class="icoon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></svg></button>
    <nav class="hoofdnav" id="hoofdnav">
      <a href="/index.html">Thuisbatterijen</a>
      <a href="/advies.html">Keuzehulp</a>
      <a href="/rekenmodule.html">Terugverdientijd</a>
      <a href="/uitleg.html">Uitleg</a>
      <details class="nav-meer">
        <summary>Meer ▾</summary>
        <div class="nav-meer-paneel">
          <a href="/regelgeving.html">Regels &amp; subsidies</a>
          <a href="/beste-thuisbatterij-home-assistant.html">Beste voor Home Assistant</a>
          <a href="/beste-thuisbatterij-homey.html">Beste voor Homey</a>
          <a href="/over-ons.html">Over ons</a>
          <a href="/contact.html">Contact</a>
        </div>
      </details>
    </nav>
  </div>
</header>

<main class="content-pagina">

  <p class="datum-stempel"><a href="/index.html">Vergelijker</a> › ${esc(volledigeNaam(b))}</p>
  <div style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap;">
    <div style="flex:1;min-width:250px;">
      <h1>${merkLogoHtml(b.merk)}${esc(volledigeNaam(b))}</h1>
      <p class="intro">${esc(typeLabel)} thuisbatterij van ${nl(b.capaciteit_kwh)} kWh${b.uitbreidbaar_tot_kwh ? `, uitbreidbaar tot ${nl(b.uitbreidbaar_tot_kwh)} kWh` : ""}. Prijzen dagelijks gecontroleerd, laatst op ${esc(datumNL(b.prijs_datum || data.laatst_bijgewerkt))}.</p>
    </div>
    ${b.afbeelding
      ? `<div class="kaart-foto batterij-foto-groot">
      <img src="/${esc(b.afbeelding.replace(/^\//, ""))}" alt="${esc(volledigeNaam(b))}" loading="lazy" decoding="async" width="900" height="600">
      ${b.afbeelding_bron ? `<span class="foto-bron">${esc(b.afbeelding_bron)}</span>` : ""}
    </div>`
      : typeIllustratie(b.type)}
  </div>

  <div class="info-kader">
    ${beste ? `<div style="font-size:1.6rem;font-weight:800;">${eur(Prijs.vergelijkPrijs(beste))} <span style="font-size:0.95rem;font-weight:400;color:var(--kleur-tekst-licht);">incl. btw ${beste.is_richtprijs ? "(richtprijs; op dit moment geen winkel met deze batterij)" : `bij ${esc(beste.winkel)}`}${perKwh ? ` · ${eur(perKwh)} per kWh opslag` : ""}</span></div>${Prijs.prijsToelichting(beste) ? `<div class="prijs-let-op">${esc(Prijs.prijsToelichting(beste))}</div>` : ""}` : "<div><b>Prijs op aanvraag</b></div>"}
    ${b.prijs_omvat ? `<div style="font-size:0.9rem;color:var(--kleur-tekst-licht);">Deze prijs dekt: ${esc(b.prijs_omvat)}</div>` : ""}
    <div style="font-size:0.95rem;margin-top:6px;" title="${esc(b.totaalprijs_toelichting || "")}">Compleet gebruiksklaar (indicatie): <b>${totaal || "op aanvraag"}</b></div>
    <p style="margin:14px 0 0;">
      ${beste && beste.url ? `<a class="knop" href="${esc(beste.affiliate_url || beste.url)}" target="_blank" rel="noopener${beste.affiliate_url ? " sponsored" : ""}">Bekijk aanbieding ${Iconen.svg("pijl-rechts")}</a>&nbsp;` : ""}
      <a class="knop knop-secundair" href="/rekenmodule.html?batterij=${encodeURIComponent(b.id)}">Bereken terugverdientijd</a>
    </p>
  </div>

  <h2>Specificaties</h2>
  <div style="overflow-x:auto;background:var(--kleur-wit);border:1px solid var(--kleur-rand);border-radius:var(--radius);">
  <table style="width:100%;border-collapse:collapse;font-size:0.95rem;">
    ${specRij("Capaciteit", `${nl(b.capaciteit_kwh)} kWh${b.uitbreidbaar_tot_kwh ? ` (uitbreidbaar tot ${nl(b.uitbreidbaar_tot_kwh)} kWh)` : ""}`)}
    ${specRij("Vermogen", b.vermogen_kw ? `${nl(b.vermogen_kw)} kW` : null)}
    ${specRij("Type", `<a class="term-link" href="/uitleg.html#${esc(b.type)}" title="Wat betekent dit? Lees de uitleg in de woordenlijst">${esc(typeLabel)}</a>`)}
    ${specRij("Aansluiting", esc(b.fase || ""))}
    ${specRij("Installatie", b.installatie === "zelf" ? "Zelf aan te sluiten (stopcontact)" : "Door installateur")}
    ${specRij("Beschermingsgraad", b.ip_klasse ? `<a class="term-link" href="/uitleg.html#ip-waarde" title="Wat zegt de IP-waarde? Lees de uitleg in de woordenlijst">${esc(b.ip_klasse)}</a>${b.buiten_toelichting ? ` <small>(${esc(b.buiten_toelichting)})</small>` : ""}` : null)}
    ${specRij("Garantie", b.garantie_jaar ? `${b.garantie_jaar} jaar` : null)}
    ${specRij("Laadcycli", b.cycli ? esc(String(b.cycli)) : null)}
    ${specRij("App", b.app ? `${esc(b.app)} <small>(<a class="term-link" href="/uitleg.html#fabrikant-app" title="Wat kan de app van de fabrikant? Lees de uitleg">wat kan zo'n app?</a>)</small>` : "")}
  </table>
  </div>
  <p class="datum-stempel">Onbekende term (zoals kWh of hybride)? Alle woorden staan uitgelegd in de <a href="/uitleg.html#woordenlijst">woordenlijst</a>.</p>

  <h2>Koppeling met zonnepanelen</h2>
  <p><span style="color:var(--kleur-accent);letter-spacing:2px;">${sterren(b.koppeling_gemak)}</span> (koppelgemak: ${b.koppeling_gemak || "?"} van 5)</p>
  <p>${esc(b.zonnepanelen_koppeling || "")}</p>

  <h2>Smart home en slim aansturen</h2>
  <p style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">${koppelScoreBadge(b)} ${badge("Homey", homey)} ${badge("Home Assistant", ha)} ${badge("Dynamisch contract", dyn)}</p>
  <p class="datum-stempel">De <a href="/uitleg.html#koppel-score">Koppel-score</a> telt de ondersteuning voor Homey, Home Assistant en een dynamisch contract op: 2 punten per volledige, 1 per gedeeltelijke ondersteuning.</p>
  <ul>
    <li><b>Homey:</b> ${esc(homey.tekst)}</li>
    <li><b>Home Assistant:</b> ${esc(ha.tekst)}</li>
    <li><b>Dynamisch energiecontract:</b> ${esc(dyn.tekst)}</li>
  </ul>

  <h2>Noodstroom en zelfvoorzienendheid</h2>
  <p><b><a class="term-link" href="/uitleg.html#noodstroom" title="Wat is noodstroom? Lees de uitleg">Noodstroom</a> bij stroomuitval:</b> ${nood.status === "ja" ? "Ja. " : nood.status === "nee" ? "Nee. " : nood.status === "onbekend" ? "Onbekend. " : ""}${esc(b.noodstroom_uitleg || nood.tekst)}</p>
  <p class="datum-stempel">Goed om te weten: volledig zelfvoorzienend (van het net af) is in Nederland vrijwel nooit haalbaar vanwege de lage winteropbrengst van zonnepanelen. Noodstroom betekent dat (een deel van) je huis blijft werken tijdens een storing; veel plug-in batterijen vallen dan juist uit omdat ze met het net meedraaien.</p>

  ${b.opmerkingen ? `<h2>Goed om te weten</h2><p>${esc(b.opmerkingen)}</p>` : ""}

  ${(b.aanbiedingen || []).length ? `<h2>Verkrijgbaar bij</h2>
  <ul>
    ${b.aanbiedingen.map((a) => `<li><a href="${esc(a.affiliate_url || a.url)}" target="_blank" rel="noopener${a.affiliate_url ? " sponsored" : ""}">${esc(a.winkel)}</a>: <b>${eur(a.prijs_eur)}</b>${Prijs.isOmgerekend(a) ? " <small>excl. btw</small>" : ""}${a.omvat ? ` <small>${esc(a.omvat)}</small>` : ""} <span class="datum-stempel">${a.datum ? `(gecontroleerd ${esc(datumNL(a.datum))})` : "(prijsindicatie; klik voor de actuele prijs)"}</span></li>`).join("\n    ")}
  </ul>
  <p class="datum-stempel">Prijzen worden dagelijks automatisch gecontroleerd; de prijs op de website van de winkel is altijd leidend.${(b.aanbiedingen || []).some((a) => a.affiliate_url) ? " Sommige links zijn commissielinks: koop je via die link, dan ontvangen wij een kleine vergoeding van de winkel. Dit kost jou niets en be\u00efnvloedt onze prijzen, scores en volgorde niet." : ""}</p>` : ""}

  ${VERGELIJKINGEN.filter((v) => v.a === b.id || v.b === b.id).length ? `<h2>Vergelijk met alternatieven</h2>
  <ul>
    ${VERGELIJKINGEN.filter((v) => v.a === b.id || v.b === b.id).map((v) => {
      const ander = batterijById[v.a === b.id ? v.b : v.a];
      return `<li><a href="/vergelijk/${esc(v.slug)}.html">${esc(volledigeNaam(b))} vs ${esc(volledigeNaam(ander))}</a></li>`;
    }).join("\n    ")}
  </ul>` : ""}

  <div class="waarschuwing-kader">Twijfel je of deze batterij bij je past? Doe de <a href="/advies.html">keuzehulp</a> voor een maatadvies, of <a href="/index.html">vergelijk alle thuisbatterijen</a> op prijs, capaciteit en koppelgemak.</div>

  ${b.product_url ? `<p>Meer informatie: <a href="${esc(b.product_url)}" target="_blank" rel="noopener">officiële productpagina van ${esc(b.merk)}</a>.</p>` : ""}

</main>

<footer class="site-footer">
  <div class="container">
    <b>${ICOON_LOGO} Batterijmaatje</b>
    <p>Onafhankelijke vergelijking van thuisbatterijen voor Nederlandse huishoudens.</p>
    <p><a href="/index.html">Thuisbatterijen</a> · <a href="/uitleg.html">Uitleg</a> · <a href="/advies.html">Keuzehulp</a> · <a href="/rekenmodule.html">Terugverdientijd</a> · <a href="/regelgeving.html">Regels &amp; subsidies</a> · <a href="/index.html#veelgestelde-vragen">Veelgestelde vragen</a> · <a href="/beste-thuisbatterij-home-assistant.html">Beste voor Home Assistant</a> · <a href="/beste-thuisbatterij-homey.html">Beste voor Homey</a> · <a href="/over-ons.html">Over ons</a> · <a href="/contact.html">Contact</a> · <a href="/privacy.html">Privacy &amp; disclaimer</a></p>
    <p class="disclaimer">Disclaimer: prijzen en specificaties veranderen regelmatig; er kunnen geen rechten aan worden ontleend. De prijs en voorwaarden op de website van de aanbieder zijn altijd leidend.</p>
  </div>
</footer>

<script src="/assets/nav.js?v=${ASSET_VERSIE}" defer></script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------
   Overzichtspagina's per smart-home-platform (SEO-landingspagina's).
   Worden dagelijks mee-gegenereerd, zodat prijzen en de lijst met
   ondersteunde batterijen automatisch actueel blijven.
   ------------------------------------------------------------------ */

const OVERZICHTEN = [
  {
    bestand: "beste-thuisbatterij-home-assistant.html",
    veld: "home_assistant",
    naam: "Home Assistant",
    anker: "home-assistant",
    intro: "Home Assistant is het populairste gratis smart-home-platform voor wie zijn huis zelf wil automatiseren. Een thuisbatterij die je in Home Assistant kunt uitlezen en aansturen, kun je laten samenwerken met je zonnepanelen, dynamische stroomprijzen en de rest van je slimme huis. Maar de ondersteuning verschilt enorm per merk: van een officiële integratie die je in twee minuten koppelt tot helemaal niets.",
    deelsUitleg: "Bij deze batterijen werkt de koppeling via een omweg: een community-integratie (HACS), een lokale API of Modbus. Dat werkt vaak prima, maar vraagt wat meer handigheid en kan na een firmware-update van de fabrikant haperen.",
  },
  {
    bestand: "beste-thuisbatterij-homey.html",
    veld: "homey",
    naam: "Homey",
    anker: "homey",
    intro: "Homey is het laagdrempelige smart-home-kastje waarmee je apparaten in huis laat samenwerken zonder te programmeren. Een thuisbatterij met een goede Homey-app kun je automatisch laten laden op goedkope uren en meenemen in je energie-overzicht. De ondersteuning verschilt per merk: sommige batterijen hebben een officiële app, andere werken alleen via een community-app of de Homey Energy Dongle.",
    deelsUitleg: "Bij deze batterijen loopt de koppeling via een community-app, een extra kastje (zoals de Homey Energy Dongle) of een beperkte integratie. Vaak goed werkbaar, maar geen officiële ondersteuning van de fabrikant.",
  },
];

function overzichtRij(b) {
  const beste = bestePrijs(b);
  const perKwh = perKwhInclBtw(b);
  return { b, beste, perKwh };
}

function overzichtTabel(lijst, veld) {
  const rijen = lijst.map(overzichtRij).sort((a, x) => (a.perKwh || Infinity) - (x.perKwh || Infinity));
  return `<div style="overflow-x:auto;background:var(--kleur-wit);border:1px solid var(--kleur-rand);border-radius:var(--radius);margin:14px 0;">
  <table style="width:100%;border-collapse:collapse;font-size:0.93rem;min-width:640px;">
    <thead><tr>
      <th style="text-align:left;padding:10px 14px;background:var(--kleur-achtergrond);position:sticky;left:0;z-index:1;box-shadow:2px 0 0 var(--kleur-rand);">Batterij</th>
      <th style="text-align:left;padding:10px 14px;background:var(--kleur-achtergrond);">Capaciteit</th>
      <th style="text-align:left;padding:10px 14px;background:var(--kleur-achtergrond);">Beste prijs</th>
      <th style="text-align:left;padding:10px 14px;background:var(--kleur-achtergrond);">Per kWh</th>
      <th style="text-align:left;padding:10px 14px;background:var(--kleur-achtergrond);">Koppel-score</th>
      <th style="text-align:left;padding:10px 14px;background:var(--kleur-achtergrond);">Hoe werkt de koppeling?</th>
    </tr></thead>
    <tbody>${rijen.map(({ b, beste, perKwh }) => {
      const d = driewaardig(b[veld]);
      return `
      <tr>
        <td style="padding:10px 14px;border-top:1px solid var(--kleur-rand);position:sticky;left:0;z-index:1;background:var(--kleur-wit);box-shadow:2px 0 0 var(--kleur-rand);">${merkLogoHtml(b.merk)}<a href="/batterij/${esc(b.id)}.html"><b>${esc(volledigeNaam(b))}</b></a></td>
        <td style="padding:10px 14px;border-top:1px solid var(--kleur-rand);white-space:nowrap;">${nl(b.capaciteit_kwh)} kWh</td>
        <td style="padding:10px 14px;border-top:1px solid var(--kleur-rand);white-space:nowrap;">${beste ? `<b>${eur(Prijs.vergelijkPrijs(beste))}</b><br><small>bij ${esc(beste.winkel)}</small>` : "op aanvraag"}</td>
        <td style="padding:10px 14px;border-top:1px solid var(--kleur-rand);white-space:nowrap;">${perKwh ? eur(perKwh) : "n.b."}</td>
        <td style="padding:10px 14px;border-top:1px solid var(--kleur-rand);white-space:nowrap;"><b>${koppelScore(b)}/6</b></td>
        <td style="padding:10px 14px;border-top:1px solid var(--kleur-rand);">${d.tekst && d.tekst !== "Ja" ? esc(d.tekst) : "Officiële ondersteuning"}</td>
      </tr>`;
    }).join("")}</tbody>
  </table>
  </div>`;
}

function overzichtsPagina(cfg) {
  const ja = data.batterijen.filter((b) => driewaardig(b[cfg.veld]).status === "ja");
  const deels = data.batterijen.filter((b) => driewaardig(b[cfg.veld]).status === "deels");
  const nee = data.batterijen.filter((b) => driewaardig(b[cfg.veld]).status === "nee");
  const titel = `Beste thuisbatterij voor ${cfg.naam} (2026): ${ja.length + deels.length} modellen vergeleken`;
  const paginaTitel = titelMetMerk(`Beste thuisbatterij voor ${cfg.naam} (2026)`);
  const metaDesc = kortOmschrijving(`Welke thuisbatterij werkt met ${cfg.naam}? ${ja.length} met volledige en ${deels.length} met gedeeltelijke ondersteuning, met dagelijks gecontroleerde prijzen en Koppel-score.`);
  const alleGetoond = [...ja, ...deels];

  const itemList = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": titel,
    "itemListElement": alleGetoond.map((b, i) => ({
      "@type": "ListItem",
      "position": i + 1,
      "name": `${volledigeNaam(b)}`,
      "url": `${SITE}/batterij/${b.id}.html`,
    })),
  }, null, 2);

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(paginaTitel)}</title>
  <meta name="description" content="${esc(metaDesc)}">
  <link rel="canonical" href="${SITE}/${cfg.bestand}">
  <meta property="og:title" content="${esc(titel)}">
  <meta property="og:description" content="${esc(metaDesc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${SITE}/${cfg.bestand}">
  <meta property="og:locale" content="nl_NL">
  <meta property="og:image" content="${SITE}/assets/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name" content="Batterijmaatje.nl">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">
${itemList}
  </script>
  <link rel="preload" href="/assets/fonts/figtree-variable.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/style.css?v=${ASSET_VERSIE}">
  <link rel="icon" href="/assets/favicon.svg?v=2" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png?v=2">
</head>
<body>

<header class="site-header">
  <div class="container">
    <a class="logo" href="/index.html">
      <span class="logo-icoon">${ICOON_LOGO}</span>
      <span>Batterij<b>maatje</b></span>
    </a>
    <button class="menu-knop" type="button" aria-expanded="false" aria-controls="hoofdnav" aria-label="Menu openen"><svg class="icoon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></svg></button>
    <nav class="hoofdnav" id="hoofdnav">
      <a href="/index.html">Thuisbatterijen</a>
      <a href="/advies.html">Keuzehulp</a>
      <a href="/rekenmodule.html">Terugverdientijd</a>
      <a href="/uitleg.html">Uitleg</a>
      <details class="nav-meer">
        <summary>Meer ▾</summary>
        <div class="nav-meer-paneel">
          <a href="/regelgeving.html">Regels &amp; subsidies</a>
          <a href="/beste-thuisbatterij-home-assistant.html">Beste voor Home Assistant</a>
          <a href="/beste-thuisbatterij-homey.html">Beste voor Homey</a>
          <a href="/over-ons.html">Over ons</a>
          <a href="/contact.html">Contact</a>
        </div>
      </details>
    </nav>
  </div>
</header>

<main class="container" style="max-width:900px;">
  <p class="datum-stempel" style="margin-top:22px;"><a href="/index.html">${Iconen.svg("pijl-links")} Alle thuisbatterijen vergelijken</a></p>
  <h1>Beste thuisbatterij voor ${esc(cfg.naam)} (2026)</h1>
  <p class="datum-stempel">Dagelijks automatisch bijgewerkt · laatst gecontroleerd op ${datumNL(data.laatst_bijgewerkt || VANDAAG)}</p>
  <p>${esc(cfg.intro)}</p>
  <p>Hieronder zie je alle ${data.batterijen.length} thuisbatterijen uit onze vergelijker, ingedeeld naar ${esc(cfg.naam)}-ondersteuning. De prijzen worden dagelijks automatisch gecontroleerd bij de winkels. De <a href="/uitleg.html#koppel-score">Koppel-score</a> (0 tot 6 punten) telt daarnaast ook de ondersteuning voor ${cfg.veld === "homey" ? "Home Assistant" : "Homey"} en een dynamisch energiecontract mee.</p>

  <h2>${Iconen.svg("ja")} Volledige ${esc(cfg.naam)}-ondersteuning (${ja.length})</h2>
  <p>Deze batterijen hebben een officiële ${esc(cfg.naam)}-koppeling van de fabrikant. Installeren, koppelen en klaar.</p>
  ${overzichtTabel(ja, cfg.veld)}

  <h2>~ Gedeeltelijke ondersteuning (${deels.length})</h2>
  <p>${esc(cfg.deelsUitleg)}</p>
  ${overzichtTabel(deels, cfg.veld)}

  <h2>${Iconen.svg("nee")} Geen ${esc(cfg.naam)}-ondersteuning (${nee.length})</h2>
  <p>${nee.length ? `Van deze batterijen is geen bruikbare ${esc(cfg.naam)}-koppeling bekend: ${nee.map((b) => `<a href="/batterij/${esc(b.id)}.html">${esc(volledigeNaam(b))}</a>`).join(", ")}.` : `Alle batterijen in onze vergelijker hebben een vorm van ${esc(cfg.naam)}-ondersteuning.`}</p>

  <h2>Zo kies je</h2>
  <ul>
    <li><b>Wil je zekerheid?</b> Kies een batterij uit de eerste tabel: officiële ondersteuning blijft werken na updates en de fabrikant helpt bij problemen.</li>
    <li><b>Ben je handig?</b> De tweede tabel biedt vaak meer batterij voor je geld; community-integraties werken meestal goed, maar zonder garantie.</li>
    <li><b>Twijfel je over de maat?</b> Doe de <a href="/advies.html">keuzehulp</a>: die rekent uit welke capaciteit bij je verbruik past.</li>
    <li><b>Wat is ${esc(cfg.naam)} eigenlijk?</b> Lees de eenvoudige uitleg in onze <a href="/uitleg.html#${cfg.anker}">woordenlijst</a>.</li>
  </ul>

  <h2>Geen ${esc(cfg.naam)}? Er zijn meer manieren om slim aan te sturen</h2>
  <ul>
    <li><b><a class="term-link" href="/uitleg.html#fabrikant-app">De app van de fabrikant</a>.</b> Elke batterij heeft een eigen app; veel apps kunnen zelf al slim laden op dynamische uurprijzen. Je hebt dus geen apart smart-home-systeem nodig om een batterij te gebruiken.</li>
    <li><b><a class="term-link" href="/uitleg.html#leverancier-sturing">Aansturing door je energieleverancier</a>.</b> Leveranciers met dynamische contracten zoals Tibber, Frank Energie en Zonneplan kunnen bepaalde batterijen volledig automatisch aansturen, soms inclusief handel op de onbalansmarkt. Controleer vóór aanschaf of jouw batterij wordt ondersteund.</li>
    <li><b><a class="term-link" href="/uitleg.html#matter">Matter</a>.</b> De universele smart-home-standaard van onder meer Apple, Google en Samsung ondersteunt in de nieuwste versies ook thuisbatterijen. In de praktijk kunnen nog maar weinig batterijen dit; de verwachting is dat dit de komende jaren groeit.</li>
  </ul>

  <div class="waarschuwing-kader">Prijzen en integraties veranderen regelmatig. Deze pagina wordt dagelijks automatisch bijgewerkt vanuit onze <a href="/index.html">vergelijker</a>; de prijs en specificaties op de website van de winkel zijn altijd leidend.</div>
</main>

<footer class="site-footer">
  <div class="container">
    <b>${ICOON_LOGO} Batterijmaatje</b>
    <p>Onafhankelijke vergelijking van thuisbatterijen voor Nederlandse huishoudens.</p>
    <p><a href="/index.html">Thuisbatterijen</a> · <a href="/uitleg.html">Uitleg</a> · <a href="/advies.html">Keuzehulp</a> · <a href="/rekenmodule.html">Terugverdientijd</a> · <a href="/regelgeving.html">Regels &amp; subsidies</a> · <a href="/index.html#veelgestelde-vragen">Veelgestelde vragen</a> · <a href="/beste-thuisbatterij-home-assistant.html">Beste voor Home Assistant</a> · <a href="/beste-thuisbatterij-homey.html">Beste voor Homey</a> · <a href="/over-ons.html">Over ons</a> · <a href="/contact.html">Contact</a> · <a href="/privacy.html">Privacy &amp; disclaimer</a></p>
    <p class="disclaimer">Disclaimer: prijzen en specificaties veranderen regelmatig; er kunnen geen rechten aan worden ontleend. De prijs en voorwaarden op de website van de aanbieder zijn altijd leidend.</p>
  </div>
</footer>

<script src="/assets/nav.js?v=${ASSET_VERSIE}" defer></script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------
   Vergelijkingspagina's "X vs Y" (SEO-landingspagina's voor veel
   gezochte duels). Volledig uit de data gegenereerd en dagelijks
   herbouwd, zodat prijzen en scores actueel blijven.
   ------------------------------------------------------------------ */

const VERGELIJKINGEN = [
  { a: "sessy-5kwh", b: "homewizard-plug-in-battery" },
  { a: "marstek-venus-e-3", b: "sessy-5kwh" },
  { a: "marstek-venus-e-3", b: "homewizard-plug-in-battery" },
  { a: "marstek-venus-e-3", b: "marstek-venus-c-768" },
  { a: "tesla-powerwall-3", b: "sigenergy-sigenstor-8kwh" },
  { a: "ecoflow-stream-ac-pro", b: "anker-solix-solarbank-3-pro" },
  { a: "ecoflow-stream-ac-pro", b: "zendure-solarflow-hyper-2000" },
  { a: "huawei-luna2000-10", b: "byd-battery-box-hvm-11" },
].map((v) => ({ ...v, slug: `${v.a}-vs-${v.b}` }));

const batterijById = Object.fromEntries(data.batterijen.map((b) => [b.id, b]));
// "Sessy" + "Sessy 5 kWh" wordt anders "Sessy Sessy 5 kWh"
const volledigeNaam = (b) => b.model.toLowerCase().startsWith(b.merk.toLowerCase()) ? b.model : `${b.merk} ${b.model}`;
const perKwhVan = perKwhInclBtw;
const buitenGeschikt = (b) => /IP6[5-7]/.test(b.ip_klasse || "");

// Feitelijke pluspunten van x ten opzichte van y, alleen op basis van de data.
function pluspunten(x, y) {
  const p = [];
  const px = perKwhVan(x), py = perKwhVan(y);
  if (px && py && px < py) p.push(`is per kWh opslag goedkoper (${eur(px)} tegenover ${eur(py)} per kWh)`);
  if (koppelScore(x) > koppelScore(y)) p.push(`is beter slim aan te sturen (Koppel-score ${koppelScore(x)}/6 tegenover ${koppelScore(y)}/6)`);
  if (vierwaardig(x.noodstroom).status === "ja" && vierwaardig(y.noodstroom).status !== "ja") p.push("heeft noodstroom bij een stroomstoring");
  if (x.installatie === "zelf" && y.installatie !== "zelf") p.push("sluit je zelf aan op een stopcontact, zonder installateur");
  if (buitenGeschikt(x) && !buitenGeschikt(y)) p.push(`kan ook buiten worden geplaatst (${esc(x.ip_klasse)})`);
  if ((x.garantie_jaar || 0) > (y.garantie_jaar || 0)) p.push(`heeft langere garantie (${x.garantie_jaar} tegenover ${y.garantie_jaar || "?"} jaar)`);
  if (x.capaciteit_kwh && y.capaciteit_kwh && x.capaciteit_kwh > y.capaciteit_kwh * 1.25) p.push(`biedt meer opslag (${nl(x.capaciteit_kwh)} tegenover ${nl(y.capaciteit_kwh)} kWh)`);
  if (x.vermogen_kw && y.vermogen_kw && x.vermogen_kw > y.vermogen_kw * 1.25) p.push(`levert meer vermogen (${nl(x.vermogen_kw)} tegenover ${nl(y.vermogen_kw)} kW)`);
  return p;
}

function vergelijkingsPagina(v) {
  const A = batterijById[v.a], B = batterijById[v.b];
  const naam = volledigeNaam;
  const besteA = bestePrijs(A), besteB = bestePrijs(B);
  const badgeIcoon = { ja: Iconen.svg("ja"), deels: Iconen.svg("deels"), nee: Iconen.svg("nee"), onbekend: Iconen.svg("onbekend") };
  const d3kort = (w) => { const d = driewaardig(w); return `${badgeIcoon[d.status]} ${d.status === "ja" ? "Ja" : d.status === "nee" ? "Nee" : esc(d.tekst)}`; };

  const celStijl = 'style="padding:10px 14px;border-top:1px solid var(--kleur-rand);vertical-align:top;"';
  const rij = (label, wa, wb, winnaar = -1) =>
    `<tr><th style="text-align:left;padding:10px 14px;border-top:1px solid var(--kleur-rand);background:var(--kleur-achtergrond);white-space:normal;min-width:110px;vertical-align:top;position:sticky;left:0;z-index:1;box-shadow:2px 0 0 var(--kleur-rand);">${esc(label)}</th>` +
    `<td ${celStijl}>${winnaar === 0 ? `<b>${wa}</b>` : wa}</td>` +
    `<td ${celStijl}>${winnaar === 1 ? `<b>${wb}</b>` : wb}</td></tr>`;

  const laagWint = (x, y) => (x == null || y == null || x === y) ? -1 : (x < y ? 0 : 1);
  const hoogWint = (x, y) => (x == null || y == null || x === y) ? -1 : (x > y ? 0 : 1);
  const perA = perKwhVan(A), perB = perKwhVan(B);
  const typeLabelVan = (b) => ({ "plug-in": "Plug-in (stopcontact)", "ac-gekoppeld": "AC-gekoppeld", "hybride": "Hybride omvormer" }[b.type] || b.type);
  const noodA = vierwaardig(A.noodstroom), noodB = vierwaardig(B.noodstroom);

  const plusA = pluspunten(A, B), plusB = pluspunten(B, A);
  const titel = `${naam(A)} vs ${naam(B)}: welke thuisbatterij?`;
  const paginaTitel = besteTitel([`${naamZonderHaakjes(A)} vs ${naamZonderHaakjes(B)}`]);
  const metaDesc = kortOmschrijving(`${naamZonderHaakjes(A)} of ${naamZonderHaakjes(B)}? Vergelijk prijs per kWh, capaciteit, noodstroom en slimme aansturing. Prijzen dagelijks gecontroleerd.`);

  const itemList = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": titel,
    "itemListElement": [A, B].map((b, i) => ({
      "@type": "ListItem", "position": i + 1, "name": naam(b), "url": `${SITE}/batterij/${b.id}.html`,
    })),
  }, null, 2);

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(paginaTitel)}</title>
  <meta name="description" content="${esc(metaDesc)}">
  <link rel="canonical" href="${SITE}/vergelijk/${esc(v.slug)}.html">
  <meta property="og:title" content="${esc(titel)}">
  <meta property="og:description" content="${esc(metaDesc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${SITE}/vergelijk/${esc(v.slug)}.html">
  <meta property="og:locale" content="nl_NL">
  <meta property="og:image" content="${SITE}/assets/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name" content="Batterijmaatje.nl">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">
${itemList}
  </script>
  <link rel="preload" href="/assets/fonts/figtree-variable.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/style.css?v=${ASSET_VERSIE}">
  <link rel="icon" href="/assets/favicon.svg?v=2" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png?v=2">
</head>
<body>

<header class="site-header">
  <div class="container">
    <a class="logo" href="/index.html">
      <span class="logo-icoon">${ICOON_LOGO}</span>
      <span>Batterij<b>maatje</b></span>
    </a>
    <button class="menu-knop" type="button" aria-expanded="false" aria-controls="hoofdnav" aria-label="Menu openen"><svg class="icoon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></svg></button>
    <nav class="hoofdnav" id="hoofdnav">
      <a href="/index.html">Thuisbatterijen</a>
      <a href="/advies.html">Keuzehulp</a>
      <a href="/rekenmodule.html">Terugverdientijd</a>
      <a href="/uitleg.html">Uitleg</a>
      <details class="nav-meer">
        <summary>Meer ▾</summary>
        <div class="nav-meer-paneel">
          <a href="/regelgeving.html">Regels &amp; subsidies</a>
          <a href="/beste-thuisbatterij-home-assistant.html">Beste voor Home Assistant</a>
          <a href="/beste-thuisbatterij-homey.html">Beste voor Homey</a>
          <a href="/over-ons.html">Over ons</a>
          <a href="/contact.html">Contact</a>
        </div>
      </details>
    </nav>
  </div>
</header>

<main class="container" style="max-width:900px;">
  <p class="datum-stempel" style="margin-top:22px;"><a href="/index.html">${Iconen.svg("pijl-links")} Alle thuisbatterijen vergelijken</a></p>
  <h1>${esc(naam(A))} vs ${esc(naam(B))}</h1>
  <p class="datum-stempel">Prijzen dagelijks automatisch gecontroleerd · laatst op ${datumNL(data.laatst_bijgewerkt || VANDAAG)}</p>
  <p>Twee veelvergeleken thuisbatterijen naast elkaar, op basis van dezelfde feiten als in onze <a href="/index.html">vergelijker</a>. Onder de tabel staan de belangrijkste verschillen op een rij. Vetgedrukt betekent: op dit punt objectief in het voordeel.</p>

  <div style="overflow-x:auto;background:var(--kleur-wit);border:1px solid var(--kleur-rand);border-radius:var(--radius);margin:14px 0;">
  <table style="width:100%;border-collapse:collapse;font-size:0.93rem;min-width:560px;">
    <thead><tr>
      <th style="text-align:left;padding:10px 14px;background:var(--kleur-achtergrond);position:sticky;left:0;z-index:1;"></th>
      <th style="text-align:left;padding:10px 14px;background:var(--kleur-achtergrond);"><a href="/batterij/${esc(A.id)}.html">${esc(naam(A))}</a></th>
      <th style="text-align:left;padding:10px 14px;background:var(--kleur-achtergrond);"><a href="/batterij/${esc(B.id)}.html">${esc(naam(B))}</a></th>
    </tr></thead>
    <tbody>
      ${rij("Beste prijs incl. btw", besteA ? `${eur(Prijs.vergelijkPrijs(besteA))}<br><small>bij ${esc(besteA.winkel)}</small>` : "op aanvraag", besteB ? `${eur(Prijs.vergelijkPrijs(besteB))}<br><small>bij ${esc(besteB.winkel)}</small>` : "op aanvraag")}
      ${rij("Compleet gebruiksklaar (indicatie)", totaalprijsTekst(A) || "op aanvraag", totaalprijsTekst(B) || "op aanvraag")}
      ${rij("Prijs per kWh opslag", perA ? eur(perA) : "n.b.", perB ? eur(perB) : "n.b.", laagWint(perA, perB))}
      ${rij("Capaciteit", `${nl(A.capaciteit_kwh)} kWh${A.uitbreidbaar_tot_kwh ? ` <small>(tot ${nl(A.uitbreidbaar_tot_kwh)})</small>` : ""}`, `${nl(B.capaciteit_kwh)} kWh${B.uitbreidbaar_tot_kwh ? ` <small>(tot ${nl(B.uitbreidbaar_tot_kwh)})</small>` : ""}`)}
      ${rij("Vermogen", A.vermogen_kw ? `${nl(A.vermogen_kw)} kW` : "n.b.", B.vermogen_kw ? `${nl(B.vermogen_kw)} kW` : "n.b.", hoogWint(A.vermogen_kw, B.vermogen_kw))}
      ${rij("Type en installatie", `${esc(typeLabelVan(A))}<br><small>${A.installatie === "zelf" ? "zelf aan te sluiten" : "door installateur"}</small>`, `${esc(typeLabelVan(B))}<br><small>${B.installatie === "zelf" ? "zelf aan te sluiten" : "door installateur"}</small>`)}
      ${rij("Koppel-score", `${koppelScore(A)}/6`, `${koppelScore(B)}/6`, hoogWint(koppelScore(A), koppelScore(B)))}
      ${rij("Homey", d3kort(A.homey), d3kort(B.homey))}
      ${rij("Home Assistant", d3kort(A.home_assistant), d3kort(B.home_assistant))}
      ${rij("Dynamisch contract", d3kort(A.dynamisch_contract), d3kort(B.dynamisch_contract))}
      ${rij("Noodstroom", `${badgeIcoon[noodA.status]} ${esc(noodA.status === "deels" ? noodA.tekst : noodA.status.charAt(0).toUpperCase() + noodA.status.slice(1))}`, `${badgeIcoon[noodB.status]} ${esc(noodB.status === "deels" ? noodB.tekst : noodB.status.charAt(0).toUpperCase() + noodB.status.slice(1))}`)}
      ${rij("Beschermingsgraad (IP)", A.ip_klasse ? `${esc(A.ip_klasse)}${A.buiten_toelichting ? `<br><small>${esc(A.buiten_toelichting)}</small>` : ""}` : "onbekend", B.ip_klasse ? `${esc(B.ip_klasse)}${B.buiten_toelichting ? `<br><small>${esc(B.buiten_toelichting)}</small>` : ""}` : "onbekend")}
      ${rij("Garantie", A.garantie_jaar ? `${A.garantie_jaar} jaar` : "n.b.", B.garantie_jaar ? `${B.garantie_jaar} jaar` : "n.b.", hoogWint(A.garantie_jaar, B.garantie_jaar))}
      ${rij("Laadcycli", A.cycli ? esc(String(A.cycli)) : "n.b.", B.cycli ? esc(String(B.cycli)) : "n.b.")}
      ${rij("App", esc(A.app || "n.b."), esc(B.app || "n.b."))}
    </tbody>
  </table>
  </div>

  <h2>De belangrijkste verschillen</h2>
  <ul>
    ${plusA.length ? `<li><b>De ${esc(naam(A))}</b> ${plusA.join(", ")}.</li>` : ""}
    ${plusB.length ? `<li><b>De ${esc(naam(B))}</b> ${plusB.join(", ")}.</li>` : ""}
    ${!plusA.length && !plusB.length ? "<li>Op de vergeleken punten ontlopen deze batterijen elkaar weinig; kijk vooral naar prijs en beschikbaarheid.</li>" : ""}
  </ul>
  <p class="datum-stempel">Deze verschillen worden automatisch afgeleid uit de specificaties hierboven en veranderen mee met de dagelijkse prijscontrole.</p>

  <h2>Verder kijken</h2>
  <ul>
    <li>Alle details, actuele aanbiedingen en winkels: <a href="/batterij/${esc(A.id)}.html">${esc(naam(A))}</a> · <a href="/batterij/${esc(B.id)}.html">${esc(naam(B))}</a></li>
    <li>Wat leveren ze op in jouw situatie? Bereken het: <a href="/rekenmodule.html?batterij=${encodeURIComponent(A.id)}">terugverdientijd ${esc(naam(A))}</a> · <a href="/rekenmodule.html?batterij=${encodeURIComponent(B.id)}">terugverdientijd ${esc(naam(B))}</a></li>
    <li>Twijfel je over de juiste maat? Doe de <a href="/advies.html">keuzehulp</a>.</li>
  </ul>

  <div class="waarschuwing-kader">Prijzen en specificaties veranderen regelmatig; deze pagina wordt dagelijks automatisch herbouwd. De prijs en voorwaarden op de website van de winkel zijn altijd leidend.</div>
</main>

<footer class="site-footer">
  <div class="container">
    <b>${ICOON_LOGO} Batterijmaatje</b>
    <p>Onafhankelijke vergelijking van thuisbatterijen voor Nederlandse huishoudens.</p>
    <p><a href="/index.html">Thuisbatterijen</a> · <a href="/uitleg.html">Uitleg</a> · <a href="/advies.html">Keuzehulp</a> · <a href="/rekenmodule.html">Terugverdientijd</a> · <a href="/regelgeving.html">Regels &amp; subsidies</a> · <a href="/index.html#veelgestelde-vragen">Veelgestelde vragen</a> · <a href="/beste-thuisbatterij-home-assistant.html">Beste voor Home Assistant</a> · <a href="/beste-thuisbatterij-homey.html">Beste voor Homey</a> · <a href="/over-ons.html">Over ons</a> · <a href="/contact.html">Contact</a> · <a href="/privacy.html">Privacy &amp; disclaimer</a></p>
    <p class="disclaimer">Disclaimer: prijzen en specificaties veranderen regelmatig; er kunnen geen rechten aan worden ontleend. De prijs en voorwaarden op de website van de aanbieder zijn altijd leidend.</p>
  </div>
</footer>

<script src="/assets/nav.js?v=${ASSET_VERSIE}" defer></script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------
   Pagina's schrijven
   ------------------------------------------------------------------ */

for (const b of data.batterijen) {
  writeFileSync(resolve(ROOT, "batterij", `${b.id}.html`), pagina(b), "utf8");
}
console.log(`${data.batterijen.length} batterijpagina's gegenereerd in /batterij/`);

for (const cfg of OVERZICHTEN) {
  writeFileSync(resolve(ROOT, cfg.bestand), overzichtsPagina(cfg), "utf8");
}
console.log(`${OVERZICHTEN.length} overzichtspagina's gegenereerd (Home Assistant, Homey)`);

mkdirSync(resolve(ROOT, "vergelijk"), { recursive: true });
for (const v of VERGELIJKINGEN) {
  writeFileSync(resolve(ROOT, "vergelijk", `${v.slug}.html`), vergelijkingsPagina(v), "utf8");
}
console.log(`${VERGELIJKINGEN.length} vergelijkingspagina's gegenereerd in /vergelijk/`);

/* ------------------------------------------------------------------
   Sitemap herbouwen (vaste pagina's + batterijpagina's)
   ------------------------------------------------------------------ */

/* ------------------------------------------------------------------
   De vergelijker voorrenderen in index.html

   De kaarten werden pas in de browser getekend, waardoor de HTML van de
   homepage alleen "Batterijen laden..." bevatte: geen prijzen, geen
   modelnamen en geen enkele link naar de 41 batterijpagina's. Zoekmachines
   voeren JavaScript wel uit, maar later en minder betrouwbaar, en interne
   links bepalen mede hoe goed die pagina's gevonden worden.

   Daarom zet de generator de kaarten hier kant-en-klaar tussen de markeringen
   in index.html. De opmaak komt uit assets/kaart.js, dezelfde module die de
   browser gebruikt, dus er kan geen verschil ontstaan. Zodra de bezoeker gaat
   filteren of sorteren neemt app.js het over.
   ------------------------------------------------------------------ */

const BEGIN = "<!-- kaarten:begin -->";
const EIND = "<!-- kaarten:eind -->";

const gesorteerdeBatterijen = Kaart.standaardVolgorde(data.batterijen);

const kaarten = gesorteerdeBatterijen
  .map((b) => Kaart.kaartHtml(b, { merkLogos: data.merk_logos }))
  .join("\n");

// ItemList vertelt de zoekmachine dat dit een gerangschikte lijst producten is
// en welke pagina bij elk item hoort.
const itemLijst = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "Thuisbatterijen vergeleken",
  description: "Alle vergeleken thuisbatterijen, gerangschikt op prijs per kWh opslag.",
  numberOfItems: gesorteerdeBatterijen.length,
  itemListElement: gesorteerdeBatterijen.map((b, i) => ({
    "@type": "ListItem",
    position: i + 1,
    url: `${SITE}/batterij/${b.id}.html`,
    name: volledigeNaam(b),
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

writeFileSync(resolve(ROOT, "index.html"), index, "utf8");
console.log(`index.html: ${gesorteerdeBatterijen.length} kaarten voorgerenderd en ItemList bijgewerkt`);

const vast = [
  { loc: `${SITE}/`, freq: "daily", prio: "1.0" },
  { loc: `${SITE}/uitleg.html`, freq: "monthly", prio: "0.8" },
  { loc: `${SITE}/advies.html`, freq: "weekly", prio: "0.9" },
  { loc: `${SITE}/rekenmodule.html`, freq: "weekly", prio: "0.8" },
  { loc: `${SITE}/regelgeving.html`, freq: "monthly", prio: "0.8" },
  { loc: `${SITE}/beste-thuisbatterij-home-assistant.html`, freq: "daily", prio: "0.8" },
  { loc: `${SITE}/beste-thuisbatterij-homey.html`, freq: "daily", prio: "0.8" },
  { loc: `${SITE}/over-ons.html`, freq: "monthly", prio: "0.4" },
  { loc: `${SITE}/contact.html`, freq: "yearly", prio: "0.3" },
  { loc: `${SITE}/privacy.html`, freq: "yearly", prio: "0.2" },
];

const urls = [
  ...vast,
  ...data.batterijen.map((b) => ({ loc: `${SITE}/batterij/${b.id}.html`, freq: "daily", prio: "0.7" })),
  ...VERGELIJKINGEN.map((v) => ({ loc: `${SITE}/vergelijk/${v.slug}.html`, freq: "daily", prio: "0.7" })),
];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${VANDAAG}</lastmod>\n    <changefreq>${u.freq}</changefreq>\n    <priority>${u.prio}</priority>\n  </url>`).join("\n") +
  `\n</urlset>\n`;

writeFileSync(resolve(ROOT, "sitemap.xml"), sitemap, "utf8");
console.log(`sitemap.xml herbouwd met ${urls.length} URL's (lastmod ${VANDAAG})`);
