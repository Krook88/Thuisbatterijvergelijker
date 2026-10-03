/**
 * Wat staat er op deze winkelpagina?
 *
 * Waarom dit bestaat: zes aanbiedingen stonden wekenlang als "te controleren"
 * in de lijst, met een verschil erbij en verder niets. "solaredge-home-battery-48v
 * @ Thuisbatterij Nederland: €6200 → €1495 (-76%)" kan twee dingen betekenen -
 * de winkel is gehalveerd, of het script leest de losse module van 4,6 kWh op
 * een pagina waar ook het pakket van 9,2 kWh staat. Het verschil bepaalt of er
 * een prijs op de site moet veranderen of een URL, en het is niet te zien
 * zonder de pagina.
 *
 * En die pagina is hier niet te openen. De ontwikkelomgeving komt niet bij
 * winkels: de egress-proxy laat alleen npm en pypi door, dus zowel curl als
 * fetch krijgt een 403 van de proxy in plaats van een antwoord van de winkel.
 * Een GitHub-runner komt er wel bij. Vandaar een werkstroom eromheen
 * (.github/workflows/winkelpagina.yml, met de hand te starten): je geeft er
 * adressen aan mee en leest het antwoord in het logboek.
 *
 * Wat dit script bewust niet doet, is kiezen. Het toont per pagina wat elke
 * route apart oplevert en welke bedragen er sowieso op staan, met de tekst
 * eromheen. Het oordeel blijft mensenwerk, want het overnemen van dat oordeel
 * door een script is precies wat die zes meldingen veroorzaakte.
 *
 * Schrijft niets weg en raakt geen enkel gegevensbestand aan.
 *
 *   node scripts/winkelpagina.mjs <url> [<url>...] [--naam "Marstek Venus E 4.0"]
 *                                  [--zoek "scop,dB(A)"] [--links "acs-classic"]
 */

import {
  haalPagina,
  haalMetBrowser,
  sluitBrowser,
  browserBeschikbaar,
  ankerWoorden,
  prijsUitJsonLd,
  prijsUitScriptJson,
  prijsUitMeta,
  prijsUitJsonVeld,
  prijsUitTekst,
  prijsUitPagina,
  toontExclBtw,
  bedragenMetContext,
  tekstMetContext,
  linksMetTekst,
} from "../kern/scripts/prijs-uitlezen.mjs";
import { appendFileSync } from "node:fs";

/* Hoeveel bedragen we tonen. Een overzichtspagina met veertig producten is
   precies het geval waarvoor dit script bestaat, dus de grens ligt ruim; maar
   een logboek van duizend regels leest ook niemand. */
const MAX_BEDRAGEN = 60;

const args = process.argv.slice(2);

/* Een vlag met zijn waarde uit de argumenten halen, en beide weghalen zodat wat
   overblijft de adressen zijn.
 *
 * Hier stond een rij losse indexen (naamIndex, zoekIndex, zoekWaardeIndex) en
 * een filter dat ze allemaal moest uitsluiten. Dat werkte, maar bij elke nieuwe
 * vlag moest die lijst mee groeien, en vergeet je er een, dan komt de waarde
 * van die vlag als adres in de lijst terecht - stil, want een niet-adres valt
 * er daarna toch weer uit. Eén plek die het afhandelt kan dat niet vergeten. */
function vlag(naam, omgeving) {
  const i = args.indexOf(`--${naam}`);
  // Zonder de vlag is i -1, en dan wijst i + 1 naar het eerste argument: meestal
  // de enige URL. Vandaar de vraag apart, en niet "de volgende".
  if (i < 0) return process.env[omgeving] || "";
  const waarde = args[i + 1] || "";
  args.splice(i, waarde.startsWith("--") ? 1 : 2);
  return waarde.startsWith("--") ? "" : waarde;
}

const NAAM = vlag("naam", "NAAM");

/* Woorden om naast de bedragen op te zoeken, gescheiden door komma's.
 *
 * Hiervoor kon dit script alleen euro's laten zien, en dat is genoeg zolang de
 * vraag over prijzen gaat. Bij het opnemen van een nieuw model gaat de vraag
 * over SCOP, geluidsvermogen en aanvoertemperatuur, en die staan in gewone
 * zinnen op de fabrikantpagina. Zonder dit moest iemand die specificaties met
 * de hand overtypen uit een datasheet; nu haalt de runner de zin op en leest
 * een mens hem na. Het script kiest nog steeds niets. */
const ZOEK = vlag("zoek", "ZOEK").split(",").map((w) => w.trim()).filter(Boolean);

/* Welke links het logboek moet tonen, als stuk tekst dat in het adres of in de
   linktekst voorkomt.
 *
 * Waarom dit erbij hoort: --zoek haalde de hele WPL ACS Classic-familie van de
 * Stiebel-categoriepagina, maar dat leverde namen op en geen adressen, en de
 * specificaties staan een pagina verder. Adressen raden kostte eerst een 404 op
 * een verzonnen pad en daarna twee runs op een vangnetpagina die wel 200
 * teruggaf - Stiebel stuurt bij een onbekend pad geen 404 - dus aan de
 * statuscode zie je niet eens of je goed zat. Met de links erbij is het één
 * run: categoriepagina lezen, adressen eruit, die lezen. */
const LINKS = vlag("links", "LINKS");
/* Kort: alleen titel, treffers en links, zonder de prijsdiagnose per route.
   Dit script is gaandeweg ook het gereedschap geworden voor alles wat geen
   prijs is - garantietermijnen, geluidsvermogen, de juiste productpagina bij
   een fabrikant - en dan is de diagnose per route alleen ruis: zestien regels
   per pagina die niets met de vraag te maken hebben, bij twaalf pagina's het
   grootste deel van het logboek. */
const KORT = args.includes("--kort") || /^(1|true|ja)$/i.test(process.env.KORT || "");

const urls = [
  ...args.filter((a) => !a.startsWith("--")),
  // Uit de werkstroom komen ze als één tekstveld met een adres per regel.
  ...String(process.env.URLS || "").split(/[\s,]+/),
].map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u));

if (!urls.length) {
  console.error("Geef minstens één adres mee, of zet URLS in de omgeving.");
  console.error('  node scripts/winkelpagina.mjs https://winkel.nl/product --naam "Marstek Venus E 4.0"');
  console.error('  node scripts/winkelpagina.mjs https://fabrikant.nl/pomp --zoek "scop,dB(A),aanvoertemperatuur"');
  console.error('  node scripts/winkelpagina.mjs https://fabrikant.nl/pompen --links "acs-classic"');
  process.exit(2);
}

const ANKERS = ankerWoorden(NAAM);

/** Elke route apart, zodat te zien is waar ze het oneens zijn. */
function perRoute(html) {
  const wegen = [
    ["structured data", () => prijsUitJsonLd(html, ANKERS)],
    ["json in de pagina", () => prijsUitScriptJson(html, ANKERS)],
    ["meta-tag", () => prijsUitMeta(html)],
    ["prijsveld in de pagina", () => prijsUitJsonVeld(html)],
    ["zichtbare tekst (met anker)", () => prijsUitTekst(html, ANKERS)],
    ["zichtbare tekst (zonder anker)", () => prijsUitTekst(html, [])],
  ];
  return wegen.map(([hoe, lees]) => {
    let uit;
    try {
      uit = lees();
    } catch (err) {
      return { hoe, fout: err.message };
    }
    const prijs = typeof uit === "object" && uit !== null ? uit.prijs : uit;
    return { hoe, prijs: prijs || null };
  });
}

function titelVan(html) {
  const m = /<title[^>]*>([\s\S]{0,200}?)<\/title>/i.exec(String(html));
  return m ? m[1].replace(/\s+/g, " ").trim() : "(geen titel)";
}

/**
 * Ophalen met dezelfde terugval als de prijsupdate: lukt een gewoon verzoek
 * niet, dan een echte browser; komt er wel HTML maar geen bedrag uit, dan ook.
 * Anders diagnosticeer je iets anders dan wat er 's nachts gebeurt.
 */
async function haal(url) {
  try {
    const html = await haalPagina(url);
    if (prijsUitPagina(html, NAAM).prijs) return { html, via: "gewoon verzoek" };
    const uitBrowser = await haalMetBrowser(url).catch(() => null);
    if (uitBrowser) return { html: uitBrowser, via: "browser (gewoon verzoek gaf geen bedrag)" };
    return { html, via: "gewoon verzoek, geen bedrag; browser gaf niets" };
  } catch (err) {
    const uitBrowser = await haalMetBrowser(url).catch(() => null);
    if (uitBrowser) return { html: uitBrowser, via: `browser (gewoon verzoek: ${err.message})` };
    return { fout: err.message };
  }
}

const samenvatting = [];

console.log(`\nProductnaam om op te mikken: ${NAAM || "(geen)"}`);
console.log(`Ankerwoorden: ${ANKERS.length ? ANKERS.join(", ") : "(geen - elke route zonder anker)"}`);
console.log(`Browser beschikbaar: ${(await browserBeschikbaar()) ? "ja" : "nee (playwright ontbreekt)"}`);

for (const url of urls) {
  console.log(`\n${"=".repeat(72)}\n${url}`);
  const uit = await haal(url);
  if (uit.fout) {
    console.log(`  niet op te halen: ${uit.fout}`);
    samenvatting.push(`### ${url}\n\nNiet op te halen: \`${uit.fout}\`\n`);
    continue;
  }

  console.log(`  opgehaald via: ${uit.via}`);
  console.log(`  titel: ${titelVan(uit.html)}`);
  const routes = KORT ? [] : perRoute(uit.html);
  const gekozen = KORT ? { prijs: null } : prijsUitPagina(uit.html, NAAM);
  const bedragen = KORT ? [] : bedragenMetContext(uit.html);
  if (!KORT) {
  console.log(`  btw volgens de pagina: ${toontExclBtw(uit.html) ? "excl." : "geen aanwijzing (dus incl.)"}`);
  console.log(`  het script kiest: ${gekozen.prijs ? `€${gekozen.prijs} via ${gekozen.hoe}` : "geen prijs"}`);
  console.log("  per route:");
  for (const r of routes) {
    console.log(`    ${r.hoe.padEnd(32)} ${r.fout ? `fout: ${r.fout}` : r.prijs ? `€${r.prijs}` : "-"}`);
  }
  console.log(`  ${bedragen.length} bedrag(en) op de pagina:`);
  for (const b of bedragen.slice(0, MAX_BEDRAGEN)) {
    console.log(`    €${String(b.prijs).padEnd(7)} ...${b.context}...`);
  }
  if (bedragen.length > MAX_BEDRAGEN) {
    console.log(`    (nog ${bedragen.length - MAX_BEDRAGEN} bedrag(en) niet getoond)`);
  }
  }

  if (LINKS) {
    const links = linksMetTekst(uit.html, LINKS, { basis: url });
    console.log(`  ${links.length} link(s) met "${LINKS}" erin:`);
    for (const l of links) console.log(`    ${l.url}\n      ${l.tekst || "(geen linktekst)"}`);
    if (!links.length) console.log("    (geen link met dat stuk tekst erin)");
  }

  if (ZOEK.length) {
    const treffers = tekstMetContext(uit.html, ZOEK);
    console.log(`  ${treffers.length} treffer(s) op ${ZOEK.join(", ")}:`);
    for (const t of treffers) console.log(`    ${t.woord.padEnd(14)} ...${t.context}...`);
    if (!treffers.length) console.log("    (geen van die woorden staat in de zichtbare tekst)");
  }

  samenvatting.push([
    `### ${titelVan(uit.html)}`,
    "",
    `<${url}>`,
    "",
    `Opgehaald via ${uit.via}. Het script kiest ${gekozen.prijs ? `**€${gekozen.prijs}** via ${gekozen.hoe}` : "**geen prijs**"}.`,
    "",
    "| route | bedrag |",
    "| --- | --- |",
    ...routes.map((r) => `| ${r.hoe} | ${r.fout ? `fout: ${r.fout}` : r.prijs ? `€${r.prijs}` : "-"} |`),
    "",
    `**${bedragen.length} bedrag(en) op de pagina**`,
    "",
    "| bedrag | tekst eromheen |",
    "| --- | --- |",
    ...bedragen.slice(0, MAX_BEDRAGEN).map((b) => `| €${b.prijs} | ${b.context.replace(/\|/g, "\\|")} |`),
    "",
  ].join("\n"));
}

await sluitBrowser();

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    `## Wat staat er op ${urls.length} winkelpagina('s)`,
    "",
    `Gemikt op: ${NAAM || "(geen productnaam meegegeven)"}`,
    "",
    ...samenvatting,
  ].join("\n") + "\n");
}
