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
} from "../kern/scripts/prijs-uitlezen.mjs";
import { appendFileSync } from "node:fs";

/* Hoeveel bedragen we tonen. Een overzichtspagina met veertig producten is
   precies het geval waarvoor dit script bestaat, dus de grens ligt ruim; maar
   een logboek van duizend regels leest ook niemand. */
const MAX_BEDRAGEN = 60;

const args = process.argv.slice(2);
const naamIndex = args.findIndex((a) => a === "--naam");
// Zonder --naam is naamIndex -1, en dan wijst naamIndex + 1 naar 0: het eerste
// argument, meestal de enige URL. Vandaar apart, en niet als "de volgende".
const naamWaardeIndex = naamIndex >= 0 ? naamIndex + 1 : -1;
const NAAM = (naamIndex >= 0 ? args[naamWaardeIndex] : process.env.NAAM) || "";
const urls = [
  ...args.filter((a, i) => i !== naamIndex && i !== naamWaardeIndex && !a.startsWith("--")),
  // Uit de werkstroom komen ze als één tekstveld met een adres per regel.
  ...String(process.env.URLS || "").split(/[\s,]+/),
].map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u));

if (!urls.length) {
  console.error("Geef minstens één adres mee, of zet URLS in de omgeving.");
  console.error('  node scripts/winkelpagina.mjs https://winkel.nl/product --naam "Marstek Venus E 4.0"');
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

  const routes = perRoute(uit.html);
  const gekozen = prijsUitPagina(uit.html, NAAM);
  const bedragen = bedragenMetContext(uit.html);

  console.log(`  opgehaald via: ${uit.via}`);
  console.log(`  titel: ${titelVan(uit.html)}`);
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
