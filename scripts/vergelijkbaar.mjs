#!/usr/bin/env node
/**
 * Bewaakt dat de site geen twee verschillende grootheden naast elkaar zet.
 *
 * Waarom dit bestaat. Deze fout is op één dag vier keer gevonden, elke keer in
 * een andere gedaante, en elke keer pas nadat iemand het toevallig opmerkte:
 *
 *   btw          een winkelprijs excl. btw naast een prijs incl. btw. Opgelost
 *                met Prijs.vergelijkPrijs(), de aanleiding voor prijs.js.
 *   capaciteit   de bruto pakketmaat van een batterij naast de bruikbare. De
 *                Zendure SolarFlow 2400 ging van 420 naar 504 euro per kWh toen
 *                dat werd rechtgezet.
 *   prijsomvang  de kale apparaatprijs naast de prijs inclusief installatie. De
 *                keuzehulp raadde een systeem van 5.700 euro aan bij een budget
 *                van 2.000, omdat het toestel 1.625 kost.
 *   vermogen     het vermogen van een warmtepomp op een milde dag naast dat bij
 *                de ontwerptemperatuur. De NIBE S2125-8 heet acht kilowatt en
 *                levert er vijf.
 *   stuksprijs   een micro-omvormer van 109 euro naast een string-omvormer van
 *                1.050. Je hebt er twaalf nodig; het echte verschil is 1.558
 *                tegen 1.050, en de keuzehulp koos daardoor elk scenario
 *                dezelfde twee omvormers.
 *
 * Het patroon is telkens hetzelfde: een getal dat vergelijkbaar lijkt maar het
 * niet is, omdat het onder andere omstandigheden is gemeten of iets anders
 * omvat. In de gegevens is dat te zien aan een begeleidend veld dat de eenheid
 * of conditie vastlegt - capaciteit_soort, vermogen_conditie, scop_conditie,
 * panelen_per_eenheid, btw_inbegrepen.
 *
 * Wat dit script daarom controleert:
 *
 *   1. Elk vergelijkveld uit het register hieronder heeft bij elk item zijn
 *      begeleidende veld ingevuld. Een leeg conditieveld betekent dat niemand
 *      het heeft nagekeken, en dat is iets anders dan "het klopt".
 *
 *   2. Er duiken geen nieuwe getalsvelden op die op een vergelijkveld lijken en
 *      nergens geregistreerd staan. Dat is de echte bewaking: de volgende keer
 *      dat iemand een veld toevoegt waarop gesorteerd of gerekend gaat worden,
 *      staat het hier in het rapport voordat het stilletjes de vergelijking in
 *      glijdt.
 *
 * Dit script oordeelt niet over de inhoud - het weet niet of 4,6 kWh klopt. Het
 * bewaakt alleen dat vastligt wát een getal is. Toevoegen aan het register is
 * mensenwerk, net als bij nieuwe modellen.
 *
 * Gebruik:
 *   node scripts/vergelijkbaar.mjs             rapport
 *   node scripts/vergelijkbaar.mjs --streng    foutcode bij een ontbrekende
 *                                              conditie of een onbekend veld
 */

import { readFileSync, readdirSync, existsSync, appendFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const STRENG = process.argv.includes("--streng");

/* --------------------------------------------------------------------------
   Het register.

   Per getalsveld: welk veld legt vast wát dat getal is, en waarom dat nodig is.
   "conditie: null" betekent een bewuste keuze: dit getal betekent overal
   hetzelfde en heeft geen begeleiding nodig. Ook dat hoort hier te staan, want
   anders is niet te zien of iemand erover heeft nagedacht.
   -------------------------------------------------------------------------- */

// Per site, want dezelfde veldnaam betekent elders iets anders: vermogen_kw is
// bij een warmtepomp de warmteafgifte en bij een batterij het ontlaadvermogen.
// Dat verschil zelf was het eerste wat dit script vond.
const ALGEMEEN = {
  richtprijs_eur:        { conditie: null,                   waarom: "altijd incl. btw; Prijs.vergelijkPrijs rekent om waar nodig" },
  totaalprijs_van_eur:   { conditie: null,                   waarom: "per definitie compleet gebruiksklaar" },
  totaalprijs_tot_eur:   { conditie: null,                   waarom: "idem" },
  // Bewust een apart paar naast totaalprijs_van_eur: dat veld betekent "uit een
  // bron" en wordt gebruikt om op te rangschikken. Een schatting daarin zou een
  // geschat getal laten meetellen alsof het vaststaat.
  totaalprijs_geschat_van_eur: { conditie: null,             waarom: "toestel plus 500-2.000 euro installatie; schatting, telt niet mee in de rangschikking" },
  totaalprijs_geschat_tot_eur: { conditie: null,             waarom: "idem" },
  isde_indicatie_eur:    { conditie: null,                   waarom: "bedrag per meldcode volgens RVO" },
  vermogen_wp:           { conditie: null,                   waarom: "STC, wereldwijd dezelfde meetconditie voor panelen" },
  rendement_pct:         { conditie: null,                   waarom: "idem, volgt uit vermogen en oppervlak" },
  capaciteit_nominaal_kwh: { conditie: null,                 waarom: "is zelf de begeleiding bij capaciteit_kwh" },
  vermogen_a7_kw:        { conditie: null,                   waarom: "idem bij vermogen_kw" },
  garantie_jaar:         { conditie: null,                   waarom: "jaren zijn jaren" },
  garantie_product_jaar: { conditie: null,                   waarom: "idem" },
  garantie_vermogen_jaar:{ conditie: null,                   waarom: "idem" },
  cycli:                 { conditie: null,                   waarom: "aantal laadcycli, opgave van de fabrikant" },
  max_aanvoer_c:         { conditie: null,                   waarom: "graden zijn graden" },
  gewicht_kg:            { conditie: null,                   waarom: "kilo's zijn kilo's" },
  temp_coefficient:      { conditie: null,                   waarom: "vaste eenheid per graad" },
  vermogen_behoud_25j_pct: { conditie: null,                 waarom: "percentage op een vast moment" },
  vermogen_behoud_eind_pct: { conditie: null,                waarom: "percentage op het einde van de garantie" },
  koppeling_gemak:       { conditie: null,                   waarom: "eigen sterscore, zelfde schaal voor iedereen" },
  uitbreidbaar_tot_kwh:  { conditie: "capaciteit_soort",     waarom: "volgt dezelfde maat als capaciteit_kwh" },
  systeem_toeslag_eur:   { conditie: null,                   waarom: "hoort bij panelen_per_eenheid" },
  panelen_per_eenheid:   { conditie: null,                   waarom: "is zelf de begeleiding bij de prijs van een omvormer" },
};

const REGISTERS = {
  batterijmaatje: {
    ...ALGEMEEN,
    capaciteit_kwh: { conditie: "capaciteit_soort", waarom: "bruto pakketmaat of bruikbaar; scheelt tot een vijfde" },
    // Gevonden door dit script zelf, en nog niet opgelost: bij een batterij is
    // "2,5 kW" soms het continue ontlaadvermogen en soms de piek. Dat is
    // dezelfde valkuil als bij de warmtepompen, en de site vergelijkt erop.
    // Zolang er geen vermogen_conditie staat, meldt dit script het - dat is
    // beter dan het veld stilzwijgend goedkeuren.
    // "continu" = wat hij aan je huis blijft leveren, "max" = een piek of het
    // off-grid maximum dat je in dagelijks gebruik niet haalt, "onbekend" =
    // nagezocht en niet vastgesteld. Marstek geeft bijvoorbeeld 800 W on-grid
    // en 2500 W off-grid op; ons veld stond op dat tweede getal.
    vermogen_kw: { conditie: "vermogen_conditie", waarom: "continu ontlaadvermogen, een piek, of het off-grid maximum" },
    vermogen_bron: { conditie: null, waarom: "waar de conditie op gebaseerd is" },
    terugleverkosten_per_kwh_indicatie: { conditie: null, waarom: "tarief per kWh, zelfde eenheid voor elke leverancier" },
  },
  warmtepompmaatje: {
    ...ALGEMEEN,
    vermogen_kw: { conditie: "vermogen_conditie", waarom: "milde dag of ontwerptemperatuur; scheelt tot een derde" },
    scop: { conditie: "scop_conditie", waarom: "35 of 55 graden aanvoer; scheelt ruim een punt" },
    geluid_db: { conditie: "geluid_toelichting", waarom: "geluidsvermogen of geluidsdruk; scheelt tien tot vijfentwintig dB" },
  },
  zonnestroommaatje: {
    ...ALGEMEEN,
  },
};

// Velden die per item verschillen maar nooit vergeleken worden.
const GEEN_VERGELIJKVELD = new Set(["prijs_eur", "prijs_datum", "isde_meldcode", "jaar"]);

function lees(pad) {
  return JSON.parse(readFileSync(pad, "utf8"));
}

function itemsUit(data) {
  for (const waarde of Object.values(data)) {
    if (Array.isArray(waarde) && waarde.length && typeof waarde[0] === "object") return waarde;
  }
  return [];
}

let ontbrekend = 0;
let onbekend = 0;

for (const site of readdirSync(resolve(ROOT, "sites"))) {
  const dataMap = resolve(ROOT, "sites", site, "data");
  if (!existsSync(dataMap)) continue;

  const meldingen = [];
  const nieuweVelden = new Map();

  for (const bestand of readdirSync(dataMap).filter((f) => f.endsWith(".json"))) {
    if (bestand === "nieuwe-modellen.json") continue;   // werklijst, geen catalogus
    const items = itemsUit(lees(join(dataMap, bestand)));
    if (!items.length) continue;

    const register = REGISTERS[site] || ALGEMEEN;
    for (const [veld, regel] of Object.entries(register)) {
      if (!regel.conditie) continue;
      const metGetal = items.filter((i) => typeof i[veld] === "number");
      if (!metGetal.length) continue;
      const zonder = metGetal.filter((i) => i[regel.conditie] === undefined || i[regel.conditie] === null || i[regel.conditie] === "");
      if (zonder.length) {
        ontbrekend += zonder.length;
        meldingen.push(`  ${bestand}: ${zonder.length} van ${metGetal.length} met ${veld} missen ${regel.conditie}`);
        meldingen.push(`      ${regel.waarom}`);
        for (const i of zonder.slice(0, 6)) meldingen.push(`      - ${i.id}`);
        if (zonder.length > 6) meldingen.push(`      ... en nog ${zonder.length - 6}`);
      }
    }

    // Getalsvelden die niemand heeft geregistreerd.
    for (const item of items) {
      for (const [veld, waarde] of Object.entries(item)) {
        if (typeof waarde !== "number") continue;
        if (register[veld] || GEEN_VERGELIJKVELD.has(veld)) continue;
        if (!nieuweVelden.has(veld)) nieuweVelden.set(veld, new Set());
        nieuweVelden.get(veld).add(bestand);
      }
    }
  }

  if (meldingen.length || nieuweVelden.size) {
    console.log(`\n${site}`);
    for (const regel of meldingen) console.log(regel);
    for (const [veld, bestanden] of nieuweVelden) {
      onbekend++;
      console.log(`  onbekend getalsveld: ${veld}  (${[...bestanden].join(", ")})`);
      console.log(`      Zet het in het register van scripts/vergelijkbaar.mjs: betekent dit`);
      console.log(`      getal overal hetzelfde, of hoort er een conditieveld bij?`);
    }
  }
}

console.log(
  ontbrekend || onbekend
    ? `\n${ontbrekend} ontbrekende conditie(s), ${onbekend} ongeregistreerd getalsveld(en).`
    : "\nElk vergeleken getal heeft vastliggen wat het is."
);

if ((ontbrekend || onbekend) && process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### Vergelijkbaarheid: ${ontbrekend} ontbrekende conditie(s), ${onbekend} ongeregistreerd veld(en)\n\n` +
    "Een getal dat vergelijkbaar lijkt maar het niet is, is op deze sites vijf keer voorgekomen. Zie scripts/vergelijkbaar.mjs.\n\n");
}

if (STRENG && (ontbrekend || onbekend)) process.exit(1);
