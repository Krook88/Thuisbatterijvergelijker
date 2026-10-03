#!/usr/bin/env node
/**
 * Staan de getallen die wij publiceren nog op de pagina waar ze vandaan komen?
 *
 * Waarom dit bestaat. De dagelijkse run controleert al of `product_url` nog
 * bestaat (controleer-links.mjs) en of de prijzen vers zijn (verse-data.mjs).
 * Wat niemand controleerde is of de *inhoud* achter die URL nog klopt met wat
 * er bij ons staat. Een fabrikant kan de URL houden en de SCOP herzien, een
 * typefout kan er maanden ongemerkt in staan, en een specificatie die ik met de
 * hand uit een logboek heb overgenomen kan simpelweg verkeerd zijn overgetypt.
 *
 * Dat laatste is geen theorie: de zes Stiebel WPL-maten zijn zo binnengekomen,
 * via de werkstroom met --zoek, en daarna door mij ingetypt. Zulke getallen
 * horen controleerbaar te blijven, want ze zijn precies waarvoor iemand deze
 * site gebruikt.
 *
 * Hoe het werkt, en waarom zo. Een getal los zoeken werkt niet: "57" staat op
 * elke pagina wel ergens, en dan bevestigt deze controle alles en betekent hij
 * niets. Daarom ankert hij elk getal aan een woord dat erbij hoort - "scop",
 * "geluidsniveau", "aanvoertemperatuur" - met tekstMetContext uit
 * kern/scripts/prijs-uitlezen.mjs, en kijkt hij alleen binnen die zin of onze
 * waarde er staat. Dat levert drie verschillende uitkomsten op, en het verschil
 * is de hele waarde van deze controle:
 *
 *   bevestigd    het ankerwoord staat op de pagina en onze waarde staat erbij
 *   afwijkend    het ankerwoord staat er, onze waarde niet - dus de pagina
 *                praat over de SCOP en noemt een ander getal dan wij
 *   geen bron    het ankerwoord staat er niet; de pagina zet die specificatie
 *                niet in tekst (vaak een tabblad dat javascript inlaadt, of een
 *                pdf). Dat is geen tegenspraak en hoort dus niet als fout te
 *                gelden
 *
 * Alleen "afwijkend" vraagt om iemand die kijkt. Zonder dat onderscheid zou
 * deze lijst binnen een week vollopen met pagina's die hun specificaties nu
 * eenmaal niet in platte tekst zetten, en een lijst die nooit leeg raakt leest
 * niemand meer - zie README.md over waarom zoekmachine.mjs niet in de ketting
 * staat.
 *
 * Draai dit niet in de ontwikkelomgeving: die komt niet bij fabrikanten (de
 * egress-proxy laat alleen npm en pypi door). Een runner komt er wel bij,
 * vandaar .github/workflows/bronnen.yml, wekelijks. Wekelijks en niet dagelijks
 * omdat het 99 pagina's bij fabrikanten ophaalt en die getallen niet dagelijks
 * veranderen.
 *
 * Schrijft niets weg en raakt geen enkel gegevensbestand aan.
 *
 *   node scripts/bronnen-nakijken.mjs                 rapport
 *   node scripts/bronnen-nakijken.mjs --tellen        wat hij zou nakijken, zonder op te halen
 *   node scripts/bronnen-nakijken.mjs --site warmtepompmaatje
 *   node scripts/bronnen-nakijken.mjs --alleen stiebel-wpl-acs-classic,huawei-luna2000-s1
 *   node scripts/bronnen-nakijken.mjs --streng        foutcode bij een afwijking
 */

import { readFileSync, readdirSync, existsSync, appendFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  haalPagina,
  haalMetBrowser,
  sluitBrowser,
  tekstMetContext,
  ankerWoorden,
} from "../kern/scripts/prijs-uitlezen.mjs";
// Het vergelijken zelf staat apart, omdat dit script pagina's ophaalt en dus
// niet in een proef kan draaien. Zie scripts/bron-vergelijken.test.mjs.
import { schrijfwijzen, koudemiddelCode, staatErin } from "./bron-vergelijken.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const vlag = (naam) => {
  const i = args.indexOf(`--${naam}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : "";
};
const STRENG = args.includes("--streng");
/* Wat zou hij nakijken, zonder iets op te halen.
 *
 * Nodig omdat de ontwikkelomgeving nooit bij een fabrikant komt: zonder deze
 * stand is hier niet te zien of de verzameling klopt, en merk je een fout in de
 * veldkeuze pas een week later op een runner. */
const TELLEN = args.includes("--tellen");
const SITE = vlag("site");
const ALLEEN = new Set(vlag("alleen").split(",").map((s) => s.trim()).filter(Boolean));

/* Wat we kunnen nakijken, en waaraan we het ophangen.
 *
 * Elk veld noemt de woorden waarmee een fabrikant die specificatie aankondigt.
 * Staat geen van die woorden op de pagina, dan zegt deze controle niets over
 * dat veld - en dat is met opzet, zie de kop van dit bestand.
 *
 * Niet elk veld staat hier. "vermogen_kw" zou moeten ankeren op "kw" en
 * "ip_klasse" op "ip", en die woorden staan op zo'n pagina tien keer in een
 * andere betekenis. Dan bevestigt of ontkent de uitkomst niets. Liever vijf
 * velden die iets betekenen dan tien die ruis geven. */
const VELDEN = [
  { veld: "scop", woorden: ["scop"], eenheid: "" },
  { veld: "geluid_db", woorden: ["db(a)", "geluidsniveau", "geluidsvermogen", "geluidsdruk"], eenheid: " dB(A)" },
  { veld: "max_aanvoer_c", woorden: ["aanvoertemperatuur", "vertrektemperatuur"], eenheid: " °C" },
  { veld: "koudemiddel", woorden: ["koudemiddel", "refrigerant"], eenheid: "", tekst: true },
  /* "garantie" alleen was te ruim: dat woord staat in elk menu en elke footer,
     en dan levert de zin eromheen geen getal op en zou deze controle een
     afwijking melden op een pagina die het netjes doet. Deze schrijfwijzen
     staan er alleen als er echt een garantietermijn genoemd wordt. */
  { veld: "garantie_jaar", woorden: ["jaar garantie", "jaar fabrieksgarantie", "garantie:", "garantieperiode", "jaar systeemgarantie", "year warranty", "warranty:"], eenheid: " jaar" },
  { veld: "capaciteit_kwh", woorden: ["capaciteit", "bruikbare energie", "usable"], eenheid: " kWh" },
];

async function haal(url) {
  try {
    const html = await haalPagina(url);
    // Een pagina die wel binnenkomt maar zijn tabel met javascript inlaadt
    // levert hier niets op; dan alsnog de browser, net als bij de prijsupdate.
    if (html && html.length > 400) return { html };
    const viaBrowser = await haalMetBrowser(url).catch(() => null);
    return viaBrowser ? { html: viaBrowser } : { fout: "pagina bleef leeg" };
  } catch (err) {
    const viaBrowser = await haalMetBrowser(url).catch(() => null);
    return viaBrowser ? { html: viaBrowser } : { fout: err.message };
  }
}

/* Producten verzamelen: dezelfde opzet als verse-data.mjs, namelijk elk
   databestand dat zelf bijhoudt wanneer het bijgewerkt is. Een lijst met
   leveranciers of iconen hoort hier niet bij. */
const producten = [];
for (const site of readdirSync(join(ROOT, "sites"))) {
  if (SITE && site !== SITE) continue;
  const map = join(ROOT, "sites", site, "data");
  if (!existsSync(map)) continue;
  for (const bestand of readdirSync(map).filter((f) => f.endsWith(".json"))) {
    let data;
    try {
      data = JSON.parse(readFileSync(join(map, bestand), "utf8"));
    } catch {
      continue;
    }
    if (!data || typeof data.laatst_bijgewerkt !== "string") continue;
    const lijst = Object.values(data).find((v) => Array.isArray(v) && v.length && typeof v[0] === "object");
    for (const p of lijst || []) {
      if (!p.product_url) continue;
      if (ALLEEN.size && !ALLEEN.has(p.id)) continue;
      const claims = [];
      for (const { veld, woorden, eenheid, tekst } of VELDEN) {
        const waarde = p[veld];
        if (waarde === null || waarde === undefined) continue;
        if (tekst) {
          if (typeof waarde !== "string") continue;
          const code = koudemiddelCode(waarde);
          claims.push({ veld, woorden, vormen: [code.toLowerCase()], toon: code });
        } else {
          if (typeof waarde !== "number") continue;
          claims.push({ veld, woorden, vormen: schrijfwijzen(waarde), toon: `${String(waarde).replace(".", ",")}${eenheid}` });
        }
      }
      if (claims.length) {
        producten.push({
          site,
          id: p.id,
          merk: p.merk,
          model: p.model,
          url: p.product_url,
          claims,
          // Om te kunnen zien of we überhaupt naar de juiste pagina kijken.
          ankers: ankerWoorden(`${p.merk || ""} ${p.model || ""}`),
        });
      }
    }
  }
}

if (!producten.length) {
  console.log("Niets om na te kijken.");
  process.exit(0);
}

console.log(`${producten.length} product(en) met een fabrikantpagina en minstens één na te kijken getal.\n`);

if (TELLEN) {
  const perVeld = {};
  for (const p of producten) {
    console.log(`  ${p.site}/${p.id}`);
    console.log(`      ${p.url}`);
    for (const c of p.claims) {
      console.log(`      ${c.veld} = ${c.toon}  (ankerwoorden: ${c.woorden.join(", ")})`);
      perVeld[c.veld] = (perVeld[c.veld] || 0) + 1;
    }
  }
  const totaal = Object.values(perVeld).reduce((a, b) => a + b, 0);
  console.log(`\n${totaal} na te kijken waarde(n):`);
  for (const [veld, n] of Object.entries(perVeld).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${veld}`);
  }
  const hosts = {};
  for (const p of producten) {
    let h = p.url;
    try { h = new URL(p.url).host; } catch { /* laat staan */ }
    hosts[h] = (hosts[h] || 0) + 1;
  }
  console.log(`\nover ${Object.keys(hosts).length} host(s), de drukste:`);
  for (const [h, n] of Object.entries(hosts).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    console.log(`  ${String(n).padStart(3)}  ${h}`);
  }
  process.exit(0);
}

const afwijkend = [];
const geenBron = [];
const onbereikbaar = [];
const geenProductpagina = [];
let bevestigd = 0;

// Op volgorde van host, zodat dezelfde fabrikant niet door elkaar heen bevraagd
// wordt, en met een pauze ertussen: 99 pagina's achter elkaar van één site
// halen is onnodig onbeschoft.
producten.sort((a, b) => {
  const h = (u) => { try { return new URL(u).host; } catch { return u; } };
  return h(a.url).localeCompare(h(b.url)) || a.id.localeCompare(b.id);
});

let vorigeHost = "";
for (const p of producten) {
  let host = p.url;
  try { host = new URL(p.url).host; } catch { /* laat staan */ }
  if (host === vorigeHost) await new Promise((r) => setTimeout(r, 1200));
  vorigeHost = host;

  const uit = await haal(p.url);
  if (uit.fout) {
    onbereikbaar.push({ ...p, reden: uit.fout });
    console.log(`  ? ${p.site}/${p.id}: niet op te halen (${uit.fout})`);
    continue;
  }

  /* Noemt deze pagina het product wel?
   *
   * Zonder deze poort is de uitkomst zinloos voor de regels waarvan
   * product_url naar een homepage wijst - en dat zijn er een stel, zoals
   * solar.huawei.com/nl/ en victronenergy.nl. Op zo'n pagina staat "garantie"
   * in het menu, staat ons getal er nergens bij, en zou deze controle een
   * afwijking melden terwijl er niets mis is met onze gegevens. Hetzelfde
   * geldt voor een fabrikant die zijn productpagina verplaatst en een
   * vangnetpagina terugstuurt in plaats van een 404 - dat deed Stiebel, en
   * daar liep ik al een keer in.
   *
   * Twee ankerwoorden is genoeg: "wpl" en "acs" samen wijzen deze pagina
   * voldoende aan, en eisen dat álle woorden er staan zou afketsen op een
   * fabrikant die zijn eigen merknaam in de tekst weglaat. */
  const herkend = p.ankers.length
    ? tekstMetContext(uit.html, p.ankers, { breedte: 1, maxPerWoord: 1 }).length
    : 0;
  if (p.ankers.length && herkend < Math.min(2, p.ankers.length)) {
    geenProductpagina.push({ ...p, herkend });
    console.log(`  - ${p.site}/${p.id}: de pagina noemt dit product niet (${herkend} van ${p.ankers.length} ankerwoorden)`);
    continue;
  }

  const regels = [];
  for (const claim of p.claims) {
    const treffers = tekstMetContext(uit.html, claim.woorden, { breedte: 140, maxPerWoord: 8 });
    if (!treffers.length) {
      geenBron.push({ ...p, veld: claim.veld });
      regels.push(`${claim.veld} = ${claim.toon}: het woord staat niet op de pagina`);
      continue;
    }
    if (treffers.some((t) => staatErin(t.context, claim.vormen))) {
      bevestigd++;
      regels.push(`${claim.veld} = ${claim.toon}: bevestigd`);
    } else {
      afwijkend.push({ ...p, veld: claim.veld, toon: claim.toon, context: treffers[0].context });
      regels.push(`${claim.veld} = ${claim.toon}: AFWIJKEND - de pagina noemt dit wel, maar niet onze waarde`);
    }
  }
  const stand = regels.some((r) => r.includes("AFWIJKEND")) ? "!" : "=";
  console.log(`  ${stand} ${p.site}/${p.id}`);
  for (const r of regels) console.log(`      ${r}`);
}

await sluitBrowser();

console.log("\n" + "=".repeat(72));
console.log(`bevestigd:     ${bevestigd}`);
console.log(`afwijkend:     ${afwijkend.length}`);
console.log(`geen bron:     ${geenBron.length}  (de pagina zet die specificatie niet in tekst)`);
console.log(`onbereikbaar:  ${onbereikbaar.length} pagina('s)`);
console.log(`geen productpagina: ${geenProductpagina.length}  (product_url noemt het product niet; vaak een homepage)`);

if (afwijkend.length) {
  console.log(`\n! ${afwijkend.length} getal(len) die de bronpagina anders noemt dan wij:\n`);
  for (const a of afwijkend) {
    console.log(`  ${a.site}/${a.id} (${a.merk} ${a.model})`);
    console.log(`    wij: ${a.veld} = ${a.toon}`);
    console.log(`    pagina: ...${a.context}...`);
    console.log(`    ${a.url}\n`);
  }
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const regels = [
    `## Bronnen nagekeken: ${producten.length} productpagina's`,
    "",
    `| uitkomst | aantal |`,
    `| --- | --- |`,
    `| bevestigd | ${bevestigd} |`,
    `| afwijkend | ${afwijkend.length} |`,
    `| geen bron op de pagina | ${geenBron.length} |`,
    `| pagina niet op te halen | ${onbereikbaar.length} |`,
    "",
  ];
  if (afwijkend.length) {
    regels.push(
      `### ${afwijkend.length} getal(len) die de bronpagina anders noemt`,
      "",
      "| product | veld | onze waarde | wat er op de pagina staat |",
      "| --- | --- | --- | --- |",
      ...afwijkend.map(
        (a) => `| [${a.site}/${a.id}](${a.url}) | ${a.veld} | ${a.toon} | ${a.context.replace(/\|/g, "\\|").slice(0, 160)} |`,
      ),
      "",
    );
  } else {
    regels.push("Geen enkel getal spreekt zijn bronpagina tegen.", "");
  }
  if (geenProductpagina.length) {
    regels.push(
      `### ${geenProductpagina.length} keer wijst product_url niet naar dit product`,
      "",
      "Meestal een homepage in plaats van een productpagina. Dat is geen fout in de gegevens, maar het betekent wel dat de bezoeker op een algemene pagina landt en dat deze controle hier niets kan zeggen.",
      "",
      ...geenProductpagina.map((g) => `- [${g.site}/${g.id}](${g.url}) - ${g.merk} ${g.model}`),
      "",
    );
  }

  if (onbereikbaar.length) {
    regels.push(
      "### Pagina's die een runner niet binnenlaat",
      "",
      "Dit is geen kapot script en geen verlopen URL; sommige winkels en fabrikanten weren datacenter-IP's.",
      "",
      ...onbereikbaar.map((o) => `- ${o.site}/${o.id}: ${o.reden}`),
      "",
    );
  }
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, regels.join("\n") + "\n");
}

if (afwijkend.length && STRENG) {
  console.error(`\n${afwijkend.length} afwijking(en) gevonden.`);
  process.exit(1);
}
