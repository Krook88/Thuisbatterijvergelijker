/**
 * Regels die er staan maar niets doen.
 *
 * Dit vangt de fout die de keuring niet kan vangen. Het opschrift boven de
 * hero stond netjes in de stylesheet - 12px, merkkleur, hoofdletters - en
 * rendeerde als 19px grijs, omdat ".hero p" specifieker is dan
 * ".hero-opschrift" en dus won. Formeel klopte alles: 19px staat op de
 * maatlat en het contrast was 5,4:1. Alleen deed de code niet wat er stond.
 * Het viel bij toeval op.
 *
 * Hoe dit het meet: niet door de cascade na te rekenen, maar door hem te
 * vragen. Voor elke declaratie halen we hem even weg en kijken we of er iets
 * verandert aan wat de browser uitrekent. Verandert er nergens iets, dan is
 * die declaratie overruled of overbodig.
 *
 * Wat het bewust niet meldt:
 *   - selectors die op geen enkele pagina iets raken; dat is meestal opmaak
 *     voor een toestand die we niet bezoeken (een lege lijst, een foutmelding)
 *     en zou alleen maar ruis geven
 *   - toestand-pseudo's als :hover en ::before, want die kun je zo niet meten
 *   - regels in een mediaquery die op deze breedte niet geldt
 *
 * Een declaratie wordt pas gemeld als hij op élke pagina en élke breedte waar
 * hij iets raakt, niets uithaalt.
 *
 * Draaien: npm run dode-regels        (of voor één site: -- batterijmaatje)
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { paginasVan } from "../kern/scripts/paginas.mjs";

/**
 * De breedtes waarop we meten, afgeleid uit de stylesheet zelf.
 *
 * Meet je alleen op 1280 en 390, dan lijkt een regel in
 * @media (max-width: 700px) dood zodra er ook een regel voor 640 staat: op
 * 390 wint de smalste, en 680 kwam nooit langs. Dat is geen fout in de site
 * maar een gat in de meting. Door precies op elk breekpunt te gaan staan is
 * elke mediaquery ergens de smalste die geldt, en krijgt hij een eerlijke
 * kans om te winnen.
 */
function breedtesVan(root) {
  const map = join(root, "assets");
  const punten = new Set([1280, 390]);
  for (const naam of readdirSync(map)) {
    if (!naam.endsWith(".css")) continue;
    for (const m of readFileSync(join(map, naam), "utf8").matchAll(/@media[^{]*\(max-width:\s*(\d+)px\)/g)) {
      const px = Number(m[1]);
      if (px >= 360 && px <= 1400) punten.add(px);
    }
  }
  return [...punten].sort((a, b) => b - a);
}

const WORTEL = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALLE = ["batterijmaatje", "warmtepompmaatje", "zonnestroommaatje"];
const GEVRAAGD = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const TE_DOEN = GEVRAAGD.length ? GEVRAAGD : ALLE;

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "Playwright ontbreekt, dus er is niets gemeten.\n" +
    "Installeren:  npm i --no-save playwright && npx playwright install chromium",
  );
  process.exit(1);
}

const EIGEN = "/opt/pw-browsers/chromium";
const START = existsSync(EIGEN) ? { executablePath: EIGEN } : {};
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".webp": "image/webp", ".png": "image/png",
  ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon",
};

// De eigenschappen waar het misgaan ook echt te zien is. Breder maken kan,
// maar elke eigenschap kost een herberekening per element.
const LETTEN_OP = [
  "font-size", "color", "background-color", "font-weight",
  "text-transform", "letter-spacing", "line-height",
];

const browser = await chromium.launch(START);
let totaal = 0;

for (const site of TE_DOEN) {
  const root = join(WORTEL, "sites", site);
  if (!existsSync(root)) { console.error(`Onbekende site: ${site}`); totaal++; continue; }

  const srv = createServer((q, r) => {
    const pad = join(root, decodeURIComponent(q.url.split("?")[0]));
    if (!pad.startsWith(root) || !existsSync(pad) || pad.endsWith("/")) { r.writeHead(404).end(); return; }
    r.writeHead(200, { "Content-Type": TYPES[extname(pad)] || "application/octet-stream" });
    r.end(readFileSync(pad));
  });
  await new Promise((r) => srv.listen(0, r));
  const poort = srv.address().port;

  // sleutel -> { raakt: aantal keer dat de selector iets raakte,
  //              leeft: aantal keer dat wegnemen verschil maakte }
  const boek = new Map();

  /* Declaraties waarvan we al gezien hebben dat ze ergens winnen.
   *
   * Het oordeel verderop is `overruled === raakt`: alleen wat op élke pagina en
   * élke breedte verliest wordt gemeld. Eén keer winnen sluit een declaratie
   * dus definitief uit, en dan is verder meten verspilling - en niet zo'n
   * beetje ook. Elke meting zet `!important` op de regel, leest de uitkomst
   * terug en zet hem weer terug; dat zijn twee volledige stijlherberekeningen
   * van het hele document per declaratie per pagina.
   *
   * Op zichzelf scheelt dat een vijfde van de looptijd (300 naar 247 seconden
   * gemeten over de drie sites); het grootste deel zat in het laden van de
   * pagina's, en dat lost de lus hieronder op. Wat er in de melding komt
   * verandert er niet van. Een dode declaratie wint nergens, wordt dus nooit
   * overgeslagen, en houdt zijn volledige telling "(op N pagina/breedte)";
   * `boek.size` klopt ook nog, want een declaratie staat in het boek vanaf de
   * eerste pagina waar hij voorkomt. */
  const leeft = new Set();

  const breedtes = breedtesVan(root);
  for (const [, pad] of paginasVan(root)) {
    if (!existsSync(join(root, pad))) continue;
    /* Eén pagina, zeven breedtes.
     *
     * Hier stond een `browser.newPage()` per breedte, en dus zeven keer laden
     * van dezelfde pagina: 238 laadbeurten voor de drie sites, waarvan er 204
     * hetzelfde document opnieuw ophaalden. Een mediaquery reageert gewoon op
     * `setViewportSize`, daar is geen nieuw document voor nodig.
     *
     * Dat mag alleen omdat de meting hieronder zijn eigen rommel opruimt: elke
     * declaratie die even `!important` krijgt, wordt meteen daarna op zijn
     * oorspronkelijke voorrang teruggezet. Zou dat niet kloppen, dan sleepte de
     * ene breedte zijn wijzigingen mee naar de volgende - en dan meet je je
     * eigen vorige meting.
     *
     * Samen met de overslag hierboven: 300 seconden voor de drie sites, nu 110,
     * met woord voor woord dezelfde uitkomst (329, 263 en 303 declaraties, alle
     * drie schoon). Nagemeten door een regel toe te voegen die gegarandeerd
     * verliest - `body { color: rgb(1, 2, 3) }` onderaan de stylesheet - en te
     * kijken of hij nog gemeld wordt. Dat werd hij, op 70 pagina/breedte, wat
     * ook klopt met tien pagina's maal zeven breedtes. */
    const page = await browser.newPage({ viewport: { width: breedtes[0], height: 900 } });
    await page.goto(`http://127.0.0.1:${poort}${pad}`, { waitUntil: "networkidle" });
    for (const breed of breedtes) {
      await page.setViewportSize({ width: breed, height: 900 });
      // Even laten zetten: een mediaquery herberekent direct, maar lettertypen
      // en lui geladen beelden hebben een tel nodig voordat de layout stilstaat.
      await page.waitForTimeout(300);

      const uit = await page.evaluate(([props, alGezien]) => {
        const overslaan = new Set(alGezien);
        // Toestand-pseudo's en pseudo-elementen kun je niet los meten; die
        // slaan we over in plaats van er een slag naar te slaan.
        const ONMEETBAAR = /::|:hover|:focus|:active|:visited|:target|:disabled|:checked|:placeholder|:required|:invalid|:valid|:in-range|:indeterminate|:default|:autofill/;

        const regels = [];
        const verzamel = (blad, media) => {
          let lijst;
          try { lijst = blad.cssRules; } catch { return; }
          for (const r of lijst) {
            if (r.type === CSSRule.IMPORT_RULE && r.styleSheet) { verzamel(r.styleSheet, media); continue; }
            if (r.type === CSSRule.MEDIA_RULE) {
              const t = r.conditionText || r.media.mediaText;
              // Geldt deze mediaquery hier helemaal niet, dan zegt hij niets
              // over deze breedte; @media print valt hier ook af.
              if (!window.matchMedia(t).matches) continue;
              verzamel(r, media ? `${media} en ${t}` : t);
              continue;
            }
            if (r.type === CSSRule.SUPPORTS_RULE) { verzamel(r, media); continue; }
            if (r.type !== CSSRule.STYLE_RULE) continue;
            regels.push({ regel: r, media });
          }
        };
        for (const blad of document.styleSheets) verzamel(blad, "");

        const resultaat = [];
        for (const { regel, media } of regels) {
          const kies = regel.selectorText;
          if (!kies || ONMEETBAAR.test(kies)) continue;

          let els;
          try { els = [...document.querySelectorAll(kies)]; } catch { continue; }
          els = els.filter((e) => e.checkVisibility && e.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true }));
          if (!els.length) continue;
          if (els.length > 30) els = els.slice(0, 30);

          for (const prop of props) {
            const waarde = regel.style.getPropertyValue(prop);
            if (!waarde) continue;
            const sleutel = `${kies} { ${prop}: ${waarde} }${media ? `   @media ${media}` : ""}`;
            // Deze won elders al; meten kan het oordeel niet meer veranderen.
            if (overslaan.has(sleutel)) continue;
            const voorrang = regel.style.getPropertyPriority(prop);

            /* Niet: "verandert er iets als ik hem weghaal" - dan meld je ook
               elke declaratie die toevallig hetzelfde zegt als de winnaar, en
               dat is geen fout maar een dubbeling. Wel: "krijgt hij zijn zin
               als ik hem laat winnen". Verandert de uitkomst dan, dan werd hij
               overruled en staat er iets anders op het scherm dan er in de
               stylesheet staat. */
            const voor = els.map((e) => getComputedStyle(e).getPropertyValue(prop));
            regel.style.setProperty(prop, waarde, "important");
            const na = els.map((e) => getComputedStyle(e).getPropertyValue(prop));
            regel.style.setProperty(prop, waarde, voorrang);

            /* Elk element, niet zomaar één. Een basisregel met een modifier
               ernaast (.knop en .knop.secundair) verliest bij een deel van de
               elementen, en dat is precies waar modifiers voor zijn. Alleen
               als de declaratie bij álle elementen verliest, doet hij nergens
               iets. */
            const overruled = voor.length > 0 && voor.every((v, i) => v !== na[i]);
            resultaat.push({
              sleutel,
              overruled,
              werd: voor[0],
              bedoeld: na[0],
            });
          }
        }
        return resultaat;
      }, [LETTEN_OP, [...leeft]]);

      for (const r of uit) {
        const b = boek.get(r.sleutel) || { raakt: 0, overruled: 0, werd: r.werd, bedoeld: r.bedoeld };
        b.raakt++;
        if (r.overruled) { b.overruled++; b.werd = r.werd; b.bedoeld = r.bedoeld; }
        else leeft.add(r.sleutel);
        boek.set(r.sleutel, b);
      }
    }
    await page.close();
  }
  srv.close();

  /* Alleen melden wat overal verliest. Een basisregel die op een telefoon
     door een mediaquery wordt overschreven hoort daar niet bij: die wint op
     de breedte waarvoor hij geschreven is, en dat is de bedoeling. */
  const dood = [...boek.entries()].filter(([, b]) => b.raakt && b.overruled === b.raakt).sort();
  console.log(`\n=== ${site}`);
  if (!dood.length) {
    console.log(`  schoon: van de ${boek.size} gemeten declaraties krijgen ze allemaal ergens hun zin.`);
  } else {
    console.log(`  ${dood.length} van de ${boek.size} declaraties worden overal overruled:`);
    for (const [sleutel, b] of dood) {
      console.log(`      ${sleutel}`);
      console.log(`         bedoeld: ${b.bedoeld}   maar het wordt: ${b.werd}   (op ${b.raakt} pagina/breedte)`);
    }
  }
  totaal += dood.length;
}

await browser.close();

if (totaal) {
  console.error(`\n${totaal} declaratie(s) staan er wel maar doen niets. Weghalen, of specifieker maken zodat ze winnen.`);
  process.exit(1);
}
console.log(`\nGeen dode declaraties: ${TE_DOEN.length} site(s).`);
