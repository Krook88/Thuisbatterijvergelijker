#!/usr/bin/env node
/**
 * Controleert wat een zoekmachine van deze sites te zien krijgt.
 *
 * Waarom dit bestaat: de titels en omschrijvingen stonden op twee van de drie
 * sites ver buiten wat Google toont - 67 titels tot 103 tekens, 63
 * omschrijvingen tot 232 - en van de zestig offers in de productmarkup had er
 * geen enkele een houdbaarheidsdatum. Dat is allemaal met de hand rechtgezet,
 * en zonder controle zakt het net zo geruisloos weer terug als het gekomen is.
 * Een generator die een zin een half woord langer maakt, een nieuwe pagina
 * zonder canonical: niemand ziet het, want de pagina werkt gewoon.
 *
 * Wat hij nakijkt, en waarom dat precies deze dingen zijn:
 *
 *   titel <= 60 tekens        daarboven kapt Google af
 *   omschrijving <= 155       idem
 *   canonical aanwezig        anders concurreren varianten van dezelfde pagina
 *   JSON-LD geldig            één komma verkeerd en het hele blok telt niet mee
 *   offers compleet           zonder availability geen beschikbaarheid in het
 *                             resultaat, zonder priceValidUntil laat Google de
 *                             prijs weg zodra die datum verstreken is
 *   priceValidUntil vooruit   een datum in het verleden is erger dan geen datum
 *   sitemap klopt             elke URL bestaat, elke pagina staat erin
 *   afbeeldingen met alt      voor voorlezers en voor afbeeldingzoeken
 *
 * Gebruik:
 *   node scripts/zoekmachine.mjs             rapport
 *   node scripts/zoekmachine.mjs --streng    foutcode bij een bevinding
 */

import { readFileSync, readdirSync, statSync, existsSync, appendFileSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STRENG = process.argv.includes("--streng");

const TITEL_MAX = 60;
const OMSCHRIJVING_MAX = 155;

// 404.html hoort niet in de sitemap en heeft geen canonical nodig: die pagina
// wordt nooit als resultaat getoond.
const GEEN_INDEX = new Set(["404.html"]);

function htmlIn(map, basis = map, uit = []) {
  for (const naam of readdirSync(map)) {
    if (naam === "node_modules" || naam.startsWith(".")) continue;
    const pad = join(map, naam);
    if (statSync(pad).isDirectory()) htmlIn(pad, basis, uit);
    else if (naam.endsWith(".html")) uit.push(relative(basis, pad));
  }
  return uit;
}

const pak = (h, re) => { const m = h.match(re); return m ? m[1].replace(/\s+/g, " ").trim() : null; };

let bevindingen = 0;
const vandaag = new Date().toISOString().slice(0, 10);

for (const site of readdirSync(resolve(ROOT, "sites"))) {
  const siteMap = resolve(ROOT, "sites", site);
  if (!existsSync(siteMap) || !statSync(siteMap).isDirectory()) continue;
  const meldingen = [];
  const paginas = htmlIn(siteMap).sort();
  const noindex = new Set();
  // Twee tellingen, geen meldingen. Zie de uitleg onder de lus.
  const producten = { totaal: 0, zonderAfbeelding: [], zonderPrijs: [] };

  for (const f of paginas) {
    const h = readFileSync(join(siteMap, f), "utf8");
    const meld = (tekst) => meldingen.push(`  ${f}: ${tekst}`);
    if (/<meta[^>]+name="robots"[^>]*content="[^"]*noindex/i.test(h)) noindex.add(f);

    const titel = pak(h, /<title>([\s\S]*?)<\/title>/i);
    const omschrijving = pak(h, /<meta name="description" content="([^"]*)"/i);
    if (!titel) meld("geen <title>");
    else if (titel.length > TITEL_MAX) meld(`titel ${titel.length} tekens (max ${TITEL_MAX}): "${titel.slice(0, 70)}…"`);
    if (!omschrijving && !GEEN_INDEX.has(f)) meld("geen meta description");
    else if (omschrijving && omschrijving.length > OMSCHRIJVING_MAX) meld(`omschrijving ${omschrijving.length} tekens (max ${OMSCHRIJVING_MAX})`);
    if (!GEEN_INDEX.has(f) && !/rel="canonical"/.test(h)) meld("geen canonical");

    for (const img of h.matchAll(/<img\s[^>]*>/gi)) {
      if (!/\salt=/.test(img[0])) meld(`afbeelding zonder alt: ${img[0].slice(0, 60)}…`);
    }

    for (const m of h.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
      let blok;
      try { blok = JSON.parse(m[1]); } catch (e) { meld(`JSON-LD niet te lezen: ${e.message.slice(0, 60)}`); continue; }
      for (const o of (Array.isArray(blok) ? blok : [blok])) {
        if (o["@type"] !== "Product") continue;
        producten.totaal++;
        if (!o.image) producten.zonderAfbeelding.push(o.name || f);
        if (!o.offers) producten.zonderPrijs.push(o.name || f);
        if (!o.offers) continue;
        const aanbod = o.offers;
        if (!aanbod.availability) meld(`Product zonder availability: ${o.name || "?"}`);
        // Ontbreekt de houdbaarheidsdatum, dan is de prijs zelf te oud: de
        // generator laat een verstreken datum weg omdat Google de prijs anders
        // actief negeert. De oorzaak staat in het rapport van verse-data.mjs,
        // maar het gevolg hoort hier: zonder die datum geen prijs in het
        // zoekresultaat.
        if (!aanbod.priceValidUntil) meld(`geen prijs in het zoekresultaat, de prijs is te oud: ${o.name || "?"}`);
        else if (aanbod.priceValidUntil < vandaag) meld(`priceValidUntil is verlopen (${aanbod.priceValidUntil}): ${o.name || "?"}`);
      }
    }
  }

  // Sitemap en werkelijkheid tegen elkaar: een URL die nergens heen gaat kost
  // vertrouwen bij de zoekmachine, een pagina die er niet in staat wordt later
  // of niet gevonden.
  const sitemapPad = join(siteMap, "sitemap.xml");
  if (existsSync(sitemapPad)) {
    const xml = readFileSync(sitemapPad, "utf8");
    const paden = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
      .map((m) => m[1].replace(/^https?:\/\/[^/]+/, "").replace(/^\//, ""))
      .map((p) => (p === "" ? "index.html" : p));
    for (const p of paden) {
      if (!existsSync(join(siteMap, p))) meldingen.push(`  sitemap verwijst naar een bestand dat niet bestaat: ${p}`);
    }
    const inSitemap = new Set(paden);
    for (const f of paginas) {
      if (GEEN_INDEX.has(f)) continue;
      const alsIndex = f === "index.html" ? "index.html" : f;
      if (!inSitemap.has(alsIndex)) meldingen.push(`  staat niet in de sitemap: ${f}`);
    }
    // Een pagina op noindex die wél in de sitemap staat zegt twee dingen
    // tegelijk: "kom hier kijken" en "neem me niet op". Google volgt de
    // noindex en houdt de tegenspraak over. Zonnestroommaatje zette contact en
    // privacy op noindex terwijl de andere twee sites diezelfde pagina's
    // gewoon laten indexeren, en alle drie staan ze in de sitemap. Wat de
    // keuze ook wordt: hij hoort op beide plekken hetzelfde te zijn.
    for (const f of noindex) {
      if (GEEN_INDEX.has(f)) continue;
      if (inSitemap.has(f)) meldingen.push(`  staat op noindex maar wel in de sitemap: ${f}`);
    }
  } else {
    meldingen.push("  geen sitemap.xml");
  }

  console.log(`\n${site}: ${paginas.length} pagina's, ${meldingen.length} bevinding(en)`);
  for (const r of meldingen.slice(0, 25)) console.log(r);
  if (meldingen.length > 25) console.log(`  ... en nog ${meldingen.length - 25}`);
  bevindingen += meldingen.length;

  /* Twee signalen, en met opzet geen meldingen: ze laten de run niet vallen en
     ze tellen niet mee in het aantal bevindingen. Wat eraan mankeert is namelijk
     niet met een regel code te herstellen - er moet een foto komen of een winkel
     - en een controle die meteen achtenvijftig regels afdrukt is er een die je
     wegklikt. Dat staat in SCHRIJFWIJZE.md over de tekstcontrole en het geldt
     hier net zo goed.

     Waarom ze er dan staan: Google toont een productresultaat - de foto, de
     prijs, de beschikbaarheid naast het blauwe linkje - alleen als de markup
     een image heeft. Zonder afbeelding is de hele Product-markup op zo'n
     pagina er wel, maar hij levert niets op. Dat is niet te zien aan de
     pagina, want die werkt gewoon, en het is precies het soort scheefgroei dat
     de rest van dit script ook bewaakt. Een getal dat elke run meeloopt maakt
     het verschil tussen "we weten het" en "we komen er nog eens aan toe". */
  if (producten.totaal) {
    const deel = (lijst) => `${lijst.length} van de ${producten.totaal}`;
    if (producten.zonderAfbeelding.length) {
      console.log(`  signaal: ${deel(producten.zonderAfbeelding)} productpagina's hebben geen image in de markup en komen dus niet in aanmerking voor een productresultaat.`);
      console.log(`           ${producten.zonderAfbeelding.slice(0, 3).join("; ")}${producten.zonderAfbeelding.length > 3 ? "; …" : ""}`);
    }
    if (producten.zonderPrijs.length) {
      console.log(`  signaal: ${deel(producten.zonderPrijs)} productpagina's dragen geen offers, want er hoort geen winkelaanbieding bij - alleen een richtprijs.`);
    }
  }
}

console.log(bevindingen
  ? `\n${bevindingen} bevinding(en).`
  : "\nAlles wat een zoekmachine ziet is in orde.");

if (bevindingen && process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### Zoekmachine: ${bevindingen} bevinding(en)\n\nZie scripts/zoekmachine.mjs.\n\n`);
}

if (STRENG && bevindingen) process.exit(1);
