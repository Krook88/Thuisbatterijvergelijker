#!/usr/bin/env node
/**
 * Zoekt modellen die op de markt zijn maar nog niet in onze gegevens staan.
 *
 * Waarom dit bestaat: prijzen werken zichzelf dagelijks bij, maar een nieuw
 * model verschijnt nergens vanzelf. Een vergelijker die de nieuwste batterij
 * niet kent is stil verouderd - de bezoeker ziet dat niet, en wij ook niet.
 *
 * Wat dit script bewust NIET doet: iets toevoegen. Het meldt kandidaten, meer
 * niet. Een verkeerd automatisch toegevoegd model is erger dan een ontbrekend
 * model: het krijgt een pagina, een prijs en een plek in de vergelijking,
 * terwijl niemand de specificaties heeft nagekeken. De regel die we overal in
 * dit project aanhouden geldt hier het scherpst - een bron die het zelf zegt
 * mag de gegevens veranderen, een gok mag alleen rapporteren.
 *
 * Bronnen staan in scripts/nieuwe-modellen.json naast dit script; zonder dat
 * bestand doet dit script niets. Nu ondersteund:
 *
 *   { "soort": "bol", "zoektermen": [...], "paginas": 1 }
 *       De bol Marketing Catalog API. Dit is de enige bron die zelf een
 *       productcatalogus teruggeeft in plaats van een pagina die we moeten
 *       uitpluizen, en dus veruit de betrouwbaarste. Vereist BOL_CLIENT_ID en
 *       BOL_CLIENT_SECRET; zonder die wordt de bron overgeslagen.
 *
 *   { "soort": "overzicht", "winkel": "...", "url": "...", "link": "regex" }
 *       Een categoriepagina van een winkel. We halen er alleen de productlinks
 *       uit en lezen de naam uit de linktekst of de slug. Bewust grof: elke
 *       winkel heeft een eigen opmaak, en een per-winkel selector is over drie
 *       maanden stuk. Wat we hier zoeken is een naam, geen prijs.
 *
 * Uitkomst:
 *   - een regel per kandidaat in de log;
 *   - een tabel in de samenvatting van de workflow;
 *   - data/nieuwe-modellen.json, zodat een nieuwe kandidaat als regel in de
 *     git-diff verschijnt en niet in een logbestand verdwijnt dat niemand
 *     opent. Dat bestand verandert alleen als er echt iets nieuws is: een
 *     kandidaat die we al kenden houdt zijn datum "eerst_gezien".
 *
 * Gebruik:
 *   node scripts/nieuwe-modellen.mjs            zoek en rapporteer
 *   node scripts/nieuwe-modellen.mjs --droog    niets wegschrijven
 *   node scripts/nieuwe-modellen.mjs --alles    ook tonen wat we al kennen
 *   node scripts/nieuwe-modellen.mjs --proef    toets de herkenning tegen
 *                                               scripts/proef-titels.json,
 *                                               zonder internet (voor CI)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, appendFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA = join(ROOT, "data");
const CONFIG_PAD = join(ROOT, "scripts", "nieuwe-modellen.json");
const RAPPORT_PAD = join(DATA, "nieuwe-modellen.json");

const DROOG = process.argv.includes("--droog");
const ALLES = process.argv.includes("--alles");
const VANDAAG = new Date().toISOString().slice(0, 10);
const site = ROOT.split("/").pop();

if (!existsSync(CONFIG_PAD)) {
  console.log(`${site}: geen scripts/nieuwe-modellen.json, niets te zoeken.`);
  process.exit(0);
}
const config = JSON.parse(readFileSync(CONFIG_PAD, "utf8"));

/* ------------------------------------------------------------------
   Wat kennen we al?
   ------------------------------------------------------------------ */

// Losse woorden, met de eigenaardigheden van productnamen erin verwerkt:
// "5,12 kWh" en "5.12 kWh" zijn hetzelfde getal, en wat tussen haakjes staat
// is een toelichting ("(5,12 kWh)") en geen deel van de modelnaam.
function woorden(tekst) {
  return String(tekst || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/,(\d)/g, ".$1")
    .replace(/[^a-z0-9.]+/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter(Boolean)
    // "455Wp" en "455 Wp" zijn hetzelfde paneel. Een eenheid die aan het getal
    // vastgeplakt zit maakt er anders een ander woord van, en dan meldt het
    // script elk paneel dat we al hebben als nieuw.
    .flatMap((t) => {
      const m = t.match(/^(\d+(?:\.\d+)?)(wp|kwp|kwh|kw|w|v|ah)$/);
      return m ? [m[1], m[2]] : [t];
    });
}

// Eenheden en vulwoorden zeggen niets over wélk model het is: "Marstek Venus E
// 3.0 kWh thuisbatterij" en "Marstek Venus E 3.0" horen hetzelfde te zijn.
// Losse cijfers blijven staan - die zijn juist vaak de modelnaam ("Powerwall 3").
const GENERIEK = new Set([
  "kwh", "kw", "kwp", "wp", "ah", "v", "w", "btw", "incl", "excl", "inclusief", "exclusief",
  "set", "met", "en", "de", "het", "een", "voor", "van",
  "batterij", "batterijen", "thuisbatterij", "thuisaccu", "accu", "module",
  "omvormer", "omvormers", "inverter", "inverters", "warmtepomp", "warmtepompen",
  "zonnepaneel", "zonnepanelen", "paneel", "panelen",
  // Per site aan te vullen met woorden die hier de uitvoering beschrijven en
  // niet het model: "Full Black" en "all black" is hetzelfde paneel, en
  // "monoblock lucht-water" staat in elke warmtepomptitel. Zie
  // "extra_generiek" in scripts/nieuwe-modellen.json.
  ...(config.extra_generiek || []).map((w) => String(w).toLowerCase()),
]);

function kenmerkendeWoorden(...delen) {
  return [...new Set(delen.flatMap((d) => woorden(d)))].filter((t) => !GENERIEK.has(t));
}

// Elk databestand met een lijst van objecten die een merk hebben telt mee.
// Zo werkt dit script op alle drie de sites zonder per site te weten of de
// lijst nu "batterijen", "panelen", "omvormers" of "warmtepompen" heet.
function bekendeModellen() {
  const uit = [];
  if (!existsSync(DATA)) return uit;
  for (const bestand of readdirSync(DATA).filter((f) => f.endsWith(".json"))) {
    if (bestand === "nieuwe-modellen.json") continue;
    let data;
    try {
      data = JSON.parse(readFileSync(join(DATA, bestand), "utf8"));
    } catch {
      continue;
    }
    for (const waarde of Object.values(data || {})) {
      if (!Array.isArray(waarde)) continue;
      for (const item of waarde) {
        if (!item || typeof item !== "object" || typeof item.merk !== "string") continue;
        uit.push({
          id: item.id || `${item.merk} ${item.model || ""}`.trim(),
          merk: kenmerkendeWoorden(item.merk),
          woorden: kenmerkendeWoorden(item.merk, item.model),
          eans: (item.aanbiedingen || []).map((a) => a && a.ean).filter(Boolean),
        });
      }
    }
  }
  return uit;
}

const BEKEND = bekendeModellen();
const BEKENDE_EANS = new Set(BEKEND.flatMap((b) => b.eans));

// Zelfcontrole. "extra_generiek" maakt de herkenning ruimer, en te ruim is
// gevaarlijk: als twee modellen die we al hebben na normalisatie dezelfde
// woorden overhouden, kan het script ze niet uit elkaar houden - en dus ook
// een echt nieuw model van die serie niet herkennen. Dat is een fout die
// nergens uit de uitvoer blijkt, want het script meldt dan simpelweg niets.
// Vandaar deze melding: hij kost niets en vangt een verkeerd woord in de
// configuratie meteen af.
const perVingerafdruk = new Map();
for (const b of BEKEND) {
  const sleutel = [...b.woorden].sort().join(" ");
  if (!perVingerafdruk.has(sleutel)) perVingerafdruk.set(sleutel, []);
  perVingerafdruk.get(sleutel).push(b.id);
}
const botsingen = [...perVingerafdruk.values()].filter((ids) => ids.length > 1);
for (const ids of botsingen) {
  console.log(`  ! niet uit elkaar te houden na normalisatie: ${ids.join(", ")} - haal een woord uit "extra_generiek"`);
}

// Een titel is bekend als álle kenmerkende woorden van een model erin zitten.
// Andersom kijken zou niet werken: een winkeltitel bevat altijd extra woorden
// ("Marstek Venus E 3.0 Thuisbatterij 5,12 kWh incl. P1-meter"), en die extra
// woorden mogen de herkenning niet in de weg zitten. Wat een nieuw model juist
// wél onderscheidt is dat er een woord van ons model ontbreekt: "Venus E Plus
// 5.0" mist "3.0" en telt dus als nieuw.
// Een typeaanduiding wordt in winkels vaak langer geschreven dan bij ons: wij
// noteren de serie ("IQ8", "SUN2000 L1"), de winkel het exacte type ("IQ8HC",
// "SUN2000-5KTL-L1"). Daarom mag een woord van ons ook het begin van een woord
// in de titel zijn - maar alleen als het eruitziet als een typecode: minstens
// drie tekens, en letters én cijfers door elkaar. Zonder die voorwaarde zou
// "pro" op "protect" passen en "3.0" op "3.02".
function isTypecode(t) {
  return t.length >= 3 && /[a-z]/.test(t) && /\d/.test(t);
}
function komtVoor(gezien, lijstGezien, t, aaneen) {
  if (gezien.has(t)) return true;
  if (isTypecode(t) && lijstGezien.some((g) => g.length > t.length && g.startsWith(t))) return true;
  // Merken schrijven zichzelf niet overal hetzelfde: wij noteren "Qcells", de
  // winkel "Q-CELLS", en dat wordt bij ons één woord en daar twee. Zoeken in de
  // titel zonder scheidingstekens vangt dat op. Alleen voor woorden van vijf
  // tekens of langer, want korte woorden zitten per ongeluk overal in.
  return t.length >= 5 && aaneen.includes(t);
}

function herkenBekend(titel, ean) {
  if (ean && BEKENDE_EANS.has(ean)) return BEKEND.find((b) => b.eans.includes(ean));
  const lijstGezien = woorden(titel);
  const gezien = new Set(lijstGezien);
  const aaneen = lijstGezien.join("");
  return BEKEND.find((b) => b.woorden.length >= 2 && b.woorden.every((t) => komtVoor(gezien, lijstGezien, t, aaneen)));
}

// Scheelt het maar één woord met een model dat we al hebben? Dan is het
// meestal hetzelfde apparaat onder een kortere winkelnaam: wij noemen het
// "Solarbank 3 E2700 Pro", de winkel "Solarbank 3 Pro".
//
// Dat woord zomaar laten vallen mag niet. Bij omvormers is precies zo'n code
// juist het verschil tussen twee apparaten - een SUN2000-5KTL is geen
// SUN2000-6KTL - en dan zouden we een echt nieuw model als bekend afdoen. Een
// gemist model is erger dan een dubbele melding, dus melden we het gewoon, met
// erbij op welk model het lijkt. Wie het rapport leest ziet in één oogopslag
// of het een naamsvariant is of een nieuw apparaat.
function lijktOp(titel) {
  const lijstGezien = woorden(titel);
  const gezien = new Set(lijstGezien);
  const aaneen = lijstGezien.join("");
  let beste = null;
  for (const b of BEKEND) {
    if (b.woorden.length < 3) continue;
    const missend = b.woorden.filter((t) => !komtVoor(gezien, lijstGezien, t, aaneen));
    if (missend.length !== 1) continue;
    if (!beste || b.woorden.length > beste.woorden.length) beste = b;
  }
  return beste;
}

// Welk merk dat wij al volgen staat in deze titel? Een merk is meestal één
// woord, maar niet altijd ("Anker SOLIX", "LG Energy Solution"), dus eisen we
// alle woorden van het merk.
function herkenMerk(titel) {
  const gezien = new Set(woorden(titel));
  const treffer = BEKEND.find((b) => b.merk.length && b.merk.every((t) => gezien.has(t)));
  return treffer ? treffer.merk : null;
}

// Een naam zonder modelaanduiding is geen model. Dat klinkt vanzelfsprekend,
// maar het is precies wat een categoriepagina oplevert: "Warmtepompen Daikin"
// is een rubriek, "Daikin Altherma 3 R 8 kW" is een apparaat. Het verschil is
// dat er naast het merk nog een kenmerkend woord staat.
function heeftModelaanduiding(titel, merk, minimum) {
  const merkWoorden = new Set(merk || []);
  const rest = kenmerkendeWoorden(titel).filter((t) => !merkWoorden.has(t));
  return rest.length >= minimum;
}

/* ------------------------------------------------------------------
   Ruis eruit. Een categoriepagina en een zoekopdracht leveren ook
   kabels, beugels en boeken op; die horen niet in een vergelijker.
   ------------------------------------------------------------------ */

const AFGEWEZEN = new Set((config.afgewezen || []).map((w) => w.toLowerCase().trim()));

// Per bron te overschrijven, want één site kan over twee dingen gaan:
// zonnestroommaatje vergelijkt panelen én omvormers, en "omvormer" is bij de
// panelen ruis en bij de omvormers juist het onderwerp.
function lijst(regels, sleutel) {
  const bron = regels && regels[sleutel];
  return ((bron !== undefined ? bron : config[sleutel]) || []).map((w) => String(w).toLowerCase());
}

function gaatOverOnsOnderwerp(titel, regels) {
  const t = " " + String(titel).toLowerCase() + " ";
  if (lijst(regels, "uitsluit_woorden").some((w) => t.includes(w))) return false;
  const onderwerp = lijst(regels, "onderwerp_woorden");
  if (!onderwerp.length) return true;
  return onderwerp.some((w) => t.includes(w));
}

function minimumPrijs(regels) {
  if (regels && typeof regels.minimum_prijs_eur === "number") return regels.minimum_prijs_eur;
  return typeof config.minimum_prijs_eur === "number" ? config.minimum_prijs_eur : 0;
}

/* ------------------------------------------------------------------
   Bron 1: de bol Marketing Catalog API.
   ------------------------------------------------------------------ */

const BOL_BASIS = "https://api.bol.com/marketing/catalog/v1";
const BOL_CLIENT_ID = process.env.BOL_CLIENT_ID || "";
const BOL_CLIENT_SECRET = process.env.BOL_CLIENT_SECRET || "";
let bolToken = null;

async function haalBolToken() {
  if (!BOL_CLIENT_ID || !BOL_CLIENT_SECRET) return null;
  if (bolToken) return bolToken;
  const res = await fetch("https://login.bol.com/token?grant_type=client_credentials", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(`${BOL_CLIENT_ID}:${BOL_CLIENT_SECRET}`).toString("base64"),
      "Accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(`bol-token HTTP ${res.status}`);
  bolToken = (await res.json()).access_token;
  return bolToken;
}

// Accept-Language is verplicht; zonder die regel stuurt Node "*" en antwoordt
// bol met HTTP 400.
function bolHeaders(token) {
  return { "Authorization": `Bearer ${token}`, "Accept": "application/json", "Accept-Language": "nl" };
}

// Defensief zoeken naar velden, net als in update-prices.mjs: het responsformaat
// van bol is niet van ons, en een hernoemd veld hoort dit script niet te breken.
function diepsteTekst(obj, sleutels) {
  if (obj == null || typeof obj !== "object") return null;
  for (const s of sleutels) {
    if (typeof obj[s] === "string" && obj[s].trim()) return obj[s].trim();
  }
  return null;
}
function zoekEan(obj) {
  if (obj == null) return null;
  if (typeof obj === "string") return /^\d{13}$/.test(obj) ? obj : null;
  if (typeof obj !== "object") return null;
  for (const x of Array.isArray(obj) ? obj : Object.values(obj)) {
    const e = zoekEan(x);
    if (e) return e;
  }
  return null;
}
function zoekPrijs(obj) {
  if (obj == null || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const x of obj) { const p = zoekPrijs(x); if (p) return p; }
    return null;
  }
  if (typeof obj.price === "number" && obj.price > 0) return obj.price;
  for (const k of Object.keys(obj)) { const p = zoekPrijs(obj[k]); if (p) return p; }
  return null;
}

async function viaBol(bron, diagnose) {
  const token = await haalBolToken();
  if (!token) {
    diagnose.push("bol: geen BOL_CLIENT_ID/BOL_CLIENT_SECRET, bron overgeslagen");
    return [];
  }
  const paginas = bron.paginas || 1;
  const uit = [];
  for (const term of bron.zoektermen || []) {
    for (let p = 1; p <= paginas; p++) {
      const url = `${BOL_BASIS}/products/search?search-term=${encodeURIComponent(term)}&country-code=NL&page=${p}`;
      let data;
      try {
        const res = await fetch(url, { headers: bolHeaders(token), signal: AbortSignal.timeout(20000) });
        if (!res.ok) {
          diagnose.push(`bol "${term}" p${p}: HTTP ${res.status} (${(await res.text()).slice(0, 200)})`);
          continue;
        }
        data = await res.json();
      } catch (err) {
        diagnose.push(`bol "${term}" p${p}: ${err.message}`);
        continue;
      }
      const treffers = data.results || data.products || [];
      diagnose.push(`bol "${term}" p${p}: ${treffers.length} treffers`);
      for (const r of treffers) {
        const titel = diepsteTekst(r, ["title", "name", "productTitle"]);
        if (!titel) continue;
        const id = r.bolProductId || r.productId || null;
        uit.push({
          titel,
          ean: zoekEan(r),
          prijs: zoekPrijs(r),
          bron: "bol.com",
          url: id ? `https://www.bol.com/nl/nl/p/-/${id}/` : null,
        });
      }
      // Beleefd blijven tegen een API die we gratis gebruiken.
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return uit;
}

/* ------------------------------------------------------------------
   Bron 2: een categoriepagina van een winkel.
   ------------------------------------------------------------------ */

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 ThuisbatterijVergelijker-modelcheck/1.0";

async function viaOverzicht(bron, diagnose) {
  let html;
  try {
    const res = await fetch(bron.url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "nl-NL,nl;q=0.9,en;q=0.8",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
      },
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) {
      diagnose.push(`${bron.winkel}: HTTP ${res.status}`);
      return [];
    }
    html = await res.text();
  } catch (err) {
    diagnose.push(`${bron.winkel}: ${err.message}`);
    return [];
  }

  const patroon = new RegExp(bron.link);
  const gezien = new Map();
  // Grof met opzet: pak elke <a href>, filter op het patroon uit de config, en
  // haal de naam uit de linktekst als die er is en anders uit de slug.
  for (const m of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]{0,300}?)<\/a>/gi)) {
    const href = m[1];
    if (!patroon.test(href)) continue;
    const tekst = m[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const slug = (href.split("?")[0].split("/").filter(Boolean).pop() || "").replace(/\.html?$/, "");
    const titel = tekst.length >= 6 ? tekst : decodeURIComponent(slug).replace(/[-_]+/g, " ");
    if (!titel || titel.length < 6) continue;
    const volledig = href.startsWith("http") ? href : new URL(href, bron.url).href;
    if (!gezien.has(volledig)) gezien.set(volledig, titel);
  }
  diagnose.push(`${bron.winkel}: ${gezien.size} productlinks`);
  return [...gezien].map(([url, titel]) => ({ titel, ean: null, prijs: null, bron: bron.winkel, url }));
}

/* ------------------------------------------------------------------
   Uitvoeren
   ------------------------------------------------------------------ */

/* ------------------------------------------------------------------
   De proef. Het herkennen van modelnamen is het enige deel van dit
   script dat echt stuk kan gaan zonder dat iemand het merkt: als de
   herkenning te ruim staat meldt het niets meer, en "geen kandidaten"
   ziet er precies zo uit als "alles is al bekend". Daarom staat er in
   scripts/proef-titels.json een lijstje echte winkeltitels met wat we
   ervan verwachten, en toetst dit script zichzelf daaraan - zonder één
   verzoek naar buiten, dus het kan in CI mee.
   ------------------------------------------------------------------ */

if (process.argv.includes("--proef")) {
  const pad = join(ROOT, "scripts", "proef-titels.json");
  if (!existsSync(pad)) {
    console.log(`${site}: geen scripts/proef-titels.json, niets te toetsen.`);
    process.exit(0);
  }
  const regels = { alleen_bekende_merken: false, minimum_modelwoorden: 1 };
  let fout = 0;
  for (const geval of JSON.parse(readFileSync(pad, "utf8")).titels) {
    let uitkomst;
    if (!gaatOverOnsOnderwerp(geval.titel, regels)) uitkomst = "genegeerd";
    else if (herkenBekend(geval.titel, null)) uitkomst = "bekend";
    else uitkomst = "nieuw";
    const goed = uitkomst === geval.verwacht;
    if (!goed) fout++;
    console.log(`  ${goed ? "=" : "x"} ${uitkomst.padEnd(9)} ${goed ? "" : `(verwacht: ${geval.verwacht}) `}${geval.titel}`);
  }
  if (fout) {
    console.error(`\n${site}: ${fout} titel(s) anders beoordeeld dan verwacht.`);
    process.exit(1);
  }
  console.log(`\n${site}: de herkenning doet wat we ervan verwachten.`);
  process.exit(0);
}

const diagnose = [];
const rauw = [];

for (const bron of config.bronnen || []) {
  let gevonden;
  if (bron.soort === "bol") gevonden = await viaBol(bron, diagnose);
  else if (bron.soort === "overzicht") gevonden = await viaOverzicht(bron, diagnose);
  else { diagnose.push(`onbekende bronsoort "${bron.soort}", overgeslagen`); continue; }
  // De filters verschillen per bron: de bol-catalogus levert nette producttitels,
  // een categoriepagina levert ook rubrieken en kruimelpaden. Daarom hangt elk
  // resultaat zijn eigen bronregels mee.
  for (const r of gevonden) rauw.push({ ...r, regels: bron });
}

const kandidaten = new Map();
const weggelaten = { merk: 0, geenmodel: 0, onderwerp: 0, prijs: 0 };
let bekendGevonden = 0;
for (const r of rauw) {
  const sleutel = r.titel.toLowerCase().replace(/\s+/g, " ").trim();
  if (AFGEWEZEN.has(sleutel)) continue;
  if (!gaatOverOnsOnderwerp(r.titel, r.regels)) { weggelaten.onderwerp++; continue; }
  const drempel = minimumPrijs(r.regels);
  if (drempel && typeof r.prijs === "number" && r.prijs < drempel) { weggelaten.prijs++; continue; }

  const merk = herkenMerk(r.titel);
  // Alleen merken die we al volgen. Dat mist een nieuwkomer op de markt, maar
  // maakt een grove bron bruikbaar; voor de bol-catalogus staat dit uit, want
  // die is nauwkeurig genoeg om ook een onbekend merk te mogen melden.
  if (r.regels.alleen_bekende_merken && !merk) { weggelaten.merk++; continue; }
  const minimum = typeof r.regels.minimum_modelwoorden === "number" ? r.regels.minimum_modelwoorden : 1;
  if (!heeftModelaanduiding(r.titel, merk, minimum)) { weggelaten.geenmodel++; continue; }

  const bekend = herkenBekend(r.titel, r.ean);
  if (bekend) {
    bekendGevonden++;
    if (ALLES) console.log(`  = ${r.titel}  ->  ${bekend.id}`);
    continue;
  }
  const buur = lijktOp(r.titel);
  if (!kandidaten.has(sleutel)) kandidaten.set(sleutel, { ...r, lijkt_op: buur ? buur.id : null });
}

// De vorige uitkomst erbij, zodat "eerst_gezien" blijft staan en dit bestand
// alleen verandert als er echt iets nieuws is. Een kandidaat die van de markt
// verdwijnt laten we staan: die haal ik er met de hand uit als hij beoordeeld
// is, en dat is precies het moment waarop iemand ernaar kijkt.
const vorig = existsSync(RAPPORT_PAD) ? JSON.parse(readFileSync(RAPPORT_PAD, "utf8")) : { kandidaten: [] };
const perSleutel = new Map((vorig.kandidaten || []).map((k) => [k.titel.toLowerCase().replace(/\s+/g, " ").trim(), k]));

for (const [sleutel, r] of kandidaten) {
  const bestaand = perSleutel.get(sleutel);
  perSleutel.set(sleutel, {
    titel: r.titel,
    bron: r.bron,
    url: r.url,
    ean: r.ean || (bestaand && bestaand.ean) || null,
    prijs_eur: typeof r.prijs === "number" ? Math.round(r.prijs) : (bestaand && bestaand.prijs_eur) || null,
    lijkt_op: r.lijkt_op || (bestaand && bestaand.lijkt_op) || null,
    eerst_gezien: (bestaand && bestaand.eerst_gezien) || VANDAAG,
  });
}

const alleKandidaten = [...perSleutel.values()].sort(
  (a, b) => a.eerst_gezien.localeCompare(b.eerst_gezien) || a.titel.localeCompare(b.titel),
);
const nieuwVandaag = alleKandidaten.filter((k) => k.eerst_gezien === VANDAAG);

console.log(`\n${site}: ${rauw.length} producten bekeken, ${bekendGevonden} herkend als bekend model.`);
for (const d of diagnose) console.log(`  ~ ${d}`);
console.log(
  `  ~ weggelaten: ${weggelaten.onderwerp} ander onderwerp, ${weggelaten.merk} onbekend merk, ` +
  `${weggelaten.geenmodel} zonder modelaanduiding, ${weggelaten.prijs} te goedkoop`,
);
if (!alleKandidaten.length) {
  console.log("  = geen onbekende modellen gevonden.");
} else {
  console.log(`\n  ${nieuwVandaag.length} nieuw vandaag, ${alleKandidaten.length} openstaand:`);
  for (const k of alleKandidaten) {
    console.log(
      `  ${k.eerst_gezien === VANDAAG ? "+" : " "} ${k.titel}  [${k.bron}${k.prijs_eur ? `, ca. ${k.prijs_eur} euro` : ""}]` +
      // Bewust zonder oordeel: "Powerwall 4" scheelt ook één woord met
      // "Powerwall 3" en is toch een ander apparaat. Het script meldt de
      // afstand, de conclusie is aan de lezer.
      (k.lijkt_op ? `  (scheelt één woord met ${k.lijkt_op})` : ""),
    );
  }
}

if (nieuwVandaag.length && process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    `### ${site}: ${nieuwVandaag.length} mogelijk nieuw model`,
    "",
    "Niets is toegevoegd - dit zijn kandidaten die iemand moet nakijken.",
    "",
    "| model | winkel | prijs | scheelt 1 woord met | link |",
    "| --- | --- | --- | --- | --- |",
    ...nieuwVandaag.map((k) =>
      `| ${k.titel.replace(/\|/g, "/")} | ${k.bron} | ${k.prijs_eur ? k.prijs_eur + " euro" : "?"} | ` +
      `${k.lijkt_op || "-"} | ${k.url ? `[bekijk](${k.url})` : "-"} |`),
    "",
  ].join("\n") + "\n");
}

if (!DROOG) {
  writeFileSync(
    RAPPORT_PAD,
    JSON.stringify({
      toelichting:
        "Modellen die in een winkel staan maar niet in onze gegevens. Automatisch gevonden, " +
        "nooit automatisch toegevoegd: nakijken en dan zelf opnemen, of de titel in " +
        "scripts/nieuwe-modellen.json onder \"afgewezen\" zetten.",
      kandidaten: alleKandidaten,
    }, null, 2) + "\n",
    "utf8",
  );
}
