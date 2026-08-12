#!/usr/bin/env node
/**
 * Zoekt op de pagina van de fabrikant naar het ontlaadvermogen, en meldt wat
 * het aantreft.
 *
 * Waarom dit bestaat: van zestien batterijen ligt niet vast of het getal in
 * vermogen_kw het continue vermogen is, een piek, of de 800 W die op een
 * gedeelde groep is toegestaan. Die drie staan nu door elkaar in een kolom
 * waarop de site vergelijkt - de HomeWizard lijkt er drie keer zwakker door dan
 * een Marstek, terwijl het om dezelfde soort apparaten gaat.
 *
 * Zoekopdrachten helpen maar half: voor Enphase kwam het complete antwoord
 * boven water (3,84 kVA continu, 7,68 kW piek gedurende 3 seconden), voor BYD
 * en Sungrow leverde dezelfde vraag niets op. Die cijfers staan in datasheets
 * op de site van de fabrikant, en daar kan dit script wel bij - alleen niet
 * vanuit de ontwikkelomgeving. De egress-proxy laat daar alleen npm en pypi
 * door; sessy.nl en enphase.com geven allebei EGRESS_BLOCKED. In de workflow is
 * het internet open, zoals de ISDE-verkenning heeft aangetoond.
 *
 * Wat dit script niet doet: schrijven. Het meldt per model welke vermogens het
 * op de pagina vindt en met welke woorden eromheen, zodat een mens beslist. Een
 * regex die "5 kW" naast het woord "continu" ziet staan is een aanwijzing, geen
 * specificatie: op zo'n pagina staan ook het laadvermogen, het vermogen van de
 * noodstroomaansluiting en het vermogen van een ander model uit dezelfde serie.
 * Automatisch de beste gok overnemen is precies hoe er verkeerde getallen in
 * komen.
 *
 * Gebruik:
 *   node scripts/vermogen-verkennen.mjs           alle modellen zonder conditie
 *   node scripts/vermogen-verkennen.mjs <id>      alleen dit model
 */

import { readFileSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PAD = resolve(__dirname, "../data/batterijen.json");
const ALLEEN = process.argv.slice(2).find((a) => !a.startsWith("--"));

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Batterijmaatje-specs/1.0";

// Woorden waar het om draait, in de talen waarin deze pagina's geschreven zijn.
const CONTINU = /\b(continu|continuous|nominaal|nominal|rated|dauerleistung|nenn)\w*/i;
const PIEK = /\b(piek|peak|surge|maximaal|maximum|max\.?|kortstondig|boost)\w*/i;
const LADEN = /\b(laad|laden|charging|charge|opladen)\w*/i;
const NOOD = /\b(noodstroom|backup|back-up|ups|off-?grid|eps)\w*/i;

async function haalMetHerkansing(url, pogingen = 3) {
  for (let n = 1; n <= pogingen; n++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, "Accept-Language": "nl-NL,nl;q=0.9,en;q=0.8" },
        redirect: "follow",
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (n === pogingen) return { fout: err.message };
      await new Promise((k) => setTimeout(k, 1500 * n));
    }
  }
}

// Grof de tekst uit de HTML halen. Geen parser nodig: we zoeken getallen met een
// eenheid en de woorden eromheen, niet de structuur van de pagina.
function naarTekst(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function vondsten(tekst) {
  const uit = [];
  // Getallen met W, kW of kVA erachter, met de tekst eromheen als context.
  for (const m of tekst.matchAll(/(\d{1,2}(?:[.,]\d{1,3})?)\s*(kVA|kW|W)\b/gi)) {
    const waarde = parseFloat(m[1].replace(",", "."));
    const eenheid = m[2].toUpperCase();
    const kw = eenheid === "W" ? waarde / 1000 : waarde;
    if (kw < 0.3 || kw > 30) continue;               // buiten wat een thuisbatterij levert
    // In een specificatietabel staat het label vlak voor de waarde. Een breed
    // venster levert daarom onbruikbare uitkomsten: dan draagt elk getal alle
    // etiketten, omdat "continu", "piek", "laden" en "noodstroom" allemaal
    // ergens in de buurt staan. Alleen het dichtstbijzijnde woord telt.
    const ervoor = tekst.slice(Math.max(0, m.index - 55), m.index);
    const dichtstbij = (patroon) => {
      const treffers = [...ervoor.matchAll(new RegExp(patroon.source, "gi"))];
      return treffers.length ? treffers[treffers.length - 1].index : -1;
    };
    const posities = { continu: dichtstbij(CONTINU), piek: dichtstbij(PIEK), laden: dichtstbij(LADEN), nood: dichtstbij(NOOD) };
    const gevonden = Object.entries(posities).filter(([, i]) => i >= 0).sort((a, b) => b[1] - a[1]);
    const soort = gevonden.length ? gevonden[0][0] : null;
    uit.push({
      kw: Math.round(kw * 100) / 100,
      tekst: `${m[1]} ${eenheid}`,
      continu: soort === "continu",
      piek: soort === "piek",
      laden: soort === "laden",
      nood: soort === "nood",
      rondom: tekst.slice(Math.max(0, m.index - 70), m.index + 25).replace(/\s+/g, " ").trim(),
    });
  }
  return uit;
}

const data = JSON.parse(readFileSync(DATA_PAD, "utf8"));
let modellen = data.batterijen.filter(
  (b) => typeof b.vermogen_kw === "number" && b.vermogen_conditie === "onbekend" && b.product_url
);
if (ALLEEN) modellen = data.batterijen.filter((b) => b.id === ALLEEN);

console.log(`${modellen.length} model(len) nakijken.\n`);

let metTreffer = 0;
let jsPaginas = 0;

for (const b of modellen) {
  console.log(`── ${b.id}  (ons veld: ${b.vermogen_kw} kW)`);
  console.log(`   ${b.product_url}`);
  const html = await haalMetHerkansing(b.product_url);
  if (typeof html !== "string") {
    console.log(`   x niet op te halen: ${html.fout}\n`);
    continue;
  }
  const tekst = naarTekst(html);
  const alle = vondsten(tekst);

  // Een pagina die door JavaScript wordt opgebouwd levert HTML zonder cijfers.
  // Dat is een andere uitkomst dan "de fabrikant vermeldt het niet", en die
  // twee door elkaar halen kostte bij de ISDE-lijst een hele ronde.
  if (!alle.length) {
    const vermoedelijkJs = tekst.length < 2000;
    jsPaginas += vermoedelijkJs ? 1 : 0;
    console.log(`   = geen vermogens in de HTML (${tekst.length} tekens tekst)`);
    console.log(vermoedelijkJs
      ? "     waarschijnlijk door JavaScript opgebouwd; deze pagina heeft een browser nodig\n"
      : "     pagina is er wel, maar noemt geen vermogen in deze vorm\n");
    continue;
  }

  // Wat het meest op een ontlaadspecificatie lijkt bovenaan: eerst de regels die
  // "continu" noemen en niet over laden of noodstroom gaan.
  const gesorteerd = alle.sort((x, z) =>
    (z.continu - x.continu) || (x.laden - z.laden) || (x.nood - z.nood) || (x.piek - z.piek));
  const beste = gesorteerd.slice(0, 6);
  metTreffer++;
  for (const v of beste) {
    const merk = [v.continu && "continu", v.piek && "piek", v.laden && "laden", v.nood && "noodstroom"]
      .filter(Boolean).join("/") || "geen aanduiding";
    const zelfde = Math.abs(v.kw - b.vermogen_kw) < 0.05 ? "  << ons getal" : "";
    console.log(`   ${v.tekst.padEnd(9)} ${merk.padEnd(22)}${zelfde}`);
    console.log(`     "...${v.rondom.slice(0, 110)}..."`);
  }
  console.log("");
}

console.log(`${metTreffer} van ${modellen.length} pagina's noemden een vermogen; ${jsPaginas} hadden een browser nodig.`);
console.log("Dit is een rapport. Overnemen doet een mens, in data/batterijen.json:");
console.log("  vermogen_conditie: \"continu\" | \"max\" | \"stopcontact\" | \"onbekend\"");
console.log("  vermogen_bron:     waar het vandaan komt, in een zin");

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### Vermogens: ${metTreffer} van ${modellen.length} fabrikantpagina's noemden een getal\n\n` +
    "Zie de log van deze stap. Overnemen is mensenwerk; het script schrijft niets.\n\n");
}
