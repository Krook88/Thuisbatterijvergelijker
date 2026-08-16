/**
 * Een prijs van een winkelpagina lezen. Gedeeld door de prijsscripts van de
 * drie sites.
 *
 * Waarom dit apart staat: het prijsscript van batterijmaatje bereikte twaalf
 * van de eenenveertig producten niet meer, en de winkels die het wel bereikte
 * gaven soms de prijs van een ander product terug. De oorzaken waren niet
 * twaalf keer verschillend maar vier keer hetzelfde, en die vier komen op alle
 * drie de sites voor. Ze hier oplossen lost ze overal op.
 *
 * De vier:
 *
 *   1. De winkel weigert een kaal verzoek (HTTP 403 bij Marstek,
 *      Warmteservice, AH Voordeelshop). Een tweede poging na een pauze slaagt
 *      vaak wel; wie het na twee keer nog weigert wil het niet, en dat is te
 *      respecteren.
 *
 *   2. De prijs staat niet in de HTML maar in een JSON-blok dat de pagina zelf
 *      uitpakt (Shopify, Next.js, Nuxt). De oude volgorde - structured data,
 *      meta-tags, zichtbare tekst - keek daar niet, en meldde "geen prijs
 *      gevonden" terwijl het bedrag gewoon in het antwoord stond.
 *
 *   3. De pagina toont meer dan één product. Dan pakte de oude code de prijs
 *      die het vaakst voorkwam, en dat is op een overzichtspagina de
 *      goedkoopste buurman: Zonneplan gaf 664 euro voor een batterij van 5.990,
 *      SolarEdge 1.495 voor een van 6.200. Nu telt afstand tot de productnaam
 *      zwaarder dan hoe vaak een bedrag voorkomt.
 *
 *   4. Er is helemaal geen winkelpagina. Een prijs uit een offerte of uit een
 *      prijsvergelijking heeft geen adres om te bezoeken. Geen script haalt die
 *      ooit op; dat hoort ook niet als scriptfout in een dagelijkse lijst te
 *      staan. Zie `controleerbaar()` onderaan.
 */

import { existsSync } from "node:fs";

const TIMEOUT_MS = 20000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 ThuisbatterijVergelijker-prijscheck/1.0";

// Een verzoek met alleen een User-Agent valt op: echte browsers sturen een hele
// set headers mee. Verschillende winkels antwoorden daarom met 403 terwijl de
// pagina gewoon openbaar is.
function browserHeaders(url) {
  const h = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
  };
  // Een bezoeker komt ergens vandaan. Sommige winkels wegen dat mee.
  try { h.Referer = new URL(url).origin + "/"; } catch { /* geen geldige URL */ }
  return h;
}

const pauze = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------
   Terugval op een echte browser

   Drie winkels antwoorden al maanden met 403: Marstek, Warmteservice en AH
   Voordeelshop. Dat is geen kwestie van de goede headers meesturen - dat doen
   we hierboven al, tot en met Referer en de Sec-Fetch-set. Wie zo weigert
   kijkt naar de TLS-vingerafdruk en naar of er javascript draait, en daar valt
   met fetch niet omheen te werken.

   Twee andere winkels antwoorden wél maar tonen geen leesbaar bedrag: Sessy en
   BeterDuurzaam bouwen de prijs in de browser op. Dat is dezelfde oorzaak van
   de andere kant.

   Een echte browser lost allebei op, en die hebben we al staan: de keuring
   draait op playwright. Hij staat bewust niet in package.json, dus dit is een
   terugval en geen vereiste - ontbreekt playwright, dan gedraagt alles zich
   precies zoals eerst en zegt het rapport dat erbij.

   Alleen als terugval, nooit als eerste keus: een browser starten kost een
   seconde of twee per pagina, en voor de veertig winkels die gewoon antwoorden
   is dat weggegooide tijd. */

let browserBelofte = null;

async function browser() {
  if (browserBelofte) return browserBelofte;
  browserBelofte = (async () => {
    let pw;
    try {
      pw = await import("playwright");
    } catch {
      return null; // niet geïnstalleerd; de aanroeper valt terug op niets
    }
    const opties = { args: ["--disable-blink-features=AutomationControlled"] };
    /* Dezelfde volgorde als scripts/keuring.mjs: eerst de chromium die naast
       ons klaarstaat - dan hoeft er niets gedownload en past de versie altijd -
       dan de chrome van het systeem, dan wat playwright zelf vindt. */
    const eigen = "/opt/pw-browsers/chromium";
    const pogingen = [
      ...(existsSync(eigen) ? [{ ...opties, executablePath: eigen }] : []),
      { ...opties, channel: "chrome" },
      opties,
    ];
    for (const poging of pogingen) {
      try { return await pw.chromium.launch(poging); } catch { /* volgende */ }
    }
    return null;
  })();
  return browserBelofte;
}

/** Sluit de browser als hij open is. Aanroepen aan het eind van een script. */
export async function sluitBrowser() {
  if (!browserBelofte) return;
  const b = await browserBelofte;
  browserBelofte = null;
  if (b) await b.close().catch(() => {});
}

/** Is er een browser beschikbaar? Voor het rapport, zodat "niet gelukt" te onderscheiden is van "niet geprobeerd". */
export async function browserBeschikbaar() {
  return (await browser()) !== null;
}

/**
 * Haalt een pagina op met een echte browser. Geeft null als playwright er niet
 * is; gooit als de pagina zelf niet wil.
 */
export async function haalMetBrowser(url, { wachtMs = 2500 } = {}) {
  const b = await browser();
  if (!b) return null;
  const context = await b.newContext({
    locale: "nl-NL",
    userAgent: USER_AGENT.replace(" ThuisbatterijVergelijker-prijscheck/1.0", ""),
    viewport: { width: 1280, height: 900 },
  });
  try {
    const pagina = await context.newPage();
    const antwoord = await pagina.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
    if (antwoord && !antwoord.ok()) throw new Error(`HTTP ${antwoord.status()}`);
    // Even ademruimte: bij de winkels waar dit voor bedoeld is wordt de prijs
    // na het laden ingevuld. Netwerkstilte afwachten duurt bij winkels met
    // trackers eindeloos, dus een vaste korte pauze werkt hier beter.
    await pagina.waitForTimeout(wachtMs);
    return await pagina.content();
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Haalt een pagina op. Bij een weigering of een storing volgt één herkansing:
 * 403, 429 en 5xx zijn vaak tijdelijk of afhankelijk van toeval aan de andere
 * kant. Een 404 niet - die staat meteen vast.
 */
export async function haalPagina(url, { pogingen = 2, accept, hostvormGeprobeerd = false } = {}) {
  let laatste;
  for (let poging = 1; poging <= pogingen; poging++) {
    const controller = new AbortController();
    let verlopen = false;
    const timer = setTimeout(() => { verlopen = true; controller.abort(); }, TIMEOUT_MS);
    try {
      const headers = browserHeaders(url);
      if (accept) headers.Accept = accept;
      const res = await fetch(url, { signal: controller.signal, redirect: "follow", headers });
      if (res.ok) return await res.text();
      laatste = new Error(`HTTP ${res.status}`);
      // Definitief: een verdwenen pagina komt over drie seconden niet terug.
      // Zonder deze markering vangt de catch hieronder de fout op, ziet dat er
      // nog een poging over is, en vraagt het toch nog een keer.
      laatste.definitief = !(res.status === 403 || res.status === 429 || res.status >= 500);
      throw laatste;
    } catch (err) {
      laatste = err;
      if (err.definitief) throw err;
      if (poging === pogingen) {
        // "fetch failed" is geen antwoord van de winkel maar een naam die niet
        // te vinden is. Meestal staat de site achter de andere schrijfwijze:
        // energiemagazijn.nl beantwoordt niets, www.energiemagazijn.nl wel.
        //
        // Niet na een tijdslimiet: dan is de naam wél gevonden en neemt de
        // winkel alleen de tijd. Nog een adres proberen kost dan twintig
        // seconden per winkel, en met vijftig winkels loopt dat op.
        // Eén keer, en niet heen en weer: zonder deze vlag probeert de andere
        // schrijfwijze meteen weer de eerste, en dat houdt nooit op.
        const anders = verlopen || hostvormGeprobeerd ? null : andereHostvorm(url);
        if (anders && !/HTTP \d+/.test(String(err.message))) {
          clearTimeout(timer);
          return await haalPagina(anders, { pogingen: 1, accept, hostvormGeprobeerd: true });
        }
        throw err;
      }
    } finally {
      clearTimeout(timer);
    }
    await pauze(3000 * poging);
  }
  throw laatste;
}

// Dezelfde URL met of juist zonder "www." ervoor. Geeft null als dat niets
// nieuws oplevert.
export function andereHostvorm(url) {
  try {
    const u = new URL(url);
    u.hostname = u.hostname.startsWith("www.") ? u.hostname.slice(4) : `www.${u.hostname}`;
    return u.toString();
  } catch {
    return null;
  }
}

export function parsePrijsWaarde(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/[^\d.,]/g, "");
  if (!s) return null;
  // "1.234,56" (NL) -> 1234.56 ; "1234.56" -> 1234.56 ; "1.299" -> 1299
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  else if (/\.\d{3}$/.test(s)) s = s.replace(/\./g, "");
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/* ------------------------------------------------------------------
   De productnaam als anker
   ------------------------------------------------------------------ */

// De woorden waarmee dit product zich van de buren op dezelfde pagina
// onderscheidt. "Thuisbatterij" en "kWh" horen daar niet bij: die staan bij elk
// product op een overzichtspagina.
const ALGEMEEN = new Set([
  "thuisbatterij", "thuisbatterijen", "batterij", "batterijen", "accu",
  "warmtepomp", "warmtepompen", "omvormer", "omvormers", "zonnepaneel",
  "zonnepanelen", "paneel", "panelen", "kwh", "kwp", "watt", "volt", "serie",
  "set", "systeem", "incl", "excl", "met", "voor", "van", "een", "the", "and",
  "home", "plug", "pro", "max", "plus", "eco", "smart", "energy", "power",
]);

export function ankerWoorden(naam) {
  return String(naam || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 3 && !ALGEMEEN.has(w));
}

// Per ankerwoord alle plekken waar het in de tekst staat. Per woord apart, en
// niet op één hoop: "Zonneplan" staat bij elk product op de pagina van
// Zonneplan, "Nexus" maar bij één. Het aantal verschillende ankerwoorden dat
// zich rond een bedrag verzamelt, zegt of dat bedrag bij dit product hoort.
function ankerPosities(tekst, ankers) {
  const perWoord = new Map();
  for (const anker of ankers) {
    const posities = [];
    let i = tekst.indexOf(anker);
    while (i !== -1) {
      posities.push(i);
      i = tekst.indexOf(anker, i + anker.length);
    }
    if (posities.length) perWoord.set(anker, posities);
  }
  return perWoord;
}

/**
 * Hoe sterk hoort een bedrag op deze plek bij dit product?
 *
 * Elk ankerwoord levert punten naar rato van hoe dichtbij het staat: vlak
 * ernaast bijna een heel punt, op de rand van het bereik bijna niets. Geteld
 * over alle woorden telt dus zowel hoeveel woorden uit de naam er in de buurt
 * staan als hoe dichtbij ze staan.
 *
 * Waarom niet simpelweg tellen: op de pagina van Zonneplan staat "Zonneplan"
 * bij elk product en "Nexus" bij één. Alleen tellen maakt beide even sterk
 * zodra ze toevallig binnen bereik staan; zo won 664 het van 5.990.
 */
function nabijheid(positie, perWoord, bereik) {
  let score = 0;
  let afstand = Infinity;
  for (const posities of perWoord.values()) {
    let dichtst = Infinity;
    for (const p of posities) dichtst = Math.min(dichtst, Math.abs(p - positie));
    if (dichtst <= bereik) score += 1 - dichtst / bereik;
    afstand = Math.min(afstand, dichtst);
  }
  return { score, afstand };
}

/* ------------------------------------------------------------------
   1. Structured data
   ------------------------------------------------------------------ */

function jsonLdBlokken(html) {
  const blokken = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  const uit = [];
  for (const blok of blokken) {
    const inhoud = blok.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "");
    try { uit.push(JSON.parse(inhoud)); } catch { /* onbruikbaar blok */ }
  }
  return uit;
}

function platteItems(data, uit = []) {
  if (data == null || typeof data !== "object") return uit;
  if (Array.isArray(data)) { for (const x of data) platteItems(x, uit); return uit; }
  uit.push(data);
  if (Array.isArray(data["@graph"])) platteItems(data["@graph"], uit);
  return uit;
}

/**
 * Structured data, met de productnaam als scheidsrechter. Staan er meerdere
 * producten in - een overzichtspagina, of "anderen kochten ook" - dan wint het
 * product waarvan de naam bij ons product hoort. Is er maar één, dan is er
 * niets te kiezen en telt hij gewoon.
 *
 * Geeft naast het bedrag terug wat de markup over btw zegt, als ze dat zegt.
 * Dat is de enige plek waar een winkel het onmiskenbaar vastlegt; de rest is
 * afleiden uit de tekst, en dat is een signaal en geen bewijs.
 *
 * lowPrice van een AggregateOffer telt alleen mee als de site erom vraagt. Bij
 * een productpagina met varianten (met of zonder P1-meter, een kleiner model)
 * is de goedkoopste niet dit product; bij een paneel dat tien winkels voeren is
 * het juist wél de prijs die je betaalt.
 */
export function prijsUitJsonLd(html, ankers = [], opties = {}) {
  const { lowPriceTelt = false } = opties;
  const kandidaten = [];
  for (const data of jsonLdBlokken(html)) {
    for (const item of platteItems(data)) {
      const offers = item.offers ? (Array.isArray(item.offers) ? item.offers : [item.offers]) : [];
      for (const offer of offers) {
        if (!offer || typeof offer !== "object") continue;
        const spec = offer.priceSpecification || {};
        // Een bedrag in dollars of ponden is niet de prijs die wij zoeken.
        const munt = offer.priceCurrency || spec.priceCurrency;
        if (munt && String(munt).toUpperCase() !== "EUR") continue;
        // Een uitverkocht product houdt vaak een oude prijs in de markup.
        if (/OutOfStock|Discontinued|SoldOut/i.test(String(offer.availability || ""))) continue;
        const p = parsePrijsWaarde(offer.price ?? spec.price ?? (lowPriceTelt ? offer.lowPrice : null));
        if (!p) continue;
        const naam = String(item.name || "").toLowerCase();
        const treffers = ankers.filter((a) => naam.includes(a)).length;
        const btwVeld = spec.valueAddedTaxIncluded;
        kandidaten.push({
          prijs: p,
          treffers,
          btw: btwVeld === false ? "excl" : btwVeld === true ? "incl" : null,
        });
      }
    }
  }
  if (!kandidaten.length) return null;
  if (kandidaten.length === 1) return kandidaten[0];
  // Meerdere producten op één pagina: alleen kiezen als de naam het uitwijst.
  const beste = kandidaten.slice().sort((a, b) => b.treffers - a.treffers);
  if (beste[0].treffers === 0) return null;
  if (beste[1] && beste[1].treffers === beste[0].treffers) return null; // gelijkspel: niet gokken
  return beste[0];
}

/* ------------------------------------------------------------------
   2. Een prijs in een JSON-blok dat de pagina zelf uitpakt
   ------------------------------------------------------------------ */

// Waarbinnen een bedrag op deze sites een productprijs kán zijn. Elke site mag
// het nauwer zetten: een zonnepaneel van 60.000 euro bestaat niet, en een
// warmtepomp van 100 euro ook niet.
const ONDERGRENS = 100;
const BOVENGRENS = 60000;

const PRIJS_VELDEN = ["price", "prijs", "amount", "value", "salePrice", "sellingPrice", "currentPrice", "priceIncl"];
const NAAM_VELDEN = ["name", "title", "productName", "displayName", "sku", "handle", "slug"];

function eersteString(obj, velden) {
  for (const v of velden) {
    const w = obj[v];
    if (typeof w === "string" && w) return w;
  }
  return null;
}

function eersteGetal(obj, velden) {
  for (const v of velden) {
    const w = obj[v];
    if (typeof w === "number" && Number.isFinite(w)) return w;
    if (typeof w === "string" && /^\s*[\d.,]+\s*$/.test(w)) {
      const p = parsePrijsWaarde(w);
      if (p !== null) return p;
    }
    if (w && typeof w === "object") {
      const g = eersteGetal(w, velden);
      if (g !== null) return g;
    }
  }
  return null;
}

/**
 * Steeds meer winkels zetten de prijs niet in de HTML maar in een JSON-blok dat
 * de browser uitpakt. Sessy, HomeWizard en Vattenfall meldden daarom elke dag
 * "geen prijs gevonden" terwijl het bedrag gewoon in het antwoord stond.
 *
 * De regel om niet mis te grijpen: neem alleen een bedrag over uit een object
 * dat óók een naam draagt die bij ons product hoort. Zonder die eis pakt dit
 * het eerste beste getal uit een winkelwagen, een verzendtarief of een
 * aanbeveling.
 */
export function prijsUitScriptJson(html, ankers = [], opties = {}) {
  if (!ankers.length) return null;
  const { min = ONDERGRENS, max = BOVENGRENS } = opties;
  const blokken = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
  const gevonden = [];

  const bekijk = (obj, diepte = 0) => {
    if (obj == null || typeof obj !== "object" || diepte > 12) return;
    if (Array.isArray(obj)) { for (const x of obj) bekijk(x, diepte + 1); return; }
    const naam = eersteString(obj, NAAM_VELDEN);
    if (naam) {
      const laag = naam.toLowerCase();
      const treffers = ankers.filter((a) => laag.includes(a)).length;
      if (treffers) {
        const ruw = eersteGetal(obj, PRIJS_VELDEN);
        if (ruw !== null) {
          // Shopify en enkele andere winkels rekenen in centen. Een bedrag dat
          // door honderd gedeeld wél in het bereik van een product valt en zelf
          // niet, is dat vrijwel zeker.
          const prijs = ruw > max && ruw % 100 === 0 ? Math.round(ruw / 100) : Math.round(ruw);
          if (prijs >= min && prijs <= max) gevonden.push({ prijs, treffers, naam });
        }
      }
    }
    for (const k of Object.keys(obj)) bekijk(obj[k], diepte + 1);
  };

  for (const blok of blokken) {
    const inhoud = blok.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "");
    // Van een blok als `window.__NUXT__ = {...}` is alleen het object bruikbaar.
    const start = inhoud.indexOf("{");
    const eind = inhoud.lastIndexOf("}");
    for (const tekst of [inhoud, start !== -1 && eind > start ? inhoud.slice(start, eind + 1) : null]) {
      if (!tekst) continue;
      try { bekijk(JSON.parse(tekst)); break; } catch { /* geen JSON, volgende poging */ }
    }
  }

  if (!gevonden.length) return null;
  gevonden.sort((a, b) => b.treffers - a.treffers || a.prijs - b.prijs);
  return gevonden[0].prijs;
}

/**
 * Dezelfde gedachte, maar zonder de productnaam als eis: zoek in de hele pagina
 * naar een veld dat "price" heet en een bedrag bevat. Dat is grover - het kan
 * een variant of een accessoire zijn - en staat daarom achter alle andere
 * wegen. Bij warmtepompmaatje haalt deze route wel elke dag prijzen binnen bij
 * winkels waar niets anders werkt, dus weglaten zou daar prijzen kosten.
 *
 * Bedragen in centen (419900) vallen vanzelf af op de grenzen.
 */
export function prijsUitJsonVeld(html, opties = {}) {
  const { min = ONDERGRENS, max = BOVENGRENS } = opties;
  const patroon = /"(?:price|prijs|amount|priceAmount|unitPrice|salePrice|current_price)"\s*:\s*"?(\d[\d.,]*)"?/gi;
  const telling = new Map();
  let m;
  while ((m = patroon.exec(html)) !== null) {
    const p = parsePrijsWaarde(m[1]);
    if (p && p >= min && p <= max) telling.set(p, (telling.get(p) || 0) + 1);
  }
  // Eén treffer volstaat: dit is een benoemd veld en geen los getal in de tekst.
  // Bij gelijkspel het laagste, want dat is doorgaans de kale productprijs en
  // niet een set of een variant met toebehoren.
  let beste = null, vaakst = 0;
  for (const [prijs, n] of telling) {
    if (n > vaakst || (n === vaakst && beste !== null && prijs < beste)) { vaakst = n; beste = prijs; }
  }
  return vaakst >= 1 ? beste : null;
}

/* ------------------------------------------------------------------
   3. Meta-tags
   ------------------------------------------------------------------ */

export function prijsUitMeta(html) {
  const patronen = [
    /<meta[^>]+(?:property|name)=["'](?:og:price:amount|product:price:amount)["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:price:amount|product:price:amount)["']/i,
    /itemprop=["']price["'][^>]*content=["']([^"']+)["']/i,
  ];
  for (const p of patronen) {
    const m = html.match(p);
    if (m) {
      const prijs = parsePrijsWaarde(m[1]);
      if (prijs) return prijs;
    }
  }
  return null;
}

/* ------------------------------------------------------------------
   4. Zichtbare tekst, met de productnaam als anker
   ------------------------------------------------------------------ */

// Tags en entiteiten eerst opruimen. Zonder dat mist deze route precies de twee
// schrijfwijzen die webwinkels het meest gebruiken: een euroteken in een eigen
// element ("<span>€</span><span>4.199</span>") en de entiteit &euro;. Scripts
// gaan eruit, anders telt de JSON die de vorige twee routes al bekijken hier
// nog een keer mee.
function zichtbareTekst(html) {
  return String(html)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&euro;|&#8364;|&#x20ac;/gi, "€")
    .replace(/&nbsp;|&#160;/gi, " ")
    .toLowerCase();
}

// Hoe ver een bedrag van de productnaam mag staan om er nog bij te horen. Ruim
// genoeg voor een kop met de prijs eronder, krap genoeg om de buurman op een
// overzichtspagina buiten te sluiten.
const ANKER_BEREIK = 1200;

// Twee bedragen die zo dicht bij elkaar staan horen bij dezelfde vermelding:
// een doorgestreepte van-prijs met de voor-prijs ernaast. Krap gehouden -
// "van € 1.499 voor € 1.299" is een stuk of veertien tekens, en alles wat
// ruimer staat is het volgende product.
const SAMEN_BEREIK = 40;

export function prijsUitTekst(html, ankers = [], opties = {}) {
  const { min = ONDERGRENS, max = BOVENGRENS } = opties;
  const tekst = zichtbareTekst(html);
  const perWoord = ankerPosities(tekst, ankers);

  const kandidaten = [];
  // \s* en niet \s?: het opruimen van tags vervangt elke tag door een spatie,
  // dus tussen "€" en het bedrag staan er dan vaak meerdere.
  const re = /(?:€|eur)\s*([\d.]{3,7}(?:,\d{2})?)/g;
  let m;
  while ((m = re.exec(tekst)) !== null) {
    const p = parsePrijsWaarde(m[1]);
    if (p && p >= min && p <= max) {
      kandidaten.push({ prijs: p, positie: m.index, ...nabijheid(m.index, perWoord, ANKER_BEREIK) });
    }
  }
  if (!kandidaten.length) return null;

  const dichtbij = kandidaten.filter((k) => k.score > 0);
  if (dichtbij.length) {
    // Het bedrag waar de productnaam het sterkst omheen staat, wint. Wat daar
    // vlak naast staat hoort bij dezelfde vermelding: "van € 1.499 voor
    // € 1.299" is één prijs, en dan is het laagste bedrag wat je betaalt.
    dichtbij.sort((a, b) => b.score - a.score || a.afstand - b.afstand);
    const beste = dichtbij[0];
    const zelfdePlek = dichtbij.filter((k) => Math.abs(k.positie - beste.positie) <= SAMEN_BEREIK);
    return Math.min(...zelfdePlek.map((k) => k.prijs));
  }

  // Geen anker op de pagina. Dan is het meest voorkomende bedrag de oude,
  // zwakkere regel - en die geldt alleen als er niets anders te kiezen valt.
  // Op een pagina met veel verschillende bedragen zwijgen we liever.
  const telling = new Map();
  for (const k of kandidaten) telling.set(k.prijs, (telling.get(k.prijs) || 0) + 1);
  if (telling.size > 8) return null;
  let beste = null, vaakst = 0;
  for (const [prijs, n] of telling) if (n > vaakst) { vaakst = n; beste = prijs; }
  return vaakst >= 2 ? beste : null;
}

/* ------------------------------------------------------------------
   Alles bij elkaar
   ------------------------------------------------------------------ */

/**
 * Wat de pagina in gewone tekst over btw zegt. Een signaal, geen bewijs: de zin
 * kan ook over verzendkosten of een ander artikel gaan. Daarom alleen een
 * oordeel als de pagina eenduidig is - staat er zowel "excl. btw" als "incl.
 * btw", dan toont de winkel beide bedragen en is het bedrag dat wij oppikken
 * vrijwel altijd het bedrag inclusief.
 */
export function toontExclBtw(html) {
  const tekst = zichtbareTekst(html);
  const excl = /\b(?:excl\.?|exclusief|ex\.)\s*(?:\d+%\s*)?(?:btw|b\.t\.w)/.test(tekst);
  const incl = /\b(?:incl\.?|inclusief|in\.)\s*(?:\d+%\s*)?(?:btw|b\.t\.w)/.test(tekst);
  return excl && !incl;
}

/**
 * Leest de prijs van één pagina, langs alle wegen op volgorde van hoe zeker ze
 * zijn. Geeft naast het bedrag terug hoe het gevonden is, zodat het logboek van
 * de dagelijkse run laat zien waar een winkel op leunt - en dus wat er stuk is
 * als hij morgen zwijgt.
 *
 * De volgorde is niet vrij te kiezen. Een benoemd prijsveld gaat vóór de
 * zichtbare tekst, ook al weet dat veld niets van de productnaam: het staat er
 * als prijs, en een euroteken in de tekst is maar een euroteken. Toen de
 * zichtbare tekst hier even vóór kwam, zakten vier warmtepompen bij
 * Aircozonderstek met 42 tot 60 procent - een bedrag verderop de pagina, dat
 * ruim binnen de marge van die site viel en er zonder de droge run gewoon in
 * was gegaan.
 */
export function prijsUitPagina(html, naam, opties = {}) {
  const ankers = ankerWoorden(naam);
  const wegen = [
    ["structured data", () => prijsUitJsonLd(html, ankers, opties)],
    ["json in de pagina", () => prijsUitScriptJson(html, ankers, opties)],
    ["meta-tag", () => prijsUitMeta(html)],
    ["prijsveld in de pagina", () => prijsUitJsonVeld(html, opties)],
    ["zichtbare tekst", () => prijsUitTekst(html, ankers, opties)],
  ];
  for (const [hoe, lees] of wegen) {
    const uit = lees();
    const prijs = typeof uit === "object" && uit !== null ? uit.prijs : uit;
    if (!prijs) continue;
    // Zegt de markup zelf niets over btw, dan is de tekst op de pagina het
    // enige dat we hebben.
    const btw = (typeof uit === "object" && uit !== null && uit.btw) || (toontExclBtw(html) ? "excl" : "incl");
    return { prijs, hoe, btw };
  }
  return { prijs: null, hoe: null, btw: null };
}

/* ------------------------------------------------------------------
   Wat een script überhaupt kan controleren
   ------------------------------------------------------------------ */

/**
 * Niet elke prijs heeft een pagina. Een offerteprijs, een schatting of een
 * bedrag uit een prijsvergelijking van vorige maand staat nergens op te halen:
 * daar bestaat geen adres van. Zulke prijzen elke dag als mislukking melden
 * levert een lijst op die nooit leeg raakt, en een lijst die nooit leeg raakt
 * leest niemand meer.
 *
 * Een prijs is automatisch te controleren als er een URL bij hoort en niemand
 * heeft vastgelegd dat het om een offerte of schatting gaat.
 */
export function controleerbaar(bron) {
  if (!bron || typeof bron !== "object") return false;
  if (bron.prijs_controle === "handmatig") return false;
  return typeof (bron.url || bron.prijs_bron_url) === "string";
}
