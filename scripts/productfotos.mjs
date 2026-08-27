/**
 * Productfoto's ophalen bij de fabrikant.
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
export function afbeeldingKandidaten(html, basis) {
  const uit = [];
  const voegToe = (adres, hoe) => {
    const url = absoluut(String(adres || "").trim(), basis);
    if (!url || !/^https?:/i.test(url)) return;
    if (!BEELDSOORTEN.test(url)) return;
    if (uit.some((k) => k.url === url)) return;
    uit.push({ url, hoe });
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

  // Als laatste de gewone afbeeldingen op de pagina. Logo's en pictogrammen
  // eruit: die halen het nooit, en ze staan wel altijd bovenaan.
  for (const m of String(html).matchAll(/<img\s[^>]*>/gi)) {
    const src = /\ssrc=["']([^"']+)["']/i.exec(m[0]);
    if (!src) continue;
    if (/logo|icon|sprite|avatar|badge|placeholder/i.test(m[0])) continue;
    voegToe(src[1], "img op de pagina");
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
      if (!p.product_url) {
        console.log(`  - ${p.id}: geen product_url, hier valt niets te halen`);
        overgeslagen++;
        continue;
      }

      let html;
      try {
        html = await haalPagina(p.product_url);
      } catch (err) {
        html = await haalMetBrowser(p.product_url).catch(() => null);
        if (!html) {
          console.log(`  x ${p.id}: pagina niet op te halen (${err.message})`);
          mislukt++;
          continue;
        }
      }

      const kandidaten = afbeeldingKandidaten(html, p.product_url);
      if (!kandidaten.length) {
        console.log(`  x ${p.id}: geen bruikbaar beeld op ${p.product_url}`);
        mislukt++;
        continue;
      }
      const keuze = kandidaten[0];
      console.log(`  ? ${p.id}: ${kandidaten.length} kandidaat(en), eerste via ${keuze.hoe}`);
      console.log(`      ${keuze.url}`);
      for (const k of kandidaten.slice(1, 4)) console.log(`      (ook: ${k.hoe} ${k.url})`);

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
