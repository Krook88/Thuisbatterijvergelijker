/**
 * Slop-controle: schrijft deze site nog als een mens?
 *
 * Waarom dit bestaat
 * ------------------
 * Lezers noemen sites als deze "AI-slop". Dat verwijt gaat zelden over lelijk
 * en zelden over onjuist. Het gaat over inhoud die overkomt als gemaakt zonder
 * moeite: gladde zinnen die alles raken en niets zeggen. De scherpste
 * omschrijving die ervan rondgaat is die van slop-reacties op Reddit - ze
 * prijzen in vage termen en er zit "niets in dat op iets specifieks reageert".
 *
 * Dat laatste is de hele kern, en meteen het tegengif: een bewering met een
 * bedrag, een datum, een winkelnaam of een bron erbij kán geen slop zijn, want
 * die kun je nakijken. Deze site heeft daar zijn hele bestaansrecht van
 * gemaakt. Dit script bewaakt dat het zo blijft.
 *
 * Waarom een script en geen goede voornemens: precies om dezelfde reden als
 * llms-index.mjs. Toen er zes pagina's bijkwamen bleef llms.txt op de oude
 * negen staan, zonder dat iets dat liet zien. Schrijfstijl verloopt net zo:
 * niemand besluit ooit om vager te gaan schrijven, het zakt weg per alinea.
 *
 * Wat het wél en niet doet
 * ------------------------
 * Vier controles zijn hard en laten de run vallen. Ze zijn zo gekozen dat ze
 * vandaag op nul staan: alles wat ze melden is dus nieuw, en nieuw betekent
 * dat iemand het net heeft toegevoegd. Een controle die bij invoering al
 * honderd meldingen geeft, is een controle die je wegklikt.
 *
 * De vijfde was lang een signaal dat niets liet vallen. Bij invoering stond
 * claimdichtheid op 64 van de 185 alinea's, en een controle die bij invoering
 * al 64 meldingen geeft, klik je weg. In augustus 2026 zijn die 64 alinea's
 * stuk voor stuk nagelopen en van een bedrag, een aantal, een merknaam of een
 * bron voorzien. De teller staat op nul, en daarmee voldoet hij aan dezelfde
 * eis als de andere vier: alles wat hij meldt is nieuw.
 *
 * Dus laat hij nu wél vallen. Loop je erop vast bij een alinea die echt geen
 * getal hoort te dragen, dan is de uitweg om hem korter dan 25 woorden te
 * maken of om er de bron bij te zetten waar hij toch al op leunt.
 *
 * Draaien:  npm run slop
 *           npm run slop -- batterijmaatje     voor één site
 */
import { readFileSync, readdirSync, existsSync, statSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WORTEL = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITES_MAP = join(WORTEL, "sites");
const GEVRAAGD = process.argv.slice(2).filter((a) => !a.startsWith("-"));

/* Pagina's die met opzet op elke site hetzelfde zeggen. Een privacyverklaring
   hoort niet drie keer anders geformuleerd te zijn; daar is variatie geen
   eigenheid maar een risico. */
const BOILERPLATE = new Set(["privacy.html", "contact.html", "steun.html", "404.html"]);

/* Woorden die niets toevoegen behalve toon. Bewust kort gehouden en bewust
   zonder gewone Nederlandse woorden als "cruciaal" of "essentieel": die zijn
   soms precies het juiste woord, en een lijst die goede zinnen afkeurt wordt
   genegeerd. Alles hieronder staat vandaag nul keer op de drie sites. */
const VERBODEN = [
  [/naadlo(o|z)\w*/gi, "zegt niets over wat er gebeurt"],
  [/baanbrekend\w*/gi, "een oordeel zonder maat"],
  [/revolutionair\w*/gi, "een oordeel zonder maat"],
  [/game-?changer/gi, "vertaal het naar wat er verandert"],
  [/state-of-the-art/gi, "noem het jaartal of de norm"],
  [/ongeëvenaard\w*/gi, "onvergelijkbaar is niet te controleren"],
  [/moeiteloos/gi, "zeg hoeveel stappen het kost"],
  [/beste van beide werelden/gi, "noem de twee dingen"],
  [/een schat aan/gi, "zeg hoeveel"],
  [/talloze/gi, "zeg hoeveel"],
  [/snel verander\w+ landschap/gi, "opening zonder inhoud"],
  [/in deze tijd van/gi, "opening zonder inhoud"],
  [/in de wereld van vandaag/gi, "opening zonder inhoud"],
  [/laten we (eens )?duiken/gi, "opening zonder inhoud"],
  [/niet meer weg te denken/gi, "zeg sinds wanneer, of hoeveel"],
  [/de sleutel tot/gi, "noem de oorzaak"],
  [/op maat gemaakte oplossing\w*/gi, "noem wat er op maat is"],
  [/ontdek de wereld/gi, "opening zonder inhoud"],
  [/ontgrendel\w*/gi, "marketingwerkwoord"],
  [/ontketen\w*/gi, "marketingwerkwoord"],
];

/* "Het is niet X, het is Y" geldt als de meest herkende verklikker van
   AI-tekst. In het Nederlands is de losse vorm ("Niet X, maar Y.") net zo
   herkenbaar. Let op: alleen als stijlfiguur - een gewone zin waarin "niet" en
   "maar" toevallig samen voorkomen wordt niet geraakt, want dat is doodgewoon
   Nederlands en daar is niets mis mee.

   De laatste twee patronen zijn er later bij gekomen, nadat een lezer er een
   aanwees die hier gewoon doorheen kwam: "Dekt 44%. Dat is geen afkeuring:
   dit is ook de goedkoopste." Zelfde figuur, ander scharnier - een dubbele
   punt in plaats van "maar". Wat de vorm verklikt is niet het woord "maar"
   maar de beweging: eerst ontkennen, dan het echte antwoord geven, zodat de
   zin dieper klinkt dan hij is.

   Wat bewust niet geraakt wordt: "Dit is een hulpmiddel, geen persoonlijk
   advies." Daar staat de ontkenning achteraan als afbakening en wordt er
   niets tegenovergesteld. Dat is een disclaimer en doodgewoon Nederlands. */
const STIJLFIGUUR = [
  /(?:^|(?<=[.!?]\s))Niet [^.!?]{3,80}, maar [^.!?]{3,80}[.!?]/g,
  /Het is niet [^.!?]{3,60}, (?:het is|maar) [^.!?]{3,60}[.!?]/gi,
  /\b(?:Dat|Dit|Het) is geen [^.!?:,]{3,60}[:,] (?:het|dit|dat) is [^.!?]{3,140}[.!?]/gi,
  /\b(?:Dat|Dit|Het) is geen [^.!?:,]{3,60}[:,] maar [^.!?]{3,140}[.!?]/gi,
];

/* Een controle die iets mist is erger dan geen controle: hij geeft groen en je
   stopt met kijken. Precies dat gebeurde hier. Daarom staan de zinnen waar het
   om gaat er nu bij, met wat er wél en niet uit hoort te komen, en draait die
   proef bij elke run mee. Verandert er iemand aan de patronen, dan zegt dit
   meteen wat er kapot is. */
const PROEFZINNEN = [
  ["Dekt 44%. Dat is geen afkeuring: dit is ook de goedkoopste, en wie hem in het stopcontact prikt weet nu wat hij krijgt.", true],
  ["Dat is geen oordeel, maar een waarneming.", true],
  ["Het is geen fout: het is een oordeel.", true],
  ["Niet de prijs telt, maar de prijs per kWh.", true],
  // Een ontkenning die iets afbakent en er niets tegenoverstelt, is doodgewoon
  // Nederlands. Deze vier staan zo op de site en horen te blijven staan.
  ["Dit is een hulpmiddel, geen persoonlijk (financieel) advies.", false],
  ["Het is geen financieel advies en geen voorspelling.", false],
  ["Dit is geen offerte. Laat een installateur altijd je dak beoordelen.", false],
  ["Dat is geen toetsing aan de wet, dus vraag je installateur.", false],
];

for (const [zin, hoortTeRaken] of PROEFZINNEN) {
  const raakt = STIJLFIGUUR.some((p) => { p.lastIndex = 0; return p.test(zin); });
  if (raakt !== hoortTeRaken) {
    console.error(`De stijlfiguurcontrole is stuk: "${zin}" ${raakt ? "wordt geraakt" : "komt erdoor"} en dat hoort niet.`);
    process.exit(2);
  }
}


/* Beweren dat "onderzoeken aantonen" zonder te zeggen welke, is precies het
   patroon dat mensen als slop herkennen: het klinkt onderbouwd en is het niet.
   Deze site doet het goed - CE Delft, Berenschot en Milieu Centraal staan er
   met naam bij - dus dit bewaakt een gewoonte die er al is. */
const GENERALISATIE = /(onderzoek(en)? (toont|tonen) aan|studies (laten zien|tonen)|experts? (zeggen|stellen|adviseren)|het is algemeen bekend|men zegt|over het algemeen wordt aangenomen)/gi;

/* De site is van één maker en spreekt sinds augustus 2026 als "ik". "Wij" is
   dan niet alleen een andere toon maar een onwaarheid: het suggereert een
   redactie die er niet is, en dat is precies het soort gladheid waar lezers
   een generator in herkennen.

   Deze controle staat er omdat de terugval zo makkelijk is. Wie een nieuwe
   pagina schrijft valt vanzelf terug in "wij tonen" - het is de standaardstem
   van elke vergelijkingssite en van elk taalmodel. Nul treffers bij invoering,
   dus alles wat hier opduikt is nieuw ingeslopen. */
const MEERVOUDSSTEM = /\b(Wij|wij|We|we|ons|Ons|onze|Onze)\b/g;

/* Het kastlijntje. Of dit echt een verklikker van AI-tekst is, is betwist -
   het staat in boeken en journalistiek net zo goed, en het zegt eerder iets
   over geredigeerd schrijven dan over de schrijver. Maar het is wel het eerste
   waar lezers naar wijzen, en dat is hier genoeg reden: de zin wordt er nooit
   slechter van als je hem uitschrijft.

   Wat er meestal voor in de plaats kan: een dubbele punt als het tweede deel
   het eerste uitlegt, haakjes als het een terzijde is, een puntkomma als het
   twee zinnen zijn die bij elkaar horen, of gewoon een punt.

   Ook in HTML-notatie. Toen dit voor het eerst draaide gaf het nul en stonden
   er nog 55 streepjes op de site, geschreven als &mdash;. Een controle die
   alleen het letterlijke teken zoekt, geeft groen op precies de plek waar een
   opmaaktaal het teken anders spelt. */
const KASTLIJNTJE = /—|&mdash;|&#8212;|&#x2014;/gi;

/* Zelfde proef voor het lange streepje, in alle vier de spellingen waarin het
   op een pagina terecht kan komen. */
const STREEPJESPROEF = [
  ["Het gaat om de erfgrens — niet om het apparaat.", true],
  ["Het gaat om de erfgrens &mdash; niet om het apparaat.", true],
  ["Het gaat om de erfgrens &#8212; niet om het apparaat.", true],
  ["Het gaat om de erfgrens &#x2014; niet om het apparaat.", true],
  ["Een glas-glas paneel van 21,5 kg.", false],
  ["Prijzen van 2.900 tot 9.500 euro.", false],
];
for (const [zin, hoortTeRaken] of STREEPJESPROEF) {
  KASTLIJNTJE.lastIndex = 0;
  const raakt = KASTLIJNTJE.test(zin);
  if (raakt !== hoortTeRaken) {
    console.error(`De streepjescontrole is stuk: "${zin}" ${raakt ? "wordt geraakt" : "komt erdoor"} en dat hoort niet.`);
    process.exit(2);
  }
}

const zonderRuis = (html) =>
  html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, " ");

const hoofdblok = (html) => {
  const m = zonderRuis(html).match(/<main\b[^>]*>([\s\S]*?)<\/main>/);
  if (!m) return "";
  return m[1]
    .replace(/<aside class="steun-blok"[\s\S]*?<\/aside>/g, " ")
    .replace(/<div class="regel-banner"[\s\S]*?<\/div>/g, " ");
};

/* Let op de volgorde. Het lange streepje wordt eerst teruggezet naar het teken
   zelf, en pas daarna gaan de overgebleven entiteiten eruit. Andersom, en dat
   was hier het geval, wist deze regel het bewijs uit voordat de controle keek:
   &mdash; werd een spatie, de streepjescontrole gaf groen, en er stonden er
   nog 55 op de site. */
const HERSTEL_STREEPJE = /&mdash;|&#8212;|&#x2014;/gi;
const plat = (html) => html
  .replace(/<[^>]+>/g, " ")
  .replace(HERSTEL_STREEPJE, "—")
  .replace(/&[a-z]+;|&#\d+;/gi, " ")
  .replace(/\s+/g, " ")
  .trim();

/* Een tooltip is ook tekst die iemand leest, en die staat in een attribuut -
   dus buiten wat plat() overhoudt. Dat is geen theoretisch gat: de uitsplitsing
   van de Koppel-score staat in een title, en die stond 71 keer met een lang
   streepje in de vergelijker zonder dat deze controle er iets van zag. */
const attribuutTekst = (html) =>
  (html.match(/(?:title|aria-label|alt)="[^"]*"/g) || [])
    .map((a) => a.slice(a.indexOf('"') + 1, -1))
    .join(" ");
const zinnenIn = (tekst) => tekst.split(/(?<=[.!?])\s+/).map((z) => z.trim()).filter(Boolean);

function paginasVan(site) {
  const map = join(SITES_MAP, site);
  return readdirSync(map)
    .filter((n) => n.endsWith(".html"))
    .map((n) => ({ site, naam: n, pad: join(map, n) }));
}

const alleSites = readdirSync(SITES_MAP).filter((s) => statSync(join(SITES_MAP, s)).isDirectory());
const teDoen = GEVRAAGD.length ? GEVRAAGD : alleSites;

const gebreken = [];
const signalen = [];
const zinPerSite = new Map(); // zin -> Set van sites

for (const site of teDoen) {
  for (const { naam, pad } of paginasVan(site)) {
    const html = readFileSync(pad, "utf8");
    const tekst = `${plat(zonderRuis(html))} ${attribuutTekst(zonderRuis(html))}`;
    const waar = `${site}/${naam}`;

    for (const [patroon, waarom] of VERBODEN) {
      for (const treffer of tekst.match(patroon) || []) {
        gebreken.push({ waar, soort: "woordenschat", melding: `"${treffer}" - ${waarom}` });
      }
    }

    for (const patroon of STIJLFIGUUR) {
      for (const treffer of tekst.match(patroon) || []) {
        gebreken.push({ waar, soort: "stijlfiguur", melding: `${treffer.slice(0, 90)}` });
      }
    }

    for (const treffer of tekst.match(KASTLIJNTJE) || []) {
      gebreken.push({ waar, soort: "kastlijntje", melding: `"${treffer}" - dubbele punt, haakjes, puntkomma of punt` });
    }

    for (const treffer of tekst.match(MEERVOUDSSTEM) || []) {
      gebreken.push({ waar, soort: "meervoudsstem", melding: `"${treffer}" - deze site spreekt als "ik"` });
    }

    for (const zin of zinnenIn(tekst)) {
      if (!GENERALISATIE.test(zin)) continue;
      GENERALISATIE.lastIndex = 0;
      // Een cijfer in dezelfde zin telt als bron genoeg: dan staat er een
      // jaartal, een bedrag of een aantal bij, en is het na te lopen.
      if (!/\d/.test(zin)) {
        gebreken.push({ waar, soort: "generalisatie", melding: `${zin.slice(0, 100)}` });
      }
    }

    if (!BOILERPLATE.has(naam)) {
      for (const zin of zinnenIn(plat(hoofdblok(html)))) {
        if (zin.length < 46 || zin.length > 240) continue;
        if (!zinPerSite.has(zin)) zinPerSite.set(zin, new Set());
        zinPerSite.get(zin).add(site);
      }
    }

    // Signaal: lange alinea's zonder één getal en zonder één verwijzing.
    const alineas = (hoofdblok(html).match(/<p\b[^>]*>[\s\S]*?<\/p>/g) || []);
    let leeg = 0, lang = 0;
    for (const alinea of alineas) {
      const woorden = plat(alinea).split(" ").length;
      if (woorden < 25) continue;
      lang++;
      if (!/\d/.test(plat(alinea)) && !/<a\s/.test(alinea)) leeg++;
    }
    if (lang) signalen.push({ waar, leeg, lang });
  }
}

/* Zinnen die op meerdere sites letterlijk hetzelfde zijn. Sommige horen dat te
   zijn - een uitspraak over onafhankelijkheid moet overal hetzelfde luiden -
   dus die staan in een lijst die een mens bijhoudt. Wat er niet in staat is
   nieuw, en nieuw is bijna altijd een zin die uit gemak is overgenomen. */
const toegestaanPad = join(WORTEL, "scripts", "gedeelde-zinnen.json");
const toegestaan = new Set(existsSync(toegestaanPad) ? JSON.parse(readFileSync(toegestaanPad, "utf8")) : []);
if (teDoen.length === alleSites.length) {
  for (const [zin, sites] of zinPerSite) {
    if (sites.size < 2 || toegestaan.has(zin)) continue;
    gebreken.push({ waar: [...sites].sort().join(" + "), soort: "zelfde zin", melding: zin.slice(0, 110) });
  }
}

/* ------------------------------------------------------------------ */

const UITLEG = {
  woordenschat: "Woorden die toon toevoegen en verder niets.",
  stijlfiguur: '"Niet X, maar Y" is de meest herkende vorm van AI-tekst. Schrijf de zin gewoon uit.',
  generalisatie: "Een beroep op onderzoek zonder te zeggen welk onderzoek.",
  meervoudsstem: 'De site is van één maker en spreekt als "ik". "Wij" suggereert een redactie die er niet is.',
  kastlijntje: "Het lange streepje is het eerste waar lezers naar wijzen bij gegenereerde tekst. Schrijf de zin uit.",
  "zelfde zin": "Staat letterlijk op meer dan één site. Hoort dat zo? Zet hem dan in scripts/gedeelde-zinnen.json, met een reden in de commit.",
};

for (const soort of Object.keys(UITLEG)) {
  const lijst = gebreken.filter((g) => g.soort === soort);
  if (!lijst.length) continue;
  console.error(`\n${soort} (${lijst.length}) - ${UITLEG[soort]}`);
  for (const g of lijst.slice(0, 20)) console.error(`   ${g.waar}: ${g.melding}`);
  if (lijst.length > 20) console.error(`   ... en nog ${lijst.length - 20}`);
}

let gebrekenExtra = 0;
const legeAlineas = signalen.reduce((n, s) => n + s.leeg, 0);
const langeAlineas = signalen.reduce((n, s) => n + s.lang, 0);
if (legeAlineas) {
  console.error(`\nClaimdichtheid: ${legeAlineas} van ${langeAlineas} alinea's van 25 woorden of meer`);
  console.error("bevat geen enkel getal en geen enkele verwijzing. Zet er een bedrag, een aantal,");
  console.error("een merknaam of een bron bij, of maak de alinea korter dan 25 woorden.");
  for (const s of signalen.filter((s) => s.leeg).sort((a, b) => b.leeg - a.leeg)) {
    console.error(`   ${String(s.leeg).padStart(3)} van ${String(s.lang).padStart(3)}   ${s.waar}`);
  }
  gebrekenExtra = legeAlineas;
} else if (langeAlineas) {
  console.log(`\nClaimdichtheid: alle ${langeAlineas} alinea's van 25 woorden of meer dragen een getal of een verwijzing.`);
}

if (gebreken.length || gebrekenExtra) {
  console.error(
    `\n${gebreken.length + gebrekenExtra} plek(ken) waar de tekst vager is dan deze site wil zijn.` +
    "\nDe regels staan in SCHRIJFWIJZE.md.",
  );
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Slop-controle: ${gebreken.length + gebrekenExtra} bevinding(en)\n\nZie SCHRIJFWIJZE.md.\n\n`);
  }
  process.exit(1);
}

/* De laatste zin telt alleen wat er echt gekeken is. Draai je één site, dan is
   de vergelijking tussen sites overgeslagen, en dan hoort hij daar ook niet
   over op te scheppen - "niets gevonden" en "niets gekeken" horen er niet
   hetzelfde uit te zien. */
const alles = teDoen.length === alleSites.length;
console.log(`\nDe tekst is scherp op ${teDoen.length} site(s): geen lege woordenschat, geen "niet X maar Y",`);
console.log(`nergens "wij" waar "ik" hoort,`);
console.log(`en geen beroep op onderzoek zonder bron${alles ? ", en geen zin die ongemerkt op twee sites staat" : " (de vergelijking tussen sites is overgeslagen)"}.`);
