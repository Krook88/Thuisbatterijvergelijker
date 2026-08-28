/**
 * Productfoto's ophalen bij de fabrikant en bij de winkels die het verkopen.
 *
 * Waarom dit bestaat: van de 85 productpagina's op de drie sites hebben er 58
 * geen afbeelding, en zonder afbeelding toont Google geen productresultaat. De
 * rest van de markup is compleet - naam, merk, breadcrumbs, prijs, beschikbaar-
 * heid - en levert zonder die ene foto niets op. Dat is niet te zien aan de
 * pagina, want die werkt gewoon, en het staat sinds kort als signaal in
 * scripts/zoekmachine.mjs.
 *
 * 57 van die 58 producten hebben een `product_url` naar de fabrikant. Daar
 * staat vrijwel altijd een productfoto op, en die mag met bronvermelding
 * getoond worden; sites/batterijmaatje/README.md legt dat veld (`afbeelding_bron`)
 * al vast voor de 27 foto's die er wel zijn.
 *
 * Twee dingen die dit script met opzet niet doet.
 *
 * Het kiest niet zelf welke foto goed genoeg is. Een og:image is bij de ene
 * fabrikant een strakke productfoto op wit en bij de andere een sfeerbeeld van
 * een gezin op de bank. Het script haalt op, zet om en zegt erbij via welke
 * weg het beeld gevonden is; daarna kijkt een mens ernaar. Een verkeerde foto
 * bij een warmtepomp is erger dan geen foto.
 *
 * En het duwt niets naar de hoofdtak. De werkstroom eromheen commit naar een
 * eigen tak, zodat er niets live staat voordat iemand de 58 beelden gezien
 * heeft.
 *
 *   node scripts/productfotos.mjs [--site <naam>] [--alleen id,id] [--droog]
 *
 * Draaien doe je het via de werkstroom "Productfoto's ophalen": deze omgeving
 * komt niet bij fabrikantsites, want de egress-proxy laat alleen npm en pypi
 * door.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { haalPagina, haalMetBrowser, sluitBrowser } from "../kern/scripts/prijs-uitlezen.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* Elke site bewaart zijn producten net iets anders. */
const SITES = [
  { site: "batterijmaatje", bestand: "batterijen.json", sleutel: "batterijen" },
  { site: "zonnestroommaatje", bestand: "panelen.json", sleutel: "panelen" },
  { site: "zonnestroommaatje", bestand: "omvormers.json", sleutel: "omvormers" },
  { site: "warmtepompmaatje", bestand: "warmtepompen.json", sleutel: "warmtepompen" },
];

// Dezelfde maat als de 27 foto's die er al staan: ongeveer 900 pixels breed,
// gemiddeld 19 kB. Boven de bovengrens klopt er iets niet en slaan we hem over.
const BREEDTE = 900;
const KWALITEIT = 82;
const MAX_BYTES = 300 * 1024;

const argv = process.argv.slice(2);
const vlag = (naam) => {
  const i = argv.indexOf(naam);
  return i >= 0 ? argv[i + 1] : null;
};
const DROOG = argv.includes("--droog");
const ALLEEN_SITE = vlag("--site");
const ALLEEN = (vlag("--alleen") || "").split(",").map((s) => s.trim()).filter(Boolean);

/* ------------------------------------------------------------------
   Kandidaten uit een pagina halen

   Op volgorde van hoe waarschijnlijk het het product zelf is. De structured
   data van een webshop wijst het product aan; og:image is wat de fabrikant
   zelf als visitekaartje kiest, en dat is meestal maar niet altijd het product.
   ------------------------------------------------------------------ */

const BEELDSOORTEN = /\.(jpe?g|png|webp)(\?|#|$)/i;

/* Adressen die nooit het product zijn, hoe ze ook binnenkomen.
 *
 * Dit stond eerst alleen op de gewone <img>-tags, en dat was te weinig: juist
 * de logo's kwamen binnen via og:image, waar het filter niet langs kwam. De
 * eerste droge run over 70 producten koos daardoor nibe-logga-200.jpg voor de
 * NIBE, logo-lg-100-44.jpg voor de LG en logo-square-letter.png voor de
 * Samsung. Een fabrikant zet in og:image zijn merk, niet zijn product. */
// Let op de scheidingstekens: het adres wordt eerst gedecodeerd, dus "%20"
// is dan een spatie. Met [-_%20] stond die spatie er niet bij, en glipte
// "social share weheat.jpg" er alsnog doorheen.
const NOOIT = /logo|logga|icon|sprite|avatar|badge|placeholder|og[-_ ]?image|og[-_ ]?thumb|social[^a-z0-9]{0,3}share|share[^a-z0-9]{0,3}image|banner/i;

/* Beeld dat een machine heeft verzonnen.
 *
 * Thuisbatterij Nederland zette bij de Tesla Powerwall 3 een bestand met de
 * naam ChatGPT-Image-7-mei-2026-11_47_05-1.png. Op een contactvel ziet dat
 * eruit als een keurige productfoto, en dat is precies het probleem: het is
 * geen foto van dit apparaat maar een tekening van iets wat erop lijkt. Een
 * site die zijn prijzen bij de winkel natelt, kan geen verzonnen product tonen.
 * De bestandsnaam is het enige wat het verraadt. */
const VERZONNEN = /chatgpt|dall[-_ ]?e|midjourney|stable[-_ ]?diffusion|ai[-_ ]?generated|generated[-_ ]?image|firefly/i;

/* Woorden uit de productnaam die op een bestandsnaam kunnen staan. Merk en
 * model zonder de maten en de eenheden, want "10" en "kWh" staan overal. */
export function naamDelen(naam) {
  return String(naam || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 4 && !/^\d+$/.test(w));
}

/* Hoeveel van die woorden in het adres terugkomen. Een bestandsnaam als
 * "elga-ace-hybride-warmtepomp-remeha_1.png" noemt het product; een
 * "Header_Desktop_1440x360.jpg" noemt het niet. Dat is het verschil tussen de
 * foto van dit apparaat en de foto van de pagina waar hij op staat. */
export function naamScore(url, delen) {
  const kaal = decodeURIComponent(String(url)).toLowerCase();
  return delen.filter((w) => kaal.includes(w)).length;
}

/* Twee woordenlijsten die de naam niet kan vervangen.
 *
 * Bij Itho stonden er twee beelden in de structured data die allebei "Vincent"
 * heten: een campagne-illustratie en de echte packshot. De productnaam maakt
 * daar geen verschil, de bestandsnaam wel. Deze woorden komen uit wat de eerste
 * droge run over 70 fabrikantpagina's opleverde, niet uit een aanname:
 * "03_Packshot_EHBX_3-4_FRONT.jpg" bij Daikin tegenover
 * "wolf_ambiente_cha-monoblock.jpg" bij Wolf en "lifestyle-terrace" bij
 * Viessmann. */
const WIJST_OP_PRODUCT = /packshot|product|vooraanzicht|front|render/i;
const WIJST_OP_SFEER = /campagne|campaign|illu|lifestyle|sfeer|ambiente|header|hero|promo|menu|academy|woningbouw/i;

/** De volgorde waarin we kandidaten aanbieden. Hoger is waarschijnlijker. */
export function beeldScore(url, delen) {
  const kaal = decodeURIComponent(String(url)).toLowerCase();
  return naamScore(url, delen)
    + (WIJST_OP_PRODUCT.test(kaal) ? 1 : 0)
    - (WIJST_OP_SFEER.test(kaal) ? 1 : 0);
}

/** Maakt een adres absoluut ten opzichte van de pagina waar het op stond. */
export function absoluut(adres, basis) {
  // Een leeg adres lost met new URL op naar de pagina zelf, en dat is geen
  // afbeelding maar een pagina. Zonder deze regel wordt <meta content="">
  // een kandidaat die pas verderop struikelt.
  if (!adres) return null;
  try {
    return new URL(adres, basis).href;
  } catch {
    return null;
  }
}

/**
 * Alle beeldadressen die deze pagina aandraagt, met de weg waarlangs.
 * Geen oordeel over welke de goede is; dat blijft mensenwerk.
 */
export function afbeeldingKandidaten(html, basis, naam = "") {
  const uit = [];
  const delen = naamDelen(naam);
  const voegToe = (adres, hoe) => {
    const url = absoluut(String(adres || "").trim(), basis);
    if (!url || !/^https?:/i.test(url)) return;
    if (!BEELDSOORTEN.test(url)) return;
    const leesbaar = decodeURIComponent(url);
    if (NOOIT.test(leesbaar) || VERZONNEN.test(leesbaar)) return;
    if (uit.some((k) => k.url === url)) return;
    uit.push({ url, hoe, score: beeldScore(url, delen) });
  };

  for (const m of String(html).matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    let blok;
    try { blok = JSON.parse(m[1]); } catch { continue; }
    const rij = Array.isArray(blok) ? blok : [blok];
    for (const o of rij) {
      if (!o || o["@type"] !== "Product" || !o.image) continue;
      for (const beeld of [].concat(o.image)) {
        voegToe(typeof beeld === "string" ? beeld : beeld && beeld.url, "structured data");
      }
    }
  }

  const meta = (naam, hoe) => {
    for (const m of String(html).matchAll(
      new RegExp(`<meta[^>]+(?:property|name)=["']${naam}["'][^>]*>`, "gi"))) {
      const inhoud = /content=["']([^"']+)["']/i.exec(m[0]);
      if (inhoud) voegToe(inhoud[1], hoe);
    }
  };
  meta("og:image", "og:image");
  meta("twitter:image", "twitter:image");

  for (const m of String(html).matchAll(/<link[^>]+rel=["']image_src["'][^>]*>/gi)) {
    const href = /href=["']([^"']+)["']/i.exec(m[0]);
    if (href) voegToe(href[1], "link image_src");
  }

  // Als laatste de gewone afbeeldingen op de pagina. Hier kijkt het filter naar
  // de hele tag en niet alleen naar het adres, want "alt=Logo Bosch" verraadt
  // een logo dat toevallig een nietszeggende bestandsnaam heeft.
  for (const m of String(html).matchAll(/<img\s[^>]*>/gi)) {
    const src = /\ssrc=["']([^"']+)["']/i.exec(m[0]);
    if (!src) continue;
    if (NOOIT.test(m[0])) continue;
    voegToe(src[1], "img op de pagina");
  }

  /* Een adres dat het product bij naam noemt gaat voor op de volgorde van de
     wegen. Zonder dat won bij Itho de campagne-illustratie het van
     "Vincent_Front_Schaduw_1200x1200px.jpg", die er vlak achter stond. Bij
     gelijke stand blijft de oorspronkelijke volgorde staan, want structured
     data wijst het product aan en og:image is de keuze van de fabrikant. */
  return uit
    .map((k, i) => ({ ...k, plek: i }))
    .sort((a, b) => b.score - a.score || a.plek - b.plek)
    .map(({ plek, ...k }) => k);
}

/* Waar we mogen kijken, op volgorde.
 *
 * Eerst de fabrikant, want die toont zijn eigen product. Daarna de winkels die
 * het verkopen, en dat is vaak de betere bron: een webshop heeft een strakke
 * productfoto nodig om iets te verkopen, waar een fabrikantpagina een
 * merkverhaal vertelt. Van de 51 producten die na de eerste ronde nog zonder
 * foto zaten hebben er 42 minstens één winkel-URL, en die adressen bezoeken we
 * toch al elke dag voor de prijzen.
 *
 * Aanbiedingen die de winkel niet meer voert doen niet mee: daar staat het
 * artikel niet meer op de pagina. */
export function bronPaginas(p) {
  const uit = [];
  const voegToe = (url, naam) => {
    if (!url || !/^https?:/i.test(url)) return;
    if (uit.some((b) => b.url === url)) return;
    uit.push({ url, naam });
  };
  voegToe(p.product_url, "de fabrikant");
  for (const a of p.aanbiedingen || []) {
    if (a && !a.niet_leverbaar) voegToe(a.url, a.winkel || "een winkel");
  }
  return uit;
}

/* ------------------------------------------------------------------
   Omzetten naar webp
   ------------------------------------------------------------------ */

function omzetter() {
  for (const naam of ["cwebp"]) {
    try {
      execFileSync(naam, ["-version"], { stdio: "ignore" });
      return naam;
    } catch { /* volgende */ }
  }
  return null;
}

async function haalBeeld(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 ThuisbatterijVergelijker-fotocheck/1.0", "Accept": "image/*" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/* ------------------------------------------------------------------ */

async function main() {
  const werktuig = omzetter();
  if (!werktuig && !DROOG) {
    console.error("cwebp ontbreekt, dus er valt niets om te zetten. In de werkstroom staat een stap die hem installeert.");
    process.exit(2);
  }
  console.log(`Omzetter: ${werktuig || "geen (droge run)"}\n`);

  let opgehaald = 0, overgeslagen = 0, mislukt = 0;

  for (const { site, bestand, sleutel } of SITES) {
    if (ALLEEN_SITE && site !== ALLEEN_SITE) continue;
    const pad = join(ROOT, "sites", site, "data", bestand);
    if (!existsSync(pad)) continue;
    const data = JSON.parse(readFileSync(pad, "utf8"));
    const producten = data[sleutel] || [];
    let gewijzigd = false;

    console.log(`=== ${site}/${sleutel}`);
    for (const p of producten) {
      if (p.afbeelding) continue;
      if (ALLEEN.length && !ALLEEN.includes(p.id)) continue;

      const bronnen = bronPaginas(p);
      if (!bronnen.length) {
        console.log(`  - ${p.id}: geen adres om te bezoeken`);
        overgeslagen++;
        continue;
      }

      const productNaam = `${p.merk || ""} ${p.model || ""} ${p.voorbeeld_variant || ""}`.trim();
      let kandidaten = [];
      let bezocht = 0;
      let laatsteFout = null;
      for (const bron of bronnen) {
        let html;
        try {
          html = await haalPagina(bron.url);
        } catch (err) {
          html = await haalMetBrowser(bron.url).catch(() => null);
          if (!html) { laatsteFout = err.message; continue; }
        }
        bezocht++;
        const gevonden = afbeeldingKandidaten(html, bron.url, productNaam)
          .map((k) => ({ ...k, bron: bron.naam }));
        kandidaten = kandidaten.concat(gevonden);
        // Een treffer op de productnaam is goed genoeg om te stoppen. Zonder
        // die grens bezoeken we voor elk product vier winkels, en dan duurt de
        // ronde langer dan de dagelijkse prijsrun.
        if (gevonden.some((k) => k.score > 0)) break;
      }
      kandidaten.sort((a, b) => b.score - a.score);

      if (!kandidaten.length) {
        console.log(`  x ${p.id}: geen bruikbaar beeld op ${bezocht} van de ${bronnen.length} pagina(s)${laatsteFout ? ` (laatste fout: ${laatsteFout})` : ""}`);
        mislukt++;
        continue;
      }
      const keuze = kandidaten[0];
      console.log(`  ? ${p.id}: ${kandidaten.length} kandidaat(en) van ${bezocht} pagina(s), eerste via ${keuze.hoe} bij ${keuze.bron} (naamtreffers ${keuze.score})`);
      console.log(`      ${keuze.url}`);
      for (const k of kandidaten.slice(1, 4)) console.log(`      (ook: ${k.hoe} bij ${k.bron} ${k.url})`);

      if (DROOG) { opgehaald++; continue; }

      try {
        const rauw = await haalBeeld(keuze.url);
        const tijdelijk = join(tmpdir(), `foto-${p.id}`);
        writeFileSync(tijdelijk, rauw);
        const map = join(ROOT, "sites", site, "assets", "producten");
        mkdirSync(map, { recursive: true });
        const doel = join(map, `${p.id}.webp`);
        execFileSync(werktuig, ["-quiet", "-q", String(KWALITEIT), "-resize", String(BREEDTE), "0", tijdelijk, "-o", doel]);
        const grootte = readFileSync(doel).length;
        if (!grootte || grootte > MAX_BYTES) {
          console.log(`      omgezet bestand is ${Math.round(grootte / 1024)} kB, dat is niet in orde; overgeslagen`);
          mislukt++;
          continue;
        }
        p.afbeelding = `assets/producten/${p.id}.webp`;
        p.afbeelding_bron = `foto: ${p.merk || "fabrikant"}`;
        p.afbeelding_herkomst = keuze.url;
        gewijzigd = true;
        opgehaald++;
        console.log(`      ✓ ${Math.round(grootte / 1024)} kB weggeschreven naar ${p.afbeelding}`);
      } catch (err) {
        console.log(`      beeld niet op te halen of om te zetten: ${err.message}`);
        mislukt++;
      }
    }

    if (gewijzigd && !DROOG) {
      writeFileSync(pad, JSON.stringify(data, null, 2) + "\n", "utf8");
      console.log(`  ${bestand} bijgewerkt`);
    }
  }

  await sluitBrowser();
  console.log(`\n${opgehaald} opgehaald, ${overgeslagen} overgeslagen, ${mislukt} niet gelukt.`);
  console.log("Kijk de foto's na voordat er iets live gaat; een sfeerbeeld is geen productfoto.");
}

/* Alleen draaien als je dit bestand zelf aanroept. Zonder deze grens haalt de
   proef hieronder bij het importeren meteen achtenvijftig fabrikantsites op. */
if (resolve(process.argv[1] || "") === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
