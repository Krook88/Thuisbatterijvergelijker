#!/usr/bin/env node
/**
 * Haalt uit de ISDE-meldcodelijst van RVO op onder welke omstandigheden de
 * getallen van een warmtepomp gelden.
 *
 * Waarom deze bron: de site vergelijkt op vermogen en SCOP, en die betekenen
 * alleen iets als vaststaat waar ze gemeten zijn. Fabrikanten publiceren dat
 * lang niet allemaal. RVO wel, voor elke pomp die voor subsidie in aanmerking
 * komt, met het thermisch vermogen volgens EU 811/2013 - en alle dertig pompen
 * in data/warmtepompen.json hebben al een isde_meldcode. Dat maakt dit een
 * script in plaats van dertig keer handwerk.
 *
 * Dit is een gezaghebbende bron: het is het register waarop de Nederlandse
 * subsidie wordt uitgekeerd. Volgens de regel die we overal aanhouden mag zo'n
 * bron de gegevens veranderen. Toch schrijft dit script pas iets weg met
 * --schrijf, en meldt het anders alleen. Reden: het formaat van die lijst is
 * niet van ons, en een parser die er stilletjes naast zit is erger dan geen
 * parser.
 *
 * Gebruik:
 *   node scripts/isde-condities.mjs --verken   meld wat RVO aanbiedt en in
 *                                              welk formaat, verander niets
 *   node scripts/isde-condities.mjs            zoek de meldcodes op en meld
 *                                              wat er te halen valt
 *   node scripts/isde-condities.mjs --schrijf  neem de gevonden waarden over
 *
 * Stand van zaken: rvo.nl is vanuit de workflow gewoon bereikbaar. Een eerdere
 * run gaf "fetch failed" en ik concludeerde daaruit dat RVO het verkeer weerde;
 * dat was te snel. Een tweede run haalde de pagina in 670 ms binnen, en alle
 * vier de beproefde ingangen deden het. Het was een eenmalige storing. Vanuit
 * de ontwikkelomgeving blijft hij onbereikbaar - daar staat de egress-proxy de
 * host niet toe - dus toetsen kan alleen in de workflow.
 *
 * Wat wel klopt: de pagina bevat geen herkenbare bestandslink. Van alle links
 * bleven er twee over en dat waren de pagina zelf en zijn bovenliggende. De
 * lijst zit dus achter iets anders - een viewer, een script of een pad zonder
 * bestandsextensie. Daarom dumpt --verken nu wat de pagina werkelijk bevat in
 * plaats van alleen te melden dat er niets herkend is.
 */

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PAD = resolve(__dirname, "../data/warmtepompen.json");

const VERKEN = process.argv.includes("--verken");
const SCHRIJF = process.argv.includes("--schrijf");

// De bron. rvo.nl is wisselvallig vanuit de runner: van de drie runs tot nu toe
// lukte er een en faalden er twee, telkens binnen een halve seconde. Dat is
// geen blokkade maar een storing, en daar hoort een herkansing bij en geen
// uitwijkbron.
const LIJST_PAGINA = "https://www.rvo.nl/subsidies-financiering/isde/meldcodelijsten/warmtepompen";

// Deze twee zijn géén vervanging van de pagina hierboven: het zijn andere
// dingen. Dat was precies de fout in de vorige stand - toen rvo.nl uitviel ging
// het script vrolijk de JSON van data.overheid.nl afzoeken op bestandslinks, en
// meldde het dat er niets te vinden was. Ze staan hier nu als losse peiling:
// ze vertellen of het aan die ene host ligt of aan de verbinding.
const PEILINGEN = [
  ["data.overheid.nl (zoek-API)", "https://data.overheid.nl/data/api/3/action/package_search?q=ISDE%20meldcode"],
  ["open.overheid.nl (zoeken)", "https://open.overheid.nl/zoeken?trefwoord=ISDE%20meldcodelijst%20warmtepompen"],
];
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Warmtepompmaatje-isde/1.0";

function log(regel) {
  console.log(regel);
}

async function haal(url, alsTekst = true) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "nl-NL,nl;q=0.9" },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} bij ${url}`);
  return alsTekst ? await res.text() : Buffer.from(await res.arrayBuffer());
}

// Het formaat herkennen aan de eerste bytes in plaats van aan de bestandsnaam:
// RVO kan een .xlsx achter een redirect zetten of een pdf .aspx noemen.
function formaatVan(buf) {
  const kop = buf.subarray(0, 8);
  if (kop[0] === 0x50 && kop[1] === 0x4b) return "zip (xlsx/ods)";
  if (buf.subarray(0, 4).toString() === "%PDF") return "pdf";
  const tekst = buf.subarray(0, 400).toString("utf8");
  if (/^\s*</.test(tekst)) return "html";
  if (/[;,\t]/.test(tekst.split("\n")[0] || "")) return "tekst met scheidingstekens (csv?)";
  return "onbekend";
}

// Een wisselvallige bron verdient herkansingen, geen uitwijkbron.
async function haalMetHerkansing(url, pogingen = 5) {
  for (let n = 1; n <= pogingen; n++) {
    const start = Date.now();
    try {
      const tekst = await haal(url);
      log(`  = poging ${n}: gelukt, ${tekst.length} tekens in ${Date.now() - start} ms`);
      return tekst;
    } catch (err) {
      log(`  x poging ${n}: ${err.message} (na ${Date.now() - start} ms)`);
      if (n < pogingen) await new Promise((k) => setTimeout(k, 2000 * n));
    }
  }
  return null;
}

async function verken() {
  log(`De bron: ${LIJST_PAGINA}\n`);
  const html = await haalMetHerkansing(LIJST_PAGINA);
  const gebruikt = LIJST_PAGINA;

  log("\nPeiling van andere overheidshosts. Dit is geen vervanging van de bron -");
  log("het zijn andere dingen - maar het zegt of het aan rvo.nl ligt of aan de");
  log("verbinding. Die twee door elkaar halen kostte eerder een hele run.");
  for (const [naam, url] of PEILINGEN) {
    const start = Date.now();
    try {
      const t = await haal(url);
      log(`  = ${naam}: gelukt, ${t.length} tekens in ${Date.now() - start} ms`);
    } catch (err) {
      log(`  x ${naam}: ${err.message} (na ${Date.now() - start} ms)`);
    }
  }

  if (!html) {
    log("\n  ! de bron kwam ook na vijf pogingen niet door.");
    return;
  }
  log("");

  // Elke link die op een bestand lijkt. Bewust breed: we weten nog niet hoe
  // RVO het aanbiedt, en dat uitvinden is precies het doel van deze stand.
  const links = new Map();
  for (const m of html.matchAll(/href="([^"]+)"/gi)) {
    const href = m[1];
    if (!/\.(xlsx|xls|ods|csv|pdf)(\?|$)/i.test(href) && !/download|bestand|meldcode/i.test(href)) continue;
    try {
      links.set(new URL(href, gebruikt).href, true);
    } catch { /* geen bruikbare url */ }
  }
  log(`  = ${links.size} mogelijke bestandslinks gevonden`);
  for (const url of [...links.keys()].slice(0, 15)) log(`      ${url}`);

  // Wat staat er dan wel op die pagina? Zonder dit blijft "niets herkend" een
  // dood spoor: je weet niet of de link een andere vorm heeft, of dat de lijst
  // pas door een script wordt ingeladen.
  const alleHrefs = [...html.matchAll(/href="([^"]+)"/gi)].map((m) => m[1]);
  log(`\n  = ${alleHrefs.length} links op de pagina in totaal`);
  const interessant = alleHrefs.filter((h) => /meldcode|document|publicatie|bijlage|download|bestand/i.test(h));
  log(`  = ${interessant.length} daarvan lijken op een document:`);
  for (const h of interessant.slice(0, 20)) log(`      ${h}`);
  for (const woord of ["xlsx", "xls", "csv", "ods", ".pdf"]) {
    const i = html.toLowerCase().indexOf(woord);
    if (i === -1) { log(`  = "${woord}" komt niet voor in de pagina`); continue; }
    log(`  = "${woord}" gevonden op positie ${i}, in context:`);
    log(`      ...${html.slice(Math.max(0, i - 160), i + 160).replace(/\s+/g, " ")}...`);
  }

  // De eerste die op een echt bestand lijkt ophalen en kijken wat het is.
  const kandidaat = [...links.keys()].find((u) => /\.(xlsx|xls|ods|csv)(\?|$)/i.test(u))
    || [...links.keys()].find((u) => /\.pdf(\?|$)/i.test(u));
  if (!kandidaat) {
    log("\n  ! geen bestandslink herkend; de lijst staat mogelijk achter een viewer of een formulier.");
    return;
  }
  log(`\n  -> ophalen: ${kandidaat}`);
  try {
    const buf = await haal(kandidaat, false);
    log(`  = ${buf.length} bytes, formaat: ${formaatVan(buf)}`);
    log(`  = eerste bytes: ${buf.subarray(0, 32).toString("hex")}`);
    if (formaatVan(buf).startsWith("tekst")) {
      log("  = eerste twee regels:");
      for (const r of buf.subarray(0, 600).toString("utf8").split(/\r?\n/).slice(0, 2)) log(`      ${r}`);
    }
  } catch (err) {
    log(`  x bestand niet op te halen: ${err.message}`);
  }
}

const data = JSON.parse(readFileSync(DATA_PAD, "utf8"));
const meldcodes = (data.warmtepompen || []).filter((w) => w.isde_meldcode);
log(`${meldcodes.length} van ${(data.warmtepompen || []).length} pompen hebben een meldcode.\n`);

if (VERKEN) {
  await verken();
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      "### ISDE-verkenning gedraaid\n\nZie de log van deze stap voor het formaat van de meldcodelijst.\n\n");
  }
  process.exit(0);
}

log("Nog geen parser: draai eerst --verken, dan weten we welk formaat we moeten lezen.");
if (SCHRIJF) {
  log("  (--schrijf doet daarom nu nog niets)");
  void writeFileSync;
}
