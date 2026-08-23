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
import { paginaStand, lastmodMaker } from "./sitemap-datum.mjs";

// Dezelfde icoonset als de browser gebruikt, zodat een pomppagina nooit een
// ander icoon toont dan de vergelijker.
const vereis = createRequire(import.meta.url);
const Iconen = vereis("../assets/iconen.js");
// En dezelfde prijslogica, zodat een pomppagina nooit een ander bedrag
// noemt dan de kaart in de vergelijker.
const Prijs = vereis("../assets/prijs.js");
// En dezelfde regels over onder welke omstandigheden een getal geldt, zodat
// het label op een pomppagina niet iets anders zegt dan op de kaart.
const Condities = vereis("../assets/condities.js");
// En dezelfde kaartopmaak, zodat de voorgerenderde kaarten in index.html niet
// kunnen afwijken van wat de browser tekent.
const Kaart = vereis("../assets/kaart.js");

/* ------------------------------------------------------------------
   Titels en omschrijvingen binnen de ruimte die Google toont

   Google kapt een titel af rond de 60 tekens en een omschrijving rond de 155.
   Wat daarna komt ziet niemand, en juist het achtervoegsel met de sitenaam
   duwde hier de inhoud eruit: " | Warmtepompmaatje" kost al 19 tekens.

   Dezelfde aanpak als op batterijmaatje: de naam staat vooraan want daar zoekt
   de bezoeker op, en het achtervoegsel wijkt als het niet past. besteTitel
   krijgt varianten van lang naar kort en pakt de eerste die past.
   ------------------------------------------------------------------ */

const TITEL_MAX = 60;
const OMSCHRIJVING_MAX = 155;
const MERK_ACHTERVOEGSEL = " | Warmtepompmaatje";

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


// Het merkicoon staat in de kop en de voet van elke pagina.
const ICOON_LOGO = Iconen.svg("warmte", { klasse: "icoon-groot" });

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://warmtepompmaatje.nl";

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
  const css = readFileSync(join(ROOT, "assets", "style.css"), "utf8");
  const m = css.match(/@import url\("[^"]*\.css\?v=([A-Za-z0-9]+)"\)/);
  if (!m) throw new Error("Geen ?v= gevonden in de @import van assets/style.css.");
  return m[1];
}

const ASSET_VERSIE = assetVersie();
const VANDAAG = new Date().toISOString().slice(0, 10);

const data = JSON.parse(readFileSync(join(ROOT, "data", "warmtepompen.json"), "utf8"));

/* De stand van de pagina's vóór dit script ze overschrijft. Daarmee kan de
   sitemap straks zeggen welke pagina's echt veranderd zijn, in plaats van elke
   dag alles als vers te melden. Zie kern/scripts/sitemap-datum.mjs. */
const STAND_VOOR = paginaStand(ROOT);
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

// Google laat een prijs weg zodra priceValidUntil verstreken is. Dertig dagen
// na de laatste prijscontrole: de workflow draait dagelijks, dus die datum
// schuift mee; valt de update uit, dan verloopt de vermelding vanzelf in plaats
// van een oude prijs te blijven beloven.
function houdbaarTot(datum) {
  // Zonder prijsdatum weten we niet hoe vers het bedrag is, en dan is
  // "geldig tot over dertig dagen" een belofte die nergens op steunt. Er stond
  // hier new Date() als terugval, waardoor die datum elke dag een dag opschoof:
  // het bestand veranderde dagelijks zonder dat er iets aan de pagina veranderde,
  // en Google kreeg een houdbaarheidsdatum voor een prijs die nooit bevestigd is.
  if (!datum) return null;
  const vanaf = new Date(datum);
  if (Number.isNaN(vanaf.getTime())) return null;
  vanaf.setDate(vanaf.getDate() + 30);
  const tot = vanaf.toISOString().slice(0, 10);
  // Een datum die al verstreken is publiceren is erger dan er geen zetten:
  // Google negeert de prijs dan actief. Dat gebeurt zodra een winkel niet meer
  // door het prijsscript bereikt wordt en de datum blijft staan - bij
  // batterijmaatje gold dat voor twaalf producten. Die staleness hoort in het
  // rapport van verse-data.mjs thuis, niet in de markup.
  return tot > new Date().toISOString().slice(0, 10) ? tot : null;
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
    ld.offers = { "@type": "Offer", "price": vergelijkPrijs(aanbiedingen[0]), "priceCurrency": "EUR", "url": aanbiedingen[0].affiliate_url || aanbiedingen[0].url, "availability": "https://schema.org/InStock", "itemCondition": "https://schema.org/NewCondition", ...(houdbaarTot(w.prijs_datum) ? { "priceValidUntil": houdbaarTot(w.prijs_datum) } : {}) };
  } else if (aanbiedingen.length > 1) {
    const prijzen = aanbiedingen.map(vergelijkPrijs);
    ld.offers = { "@type": "AggregateOffer", "lowPrice": Math.min(...prijzen), "highPrice": Math.max(...prijzen), "priceCurrency": "EUR", "offerCount": aanbiedingen.length, "availability": "https://schema.org/InStock", "itemCondition": "https://schema.org/NewCondition", ...(houdbaarTot(w.prijs_datum) ? { "priceValidUntil": houdbaarTot(w.prijs_datum) } : {}) };
  } else if (beste && Prijs.zelfdeSamenstelling(beste)) {
    ld.offers = { "@type": "Offer", "price": vergelijkPrijs(beste), "priceCurrency": "EUR", "url": beste.url, "availability": "https://schema.org/InStock", "itemCondition": "https://schema.org/NewCondition", ...(houdbaarTot(w.prijs_datum) ? { "priceValidUntil": houdbaarTot(w.prijs_datum) } : {}) };
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
          <a href="${p}warmtepomp-geluid.html">Geluid</a>
          <a href="${p}monoblock-of-split.html">Monoblock of split</a>
          <a href="${p}over-ons.html">Over mij</a>
          <a href="${p}contact.html">Contact</a>
          <a href="${p}privacy.html">Privacy &amp; disclaimer</a>
          <a href="${p}steun.html" class="nav-steun"><svg class="icoon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2v2" /> <path d="M14 2v2" /> <path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1" /> <path d="M6 2v2" /></svg> Steun deze site</a>
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
    <p><a href="${p}index.html">Warmtepompen</a> · <a href="${p}advies.html">Keuzehulp</a> · <a href="${p}rekenmodule.html">Terugverdientijd</a> · <a href="${p}uitleg.html">Uitleg</a> · <a href="${p}subsidie.html">Subsidie</a> · <a href="${p}warmtepomp-geluid.html">Geluid</a> · <a href="${p}monoblock-of-split.html">Monoblock of split</a> · <a href="${p}over-ons.html">Over mij</a> · <a href="${p}contact.html">Contact</a> · <a href="${p}steun.html">Steun deze site</a> · <a href="${p}privacy.html">Privacy &amp; disclaimer</a></p>
    <p class="disclaimer">Disclaimer: prijzen en specificaties zijn indicaties; er kunnen geen rechten aan worden ontleend. De prijs en voorwaarden op de website van de aanbieder zijn altijd leidend.</p>
  </div>
</footer>`;
}

/* ------------------------------------------------------------------
   Geluidspagina

   Geluid is de vraag waar de meeste twijfel zit voordat iemand een warmtepomp
   koopt, en de enige eigenschap met een harde wettelijke grens. Die grens gaat
   alleen over iets anders dan het getal op het productlabel, en juist daar
   gaat het mis in bijna elk stuk dat erover geschreven wordt:

     geluidsvermogen  wat het apparaat afgeeft (Lw). Dat staat op het label en
                      in onze data, en is geen meetwaarde op een plek.
     geluidsdruk      wat je hoort op een afstand (Lp). Daar gaat de norm over:
                      45 dB(A) tussen 07:00 en 19:00, 40 dB(A) tussen 19:00 en
                      07:00, gemeten op de erfgrens.

   Een pomp van 54 dB(A) op het label naast de 40 dB(A) van de norm leggen is
   dus appels met peren, en zou elke pomp hier laten zakken. Daarom rekent deze
   pagina het label om naar een schatting op afstand, met de vuistregel er
   zichtbaar bij en met de mededeling dat de officiele berekening voorgeschreven
   is (Omgevingsregeling art. 5.59 en bijlage XVII) en door de installateur
   gedaan wordt.
   ------------------------------------------------------------------ */

const GELUID_BESTAND = "warmtepomp-geluid.html";

/* Halfvrije uitstraling: een buitenunit staat vrijwel altijd tegen een gevel,
   dus straalt hij in een halve bol. Lp = Lw - 10*log10(2*pi*r^2). Dat is de
   standaardbenadering; hij houdt geen rekening met weerkaatsing tegen een
   schutting of een tweede gevel, en valt daarmee aan de gunstige kant uit. */
const aftrekOpAfstand = (meter) => 10 * Math.log10(2 * Math.PI * meter * meter);
const AFSTANDEN = [2, 3, 5];

/* Twee pompen in de vergelijker hebben geen buitenunit: een ventilatie-
   warmtepomp en een hybride die binnen staat. Voor die twee bestaat de
   erfgrensnorm niet en zegt een omrekening naar afstand niets - hun
   labelwaarde is op een heel andere manier tot stand gekomen. Ze in dezelfde
   kolom zetten zou precies de fout maken die deze pagina uitlegt, dus staat
   het in de data en niet in een tekstvergelijking op de toelichting. */
const heeftBuitenunit = (w) => w.buitenunit !== false;

function geluidsdruk(w, meter) {
  if (w.geluid_db == null || !heeftBuitenunit(w)) return null;
  return w.geluid_db - aftrekOpAfstand(meter);
}

function geluidsdrukOp(w, meter) {
  const lp = geluidsdruk(w, meter);
  return lp == null ? null : Math.round(lp);
}

function geluidTabel(lijst) {
  return `<div class="tabel-wrap">
  <table class="vergelijk-tabel compact">
    <thead><tr>
      <th>Warmtepomp</th>
      <th>Soort</th>
      <th>Geluidsvermogen</th>
      ${AFSTANDEN.map((m) => `<th>Op ${m} m</th>`).join("\n      ")}
      <th>Toelichting</th>
    </tr></thead>
    <tbody>${lijst.map((w) => {
      const opDrie = geluidsdrukOp(w, 3);
      return `
      <tr>
        <td><a href="pomp/${esc(w.id)}.html"><b>${esc(w.merk)} ${esc(w.model)}</b></a></td>
        <td>${esc(w.type)}</td>
        <td class="niet-afbreken">${w.geluid_db != null ? `<b>${w.geluid_db} dB(A)</b>` : "niet opgegeven"}</td>
        ${AFSTANDEN.map((m) => {
          const lp = geluidsdrukOp(w, m);
          const leeg = heeftBuitenunit(w) ? "n.b." : `<small>geen buitenunit</small>`;
          return `<td class="niet-afbreken">${lp == null ? leeg : `${lp} dB(A)`}</td>`;
        }).join("\n        ")}
        <td>${esc(w.geluid_toelichting || "")}</td>
      </tr>`;
    }).join("")}</tbody>
  </table>
  </div>${opmerkingBijOntbrekend(lijst)}`;
}

function opmerkingBijOntbrekend(lijst) {
  const zonder = lijst.filter((w) => w.geluid_db == null);
  if (!zonder.length) return "";
  return `\n  <p class="datum-stempel">Van ${zonder.length} van de ${lijst.length} pompen heb ik het geluidsvermogen nog niet kunnen vaststellen. Die staan hier bewust wel in, want ze weglaten zou de vergelijking vollediger laten lijken dan hij is. Wat de fabrikant er zelf over zegt, staat in de kolom Toelichting.</p>`;
}

function geluidPagina() {
  /* Volgorde: eerst de buitenunits van stil naar luid, dan de pompen zonder
     buitenunit, dan wat wij nog niet weten. Een onbekende waarde bovenaan
     zetten zou hem laten lijken op een goede score. */
  const rang = (w) => (w.geluid_db == null ? 2 : heeftBuitenunit(w) ? 0 : 1);
  const opGeluid = [...pompen].sort((a, b) => rang(a) - rang(b) || (a.geluid_db || 0) - (b.geluid_db || 0));
  const gemeten = opGeluid.filter((w) => w.geluid_db != null && heeftBuitenunit(w));
  const stilste = gemeten[0];
  const luidste = gemeten[gemeten.length - 1];
  const haalt40OpDrie = gemeten.filter((w) => geluidsdruk(w, 3) <= 40).length;
  const binnen = pompen.filter((w) => !heeftBuitenunit(w));

  const titel = "Warmtepomp geluid: normen, dB en de erfgrens";
  const metaDesc = kortOmschrijving(
    `Hoeveel geluid maakt een warmtepomp? De norm van 45 en 40 dB(A) op de erfgrens uitgelegd, met het geluidsvermogen van ${gemeten.length} warmtepompen omgerekend naar afstand.`,
  );

  const itemList = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": titel,
    "itemListElement": gemeten.map((w, i) => ({
      "@type": "ListItem",
      "position": i + 1,
      "name": `${w.merk} ${w.model}`,
      "url": `${SITE}/pomp/${w.id}.html`,
    })),
  }, null, 2);

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(besteTitel([titel, "Warmtepomp geluid: normen en dB", "Warmtepomp en geluid"]))}</title>
  <meta name="description" content="${esc(metaDesc)}">
  <link rel="canonical" href="${SITE}/${GELUID_BESTAND}">
  <meta property="og:title" content="${esc(titel)}">
  <meta property="og:description" content="${esc(metaDesc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${SITE}/${GELUID_BESTAND}">
  <meta property="og:locale" content="nl_NL">
  <meta property="og:site_name" content="Warmtepompmaatje.nl">
  <meta property="og:image" content="${SITE}/assets/og-image.png">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">
${itemList}
  </script>
  <link rel="stylesheet" href="assets/style.css?v=${ASSET_VERSIE}">
  <script src="assets/iconen.js?v=${ASSET_VERSIE}" defer></script>
  <script src="assets/nav.js?v=${ASSET_VERSIE}" defer></script>
  <link rel="icon" href="assets/favicon.svg?v=1" type="image/svg+xml">
</head>
<body>

${kop("", false)}

<main class="container leespagina">
  <p class="datum-stempel"><a href="index.html">${Iconen.svg("pijl-links")} Alle warmtepompen vergelijken</a></p>
  <h1>Warmtepomp en geluid</h1>
  <p class="datum-stempel">Samengesteld uit mijn vergelijker · laatst bijgewerkt op ${datumNL(data.laatst_bijgewerkt || VANDAAG)}</p>

  <p>Geluid is de vraag waar de meeste twijfel zit voordat iemand een warmtepomp koopt, en terecht. Het is de enige eigenschap met een harde wettelijke grens eraan, van 45 dB(A) overdag en 40 dB(A) 's nachts. Alleen gaat die grens over iets anders dan het getal dat op het productblad staat, en daar gaat het mis in bijna alles wat je erover leest.</p>

  <h2>De norm: 45 dB(A) overdag, 40 dB(A) 's nachts</h2>
  <p>Sinds 1 april 2021 geldt in Nederland een geluidseis voor de buitenunit van een warmtepomp of airco bij een woning. Die staat nu in het Besluit bouwwerken leefomgeving:</p>
  <ul>
    <li><b>45 dB(A)</b> tussen 07:00 en 19:00 uur;</li>
    <li><b>40 dB(A)</b> tussen 19:00 en 07:00 uur.</li>
  </ul>
  <p>Beide gelden <b>op de erfgrens met de buren</b>, dus niet bij het apparaat en ook niet bij het slaapkamerraam van de buren. Blijf je onder die 45 en 40 dB(A), dan heb je in de regel geen vergunning nodig en kan de gemeente je niet op het geluid aanspreken. Sommige gemeenten hebben aanvullende beleidsregels over waar een unit mag hangen; dat verschilt per gemeente.</p>

  <h2>Waarom het getal op het label niet de norm is</h2>
  <p>Er zijn twee soorten decibellen in het spel, en ze verschillen makkelijk vijftien tot twintig punten:</p>
  <ul>
    <li><b>Geluidsvermogen (Lw)</b> is wat het apparaat afgeeft. Dat staat op het energielabel en in het datablad, en het is geen waarde op een plek. Dit is het getal in de tabel hieronder.</li>
    <li><b>Geluidsdruk (Lp)</b> is wat je op een bepaalde afstand hoort. Daar gaat de norm over.</li>
  </ul>
  <p>Een pomp met 54 dB(A) op het label naast de 40 dB(A) van de norm leggen is dus appels met peren vergelijken, want zo zou geen enkele warmtepomp erdoorheen komen, terwijl ze het in de praktijk vrijwel allemaal halen. Geluid neemt namelijk af met de afstand, en die afname laat zich benaderen:</p>
  <div class="tabel-wrap">
    <table class="vergelijk-tabel compact">
      <thead><tr><th>Afstand tot de erfgrens</th><th>Gaat er ongeveer af</th></tr></thead>
      <tbody>${AFSTANDEN.map((m) => `<tr><td>${m} meter</td><td>${Math.round(aftrekOpAfstand(m))} dB</td></tr>`).join("")}</tbody>
    </table>
  </div>
  <p>Staat de unit ${AFSTANDEN[1]} meter van de erfgrens, dan haalt ${haalt40OpDrie} van de ${gemeten.length} pompen waarvan ik het geluidsvermogen ken ook 's nachts de 40 dB(A). Dat is een schatting, geen toetsing. De officiële berekening is voorgeschreven in de Omgevingsregeling (artikel 5.59 en bijlage XVII) en houdt rekening met weerkaatsing tegen schuttingen en gevels. Die hoort de installateur te maken vóór de plaatsing. Vraag erom, en vraag hem op papier.</p>

  <h2>Hoe stil de pompen in mijn vergelijker zijn</h2>
  <p>Gesorteerd van stil naar luid. De stilste buitenunit is die van de ${esc(stilste.merk)} ${esc(stilste.model)} met ${stilste.geluid_db} dB(A), de luidste die van de ${esc(luidste.merk)} ${esc(luidste.model)} met ${luidste.geluid_db} dB(A). Dat scheelt ${luidste.geluid_db - stilste.geluid_db} punten, en dat hoor je.${binnen.length ? ` Onderaan staan ${binnen.length} ${binnen.length === 1 ? "pomp" : "pompen"} zonder buitenunit, waarvoor de erfgrensnorm niet geldt en een omrekening naar afstand dus niets zegt.` : ""}</p>
  ${geluidTabel(opGeluid)}

  <h2>Wat je eraan kunt doen</h2>
  <ul>
    <li><b>Zet hem verder weg.</b> De goedkoopste maatregel die er is. Elke verdubbeling van de afstand scheelt ongeveer 6 dB. Van 1,5 naar 3 meter is dus al een halvering van wat de buren horen.</li>
    <li><b>Gebruik de nachtstand.</b> Vrijwel elke pomp heeft er een; hij draait dan langzamer en levert wat minder vermogen. Bij de meeste modellen in de tabel hierboven staat dat in de toelichting.</li>
    <li><b>Richt hem niet op de erfgrens.</b> De ventilator blaast naar één kant. Die kant naar je eigen tuin draaien scheelt meer dan een omkasting.</li>
    <li><b>Een omkasting werkt, maar niet gratis.</b> Een goede akoestische omkasting haalt er 10 tot 15 dB af, maar knijpt ook de luchtstroom af en kost daarmee rendement. Overleg met de installateur; een verkeerd geplaatste kast maakt de pomp duurder in gebruik.</li>
    <li><b>Geen buitenunit is ook een optie.</b> Een ventilatiewarmtepomp gebruikt je mechanische ventilatie als bron en heeft daarom geen unit buiten, en dus ook geen erfgrensnorm. Hij levert wel minder vermogen.</li>
  </ul>

  <h2>Verder lezen</h2>
  <ul>
    <li><a href="advies.html">Keuzehulp</a>: welke warmtepomp bij jouw huis past, hybride of all-electric.</li>
    <li><a href="uitleg.html">Uitleg</a>: hoe een warmtepomp werkt, in gewone taal.</li>
    <li><a href="subsidie.html">ISDE-subsidie</a>: wat je terugkrijgt en hoe je het aanvraagt.</li>
    <li><a href="index.html">Alle warmtepompen</a>: vergelijken op prijs, subsidie, rendement en geluid.</li>
  </ul>

  <div class="noot">De omrekening naar afstand op deze pagina is een vuistregel om mee te kunnen kiezen, geen toetsing aan de wet. Voor die toetsing geldt de berekening uit de Omgevingsregeling; vraag je installateur daarom vóór de plaatsing.</div>
</main>

${voet(false)}
</body>
</html>
`;
}

/* ------------------------------------------------------------------
   "Monoblock of split?"

   De eerste keuze die iemand maakt nadat hij besloten heeft dat hij een
   warmtepomp wil, en er stond geen pagina over op de site.

   Wat deze pagina bewust niet doet: per model zeggen of hij monoblock of split
   is. Dat staat niet in onze gegevens, en het is ook geen eigenschap van een
   reeks: de meeste series bestaan in allebei de uitvoeringen en welke je
   krijgt hangt af van de samenstelling die de installateur kiest. Een kolom
   met veertig keer een gok erin zou dit een slechtere pagina maken, geen
   betere.

   Wat we wel hebben is het koudemiddel, en dat hangt er direct mee samen: van
   de 17 pompen op propaan haalt er geen enkele minder dan 70 graden aanvoer,
   en propaan hoort om veiligheidsredenen buiten te blijven. Dat is dus een
   eigenschap uit onze eigen data die zowel de bouwvorm als de vraag "kan ik
   mijn radiatoren houden" raakt, en daar gaat de tabel dan ook over.
   ------------------------------------------------------------------ */

const BOUWVORM_BESTAND = "monoblock-of-split.html";

const isPropaan = (w) => /R290|propaan/i.test(w.koudemiddel || "");

function bouwvormTabel(lijst) {
  return `<div class="tabel-wrap">
  <table class="vergelijk-tabel compact">
    <thead><tr>
      <th>Warmtepomp</th>
      <th>Soort</th>
      <th>Koudemiddel</th>
      <th>Max. aanvoer</th>
      <th>Geluidsvermogen</th>
    </tr></thead>
    <tbody>${lijst.map((w) => `
      <tr>
        <td><a href="pomp/${esc(w.id)}.html"><b>${esc(w.merk)} ${esc(w.model)}</b></a></td>
        <td>${esc(w.type)}</td>
        <td class="niet-afbreken">${esc(w.koudemiddel || "niet opgegeven")}</td>
        <td class="niet-afbreken">${w.max_aanvoer_c ? `${w.max_aanvoer_c} &deg;C` : "n.b."}</td>
        <td class="niet-afbreken">${w.geluid_db != null ? `${w.geluid_db} dB(A)` : "niet opgegeven"}</td>
      </tr>`).join("")}</tbody>
  </table>
  </div>`;
}

function bouwvormPagina() {
  const propaan = pompen.filter(isPropaan);
  const rest = pompen.filter((w) => !isPropaan(w));
  const aanvoerVan = (lijst) => {
    const g = lijst.map((w) => w.max_aanvoer_c).filter((n) => typeof n === "number");
    return g.length ? { laag: Math.min(...g), hoog: Math.max(...g) } : null;
  };
  const aanvoerPropaan = aanvoerVan(propaan);
  const aanvoerRest = aanvoerVan(rest);
  const opAanvoer = [...pompen].sort((a, b) => (b.max_aanvoer_c || 0) - (a.max_aanvoer_c || 0));
  const hoog = pompen.filter((w) => (w.max_aanvoer_c || 0) >= 70);

  const titel = "Monoblock of split: welke warmtepomp past bij jouw huis?";
  const metaDesc = kortOmschrijving(
    "Het verschil tussen een monoblock en een split warmtepomp, wat het betekent voor geluid, installatie en je radiatoren, en waarom het koudemiddel de keuze mede bepaalt.",
  );

  const itemList = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": "Warmtepompen op aanvoertemperatuur",
    "itemListElement": opAanvoer.map((w, i) => ({
      "@type": "ListItem",
      "position": i + 1,
      "name": `${w.merk} ${w.model}`,
      "url": `${SITE}/pomp/${w.id}.html`,
    })),
  }, null, 2);

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(besteTitel(["Monoblock of split warmtepomp: wat kies je?", "Monoblock of split warmtepomp"]))}</title>
  <meta name="description" content="${esc(metaDesc)}">
  <link rel="canonical" href="${SITE}/${BOUWVORM_BESTAND}">
  <meta property="og:title" content="${esc(titel)}">
  <meta property="og:description" content="${esc(metaDesc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${SITE}/${BOUWVORM_BESTAND}">
  <meta property="og:locale" content="nl_NL">
  <meta property="og:site_name" content="Warmtepompmaatje.nl">
  <meta property="og:image" content="${SITE}/assets/og-image.png">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">
${itemList}
  </script>
  <link rel="stylesheet" href="assets/style.css?v=${ASSET_VERSIE}">
  <script src="assets/iconen.js?v=${ASSET_VERSIE}" defer></script>
  <script src="assets/nav.js?v=${ASSET_VERSIE}" defer></script>
  <link rel="icon" href="assets/favicon.svg?v=1" type="image/svg+xml">
</head>
<body>

${kop("", false)}

<main class="container leespagina">
  <p class="datum-stempel"><a href="index.html">${Iconen.svg("pijl-links")} Alle warmtepompen vergelijken</a></p>
  <h1>Monoblock of split?</h1>
  <p class="datum-stempel">Samengesteld uit mijn vergelijker · laatst bijgewerkt op ${datumNL(data.laatst_bijgewerkt || VANDAAG)}</p>

  <p class="intro">Dit is de eerste keuze nadat je besloten hebt dat je een warmtepomp wilt, en hij gaat over waar de techniek staat. Alle 30 pompen op deze site zijn lucht-water; het verschil zit in de opstelling. Bij een <b>monoblock</b> zit alles in de buitenunit en loopt er alleen water naar binnen. Bij een <b>split</b> staat er ook een unit binnen, met een koudemiddelleiding ertussen.</p>

  <h2>Het verschil in één tabel</h2>
  <div class="tabel-wrap">
    <table class="vergelijk-tabel compact">
      <thead><tr><th></th><th>Monoblock</th><th>Split</th></tr></thead>
      <tbody>
        <tr><th>Wat loopt er naar binnen</th><td>water</td><td>koudemiddel</td></tr>
        <tr><th>Ruimte binnen nodig</th><td>weinig: alleen een boiler of buffervat</td><td>meer: er komt een binnenunit bij</td></tr>
        <tr><th>Installatie</th><td>geen koeltechnicus nodig voor de verbinding</td><td>koudemiddelleiding, dus F-gassencertificaat</td></tr>
        <tr><th>Bevriezingsrisico</th><td>ja: er staat water buiten, dus vorstbeveiliging is verplicht werk</td><td>nee: buiten zit koudemiddel</td></tr>
        <tr><th>Geluid buiten</th><td>de hele techniek zit buiten</td><td>een deel zit binnen</td></tr>
        <tr><th>Propaan (R290)</th><td>gebruikelijk</td><td>zeldzaam: brandbaar koudemiddel hoort niet binnen</td></tr>
      </tbody>
    </table>
  </div>
  <p>Dat laatste punt weegt zwaarder dan het lijkt, en het is meetbaar in mijn eigen gegevens.</p>

  <h2>Waarom het koudemiddel de keuze mede bepaalt</h2>
  <p>Propaan (R290) is een natuurlijk koudemiddel met een verwaarloosbaar broeikaseffect, maar het is brandbaar. Daarom houden fabrikanten het buiten, en zijn pompen op propaan vrijwel altijd monoblock. Tegelijk kan propaan hoger. Van de ${pompen.length} warmtepompen in mijn vergelijker draaien er ${propaan.length} op propaan${aanvoerPropaan ? `, en die halen allemaal ${aanvoerPropaan.laag} tot ${aanvoerPropaan.hoog} graden aanvoer` : ""}.${aanvoerRest ? ` De ${rest.length} met een ander koudemiddel zitten op ${aanvoerRest.laag} tot ${aanvoerRest.hoog} graden.` : ""}</p>
  <p><b>Dat is precies het getal waar je huis om vraagt.</b> Bestaande radiatoren willen vaak 65 tot 70 graden op een koude dag; vloerverwarming heeft aan 35 genoeg. ${hoog.length} van de ${pompen.length} pompen hier halen 70 graden of meer, en ${hoog.filter(isPropaan).length} daarvan draaien op propaan. Wil je je radiatoren houden zonder ze allemaal te vervangen, dan stuurt die eis je dus vanzelf richting een monoblock op propaan.</p>

  ${bouwvormTabel(opAanvoer)}

  <h2>Waarom hier niet per model "monoblock" of "split" staat</h2>
  <p>Omdat dat geen eigenschap van een reeks is. De meeste series bestaan in beide uitvoeringen, en welke je krijgt hangt af van de samenstelling die je installateur kiest. Een kolom met 30 keer een aanname erin zou deze pagina onbetrouwbaar maken. Wat er wél staat (koudemiddel, aanvoertemperatuur, geluid) komt uit de datasheets, en daarmee kun je de vraag stellen die telt: <i>welke uitvoering biedt u aan, en waarom die?</i></p>

  <h2>Zo kies je</h2>
  <ul>
    <li><b>Weinig ruimte binnen?</b> Monoblock. Er hoeft alleen water naar binnen, dus je bent een binnenunit kwijt.</li>
    <li><b>Bestaande radiatoren houden?</b> Kijk naar de aanvoertemperatuur in de tabel hierboven, niet naar de bouwvorm. Alles vanaf 70 graden is kansrijk.</li>
    <li><b>Buitenunit dicht bij de erfgrens?</b> Dan is geluid je bindende eis. Zie <a href="${GELUID_BESTAND}">warmtepomp en geluid</a> voor de norm en de omrekening naar afstand.</li>
    <li><b>Nog niet zeker over hybride of all-electric?</b> Die keuze komt eerst. Doe de <a href="advies.html">keuzehulp</a>.</li>
    <li><b>Wat het kost en oplevert</b> staat in de <a href="rekenmodule.html">rekenmodule</a>, en wat je terugkrijgt op <a href="subsidie.html">ISDE-subsidie</a>.</li>
  </ul>

  <div class="noot">Welke uitvoering in jouw huis past, hangt af van je warmteverlies, je afgiftesysteem en de plek van de buitenunit. Dat is werk voor een installateur; deze pagina helpt je de goede vraag te stellen.</div>
</main>

${voet(false)}
</body>
</html>
`;
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
  <title>${esc(besteTitel([`${naam}: prijs, subsidie, geluid en koppeling`, `${naam}: prijs, subsidie en geluid`, `${naam}: prijs en subsidie`, naam]))}</title>
  <meta name="description" content="${esc(kortOmschrijving(`${naam} (${w.type}): actuele prijs, ISDE-subsidie, geluid van de buitenunit, rendement en koppeling met Home Assistant en Homey (Koppel-score ${score}/6).`))}">
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
    .spec-tabel { width: 100%; border-collapse: collapse; font-size: var(--tekst-15); table-layout: fixed; }
    .spec-tabel th { text-align: left; padding: 9px 12px 9px 0; color: var(--kleur-tekst-licht); font-weight: 600; vertical-align: top; width: 42%; overflow-wrap: anywhere; }
    .spec-tabel td { padding: 9px 0; border-bottom: 1px dotted var(--kleur-rand); vertical-align: top; overflow-wrap: anywhere; }
    .spec-tabel tr:last-child td { border-bottom: none; }
    .prijs-groot { font-size: var(--tekst-28); font-weight: 800; color: var(--kleur-primair-donker); }
    .breadcrumb { font-size: var(--tekst-15); color: var(--kleur-tekst-licht); margin: 16px 0 0; }
    .koppel-blok dt { font-weight: 700; margin-top: 10px; }
    .koppel-blok dd { margin: 2px 0 0; font-size: var(--tekst-15); color: var(--kleur-tekst-licht); }
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
        ${specRij("Vermogen", w.vermogen_kw ? `${String(w.vermogen_kw).replace(".", ",")} kW${Condities.labelHtml("vermogen", w)}` : null)}
        ${specRij("Rendement (SCOP)", w.scop ? `${String(w.scop).replace(".", ",")}${Condities.labelHtml("scop", w)}${w.scop_toelichting ? ` <small>(${esc(w.scop_toelichting)})</small>` : ""}` : (w.scop_toelichting ? esc(w.scop_toelichting) : null))}
        ${specRij("Geluid buitenunit", w.geluid_db ? `${w.geluid_db} dB(A)${w.geluid_toelichting ? ` <small>(${esc(w.geluid_toelichting)})</small>` : ""}` : null)}
        ${specRij("Koudemiddel", w.koudemiddel ? esc(w.koudemiddel) : null)}
        ${specRij("Warm tapwater", typeof w.tapwater === "string" ? esc(w.tapwater) : d3html(w.tapwater))}
        ${specRij("Maximale aanvoertemperatuur", w.max_aanvoer_c ? `${w.max_aanvoer_c} °C` : null)}
        ${specRij("ISDE-subsidie", w.isde_indicatie_eur ? `${eur(w.isde_indicatie_eur)} <small>${w.isde_meldcode ? `bij meldcode ${esc(w.isde_meldcode)} op de <a href="https://www.rvo.nl/subsidies-financiering/isde/meldcodelijsten/warmtepompen" target="_blank" rel="noopener">meldcodelijst van RVO</a>` : `(check de meldcode bij <a href="https://www.rvo.nl/subsidies-financiering/isde/woningeigenaren/warmtepomp" target="_blank" rel="noopener">RVO</a>)`}</small>` : null)}
      </table>

      <div class="blok los">
        <b>Wat je nodig hebt voor je ISDE-aanvraag</b>
        <p class="onder-kop">De ISDE-subsidie loopt per goedgekeurd apparaat, elk met een eigen meldcode. Ik vermeld die meldcode bewust niet: RVO werkt de lijst regelmatig bij en één model heeft vaak meerdere codes per vermogensvariant. Zoek de juiste meldcode op met deze gegevens van deze warmtepomp:</p>
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
        <dt>${Iconen.svg(driewaardig(w.sturing).status === "ja" ? "ja" : driewaardig(w.sturing).status === "deels" ? "deels" : "nee")} Slimme aansturing <span class="koppel-punten">${driewaardig(w.sturing).status === "ja" ? 2 : driewaardig(w.sturing).status === "deels" ? 1 : 0}<span class="van">/2</span></span></dt><dd>${esc(driewaardig(w.sturing).tekst)}</dd>
        <dt>${Iconen.svg(driewaardig(w.home_assistant).status === "ja" ? "ja" : driewaardig(w.home_assistant).status === "deels" ? "deels" : "nee")} Home Assistant <span class="koppel-punten">${driewaardig(w.home_assistant).status === "ja" ? 2 : driewaardig(w.home_assistant).status === "deels" ? 1 : 0}<span class="van">/2</span></span></dt><dd>${esc(driewaardig(w.home_assistant).tekst)}</dd>
        <dt>${Iconen.svg(driewaardig(w.homey).status === "ja" ? "ja" : driewaardig(w.homey).status === "deels" ? "deels" : "nee")} Homey <span class="koppel-punten">${driewaardig(w.homey).status === "ja" ? 2 : driewaardig(w.homey).status === "deels" ? 1 : 0}<span class="van">/2</span></span></dt><dd>${esc(driewaardig(w.homey).tekst)}</dd>
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

// De vergelijker opent in lijstweergave, dus dat is ook wat hier in de HTML
// komt te staan. Zet je hier kaarten neer terwijl de browser meteen daarna
// regels tekent, dan ziet de bezoeker het beeld een keer omklappen en krijgt
// een zoekmachine iets anders te zien dan een mens.
const kaarten = Kaart.lijstHtml(gesorteerdePompen, { pompen: data.warmtepompen });

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
      `$1${gesorteerdePompen.length} van ${gesorteerdePompen.length} warmtepompen, gesorteerd op ${noot}$2`,
    );
  }
}

writeFileSync(join(ROOT, "index.html"), index, "utf8");
console.log(`index.html: ${gesorteerdePompen.length} kaarten voorgerenderd en ItemList bijgewerkt`);

writeFileSync(join(ROOT, GELUID_BESTAND), geluidPagina(), "utf8");
writeFileSync(join(ROOT, BOUWVORM_BESTAND), bouwvormPagina(), "utf8");
console.log(`${BOUWVORM_BESTAND} gegenereerd`);
console.log(`${GELUID_BESTAND} gegenereerd (${pompen.filter((w) => w.geluid_db != null).length} van ${pompen.length} pompen met een opgegeven geluidsvermogen)`);

const vast = [
  { loc: `${SITE}/`, prio: "1.0" },
  { loc: `${SITE}/advies.html`, prio: "0.9" },
  { loc: `${SITE}/rekenmodule.html`, prio: "0.9" },
  { loc: `${SITE}/uitleg.html`, prio: "0.8" },
  { loc: `${SITE}/subsidie.html`, prio: "0.8" },
  { loc: `${SITE}/${GELUID_BESTAND}`, prio: "0.8" },
  { loc: `${SITE}/${BOUWVORM_BESTAND}`, prio: "0.8" },
  { loc: `${SITE}/over-ons.html`, prio: "0.4" },
  { loc: `${SITE}/contact.html`, prio: "0.4" },
  { loc: `${SITE}/privacy.html`, prio: "0.2" },
  { loc: `${SITE}/steun.html`, prio: "0.3" },
];
const urls = [...vast, ...pompen.map((w) => ({ loc: `${SITE}/pomp/${w.id}.html`, prio: "0.7" }))];
const lastmodVoor = lastmodMaker(ROOT, SITE, STAND_VOOR, VANDAAG);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${lastmodVoor(u.loc)}</lastmod><priority>${u.prio}</priority></url>`).join("\n") +
  `\n</urlset>\n`;
writeFileSync(join(ROOT, "sitemap.xml"), sitemap);
const vers = urls.filter((u) => lastmodVoor(u.loc) === VANDAAG).length;
console.log(`sitemap.xml herbouwd met ${urls.length} URL's, waarvan ${vers} met lastmod van vandaag`);
