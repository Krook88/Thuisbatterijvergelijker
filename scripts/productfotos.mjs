/**
 * Productfoto's ophalen bij de fabrikant en bij de winkels die het verkopen.
 *
 * Waarom dit bestaat: van de 85 productpagina's op de drie sites hebben er 58
 * geen afbeelding, en zonder afbeelding toont Google geen productresultaat. De
 * rest van de markup is compleet - naam, merk, breadcrumbs, prijs, beschikbaar-
 * heid - en levert zonder die ene foto niets op. Dat is niet te zien aan de
 * pagina, want die werkt gewoon, en het staat sinds kort als signaal in
 * scripts/zoekmachine.mjs.
 *
 * 57 van die 58 producten hebben een `product_url` naar de fabrikant. Daar
 * staat vrijwel altijd een productfoto op, en die mag met bronvermelding
 * getoond worden; sites/batterijmaatje/README.md legt dat veld (`afbeelding_bron`)
 * al vast voor de 27 foto's die er wel zijn.
 *
 * Twee dingen die dit script met opzet niet doet.
 *
 * Het kiest niet zelf welke foto goed genoeg is. Een og:image is bij de ene
 * fabrikant een strakke productfoto op wit en bij de andere een sfeerbeeld van
 * een gezin op de bank. Het script haalt op, zet om en zegt erbij via welke
 * weg het beeld gevonden is; daarna kijkt een mens ernaar. Een verkeerde foto
 * bij een warmtepomp is erger dan geen foto.
 *
 * En het duwt niets naar de hoofdtak. De werkstroom eromheen commit naar een
 * eigen tak, zodat er niets live staat voordat iemand de 58 beelden gezien
 * heeft.
 *
 *   node scripts/productfotos.mjs [--site <naam>] [--alleen id,id] [--droog]
 *                                  [--beeld id=adres,id=adres] [--toon "stuk-adres"]
 *
 * Draaien doe je het via de werkstroom "Productfoto's ophalen": deze omgeving
 * komt niet bij fabrikantsites, want de egress-proxy laat alleen npm en pypi
 * door.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { haalPagina, haalMetBrowser, sluitBrowser } from "../kern/scripts/prijs-uitlezen.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* Elke site bewaart zijn producten net iets anders. */
const SITES = [
  { site: "batterijmaatje", bestand: "batterijen.json", sleutel: "batterijen" },
  { site: "zonnestroommaatje", bestand: "panelen.json", sleutel: "panelen" },
  { site: "zonnestroommaatje", bestand: "omvormers.json", sleutel: "omvormers" },
  { site: "warmtepompmaatje", bestand: "warmtepompen.json", sleutel: "warmtepompen" },
];

// Dezelfde maat als de 27 foto's die er al staan: ongeveer 900 pixels breed,
// gemiddeld 19 kB. Boven de bovengrens klopt er iets niet en slaan we hem over.
const BREEDTE = 900;
const KWALITEIT = 82;
const MAX_BYTES = 300 * 1024;

const argv = process.argv.slice(2);
const vlag = (naam) => {
  const i = argv.indexOf(naam);
  return i >= 0 ? argv[i + 1] : null;
};
const DROOG = argv.includes("--droog");
const ALLEEN_SITE = vlag("--site");
const ALLEEN = (vlag("--alleen") || "").split(",").map((s) => s.trim()).filter(Boolean);

/* Meer kandidaten tonen: --toon "solarvault-3-pro-max"
 *
 * Een droge run toont de beste kandidaat en drie reserves. Op de pagina van de
 * Jackery SolarVault 3 stonden 572 beelden, en de vier bovenste waren een
 * Explorer 300D uit het menu; het juiste beeld stond er wel tussen, maar niet
 * in beeld. Met --toon laat hij alle kandidaten zien waarvan het adres dit stuk
 * tekst bevat (meerdere met |), zodat je er een kiest voor --beeld. */
const TOON = (vlag("--toon") || "").toLowerCase().split("|").map((s) => s.trim()).filter(Boolean);

/* Met de hand gekozen beeld: --beeld id=adres,id=adres
 *
 * Waarom dit erbij moest. De droge run toont per product de beste kandidaat én
 * drie alternatieven, precies omdat een mens ernaar hoort te kijken. Maar
 * daarna kon diezelfde mens er niets mee: de echte run pakte altijd nummer
 * één. Bij de Sessy was dat nps-score.png en stond de productfoto op plek twee;
 * bij de SolarEdge was het een installatieplaatje terwijl 48V-product-new.jpg
 * er gewoon tussen stond. "Een mens kijkt ernaar" werkt alleen als die mens
 * ook kan kiezen.
 *
 * Het adres komt dus uit de lijst van een eerdere droge run en niet uit de
 * lucht: wat hier staat is door het script zelf op die pagina gevonden en door
 * NOOIT en VERZONNEN heen gekomen. De bronvermelding wordt bepaald door te
 * kijken welke van de bekende bronpagina's bij het adres hoort, zodat er geen
 * verkeerde naam onder de foto komt. */
export function leesBeeldkeuze(tekst) {
  /* Niet knippen op elke komma. De eerste versie deed dat wel, en viel meteen
     om op het eerste echte adres dat ik erin zette: de Viessmann Vitocal 150-A
     staat bij de fabrikant onder een pad met "0,36,1920,1044" erin. Dat werd
     vier stukken, waarvan het eerste een geldig ogend maar afgekapt adres was.
     Een scheidingsteken dat in de gegevens zelf voorkomt, is geen
     scheidingsteken.

     Wat wel werkt: knippen op de plek waar een nieuw paar begint, en dat is te
     herkennen aan "id=http". Alles daartussen hoort bij het adres, komma's en
     al. Regeleindes mogen ook, want in het invoerveld van de werkstroom typ je
     ze makkelijker dan komma's. */
  const uit = [];
  const re = /(^|[,\n\r])\s*([a-z0-9][a-z0-9._-]*)\s*=\s*(https?:\/\/[^\n\r]*?)(?=\s*(?:[,\n\r]\s*[a-z0-9][a-z0-9._-]*\s*=\s*https?:\/\/|$))/gi;
  let m;
  while ((m = re.exec(String(tekst || ""))) !== null) {
    const heel = m[3].trim().replace(/,+$/, "");
    /* Achter een | mag de pagina staan waar het beeld vandaan komt. Dat is
       niet uit het beeldadres af te leiden, en het bepaalt wel wiens naam er
       onder de foto komt: de Victron MultiPlus-II werd gevonden bij
       Acculaders.nl, maar het bestand staat op cdn.webshopapp.com. Zonder dit
       viel de bron terug op de eerste bekende bronpagina - de fabrikant - en
       stond er "foto: Victron Energy" onder een foto van de winkel. Een site
       die zijn prijzen bij de winkel natelt kan zich geen bronvermelding
       veroorloven die de verkeerde partij noemt. */
    const streep = heel.indexOf("|");
    const adres = streep < 0 ? heel : heel.slice(0, streep).trim();
    const pagina = streep < 0 ? "" : heel.slice(streep + 1).trim();
    if (adres) uit.push([m[2].trim(), pagina ? { url: adres, pagina } : adres]);
  }
  return uit;
}

const BEELD = new Map(leesBeeldkeuze(vlag("--beeld")));

/* ------------------------------------------------------------------
   Kandidaten uit een pagina halen

   Op volgorde van hoe waarschijnlijk het het product zelf is. De structured
   data van een webshop wijst het product aan; og:image is wat de fabrikant
   zelf als visitekaartje kiest, en dat is meestal maar niet altijd het product.
   ------------------------------------------------------------------ */

const BEELDSOORTEN = /\.(jpe?g|png|webp)(\?|#|$)/i;

/* Adressen die nooit het product zijn, hoe ze ook binnenkomen.
 *
 * Dit stond eerst alleen op de gewone <img>-tags, en dat was te weinig: juist
 * de logo's kwamen binnen via og:image, waar het filter niet langs kwam. De
 * eerste droge run over 70 producten koos daardoor nibe-logga-200.jpg voor de
 * NIBE, logo-lg-100-44.jpg voor de LG en logo-square-letter.png voor de
 * Samsung. Een fabrikant zet in og:image zijn merk, niet zijn product. */
// Let op de scheidingstekens: het adres wordt eerst gedecodeerd, dus "%20"
// is dan een spatie. Met [-_%20] stond die spatie er niet bij, en glipte
// "social share weheat.jpg" er alsnog doorheen.
const NOOIT = /logo|logga|icon|sprite|avatar|badge|placeholder|transparent|og[-_ ]?image|og[-_ ]?thumb|social[^a-z0-9]{0,3}share|share[^a-z0-9]{0,3}image|banner/i;

/* Beeld dat een machine heeft verzonnen.
 *
 * Thuisbatterij Nederland zette bij de Tesla Powerwall 3 een bestand met de
 * naam ChatGPT-Image-7-mei-2026-11_47_05-1.png. Op een contactvel ziet dat
 * eruit als een keurige productfoto, en dat is precies het probleem: het is
 * geen foto van dit apparaat maar een tekening van iets wat erop lijkt. Een
 * site die zijn prijzen bij de winkel natelt, kan geen verzonnen product tonen.
 * De bestandsnaam is het enige wat het verraadt. */
const VERZONNEN = /chatgpt|dall[-_ ]?e|midjourney|stable[-_ ]?diffusion|ai[-_ ]?generated|generated[-_ ]?image|firefly/i;

/* Beeld dat al eens is bekeken en afgekeurd.
 *
 * Het script kiest niet welke foto goed genoeg is; dat doet een mens, en in de
 * ronde van oktober 2026 overleefden van de acht voorstellen er zeven het
 * nakijken niet. Een datasheet-omslag bij de Aiko, een gevel met een fiets bij
 * de Viessmann 150-A, "SUBSIDIE MOGELIJK" in het beeld gebrand bij de NIBE.
 * Zonder geheugen komen die er de volgende ronde weer bovenuit, want voor het
 * script zien ze er nog steeds uit als de beste kandidaat.
 *
 * Dit is dus geen filter op kenmerken maar een lijst van beslissingen, met de
 * reden erbij. Die reden is het enige wat een volgende lezer verder helpt:
 * "afgekeurd" zonder waarom nodigt uit om het nog eens te proberen. */
const afgewezenPad = join(ROOT, "scripts", "afgewezen-fotos.json");
export const AFGEWEZEN = new Set(
  existsSync(afgewezenPad)
    ? (JSON.parse(readFileSync(afgewezenPad, "utf8")).afgewezen || []).map((a) => a.url)
    : [],
);

/* Woorden uit de productnaam die op een bestandsnaam kunnen staan. Merk en
 * model zonder de maten en de eenheden, want "10" en "kWh" staan overal. */
export function naamDelen(naam) {
  return String(naam || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 4 && !/^\d+$/.test(w));
}

/* Het merk zegt op de site van de fabrikant helemaal niets.
 *
 * Op bydbatterybox.com heet elk bestand naar BYD, dus "BYD_transparent.png" -
 * het merkteken - scoorde een naamtreffer en won van de echte productfoto's die
 * eronder stonden. Hetzelfde bij NIBE, waar "Produkter-926x470.jpg" het haalde,
 * en bij Mitsubishi, waar "ecodan_bediening.jpg" (een hand op een thermostaat)
 * boven kwam. Alleen het model onderscheidt het ene beeld van het andere; het
 * merk is op dat domein een constante.
 *
 * Daarom houdt dit de modelwoorden apart. Ze wegen dubbel in de rangschikking,
 * en verderop beslissen ze of we bij deze bron mogen ophouden met zoeken. */
export function modelDelen(product) {
  return naamDelen(`${product.model || ""} ${product.voorbeeld_variant || ""}`);
}

/* Hoeveel van die woorden in het adres terugkomen. Een bestandsnaam als
 * "elga-ace-hybride-warmtepomp-remeha_1.png" noemt het product; een
 * "Header_Desktop_1440x360.jpg" noemt het niet. Dat is het verschil tussen de
 * foto van dit apparaat en de foto van de pagina waar hij op staat. */
export function naamScore(url, delen) {
  return delen.filter((w) => padVanAdres(url).includes(w)).length;
}

/* Het pad zonder de domeinnaam, want die is bij één bron een constante.
 *
 * bydbatterybox.com bevat "battery", dus élk adres op dat domein scoorde een
 * treffer op de BYD Battery-Box - het merkteken net zo goed als de productfoto.
 * Hetzelfde geldt voor thuisbatterij.io en zonnepanelen-shop.nl. Wat het ene
 * beeld van het andere onderscheidt staat in het pad, niet in de host. */
export function padVanAdres(url) {
  const kaal = decodeURIComponent(String(url)).toLowerCase();
  try {
    const u = new URL(kaal);
    return u.pathname + u.search;
  } catch {
    return kaal;
  }
}

/* Twee woordenlijsten die de naam niet kan vervangen.
 *
 * Bij Itho stonden er twee beelden in de structured data die allebei "Vincent"
 * heten: een campagne-illustratie en de echte packshot. De productnaam maakt
 * daar geen verschil, de bestandsnaam wel. Deze woorden komen uit wat de eerste
 * droge run over 70 fabrikantpagina's opleverde, niet uit een aanname:
 * "03_Packshot_EHBX_3-4_FRONT.jpg" bij Daikin tegenover
 * "wolf_ambiente_cha-monoblock.jpg" bij Wolf en "lifestyle-terrace" bij
 * Viessmann. */
const WIJST_OP_PRODUCT = /packshot|product|vooraanzicht|front|render/i;
const WIJST_OP_SFEER = /campagne|campaign|illu|lifestyle|sfeer|ambiente|header|hero|promo|menu|academy|woningbouw|house|huis|wonen|woning|tuin|garden|interieur|bediening|landingspagina|brochure|monitoring|sustainability|investment/i;

/** De volgorde waarin we kandidaten aanbieden. Hoger is waarschijnlijker. */
export function beeldScore(url, delen, modellen = []) {
  const kaal = padVanAdres(url);
  return naamScore(url, delen)
    + naamScore(url, modellen)
    + (WIJST_OP_PRODUCT.test(kaal) ? 1 : 0)
    - (WIJST_OP_SFEER.test(kaal) ? 1 : 0);
}

/* Mag dit beeld de zoektocht afsluiten?
 *
 * Zonder deze grens hield het script op zodra iets een punt scoorde, en dat
 * gebeurde bij alle zes de producten die ik hierboven noem al op de eerste
 * pagina - bij de fabrikant, waar het merk in elke bestandsnaam staat. De
 * winkels erachter, die een strakke productfoto nodig hebben om iets te
 * verkopen, kwamen daardoor nooit aan de beurt.
 *
 * Er zijn nu twee eisen. Het adres moet het model noemen, want dat is het enige
 * woord dat dit apparaat van de rest van de catalogus onderscheidt. En het mag
 * geen sfeerbeeld zijn: "Vitocal-150-A-outdoor-unit-house-16-9.jpg" noemt het
 * model vier keer en toont een gevel met een fiets ervoor. Zo'n beeld blijft
 * wel een kandidaat, voor het geval geen enkele winkel iets beters heeft; het
 * is alleen geen reden om te stoppen met kijken. */
export function magStoppen(url, modellen) {
  if (!modellen.length) return false;
  if (!naamScore(url, modellen)) return false;
  return !WIJST_OP_SFEER.test(padVanAdres(url));
}

/** Maakt een adres absoluut ten opzichte van de pagina waar het op stond. */
export function absoluut(adres, basis) {
  // Een leeg adres lost met new URL op naar de pagina zelf, en dat is geen
  // afbeelding maar een pagina. Zonder deze regel wordt <meta content="">
  // een kandidaat die pas verderop struikelt.
  if (!adres) return null;
  try {
    return new URL(adres, basis).href;
  } catch {
    return null;
  }
}

/**
 * Het grootste adres uit een srcset.
 *
 * Een srcset is een rij "adres breedte", bijvoorbeeld "klein.jpg 400w,
 * groot.jpg 1200w". We willen de bronfoto en niet de duimnagel, dus de
 * hoogste w (of de hoogste x bij een dichtheidsset). Staat er geen maat bij,
 * dan is de laatste doorgaans de grootste - zo schrijven winkels het op.
 */
export function grootsteUitSrcset(set) {
  let beste = "";
  let maat = -1;
  for (const deel of String(set || "").split(",")) {
    const stukken = deel.trim().split(/\s+/);
    const adres = stukken[0];
    if (!adres) continue;
    const m = /^(\d+(?:\.\d+)?)(w|x)$/i.exec(stukken[1] || "");
    // Zonder maat: oplopend meegaan, zodat de laatste wint.
    const waarde = m ? Number(m[1]) * (m[2].toLowerCase() === "x" ? 1000 : 1) : maat + 1;
    if (waarde >= maat) {
      maat = waarde;
      beste = adres;
    }
  }
  return beste;
}

/**
 * Alle beeldadressen die deze pagina aandraagt, met de weg waarlangs.
 * Geen oordeel over welke de goede is; dat blijft mensenwerk.
 */
export function afbeeldingKandidaten(html, basis, naam = "", modellen = []) {
  const uit = [];
  const delen = naamDelen(naam);
  const voegToe = (adres, hoe) => {
    const url = absoluut(String(adres || "").trim(), basis);
    if (!url || !/^https?:/i.test(url)) return;
    if (!BEELDSOORTEN.test(url)) return;
    const leesbaar = decodeURIComponent(url);
    if (NOOIT.test(leesbaar) || VERZONNEN.test(leesbaar)) return;
    if (uit.some((k) => k.url === url)) return;
    uit.push({ url, hoe, score: beeldScore(url, delen, modellen), stopper: magStoppen(url, modellen) });
  };

  for (const m of String(html).matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    let blok;
    try { blok = JSON.parse(m[1]); } catch { continue; }
    const rij = Array.isArray(blok) ? blok : [blok];
    for (const o of rij) {
      if (!o || o["@type"] !== "Product" || !o.image) continue;
      for (const beeld of [].concat(o.image)) {
        voegToe(typeof beeld === "string" ? beeld : beeld && beeld.url, "structured data");
      }
    }
  }

  // Let op de eigen parameternaam: `naam` hierbuiten is de productnaam, en die
  // wil je hier niet per ongeluk overschaduwen met "og:image".
  const meta = (eigenschap, hoe) => {
    for (const m of String(html).matchAll(
      new RegExp(`<meta[^>]+(?:property|name)=["']${eigenschap}["'][^>]*>`, "gi"))) {
      const inhoud = /content=["']([^"']+)["']/i.exec(m[0]);
      if (inhoud) voegToe(inhoud[1], hoe);
    }
  };
  meta("og:image", "og:image");
  meta("twitter:image", "twitter:image");

  for (const m of String(html).matchAll(/<link[^>]+rel=["']image_src["'][^>]*>/gi)) {
    const href = /href=["']([^"']+)["']/i.exec(m[0]);
    if (href) voegToe(href[1], "link image_src");
  }

  /* Als laatste de gewone afbeeldingen op de pagina. Hier kijkt het filter naar
     de hele tag en niet alleen naar het adres, want "alt=Logo Bosch" verraadt
     een logo dat toevallig een nietszeggende bestandsnaam heeft.

     En niet alleen naar src, want daar zat een blinde vlek die precies de
     productfoto's kostte. Een winkel die lazy laadt zet in src een 1x1
     placeholder en het echte adres in data-src; het filter gooide die
     placeholder er terecht uit ("placeholder" en "transparent" staan in NOOIT),
     en wat overbleef was de decoratie. Dat verklaart waarom een verse run over
     85 producten dezelfde rommel opleverde die in augustus al was afgekeurd:
     niet omdat de pagina geen foto had, maar omdat die foto in een attribuut
     stond waar niemand keek.

     srcset telt ook mee, en daar nemen we de grootste variant: dat is de
     bronfoto en niet de duimnagel. */
  const LAZY = ["data-src", "data-original", "data-lazy-src", "data-lazy", "data-image", "data-large-image", "data-zoom-image"];
  for (const m of String(html).matchAll(/<(?:img|source)\s[^>]*>/gi)) {
    /* Het filter op de hele tag kijkt alleen naar de beschrijvende attributen,
       niet naar de adressen erin. Die adressen gaan één voor één door voegToe,
       dat NOOIT en VERZONNEN al toepast.
     *
     * Dat onderscheid is nodig en de proef betrapte me erop: toetsen op de
     * hele tag gooide juist de lazy gevallen weg. Bij <img src="placeholder.png"
     * data-src="echte-foto.jpg"> staat "placeholder" in de tag, dus sloeg hij
     * de tag over en daarmee de echte foto - precies het geval waarvoor dit
     * stuk bestaat. De bedoeling blijft: "alt=Logo Bosch" verraadt een logo
     * met een nietszeggende bestandsnaam. */
    const beschrijving = [
      /\salt=["']([^"']*)["']/i.exec(m[0]),
      /\stitle=["']([^"']*)["']/i.exec(m[0]),
      /\sclass=["']([^"']*)["']/i.exec(m[0]),
    ].map((t) => (t ? t[1] : "")).join(" ");
    if (NOOIT.test(beschrijving)) continue;
    const src = /\ssrc=["']([^"']+)["']/i.exec(m[0]);
    if (src) voegToe(src[1], "img op de pagina");
    for (const naam of LAZY) {
      const bij = new RegExp(`\\s${naam}=["']([^"']+)["']`, "i").exec(m[0]);
      if (bij) voegToe(bij[1], `${naam} (lazy)`);
    }
    for (const veld of ["srcset", "data-srcset"]) {
      const set = new RegExp(`\\s${veld}=["']([^"']+)["']`, "i").exec(m[0]);
      if (set) voegToe(grootsteUitSrcset(set[1]), `${veld}`);
    }
  }

  /* Een adres dat het product bij naam noemt gaat voor op de volgorde van de
     wegen. Zonder dat won bij Itho de campagne-illustratie het van
     "Vincent_Front_Schaduw_1200x1200px.jpg", die er vlak achter stond. Bij
     gelijke stand blijft de oorspronkelijke volgorde staan, want structured
     data wijst het product aan en og:image is de keuze van de fabrikant. */
  return uit
    .map((k, i) => ({ ...k, plek: i }))
    .sort((a, b) => b.score - a.score || a.plek - b.plek)
    .map(({ plek, ...k }) => k);
}

/* Waar we mogen kijken, op volgorde.
 *
 * Eerst de fabrikant, want die toont zijn eigen product. Daarna de winkels die
 * het verkopen, en dat is vaak de betere bron: een webshop heeft een strakke
 * productfoto nodig om iets te verkopen, waar een fabrikantpagina een
 * merkverhaal vertelt. Van de 51 producten die na de eerste ronde nog zonder
 * foto zaten hebben er 42 minstens één winkel-URL, en die adressen bezoeken we
 * toch al elke dag voor de prijzen.
 *
 * Aanbiedingen die de winkel niet meer voert doen niet mee: daar staat het
 * artikel niet meer op de pagina. */
export function bronPaginas(p) {
  const uit = [];
  const voegToe = (url, naam, vanFabrikant) => {
    if (!url || !/^https?:/i.test(url)) return;
    if (uit.some((b) => b.url === url)) return;
    uit.push({ url, naam, vanFabrikant });
  };
  voegToe(p.product_url, "de fabrikant", true);
  for (const a of p.aanbiedingen || []) {
    if (a && !a.niet_leverbaar) voegToe(a.url, a.winkel || "een winkel", false);
  }
  return uit;
}

/* Wie er onder de foto komt te staan.
 *
 * Dit stond op `foto: ${p.merk}`, ongeacht waar het bestand vandaan kwam, en
 * dat was bij twaalf van de foto's onwaar: de SolaX komt van Alma Solar, de
 * DMEGC van Stroomwinkel, de Qcells van Zonnefabriek. Op een site die zijn
 * prijzen bij de winkel natelt is een bronvermelding die de verkeerde partij
 * noemt precies het soort fout dat het vertrouwen kost, en het is ook de
 * partij die het beeld gemaakt of gelicentieerd heeft.
 *
 * De pagina waar we het beeld vonden is het enige harde gegeven; de host van
 * het beeld zelf zegt niets, want fabrikanten zetten hun foto's op
 * edge.sitecorecloud.io, a.storyblok.com of een S3-emmer. */
export function bronVermelding(product, keuze) {
  if (keuze.vanFabrikant) return `foto: ${product.merk || "fabrikant"}`;
  // De winkelnaam draagt in de gegevens vaak een toelichting tussen haakjes
  // ("Frank Energie (sets incl. aansturing)"). Onder een foto hoort de naam.
  return `foto: ${String(keuze.bron || "de winkel").replace(/\s*\(.*$/, "").trim()}`;
}

/* Ophalen, omzetten en de vier velden invullen. Eén plek, want de gewone weg
   en de handmatige keuze doen hierna precies hetzelfde. */
let gereedschap;
async function bewaarBeeld(p, site, keuze) {
  try {
    gereedschap = gereedschap || omzetter();
    const rauw = await haalBeeld(keuze.url);
    const tijdelijk = join(tmpdir(), `foto-${p.id}`);
    writeFileSync(tijdelijk, rauw);
    const map = join(ROOT, "sites", site, "assets", "producten");
    mkdirSync(map, { recursive: true });
    const doel = join(map, `${p.id}.webp`);
    execFileSync(gereedschap, ["-quiet", "-q", String(KWALITEIT), "-resize", String(BREEDTE), "0", tijdelijk, "-o", doel]);
    rmSync(tijdelijk, { force: true });
    const grootte = readFileSync(doel).length;
    if (!grootte || grootte > MAX_BYTES) {
      console.log(`      omgezet bestand is ${Math.round(grootte / 1024)} kB, dat is niet in orde; overgeslagen`);
      rmSync(doel, { force: true });
      return false;
    }
    p.afbeelding = `assets/producten/${p.id}.webp`;
    p.afbeelding_bron = bronVermelding(p, keuze);
    p.afbeelding_herkomst = keuze.url;
    p.afbeelding_via = keuze.paginaUrl;
    console.log(`      ✓ ${Math.round(grootte / 1024)} kB weggeschreven naar ${p.afbeelding}`);
    return true;
  } catch (err) {
    console.log(`      beeld niet op te halen of om te zetten: ${err.message}`);
    return false;
  }
}

/* ------------------------------------------------------------------
   Omzetten naar webp
   ------------------------------------------------------------------ */

// cwebp doet het omzetten én het schalen in één opdracht en leest jpeg, png en
// webp. Staat hij er niet, dan valt er niets om te zetten: de werkstroom heeft
// een stap die hem installeert.
function omzetter() {
  try {
    execFileSync("cwebp", ["-version"], { stdio: "ignore" });
    return "cwebp";
  } catch {
    return null;
  }
}

// Ruim boven wat een productfoto ooit weegt (de grootste die we ophaalden is
// 1,4 MB), en ruim onder wat een runner zonder morren in het geheugen trekt.
const MAX_DOWNLOAD = 20 * 1024 * 1024;

async function haalBeeld(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 ThuisbatterijVergelijker-fotocheck/1.0", "Accept": "image/*" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // Deze adressen komen van vreemde servers en de maatcontrole verderop komt
  // pas ná het omzetten. Zonder deze grens trekt één verkeerd adres - een
  // video, een zip met de verkeerde extensie - eerst alles in het geheugen.
  const gemeld = Number(res.headers.get("content-length"));
  if (gemeld > MAX_DOWNLOAD) throw new Error(`${Math.round(gemeld / 1024 / 1024)} MB is te groot`);
  const rauw = Buffer.from(await res.arrayBuffer());
  if (rauw.length > MAX_DOWNLOAD) throw new Error(`${Math.round(rauw.length / 1024 / 1024)} MB is te groot`);
  return rauw;
}

/* ------------------------------------------------------------------ */

async function main() {
  const werktuig = omzetter();
  if (!werktuig && !DROOG) {
    console.error("cwebp ontbreekt, dus er valt niets om te zetten. In de werkstroom staat een stap die hem installeert.");
    process.exit(2);
  }
  console.log(`Omzetter: ${werktuig || "geen (droge run)"}\n`);

  let opgehaald = 0, overgeslagen = 0, mislukt = 0;
  const gezocht = [];

  for (const { site, bestand, sleutel } of SITES) {
    if (ALLEEN_SITE && site !== ALLEEN_SITE) continue;
    const pad = join(ROOT, "sites", site, "data", bestand);
    if (!existsSync(pad)) continue;
    const data = JSON.parse(readFileSync(pad, "utf8"));
    const producten = data[sleutel] || [];
    let gewijzigd = false;

    console.log(`=== ${site}/${sleutel}`);
    // Een typefout in --alleen leverde eerst "0 opgehaald" op en verder niets,
    // en dan zoek je de fout bij de winkel in plaats van bij je eigen invoer.
    gezocht.push(...producten.map((x) => x.id));
    for (const p of producten) {
      if (p.afbeelding) continue;
      if (ALLEEN.length && !ALLEEN.includes(p.id)) continue;

      const bronnen = bronPaginas(p);

      /* Handmatige keuze: niet zoeken, wel de juiste bron eronder zetten. */
      const handmatig = BEELD.get(p.id);
      if (handmatig) {
        const beeldUrl = typeof handmatig === "string" ? handmatig : handmatig.url;
        const paginaHint = typeof handmatig === "string" ? "" : handmatig.pagina;
        const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
        const bijHost = (u) => bronnen.find((b) => host(b.url) === host(u))
          || bronnen.find((b) => host(u).endsWith(host(b.url).split(".").slice(-2).join(".")));
        const hoort = (paginaHint && (bijHost(paginaHint) || { url: paginaHint, naam: host(paginaHint), vanFabrikant: false }))
          || bijHost(beeldUrl)
          || bronnen[0];
        const keuze = {
          url: beeldUrl,
          hoe: "met de hand gekozen",
          bron: hoort ? hoort.naam : "de fabrikant",
          vanFabrikant: hoort ? hoort.vanFabrikant : true,
          paginaUrl: hoort ? hoort.url : p.product_url || "",
          score: null,
        };
        console.log(`  = ${p.id}: met de hand gekozen, bron ${keuze.bron}`);
        console.log(`      ${keuze.url}`);
        if (DROOG) { opgehaald++; continue; }
        if (await bewaarBeeld(p, site, keuze)) { gewijzigd = true; opgehaald++; } else { mislukt++; }
        continue;
      }

      if (!bronnen.length) {
        console.log(`  - ${p.id}: geen adres om te bezoeken`);
        overgeslagen++;
        continue;
      }

      const productNaam = `${p.merk || ""} ${p.model || ""} ${p.voorbeeld_variant || ""}`.trim();
      const modellen = modelDelen(p);
      let kandidaten = [];
      let bezocht = 0;
      let laatsteFout = null;
      for (const bron of bronnen) {
        let html;
        try {
          html = await haalPagina(bron.url);
        } catch (err) {
          html = await haalMetBrowser(bron.url).catch(() => null);
          if (!html) { laatsteFout = err.message; continue; }
        }
        bezocht++;
        const gevonden = afbeeldingKandidaten(html, bron.url, productNaam, modellen)
          .map((k) => ({ ...k, bron: bron.naam, vanFabrikant: bron.vanFabrikant, paginaUrl: bron.url }));
        kandidaten = kandidaten.concat(gevonden);
        // Een beeld dat het model noemt en geen sfeerbeeld is, is goed genoeg
        // om te stoppen. Zonder die grens bezoeken we voor elk product vier
        // winkels, en dan duurt de ronde langer dan de dagelijkse prijsrun.
        if (gevonden.some((k) => k.stopper)) break;
      }
      const voorFilter = kandidaten.length;
      kandidaten = kandidaten.filter((k) => !AFGEWEZEN.has(k.url));
      if (voorFilter !== kandidaten.length) {
        console.log(`      (${voorFilter - kandidaten.length} eerder afgekeurd, overgeslagen)`);
      }
      kandidaten.sort((a, b) => b.score - a.score);

      if (!kandidaten.length) {
        console.log(`  x ${p.id}: geen bruikbaar beeld op ${bezocht} van de ${bronnen.length} pagina(s)${laatsteFout ? ` (laatste fout: ${laatsteFout})` : ""}`);
        mislukt++;
        continue;
      }
      const keuze = kandidaten[0];
      console.log(`  ? ${p.id}: ${kandidaten.length} kandidaat(en) van ${bezocht} pagina(s), eerste via ${keuze.hoe} bij ${keuze.bron} (score ${keuze.score})`);
      console.log(`      ${keuze.url}`);
      for (const k of kandidaten.slice(1, 4)) console.log(`      (ook: ${k.hoe} bij ${k.bron} ${k.url})`);
      if (TOON.length) {
        const extra = kandidaten.filter((k) => TOON.some((t) => k.url.toLowerCase().includes(t)));
        console.log(`      ${extra.length} kandidaat(en) met "${TOON.join("|")}" in het adres:`);
        for (const k of extra.slice(0, 40)) console.log(`        ${k.url}  (${k.hoe} bij ${k.bron}, score ${k.score})`);
      }

      if (DROOG) { opgehaald++; continue; }

      if (await bewaarBeeld(p, site, keuze)) { gewijzigd = true; opgehaald++; } else { mislukt++; }
    }

    if (gewijzigd && !DROOG) {
      writeFileSync(pad, JSON.stringify(data, null, 2) + "\n", "utf8");
      console.log(`  ${bestand} bijgewerkt`);
    }
  }

  await sluitBrowser();
  // Met --site is "niet gezien" ook gewoon "staat op een andere site", en dan
  // is een waarschuwing misleidend.
  const onbekend = ALLEEN_SITE ? [] : ALLEEN.filter((id) => !gezocht.includes(id));
  if (onbekend.length) console.log(`\nLet op: ${onbekend.join(", ")} komt niet voor in de gegevens.`);
  console.log(`\n${opgehaald} opgehaald, ${overgeslagen} overgeslagen, ${mislukt} niet gelukt.`);
  console.log("Kijk de foto's na voordat er iets live gaat; een sfeerbeeld is geen productfoto.");
}

/* Alleen draaien als je dit bestand zelf aanroept. Zonder deze grens haalt de
   proef hieronder bij het importeren meteen achtenvijftig fabrikantsites op. */
if (resolve(process.argv[1] || "") === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
