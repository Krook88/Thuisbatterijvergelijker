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
import { paginaStand, lastmodMaker } from "./sitemap-datum.mjs";

// Dezelfde prijslogica en iconen als de browser gebruikt, zodat een
// batterijpagina nooit een ander bedrag of ander icoon toont dan de vergelijker.
const vereis = createRequire(import.meta.url);
const Prijs = vereis("../assets/prijs.js");
const Iconen = vereis("../assets/iconen.js");
const Kaart = vereis("../assets/kaart.js");

// Hoe de capaciteit in lopende tekst verschijnt.
//
// Sinds de bruikbare capaciteit de norm is, verdween de bruto maat van de
// pagina - en dat is precies het getal waarop mensen zoeken. Een Marstek Venus
// E heet in elke webshop "5,12 kWh"; wie daarop googelt vond ons daarna niet
// meer, want op onze pagina stond alleen nog 4,6. De bruikbare maat blijft
// leidend, de bruto maat staat erachter zodat beide vindbaar zijn.
function capaciteitInTekst(b) {
  const bruikbaar = `${nl(b.capaciteit_kwh)} kWh`;
  const nominaal = b.capaciteit_nominaal_kwh;
  if (!nominaal || Math.abs(nominaal - b.capaciteit_kwh) < 0.005) return bruikbaar;
  return `${bruikbaar} bruikbaar (${nl(nominaal)} kWh bruto)`;
}


// Het merkicoon staat in de kop en de voet van elke pagina.
const ICOON_LOGO = Iconen.svg("batterij", { klasse: "icoon-groot" });

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SITE = "https://batterijmaatje.nl";
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
   59 pagina's die dit script maakt zetten er stilletjes het oude nummer weer
   in. Bezoekers kregen daardoor nieuwe HTML met een stylesheet van maximaal
   zeven dagen oud - op warmtepompmaatje leverde dat een onleesbare link op.

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

const data = JSON.parse(readFileSync(resolve(ROOT, "data/batterijen.json"), "utf8"));

/* De stand van de pagina's vóór dit script ze overschrijft. Daarmee kan de
   sitemap straks zeggen welke pagina's echt veranderd zijn, in plaats van elke
   dag alles als vers te melden. Zie kern/scripts/sitemap-datum.mjs. */
const STAND_VOOR = paginaStand(ROOT);
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

// Google laat een prijs weg zodra priceValidUntil verstreken is, en toont geen
// beschikbaarheid als availability ontbreekt. Beide stonden er niet, terwijl de
// prijs in het zoekresultaat juist is waar deze site het van moet hebben.
//
// De houdbaarheidsdatum is dertig dagen na de laatste prijscontrole. De
// workflow draait dagelijks, dus in de praktijk schuift die elke dag mee; valt
// de update een tijd uit, dan verloopt de vermelding vanzelf in plaats van een
// oude prijs te blijven beloven.
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

function productLd(b) {
  // Prijs.geldigeAanbiedingen en niet een eigen filter: dat sluit ook de
  // aanbiedingen uit die de winkel niet meer voert. Die stonden hier wel in,
  // waardoor de structured data een prijs beloofde die de vergelijker zelf al
  // niet meer meetelde.
  const offers = Prijs.geldigeAanbiedingen(b);
  const ld = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": `${volledigeNaam(b)}`,
    "brand": { "@type": "Brand", "name": b.merk },
    "description": `${volledigeNaam(b)}: thuisbatterij van ${capaciteitInTekst(b)}. ${b.zonnepanelen_koppeling || ""}`.slice(0, 300),
    "url": `${SITE}/batterij/${b.id}.html`,
  };
  if (b.afbeelding) {
    ld.image = /^https?:/i.test(b.afbeelding) ? b.afbeelding : `${SITE}/${b.afbeelding.replace(/^\//, "")}`;
  }
  if (offers.length === 1) {
    ld.offers = {
      "@type": "Offer",
      "price": Prijs.vergelijkPrijs(offers[0]),
      "priceCurrency": "EUR",
      "url": offers[0].url,
      "availability": "https://schema.org/InStock",
      "itemCondition": "https://schema.org/NewCondition",
      ...(houdbaarTot(offers[0].datum || b.prijs_datum) ? { "priceValidUntil": houdbaarTot(offers[0].datum || b.prijs_datum) } : {}),
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
      ...(houdbaarTot(b.prijs_datum) ? { "priceValidUntil": houdbaarTot(b.prijs_datum) } : {}),
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

/* Kop en voet stonden drie keer letterlijk in dit bestand, en dat is precies
   hoe een menu-item op de ene pagina wel en op de andere niet terechtkomt.
   Nu staan ze een keer. */
const NAV_HTML = `<header class="site-header">
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
          <a href="/thuisbatterij-met-stekker.html">Batterij met stekker</a>
          <a href="/wat-kost-een-thuisbatterij.html">Wat kost er een?</a>
          <a href="/nu-kopen-of-wachten.html">Nu kopen of wachten?</a>
          <a href="/beste-thuisbatterij-home-assistant.html">Beste voor Home Assistant</a>
          <a href="/beste-thuisbatterij-homey.html">Beste voor Homey</a>
          <a href="/over-ons.html">Over ons</a>
          <a href="/contact.html">Contact</a>
        </div>
      </details>
    </nav>
  </div>
</header>`;

const VOET_HTML = `<footer class="site-footer">
  <div class="container">
    <b>${ICOON_LOGO} Batterijmaatje</b>
    <p>Onafhankelijke vergelijking van thuisbatterijen voor Nederlandse huishoudens.</p>
    <p><a href="/index.html">Thuisbatterijen</a> · <a href="/uitleg.html">Uitleg</a> · <a href="/advies.html">Keuzehulp</a> · <a href="/rekenmodule.html">Terugverdientijd</a> · <a href="/regelgeving.html">Regels &amp; subsidies</a> · <a href="/index.html#veelgestelde-vragen">Veelgestelde vragen</a> · <a href="/beste-thuisbatterij-home-assistant.html">Beste voor Home Assistant</a> · <a href="/beste-thuisbatterij-homey.html">Beste voor Homey</a> · <a href="/thuisbatterij-met-stekker.html">Batterij met stekker</a> · <a href="/wat-kost-een-thuisbatterij.html">Wat kost er een?</a> · <a href="/nu-kopen-of-wachten.html">Nu kopen of wachten?</a> · <a href="/over-ons.html">Over ons</a> · <a href="/contact.html">Contact</a> · <a href="/privacy.html">Privacy &amp; disclaimer</a></p>
    <p class="disclaimer">Disclaimer: prijzen en specificaties veranderen regelmatig; er kunnen geen rechten aan worden ontleend. De prijs en voorwaarden op de website van de aanbieder zijn altijd leidend.</p>
  </div>
</footer>`;

/* "Prijzen dagelijks gecontroleerd, laatst op 13 juli" is een zin die zichzelf
   tegenspreekt zodra die datum ver weg ligt. Dat stond hier: de belofte kwam
   uit de sjabloon en de datum uit de gegevens, en niemand vergeleek de twee.
   Nu bepaalt de ouderdom welke zin er staat, en het bedrag zelf draagt dezelfde
   markering als op de kaart. */
function prijsZin(b) {
  const datum = Prijs.prijsDatum(b);
  const oud = Prijs.prijsOuderdomLabel(b);
  if (!datum) return "Voor dit model hebben wij geen bevestigde winkelprijs.";
  if (oud) return `Deze prijs is voor het laatst bevestigd op ${esc(datumNL(datum))}, ${oud.dagen} dagen geleden.`;
  return `Prijzen dagelijks gecontroleerd, laatst op ${esc(datumNL(datum))}.`;
}

function ouderdomHtml(b) {
  const oud = Prijs.prijsOuderdomLabel(b);
  if (!oud) return "";
  return `<span class="prijs-ouderdom" title="Dit bedrag is ${oud.dagen} dagen niet bevestigd bij de winkel; controleer het daar voordat je bestelt">prijs van ${esc(datumNL(oud.datum))}</span>`;
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

  // Twee staarten: de lange noemt Homey en Home Assistant met naam, en daar
  // wordt op gezocht. Past die niet binnen wat Google toont, dan de korte -
  // beter een hele zin dan een afgekapte met "en je…" erachter.
  const kop = `${naamZonderHaakjes(b)}: thuisbatterij van ${capaciteitInTekst(b)}` +
    (beste ? `, vanaf ${eur(Prijs.vergelijkPrijs(beste)).replace(" ", " ")} incl. btw` : "");
  const lang = kop + ". Specificaties, koppeling met Homey en Home Assistant, en je terugverdientijd.";
  const metaDesc = lang.length <= OMSCHRIJVING_MAX
    ? lang
    : kortOmschrijving(kop + ". Specificaties, koppelingen en terugverdientijd.");
  const kortenaam = naamZonderHaakjes(b);
  const paginaTitel = besteTitel([
    `${kortenaam}: prijs en specificaties`,
    `${kortenaam}: prijs en specs`,
    `${kortenaam}: prijs`,
    kortenaam,
  ]);

  const specRij = (label, waarde) => waarde == null || waarde === "" ? "" :
    `<tr><th>${esc(label)}</th><td>${waarde}</td></tr>`;

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

${NAV_HTML}

<main class="content-pagina">

  <p class="datum-stempel"><a href="/index.html">Vergelijker</a> › ${esc(volledigeNaam(b))}</p>
  <div class="product-kop">
    <div class="product-kop-tekst">
      <h1>${merkLogoHtml(b.merk)}${esc(volledigeNaam(b))}</h1>
      <p class="intro">${esc(typeLabel)} thuisbatterij van ${capaciteitInTekst(b)}${b.uitbreidbaar_tot_kwh ? `, uitbreidbaar tot ${nl(b.uitbreidbaar_tot_kwh)} kWh` : ""}. ${prijsZin(b)}</p>
    </div>
    ${b.afbeelding
      ? `<div class="kaart-foto batterij-foto-groot">
      <img src="/${esc(b.afbeelding.replace(/^\//, ""))}" alt="${esc(volledigeNaam(b))}" loading="lazy" decoding="async" width="900" height="600">
      ${b.afbeelding_bron ? `<span class="foto-bron">${esc(b.afbeelding_bron)}</span>` : ""}
    </div>`
      : typeIllustratie(b.type)}
  </div>

  <div class="info-kader">
    ${beste ? `<div class="info-prijs">${eur(Prijs.vergelijkPrijs(beste))} <span class="info-prijs-bron">incl. btw ${beste.is_richtprijs ? "(richtprijs; op dit moment geen winkel met deze batterij)" : `bij ${esc(beste.winkel)}`}${perKwh ? ` · ${eur(perKwh)} per kWh opslag` : ""}</span></div>${ouderdomHtml(b)}${Prijs.prijsToelichting(beste) ? `<div class="prijs-let-op">${esc(Prijs.prijsToelichting(beste))}</div>` : ""}` : "<div><b>Prijs op aanvraag</b></div>"}
    ${b.prijs_omvat ? `<div class="info-dekking">Deze prijs dekt: ${esc(b.prijs_omvat)}</div>` : ""}
    <div class="info-totaal" title="${esc(b.totaalprijs_toelichting || "")}">Compleet gebruiksklaar (indicatie): <b>${totaal || "op aanvraag"}</b></div>
    <p class="info-acties">
      ${beste && beste.url ? `<a class="knop" href="${esc(beste.affiliate_url || beste.url)}" target="_blank" rel="noopener${beste.affiliate_url ? " sponsored" : ""}">Bekijk aanbieding ${Iconen.svg("pijl-rechts")}</a>&nbsp;` : ""}
      <a class="knop knop-secundair" href="/rekenmodule.html?batterij=${encodeURIComponent(b.id)}">Bereken terugverdientijd</a>
    </p>
  </div>

  <h2>Specificaties</h2>
  <div class="tabel-blok">
  <table class="data-tabel spec-tabel">
    ${specRij("Capaciteit", `${nl(b.capaciteit_kwh)} kWh${Prijs.capaciteitLabelHtml(b)}${b.capaciteit_nominaal_kwh && Math.abs(b.capaciteit_nominaal_kwh - b.capaciteit_kwh) >= 0.005 ? ` <small>(${nl(b.capaciteit_nominaal_kwh)} kWh bruto)</small>` : ""}${b.uitbreidbaar_tot_kwh ? ` (uitbreidbaar tot ${nl(b.uitbreidbaar_tot_kwh)} kWh)` : ""}`)}
    ${specRij("Vermogen", b.vermogen_kw ? `${nl(b.vermogen_kw)} kW${Prijs.vermogenLabelHtml(b)}` : null)}
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
  <p>${waardering(b.koppeling_gemak, 5)} <span class="waardering-uitleg">aansluitgemak op je bestaande zonnepanelen</span></p>
  <p>${esc(b.zonnepanelen_koppeling || "")}</p>

  <h2>Smart home en slim aansturen</h2>
  <p class="badge-rij">${koppelScoreBadge(b)} ${badge("Homey", homey)} ${badge("Home Assistant", ha)} ${badge("Dynamisch contract", dyn)}</p>
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

${VOET_HTML}

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
  return `<div class="tabel-blok los">
  <table class="data-tabel brede-tabel overzicht-tabel kolom-vast">
    <thead><tr>
      <th>Batterij</th>
      <th>Capaciteit</th>
      <th>Beste prijs</th>
      <th>Per kWh</th>
      <th>Koppel-score</th>
      <th>Hoe werkt de koppeling?</th>
    </tr></thead>
    <tbody>${rijen.map(({ b, beste, perKwh }) => {
      const d = driewaardig(b[veld]);
      return `
      <tr>
        <td>${merkLogoHtml(b.merk)}<a href="/batterij/${esc(b.id)}.html"><b>${esc(volledigeNaam(b))}</b></a></td>
        <td class="niet-afbreken"${Prijs.capaciteitToelichting(b) ? ` title="${esc(Prijs.capaciteitToelichting(b))}"` : ""}>${nl(b.capaciteit_kwh)} kWh</td>
        <td class="niet-afbreken">${beste ? `<b>${eur(Prijs.vergelijkPrijs(beste))}</b><br><small>bij ${esc(beste.winkel)}</small>` : "op aanvraag"}</td>
        <td class="niet-afbreken">${perKwh ? eur(perKwh) : "n.b."}</td>
        <td class="niet-afbreken"><b>${koppelScore(b)}/6</b></td>
        <td>${d.tekst && d.tekst !== "Ja" ? esc(d.tekst) : "Officiële ondersteuning"}</td>
      </tr>`;
    }).join("")}</tbody>
  </table>
  </div>`;
}

function overzichtsPagina(cfg) {
  const ja = data.batterijen.filter((b) => driewaardig(b[cfg.veld]).status === "ja");
  const deels = data.batterijen.filter((b) => driewaardig(b[cfg.veld]).status === "deels");
  const nee = data.batterijen.filter((b) => driewaardig(b[cfg.veld]).status === "nee");
  const titel = `Beste thuisbatterij voor ${cfg.naam} (${JAAR}): ${ja.length + deels.length} modellen vergeleken`;
  const paginaTitel = titelMetMerk(`Beste thuisbatterij voor ${cfg.naam} (${JAAR})`);
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

${NAV_HTML}

<main class="container leespagina">
  <p class="datum-stempel"><a href="/index.html">${Iconen.svg("pijl-links")} Alle thuisbatterijen vergelijken</a></p>
  <h1>Beste thuisbatterij voor ${esc(cfg.naam)} (${JAAR})</h1>
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

${VOET_HTML}

<script src="/assets/nav.js?v=${ASSET_VERSIE}" defer></script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------
   Stekkerbatterijen: één pagina voor vier namen.

   "Stekkerbatterij", "plug-and-play thuisbatterij", "balkonbatterij" en
   "thuisbatterij met stekker" zijn vier ingeburgerde namen voor hetzelfde
   apparaat, en ze worden alle vier gezocht. Wie op een van die woorden
   binnenkomt hoort dezelfde pagina te krijgen, dus staan ze er alle vier op -
   niet als opsomming om de zoekmachine te plezieren, maar omdat een bezoeker
   die "balkonbatterij" typt moet kunnen zien dat hij goed zit.

   De selectie kost geen nieuw gegeven: type "plug-in" staat al in de data.
   ------------------------------------------------------------------ */

const STEKKER_BESTAND = "thuisbatterij-met-stekker.html";

/* type "plug-in" en installatie "zelf" horen hetzelfde te betekenen. Nu is dat
   zo, en de pagina leunt erop ("zonder installateur"). Loopt het ooit uiteen,
   dan is dat een fout in de data en niet iets om hier stilletjes met een tweede
   filter te omzeilen. */
function controleerStekkerData(lijst) {
  const scheef = data.batterijen.filter((b) => (b.type === "plug-in") !== (b.installatie === "zelf"));
  if (scheef.length) {
    throw new Error(
      `type "plug-in" en installatie "zelf" lopen uiteen bij: ${scheef.map((b) => b.id).join(", ")}.\n` +
      `De stekkerpagina zegt dat je deze batterijen zonder installateur aansluit; dat moet uit beide velden blijken.`,
    );
  }
  if (!lijst.length) throw new Error("Geen enkele batterij heeft type \"plug-in\"; de stekkerpagina zou leeg zijn.");
}

function stekkerTabel(lijst) {
  return `<div class="tabel-blok los">
  <table class="data-tabel brede-tabel overzicht-tabel kolom-vast">
    <thead><tr>
      <th>Batterij</th>
      <th>Capaciteit</th>
      <th>Beste prijs</th>
      <th>Per kWh</th>
      <th>Vermogen</th>
      <th>Noodstroom</th>
      <th>Buiten</th>
    </tr></thead>
    <tbody>${lijst.map((b) => {
      const beste = bestePrijs(b);
      const perKwh = perKwhInclBtw(b);
      const nood = vierwaardig(b.noodstroom);
      return `
      <tr>
        <td>${merkLogoHtml(b.merk)}<a href="/batterij/${esc(b.id)}.html"><b>${esc(volledigeNaam(b))}</b></a></td>
        <td class="niet-afbreken"${Prijs.capaciteitToelichting(b) ? ` title="${esc(Prijs.capaciteitToelichting(b))}"` : ""}>${nl(b.capaciteit_kwh)} kWh</td>
        <td class="niet-afbreken">${beste ? `<b>${eur(Prijs.vergelijkPrijs(beste))}</b><br><small>bij ${esc(beste.winkel)}</small>` : "op aanvraag"}</td>
        <td class="niet-afbreken">${perKwh ? eur(perKwh) : "n.b."}</td>
        <td class="niet-afbreken">${b.vermogen_kw ? `${nl(b.vermogen_kw)} kW` : "n.b."}</td>
        <td>${nood.status === "ja" ? `${Iconen.svg("ja")} Ja` : nood.status === "nee" ? `${Iconen.svg("nee")} Nee` : `~ ${esc(kortOmschrijving(nood.tekst, 90))}`}</td>
        <td class="niet-afbreken">${buitenGeschikt(b) ? `${Iconen.svg("ja")} ${esc(b.ip_klasse)}` : b.ip_klasse ? esc(b.ip_klasse) : "n.b."}</td>
      </tr>`;
    }).join("")}</tbody>
  </table>
  </div>`;
}

function stekkerPagina() {
  const stekker = data.batterijen
    .filter((b) => b.type === "plug-in")
    .sort((a, b) => (perKwhInclBtw(a) || Infinity) - (perKwhInclBtw(b) || Infinity));
  controleerStekkerData(stekker);

  const rest = data.batterijen.filter((b) => b.type !== "plug-in");
  const caps = stekker.map((b) => b.capaciteit_kwh).filter(Boolean);
  const vermogens = stekker.map((b) => b.vermogen_kw).filter(Boolean);
  const prijzen = stekker.map((b) => bestePrijs(b)).filter(Boolean).map((a) => Prijs.vergelijkPrijs(a));
  const restPrijzen = rest.map((b) => bestePrijs(b)).filter(Boolean).map((a) => Prijs.vergelijkPrijs(a));
  const restCaps = rest.map((b) => b.capaciteit_kwh).filter(Boolean);
  const metNoodstroom = stekker.filter((b) => vierwaardig(b.noodstroom).status === "ja").length;
  const buiten = stekker.filter(buitenGeschikt).length;

  const titel = `Thuisbatterij met stekker: ${stekker.length} stekkerbatterijen vergeleken`;
  const paginaTitel = besteTitel([
    `Stekkerbatterij vergelijken: ${stekker.length} modellen (${JAAR})`,
    `Stekkerbatterij vergelijken (${JAAR})`,
  ]);
  const metaDesc = kortOmschrijving(
    `Stekkerbatterij, plug-and-play thuisbatterij of balkonbatterij: ${stekker.length} modellen die je zelf in het stopcontact steekt, vergeleken op prijs per kWh.`,
  );

  const itemList = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": titel,
    "itemListElement": stekker.map((b, i) => ({
      "@type": "ListItem",
      "position": i + 1,
      "name": volledigeNaam(b),
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
  <link rel="canonical" href="${SITE}/${STEKKER_BESTAND}">
  <meta property="og:title" content="${esc(titel)}">
  <meta property="og:description" content="${esc(metaDesc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${SITE}/${STEKKER_BESTAND}">
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

${NAV_HTML}

<main class="container leespagina">
  <p class="datum-stempel"><a href="/index.html">${Iconen.svg("pijl-links")} Alle thuisbatterijen vergelijken</a></p>
  <h1>${esc(titel)}</h1>
  <p class="datum-stempel">Dagelijks automatisch bijgewerkt · laatst gecontroleerd op ${datumNL(data.laatst_bijgewerkt || VANDAAG)}</p>

  <p>Een stekkerbatterij steek je zelf in een gewoon stopcontact: geen installateur, geen ingreep in de meterkast, geen wachtlijst. Je komt hem ook tegen als <b>plug-and-play thuisbatterij</b>, als <b>balkonbatterij</b> of gewoon als <b>thuisbatterij met stekker</b> &mdash; vier namen voor hetzelfde apparaat.</p>

  <p>Hieronder staan alle ${stekker.length} modellen uit onze vergelijker die je zonder monteur aansluit, gesorteerd op prijs per kilowattuur. De prijzen worden dagelijks automatisch bij de winkels gecontroleerd.</p>

  ${stekkerTabel(stekker)}

  <h2>Wat je ervoor terugkrijgt</h2>
  <p>Deze ${stekker.length} batterijen lopen van ${nl(Math.min(...caps))} tot ${nl(Math.max(...caps))} kWh, met een laad- en ontlaadvermogen van ${nl(Math.min(...vermogens))} tot ${nl(Math.max(...vermogens))} kW. Ze zijn alle ${stekker.length} eenfasig: ze werken op één groep van je meterkast en kunnen dus niet je hele huis in één keer voeden.</p>
  <ul>
    <li><b>Noodstroom is iets anders dan je denkt.</b> ${metNoodstroom} van de ${stekker.length} hebben een noodstroomfunctie, maar dat is bij vrijwel alle modellen een stopcontact op het apparaat zelf. Bij een stroomstoring blijft wat je daarin steekt werken; de rest van je huis niet. Een automatische overschakeling van de hele woning vraagt een batterij die een installateur plaatst.</li>
    <li><b>Buiten hangen mag niet zomaar.</b> ${buiten} van de ${stekker.length} hebben een IP65-behuizing of beter en kunnen daarmee tegen regen. De rest hoort binnen te staan.</li>
    <li><b>Je kunt hem meenemen.</b> Verhuis je, dan gaat hij mee. Dat scheelt bij een huurwoning of een huis dat je over een paar jaar verkoopt.</li>
  </ul>

  <h2>Stekker of installateur?</h2>
  <p>De keuze gaat niet over prijs per kilowattuur &mdash; daar ontlopen de twee groepen elkaar minder dan je zou denken. Hij gaat over instapbedrag en over wat je ermee kunt.</p>
  <ul>
    <li><b>Instappen is goedkoper.</b> De goedkoopste stekkerbatterij in onze vergelijker kost ${eur(Math.min(...prijzen))}${restPrijzen.length ? `, tegenover ${eur(Math.min(...restPrijzen))} voor de goedkoopste batterij die een installateur plaatst` : ""}. Daar komt bij dat de installatie zelf niets kost.</li>
    <li><b>Groot worden ze niet.</b> De stekkermodellen gaan tot ${nl(Math.max(...caps))} kWh${restCaps.length ? `; de vaste batterijen lopen door tot ${nl(Math.max(...restCaps))} kWh` : ""}. Heb je een groot verbruik, een warmtepomp of een elektrische auto, dan loop je tegen die grens aan.</li>
    <li><b>Uitbreiden kan vaak wel.</b> Veel merken verkopen losse uitbreidingsmodules die je aan dezelfde stekkerbatterij hangt. Kijk op de modelpagina wat de maximale capaciteit is voordat je de kleinste koopt.</li>
    <li><b>Zonnepanelen aansluiten verschilt.</b> Sommige stekkerbatterijen nemen zelf zonnepanelen aan, andere laden alleen uit het stopcontact en werken samen met je bestaande omvormer. Dat staat per model in de tabel op de <a href="/index.html">vergelijker</a>.</li>
  </ul>

  <h2>Zo kies je</h2>
  <ul>
    <li><b>Begin bij de maat.</b> De <a href="/advies.html">keuzehulp</a> rekent uit hoeveel kWh bij jouw verbruik past. Te groot kopen kost geld dat je niet terugverdient.</li>
    <li><b>Reken het na.</b> De <a href="/rekenmodule.html">rekenmodule</a> laat zien wat een batterij per jaar oplevert bij een vast of een dynamisch contract, met of zonder zonnepanelen.</li>
    <li><b>Let op de aansturing.</b> Wil je hem laten meebewegen met de uurprijzen, kijk dan naar de <a href="/uitleg.html#koppel-score">Koppel-score</a>: die telt Homey, Home Assistant en dynamisch contract mee.</li>
    <li><b>Nieuw hier?</b> De <a href="/uitleg.html">uitleg</a> legt in gewone taal uit wat kWh, salderen en een dynamisch contract betekenen.</li>
  </ul>

  <div class="waarschuwing-kader">Prijzen en specificaties veranderen regelmatig. Deze pagina wordt dagelijks automatisch bijgewerkt vanuit onze <a href="/index.html">vergelijker</a>; de prijs en specificaties op de website van de winkel zijn altijd leidend.</div>
</main>

${VOET_HTML}

<script src="/assets/nav.js?v=${ASSET_VERSIE}" defer></script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------
   "Wat kost een thuisbatterij?"

   Een van de meest gestelde vragen, en overal wordt hij beantwoord met een
   tabel van capaciteit naar bedrag: 5 kWh is zoveel, 10 kWh is zoveel. Onze
   eigen gegevens zeggen dat dat niet klopt. De prijs per kilowattuur daalt
   hier niet met de maat; hij volgt de soort. Een stekkerbatterij zit rond de
   350 euro per kWh en een batterij die een installateur plaatst rond de 460,
   en juist de grootste modellen zijn het duurst per kWh.

   Die uitkomst is het waard om de pagina omheen te bouwen, want ze verandert
   wat iemand moet doen: eerst kiezen hoe je hem aansluit, dan pas hoe groot.
   Alle bedragen komen uit de vergelijker, dus ze bewegen mee met de dagelijkse
   prijscontrole in plaats van te bevriezen op de dag dat dit geschreven is.
   ------------------------------------------------------------------ */

const KOSTEN_BESTAND = "wat-kost-een-thuisbatterij.html";

const KLASSEN = [
  { naam: "tot 3 kWh", van: 0, tot: 3, waarvoor: "een enkele avondpiek, of een klein verbruik" },
  { naam: "3 tot 6 kWh", van: 3, tot: 6, waarvoor: "de meestgekozen maat voor een gezin zonder warmtepomp" },
  { naam: "6 tot 10 kWh", van: 6, tot: 10, waarvoor: "een huis met zonnepanelen en een hoger verbruik" },
  { naam: "10 kWh en meer", van: 10, tot: Infinity, waarvoor: "warmtepomp, elektrische auto of drie fasen" },
];

const mediaan = (getallen) => {
  const g = getallen.filter((n) => typeof n === "number").sort((a, b) => a - b);
  return g.length ? g[Math.floor(g.length / 2)] : null;
};

function kostenGroep(lijst) {
  const prijzen = lijst.map((b) => bestePrijs(b)).filter(Boolean).map((a) => Prijs.vergelijkPrijs(a));
  return {
    aantal: lijst.length,
    laagste: prijzen.length ? Math.min(...prijzen) : null,
    hoogste: prijzen.length ? Math.max(...prijzen) : null,
    perKwh: mediaan(lijst.map((b) => perKwhInclBtw(b))),
    stekker: lijst.filter((b) => b.type === "plug-in").length,
  };
}

function kostenTabel(rijen) {
  return `<div class="tabel-blok los">
  <table class="data-tabel brede-tabel overzicht-tabel kolom-vast">
    <thead><tr>
      <th>Capaciteit</th>
      <th>Modellen</th>
      <th>Prijs van &ndash; tot</th>
      <th>Mediaan per kWh</th>
      <th>Waarvoor</th>
    </tr></thead>
    <tbody>${rijen.map(({ klasse, cijfers }) => `
      <tr>
        <td><b>${esc(klasse.naam)}</b></td>
        <td class="niet-afbreken">${cijfers.aantal}<br><small>${cijfers.stekker === 0 ? "geen met stekker" : cijfers.stekker === cijfers.aantal ? "alle met stekker" : `${cijfers.stekker} met stekker`}</small></td>
        <td class="niet-afbreken">${cijfers.laagste ? `${eur(cijfers.laagste)} &ndash; ${eur(cijfers.hoogste)}` : "n.b."}</td>
        <td class="niet-afbreken">${cijfers.perKwh ? eur(cijfers.perKwh) : "n.b."}</td>
        <td>${esc(klasse.waarvoor)}</td>
      </tr>`).join("")}</tbody>
  </table>
  </div>`;
}

function kostenPagina() {
  const rijen = KLASSEN
    .map((klasse) => ({ klasse, lijst: data.batterijen.filter((b) => b.capaciteit_kwh >= klasse.van && b.capaciteit_kwh < klasse.tot) }))
    .filter((r) => r.lijst.length)
    .map((r) => ({ ...r, cijfers: kostenGroep(r.lijst) }));

  const stekker = data.batterijen.filter((b) => b.type === "plug-in");
  const vast = data.batterijen.filter((b) => b.type !== "plug-in");
  const perKwhStekker = mediaan(stekker.map((b) => perKwhInclBtw(b)));
  const perKwhVast = mediaan(vast.map((b) => perKwhInclBtw(b)));

  const compleet = (lijst) => {
    const van = lijst.filter((b) => b.totaalprijs_van_eur).map((b) => b.totaalprijs_van_eur);
    const tot = lijst.filter((b) => b.totaalprijs_van_eur).map((b) => b.totaalprijs_tot_eur || b.totaalprijs_van_eur);
    return van.length ? { van: Math.min(...van), tot: Math.max(...tot), aantal: van.length } : null;
  };
  const compleetStekker = compleet(stekker);
  const compleetVast = compleet(vast);
  const zonderCompleet = data.batterijen.filter((b) => !b.totaalprijs_van_eur).length;

  const alle = data.batterijen.map((b) => bestePrijs(b)).filter(Boolean).map((a) => Prijs.vergelijkPrijs(a));

  const titel = `Wat kost een thuisbatterij in ${JAAR}?`;
  const metaDesc = kortOmschrijving(
    `Van ${eur(Math.min(...alle))} tot ${eur(Math.max(...alle))} voor het apparaat, met de prijs per kWh per capaciteitsklasse. Dagelijks bijgewerkt uit ${data.batterijen.length} modellen.`,
  );

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(besteTitel([titel, "Wat kost een thuisbatterij?"]))}</title>
  <meta name="description" content="${esc(metaDesc)}">
  <link rel="canonical" href="${SITE}/${KOSTEN_BESTAND}">
  <meta property="og:title" content="${esc(titel)}">
  <meta property="og:description" content="${esc(metaDesc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${SITE}/${KOSTEN_BESTAND}">
  <meta property="og:locale" content="nl_NL">
  <meta property="og:image" content="${SITE}/assets/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name" content="Batterijmaatje.nl">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="preload" href="/assets/fonts/figtree-variable.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/style.css?v=${ASSET_VERSIE}">
  <link rel="icon" href="/assets/favicon.svg?v=2" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png?v=2">
</head>
<body>

${NAV_HTML}

<main class="container leespagina">
  <p class="datum-stempel"><a href="/index.html">${Iconen.svg("pijl-links")} Alle thuisbatterijen vergelijken</a></p>
  <h1>${esc(titel)}</h1>
  <p class="datum-stempel">Dagelijks automatisch bijgewerkt · laatst gecontroleerd op ${datumNL(data.laatst_bijgewerkt || VANDAAG)}</p>

  <p class="intro">Voor het apparaat zelf: <b>${eur(Math.min(...alle))} tot ${eur(Math.max(...alle))}</b>, gerekend over de ${data.batterijen.length} modellen in onze vergelijker. Dat is een groot bereik, en de capaciteit verklaart er minder van dan je zou denken.</p>

  <h2>Per capaciteit</h2>
  ${kostenTabel(rijen)}
  <p class="datum-stempel">Prijs van het apparaat, incl. btw, bij de goedkoopste winkel die wij vinden. Waar geen winkel is, staat de richtprijs van de fabrikant. De mediaan is het middelste model van die groep, niet het gemiddelde: één uitschieter trekt een gemiddelde scheef en die staan er in elke groep.</p>

  <h2>Groter is niet goedkoper per kilowattuur</h2>
  <p>Dat is de aanname achter bijna elk prijsoverzicht, en in onze gegevens klopt hij niet. De mediaan per kWh ligt bij <b>${eur(perKwhStekker)}</b> voor een stekkerbatterij en bij <b>${eur(perKwhVast)}</b> voor een batterij die een installateur plaatst &mdash; en de grootste modellen zijn juist die tweede soort.</p>
  <p>De prijs per kilowattuur volgt dus niet de maat maar de <b>soort</b>. Dat draait de volgorde van je keuze om: eerst bepalen hoe hij wordt aangesloten, dan pas hoe groot. Wat die twee soorten zijn, staat op <a href="/${STEKKER_BESTAND}">thuisbatterij met stekker</a>.</p>

  <h2>Wat er nog bij komt</h2>
  <p>De bedragen hierboven zijn het apparaat. Gebruiksklaar is iets anders, en dat verschilt sterk per soort:</p>
  <ul>
    ${compleetStekker ? `<li><b>Met stekker: ${eur(compleetStekker.van)} tot ${eur(compleetStekker.tot)} compleet.</b> Vaak is de winkelprijs al alles; soms komt er een P1-meter van een paar tientjes bij. Je sluit hem zelf aan, dus installatiekosten zijn er niet.</li>` : ""}
    ${compleetVast ? `<li><b>Met installateur: ${eur(compleetVast.van)} tot ${eur(compleetVast.tot)} compleet.</b> Hier zit het verschil met de kale apparaatprijs in montage, bekabeling, een omvormer als je die nog niet hebt, en werk in de meterkast.</li>` : ""}
    <li><b>Btw.</b> Alle bedragen op deze site zijn incl. btw. Koop je de batterij samen met zonnepanelen, dan geldt vaak het nultarief; los ervan meestal niet. Wat er precies geldt staat op <a href="/regelgeving.html">regels en subsidies</a>.</li>
    ${zonderCompleet ? `<li><b>Van ${zonderCompleet} modellen weten wij de complete prijs niet.</b> Dat zijn er die alleen via een installateur gaan, waar het bedrag van je woning afhangt. Die staan in de tabel met de apparaatprijs; de offerte is leidend.</li>` : ""}
  </ul>

  <h2>Wat het je oplevert is een andere vraag</h2>
  <p>Een goedkope batterij die niet bij je verbruik past, verdient zichzelf niet terug. De <a href="/rekenmodule.html">rekenmodule</a> rekent uit wat een batterij per jaar oplevert bij jouw verbruik en contract, en de <a href="/advies.html">keuzehulp</a> zoekt de maat erbij. Reken met beide voordat je op de prijs afgaat: het verschil tussen een vast en een dynamisch contract is voor de opbrengst groter dan het verschil tussen twee modellen.</p>

  <div class="waarschuwing-kader">Prijzen veranderen dagelijks. Deze pagina wordt automatisch bijgewerkt vanuit onze <a href="/index.html">vergelijker</a>; de prijs op de website van de winkel is altijd leidend.</div>
</main>

${VOET_HTML}

<script src="/assets/nav.js?v=${ASSET_VERSIE}" defer></script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------
   "Nu kopen of wachten?"

   De vraag van iemand die al besloten heeft dat hij er een wil - de duurste
   bezoeker die er is, en er stond geen woord over op de site.

   Waar deze pagina zich verre van houdt: voorspellen dat batterijen goedkoper
   worden. Dat is de standaardzin in dit hoekje van het internet, en wij kunnen
   hem niet waarmaken: onze gegevens bevatten geen prijsgeschiedenis, alleen de
   prijs van vandaag. Een bewering over een dalende lijn zou hier dus verzonnen
   zijn. Dat schrijven we ook op, want het is een van de twee argumenten die
   mensen tegenkomen en het is nergens op gebaseerd.

   Wat we wel kunnen: de dingen benoemen die aantoonbaar veranderen (de datum
   van de saldering, de btw-voorwaarde, de wachtlijst bij de netbeheerder) en
   de bezoeker naar de rekenmodule sturen, want het antwoord hangt af van zijn
   contract en zijn verbruik en niet van het jaartal.
   ------------------------------------------------------------------ */

const WACHTEN_BESTAND = "nu-kopen-of-wachten.html";

function wachtenPagina() {
  const korting = data.batterijen.filter((b) => Prijs.heeftKorting(b));
  const dynamisch = data.batterijen.filter((b) => driewaardig(b.dynamisch_contract).status !== "nee");
  const alle = data.batterijen.map((b) => bestePrijs(b)).filter(Boolean).map((a) => Prijs.vergelijkPrijs(a));

  const titel = "Thuisbatterij nu kopen of wachten?";
  const metaDesc = kortOmschrijving(
    "Wat er wel en niet verandert voor 2027: saldering, btw en de wachtlijst bij de netbeheerder. Met de redenen om te wachten, en de redenen die geen reden zijn.",
  );

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(besteTitel([`${titel} (${JAAR})`, titel]))}</title>
  <meta name="description" content="${esc(metaDesc)}">
  <link rel="canonical" href="${SITE}/${WACHTEN_BESTAND}">
  <meta property="og:title" content="${esc(titel)}">
  <meta property="og:description" content="${esc(metaDesc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${SITE}/${WACHTEN_BESTAND}">
  <meta property="og:locale" content="nl_NL">
  <meta property="og:image" content="${SITE}/assets/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name" content="Batterijmaatje.nl">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="preload" href="/assets/fonts/figtree-variable.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/style.css?v=${ASSET_VERSIE}">
  <link rel="icon" href="/assets/favicon.svg?v=2" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png?v=2">
</head>
<body>

${NAV_HTML}

<main class="container leespagina">
  <p class="datum-stempel"><a href="/index.html">${Iconen.svg("pijl-links")} Alle thuisbatterijen vergelijken</a></p>
  <h1>${esc(titel)}</h1>
  <p class="datum-stempel">Dagelijks automatisch bijgewerkt · laatst gecontroleerd op ${datumNL(data.laatst_bijgewerkt || VANDAAG)}</p>

  <p class="intro">Het eerlijke antwoord is dat het niet aan het jaartal ligt. Een thuisbatterij verdient zichzelf terug uit het <i>verschil</i> tussen goedkope en dure uren, en dat verschil hangt af van je contract en je verbruik. Wie daar nu al genoeg van heeft, wint met wachten niets. Wie dat pas na 2027 krijgt, koopt nu iets dat een jaar stilligt.</p>

  <h2>Wat er echt verandert op 1 januari 2027</h2>
  <p>De salderingsregeling stopt. Tot en met 31 december 2026 streep je teruggeleverde stroom nog weg tegen je verbruik; daarna krijg je er een terugleververgoeding voor die een stuk lager ligt dan wat je voor stroom betaalt. Daarmee wordt elke kilowattuur die je zélf gebruikt ineens veel meer waard &mdash; en dat is precies wat een batterij doet.</p>
  <p><b>Een batterij wordt na 2027 dus nuttiger, niet goedkoper.</b> Dat is het hele punt, en het wordt vaak omgedraaid tot "koop nu het nog kan". Er verdwijnt niets wat je nu nog moet grijpen. De volledige uitleg staat op <a href="/regelgeving.html">regels en subsidies</a>.</p>

  <h2>Redenen om niet te wachten</h2>
  <ul>
    <li><b>Je hebt al een dynamisch contract.</b> Dan levert een batterij nu al op, los van de saldering: laden als de prijs laag is, gebruiken als hij hoog is. ${dynamisch.length} van de ${data.batterijen.length} modellen in onze vergelijker kunnen op uurprijzen sturen.</li>
    <li><b>Je levert veel terug en betaalt terugleverkosten.</b> Die kosten lopen nu al, niet pas in 2027. Elke maand wachten is een maand betalen om je eigen stroom kwijt te raken.</li>
    <li><b>Je wilt een zwaardere aansluiting.</b> Bij netcongestie kun je als kleinverbruiker op een wachtlijst komen. Een batterij vangt juist de piek af, dus die aanvraag wordt er niet makkelijker op door te wachten.</li>
    <li><b>Er staat nu een aanbieding op.</b> ${korting.length ? `Op dit moment ${korting.length === 1 ? "is dat bij één model het geval" : `zijn dat er ${korting.length}`}; wij markeren ze in de <a href="/index.html">vergelijker</a>.` : "Op dit moment staat er bij geen enkel model een korting, maar dat wisselt per week."}</li>
  </ul>

  <h2>Redenen om wel te wachten</h2>
  <ul>
    <li><b>Je hebt nog een vast contract dat pas later afloopt.</b> Zonder prijsverschil per uur en zonder terugleverkosten valt er weinig te verdienen. Laat de batterij samenvallen met een nieuw contract.</li>
    <li><b>Je overweegt zonnepanelen erbij.</b> Koop je de batterij tegelijk met panelen, dan geldt vaak het nultarief voor de btw; los ervan meestal niet. Dat scheelt 21 procent en is het wachten waard.</li>
    <li><b>Je weet nog niet hoe groot.</b> Te groot kopen kost geld dat je niet terugverdient, en dat is een duurdere vergissing dan een paar maanden later beslissen. Doe eerst de <a href="/advies.html">keuzehulp</a>.</li>
    <li><b>Je huis verandert nog.</b> Komt er een warmtepomp of een laadpaal, dan verandert je verbruikspatroon en daarmee de maat die past.</li>
  </ul>

  <h2>Wat géén reden is</h2>
  <ul>
    <li><b>"Batterijen worden elk jaar goedkoper."</b> Dat kunnen wij niet hardmaken en wij doen het daarom niet. Onze vergelijker bewaart de prijs van vandaag en geen prijsgeschiedenis, dus een dalende lijn zou hier een aanname zijn en geen meting. Wat we wel zien: het bereik loopt vandaag van ${eur(Math.min(...alle))} tot ${eur(Math.max(...alle))}, en dat verschil is groter dan wat een jaar wachten aan welke kant dan ook zou opleveren. Kiezen wat bij je past levert meer op dan timen.</li>
    <li><b>"Straks is er subsidie."</b> Er is in ${JAAR} geen landelijke aankoopsubsidie voor thuisbatterijen, en er ligt geen aangekondigde regeling klaar. Wachten op iets wat niet is aangekondigd is geen plan.</li>
    <li><b>"Ik moet erbij zijn voordat de saldering stopt."</b> Andersom: daarna is hij nuttiger. De datum is geen deadline voor de koper van een batterij.</li>
  </ul>

  <h2>Reken het na in plaats van te gokken</h2>
  <p>De <a href="/rekenmodule.html">rekenmodule</a> laat zien wat een batterij in jouw situatie per jaar oplevert, met of zonder zonnepanelen en bij een vast of dynamisch contract. Zet dezelfde som eens met en eens zonder saldering: het verschil tussen die twee uitkomsten is precies wat wachten je kost of oplevert. Dat is een concreter antwoord dan welk artikel dan ook kan geven, inclusief dit.</p>
  <p>En wat het apparaat op dit moment kost, staat op <a href="/${KOSTEN_BESTAND}">wat kost een thuisbatterij</a>.</p>

  <div class="waarschuwing-kader">Deze pagina beschrijft de regels zoals ze nu vastliggen, met de bronnen op <a href="/regelgeving.html">regels en subsidies</a>. Het is geen financieel advies en geen voorspelling.</div>
</main>

${VOET_HTML}

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

  const rij = (label, wa, wb, winnaar = -1) =>
    `<tr><th>${esc(label)}</th>` +
    `<td>${winnaar === 0 ? `<b>${wa}</b>` : wa}</td>` +
    `<td>${winnaar === 1 ? `<b>${wb}</b>` : wb}</td></tr>`;

  const laagWint = (x, y) => (x == null || y == null || x === y) ? -1 : (x < y ? 0 : 1);
  const hoogWint = (x, y) => (x == null || y == null || x === y) ? -1 : (x > y ? 0 : 1);
  const perA = perKwhVan(A), perB = perKwhVan(B);
  const typeLabelVan = (b) => ({ "plug-in": "Plug-in (stopcontact)", "ac-gekoppeld": "AC-gekoppeld", "hybride": "Hybride omvormer" }[b.type] || b.type);
  const noodA = vierwaardig(A.noodstroom), noodB = vierwaardig(B.noodstroom);

  const plusA = pluspunten(A, B), plusB = pluspunten(B, A);
  const titel = `${naam(A)} vs ${naam(B)}: welke thuisbatterij?`;
  // Bij een lange modelnaam ("SigenStor 8 kWh + 8 kW omvormer") past zelfs de
  // kale vergelijking niet meer; dan volstaat merk plus capaciteit.
  const kortAf = (b) => `${b.merk} ${nl(b.capaciteit_kwh)} kWh`;
  const paginaTitel = besteTitel([
    `${naamZonderHaakjes(A)} vs ${naamZonderHaakjes(B)}`,
    `${kortAf(A)} vs ${kortAf(B)}`,
  ]);
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

${NAV_HTML}

<main class="container leespagina">
  <p class="datum-stempel"><a href="/index.html">${Iconen.svg("pijl-links")} Alle thuisbatterijen vergelijken</a></p>
  <h1>${esc(naam(A))} vs ${esc(naam(B))}</h1>
  <p class="datum-stempel">Prijzen dagelijks automatisch gecontroleerd · laatst op ${datumNL(data.laatst_bijgewerkt || VANDAAG)}</p>
  <p>Twee veelvergeleken thuisbatterijen naast elkaar, op basis van dezelfde feiten als in onze <a href="/index.html">vergelijker</a>. Onder de tabel staan de belangrijkste verschillen op een rij. Vetgedrukt betekent: op dit punt objectief in het voordeel.</p>

  <div class="tabel-blok los">
  <table class="data-tabel brede-tabel duel-tabel kolom-vast">
    <thead><tr>
      <th></th>
      <th><a href="/batterij/${esc(A.id)}.html">${esc(naam(A))}</a></th>
      <th><a href="/batterij/${esc(B.id)}.html">${esc(naam(B))}</a></th>
    </tr></thead>
    <tbody>
      ${rij("Beste prijs incl. btw", besteA ? `${eur(Prijs.vergelijkPrijs(besteA))}<br><small>bij ${esc(besteA.winkel)}</small>` : "op aanvraag", besteB ? `${eur(Prijs.vergelijkPrijs(besteB))}<br><small>bij ${esc(besteB.winkel)}</small>` : "op aanvraag")}
      ${rij("Compleet gebruiksklaar (indicatie)", totaalprijsTekst(A) || "op aanvraag", totaalprijsTekst(B) || "op aanvraag")}
      ${rij("Prijs per kWh opslag", perA ? eur(perA) : "n.b.", perB ? eur(perB) : "n.b.", laagWint(perA, perB))}
      ${rij("Capaciteit", `${nl(A.capaciteit_kwh)} kWh${Prijs.capaciteitLabelHtml(A)}${A.uitbreidbaar_tot_kwh ? ` <small>(tot ${nl(A.uitbreidbaar_tot_kwh)})</small>` : ""}`, `${nl(B.capaciteit_kwh)} kWh${Prijs.capaciteitLabelHtml(B)}${B.uitbreidbaar_tot_kwh ? ` <small>(tot ${nl(B.uitbreidbaar_tot_kwh)})</small>` : ""}`)}
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

${VOET_HTML}

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

writeFileSync(resolve(ROOT, STEKKER_BESTAND), stekkerPagina(), "utf8");
console.log(`${STEKKER_BESTAND} gegenereerd (${data.batterijen.filter((b) => b.type === "plug-in").length} stekkerbatterijen)`);

writeFileSync(resolve(ROOT, KOSTEN_BESTAND), kostenPagina(), "utf8");
writeFileSync(resolve(ROOT, WACHTEN_BESTAND), wachtenPagina(), "utf8");
console.log(`${KOSTEN_BESTAND} en ${WACHTEN_BESTAND} gegenereerd`);

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

// De vergelijker opent in lijstweergave, dus dat is ook wat hier in de HTML
// komt te staan. Zet je hier kaarten neer terwijl de browser meteen daarna
// regels tekent, dan ziet de bezoeker het beeld een keer omklappen en krijgt
// een zoekmachine iets anders te zien dan een mens.
const kaarten = Kaart.lijstHtml(gesorteerdeBatterijen, { merkLogos: data.merk_logos });

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
  { loc: `${SITE}/${STEKKER_BESTAND}`, freq: "daily", prio: "0.8" },
  { loc: `${SITE}/${KOSTEN_BESTAND}`, freq: "daily", prio: "0.8" },
  { loc: `${SITE}/${WACHTEN_BESTAND}`, freq: "weekly", prio: "0.7" },
  { loc: `${SITE}/over-ons.html`, freq: "monthly", prio: "0.4" },
  { loc: `${SITE}/contact.html`, freq: "yearly", prio: "0.3" },
  { loc: `${SITE}/privacy.html`, freq: "yearly", prio: "0.2" },
];

const urls = [
  ...vast,
  ...data.batterijen.map((b) => ({ loc: `${SITE}/batterij/${b.id}.html`, freq: "daily", prio: "0.7" })),
  ...VERGELIJKINGEN.map((v) => ({ loc: `${SITE}/vergelijk/${v.slug}.html`, freq: "daily", prio: "0.7" })),
];

const lastmodVoor = lastmodMaker(ROOT, SITE, STAND_VOOR, VANDAAG);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${lastmodVoor(u.loc)}</lastmod>\n    <changefreq>${u.freq}</changefreq>\n    <priority>${u.prio}</priority>\n  </url>`).join("\n") +
  `\n</urlset>\n`;

writeFileSync(resolve(ROOT, "sitemap.xml"), sitemap, "utf8");
const vers = urls.filter((u) => lastmodVoor(u.loc) === VANDAAG).length;
console.log(`sitemap.xml herbouwd met ${urls.length} URL's, waarvan ${vers} met lastmod van vandaag`);
