#!/usr/bin/env node
/**
 * Dagelijkse prijsupdate voor data/warmtepompen.json (Warmtepompmaatje).
 *
 * Voor elke aanbieding (winkel-URL) probeert dit script de actuele prijs van de
 * productpagina te lezen. Hoe dat lezen gaat staat in scripts/prijs-uitlezen.mjs,
 * gedeeld met de andere twee sites; hier staat wat er met de uitkomst gebeurt.
 *
 * In het databestand staat het bedrag zoals de winkel het toont. Veel van deze
 * winkels zijn installateurs- en groothandelsshops die exclusief btw prijzen;
 * dat wordt herkend en vastgelegd met "btw_inbegrepen": false. Het omrekenen
 * naar inclusief btw gebeurt pas bij het tonen, in assets/prijs.js, zodat één
 * plek bepaalt welk bedrag de bezoeker ziet en waarom het afwijkt van de winkel.
 * De plausibiliteitscontrole hieronder vergelijkt wél altijd inclusief btw;
 * anders zou een winkel die overstapt op prijzen zonder btw een "daling" van
 * 21% lijken te tonen.
 *
 * Veiligheidsregels:
 *   - Een nieuwe prijs moet altijd binnen de absolute grenzen voor deze
 *     productgroep vallen, én binnen 40% tot 250% van de laatst bekende prijs.
 *   - Een prijs die ver van de richtprijs af ligt, wordt niet stil overgenomen:
 *     die dekt vrijwel altijd iets anders (alleen de buitenunit, of juist een
 *     set met boiler). Zulke gevallen worden gemeld voor handmatige controle.
 *   - Bij fouten of onduidelijke pagina's blijft de oude prijs staan en wordt
 *     "datum" niet bijgewerkt, zodat zichtbaar blijft hoe vers elke prijs is.
 *   - Het script faalt nooit hard op één winkel: fouten worden gelogd
 *     en de rest gaat door.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { haalPagina, prijsUitPagina } from "./prijs-uitlezen.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Dezelfde prijslogica als de site, zodat de controle hieronder appels met
// appels vergelijkt: altijd inclusief btw, aan beide kanten.
const Prijs = createRequire(import.meta.url)("../assets/prijs.js");

// Per databestand: waar de productlijst staat en welke prijzen geloofwaardig
// zijn. Een hybride warmtepomp begint rond de € 1.500; een all-electric pomp
// met hoge aanvoertemperatuur loopt op tot circa € 16.000 inclusief btw.
const BESTANDEN = [
  { pad: resolve(__dirname, "../data/warmtepompen.json"), lijst: "warmtepompen", min: 1500, max: 16000 },
];

// Btw-tarief op warmtepompen (levering van het losse toestel).
const BTW = 1.21;

// Hoe ver een winkelprijs van de richtprijs mag afliggen voordat we hem
// verdacht vinden. Daaronder dekt de prijs meestal alleen de buitenunit,
// daarboven zit er een boiler of afgifteset in de aanbieding.
const RICHTPRIJS_ONDER = 0.7;
const RICHTPRIJS_BOVEN = 1.4;

const VANDAAG = new Date().toISOString().slice(0, 10);

// Alleen kijken, niets wegschrijven: laat zien welke prijs het script zou
// vinden zonder de gegevens aan te raken. Zo is een wijziging aan het uitlezen
// te controleren voordat hij de site haalt.
const DROOG = process.argv.includes("--droog");

/* ------------------------------------------------------------------
   Bol.com Marketing Catalog API (officiële partnerroute).
   Bol blokkeert gewone scraping (403); met partner-inloggegevens halen
   we prijzen op via de API. Zonder BOL_CLIENT_ID/BOL_CLIENT_SECRET in
   de omgeving wordt dit overgeslagen en blijft de oude prijs staan.
   Auth: https://api.bol.com/marketing/docs/catalog-api/authentication.html
   ------------------------------------------------------------------ */

const BOL_CLIENT_ID = process.env.BOL_CLIENT_ID || "";
const BOL_CLIENT_SECRET = process.env.BOL_CLIENT_SECRET || "";
let bolToken = null;

async function haalBolToken() {
  if (!BOL_CLIENT_ID || !BOL_CLIENT_SECRET) return null;
  if (bolToken) return bolToken;
  const res = await fetch("https://login.bol.com/token?grant_type=client_credentials", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(`${BOL_CLIENT_ID}:${BOL_CLIENT_SECRET}`).toString("base64"),
      "Accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(`bol-token HTTP ${res.status}`);
  bolToken = (await res.json()).access_token;
  return bolToken;
}

// Defensief: vind de eerste plausibele price-waarde in de API-respons,
// zodat kleine wijzigingen in het responsformaat ons niet breken.
//
// De grenzen komen uit het databestand en niet uit een vaste marge: met een
// ondergrens van een paar tientjes pakt deze zoektocht net zo goed de
// verzendkosten of een los accessoire uit de respons als de productprijs.
function zoekPrijsInRespons(obj, grenzen) {
  if (obj == null || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const x of obj) { const p = zoekPrijsInRespons(x, grenzen); if (p) return p; }
    return null;
  }
  if (typeof obj.price === "number" && obj.price >= grenzen.min && obj.price <= grenzen.max) return obj.price;
  for (const k of Object.keys(obj)) {
    const p = zoekPrijsInRespons(obj[k], grenzen);
    if (p) return p;
  }
  return null;
}

async function bolApiPrijs(aanbieding, grenzen) {
  const token = await haalBolToken();
  if (!token) return null;
  // Query en fragment eerst weg: bol-links dragen vaak een ?bltgh=-parameter,
  // en dan staat het product-id niet meer aan het eind van de URL.
  const pad = (aanbieding.url || "").split(/[?#]/)[0];
  const m = pad.match(/\/(\d{8,})\/?$/);
  if (!m) { console.log(`  ~ bol-API: geen product-id herkend in ${aanbieding.url}`); return null; }
  const res = await fetch(`https://api.bol.com/marketing/catalog/v1/products/${m[1]}/offers/best?country-code=NL`, {
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
  });
  if (!res.ok) {
    console.log(`  ~ bol-API ${m[1]}: HTTP ${res.status} (respons kort: ${(await res.text()).slice(0, 120)})`);
    return null;
  }
  const prijs = zoekPrijsInRespons(await res.json(), grenzen);
  // Bol toont consumentenprijzen: altijd inclusief btw.
  return prijs ? { bedrag: Math.round(prijs), btw: "incl" } : null;
}

/**
 * De absolute grenzen gelden altijd, ook als er al een oude prijs staat.
 * Anders kan een prijs met stapjes van 40% per dag onder de ondergrens
 * wegzakken zonder dat één losse controle onplausibel lijkt.
 */
function plausibel(nieuw, oud, grenzen) {
  if (nieuw < grenzen.min || nieuw > grenzen.max) return false;
  if (!oud) return true;
  return nieuw >= oud * 0.4 && nieuw <= oud * 2.5;
}

/* ------------------------------------------------------------------ */

async function updateAanbieding(pomp, aanbieding, grenzen, verdacht) {
  if (!aanbieding.url) return false;
  try {
    let gevonden;
    if (/www\.bol\.com/.test(aanbieding.url) && BOL_CLIENT_ID && BOL_CLIENT_SECRET) {
      gevonden = await bolApiPrijs(aanbieding, grenzen);
    } else {
      const html = await haalPagina(aanbieding.url);
      const uit = prijsUitPagina(html, `${pomp.merk || ""} ${pomp.model || ""}`, grenzen);
      gevonden = uit.prijs ? { bedrag: uit.prijs, btw: uit.btw } : null;
    }
    if (!gevonden) {
      // Een winkel-URL kan alvast vastliggen voordat er ooit een bedrag bij
      // gevonden is; dan is er geen oude prijs om te behouden.
      const staat = typeof aanbieding.prijs_eur === "number"
        ? `oude prijs blijft (€${aanbieding.prijs_eur})`
        : "er staat nog geen prijs bij deze winkel";
      console.log(`  ~ ${pomp.id} @ ${aanbieding.winkel}: geen prijs gevonden, ${staat}`);
      return false;
    }

    // Het databestand bewaart het bedrag zoals de winkel het toont, met
    // btw_inbegrepen erbij. Omrekenen gebeurt bij het tonen, in assets/prijs.js.
    // Zo blijft zichtbaar wat er werkelijk op de productpagina stond, en is er
    // maar één plek waar de btw-regel staat.
    const exclBtw = gevonden.btw === "excl";
    const winkelbedrag = gevonden.bedrag;
    // Vergelijken en controleren gebeurt wel op de prijs inclusief btw, anders
    // wordt een bedrag zonder btw ten onrechte als koopje gezien.
    const nieuw = exclBtw ? Math.round(winkelbedrag * BTW) : winkelbedrag;

    const oudVergelijk = typeof aanbieding.prijs_eur === "number"
      ? (aanbieding.btw_inbegrepen === false ? Math.round(aanbieding.prijs_eur * BTW) : aanbieding.prijs_eur)
      : null;
    if (!plausibel(nieuw, oudVergelijk, grenzen)) {
      console.log(`  ! ${pomp.id} @ ${aanbieding.winkel}: gevonden prijs €${nieuw} niet plausibel t.o.v. €${oudVergelijk}, overgeslagen`);
      return false;
    }

    // Een prijs die ver van de richtprijs ligt, dekt bijna altijd iets anders
    // dan het toestel waar de richtprijs over gaat. Zulke bedragen worden wel
    // opgeslagen, maar ook gemeld zodat iemand ernaar kan kijken.
    //
    // Twee dingen zijn hier belangrijk, want anders is de melding niets waard:
    //
    //   1. Beide kanten via de vergelijkprijs. Deed de winkel het bedrag zonder
    //      btw, dan week het 21% af van de richtprijs zonder dat er iets aan de
    //      hand was - de Mitsubishi werd zo elke dag als "51% van de richtprijs"
    //      gemeld terwijl het in werkelijkheid 72% was.
    //   2. Aanbiedingen met "omvat" overslaan. Daar hebben we zelf al
    //      opgeschreven dat ze iets anders dekken; die elke dag opnieuw melden
    //      maakt van de waarschuwing ruis, en dan valt een échte afwijking niet
    //      meer op tussen de bekende gevallen.
    const richtprijs = Prijs.vergelijkPrijs(Prijs.richtprijsAlsAanbieding(pomp));
    if (richtprijs && !aanbieding.omvat) {
      const verhouding = nieuw / richtprijs;
      if (verhouding < RICHTPRIJS_ONDER || verhouding > RICHTPRIJS_BOVEN) {
        verdacht.push(
          `${pomp.id} @ ${aanbieding.winkel}: €${nieuw} is ${Math.round(verhouding * 100)}% van de richtprijs (€${richtprijs})` +
          ` - controleer of deze prijs hetzelfde dekt; klopt het verschil, zet dan "omvat" op deze aanbieding (${aanbieding.url})`
        );
      }
    }

    const wasExcl = aanbieding.btw_inbegrepen === false;
    const veranderd = winkelbedrag !== aanbieding.prijs_eur || exclBtw !== wasExcl;
    aanbieding.prijs_eur = winkelbedrag;
    if (exclBtw) aanbieding.btw_inbegrepen = false;
    else delete aanbieding.btw_inbegrepen;
    aanbieding.datum = VANDAAG;
    const btwNoot = exclBtw ? ` excl. btw (€${nieuw} inclusief)` : "";
    console.log(`  ${veranderd ? "✓ NIEUW" : "= gelijk"} ${pomp.id} @ ${aanbieding.winkel}: €${winkelbedrag}${btwNoot}`);
    return veranderd;
  } catch (err) {
    console.log(`  x ${pomp.id} @ ${aanbieding.winkel}: ${err.message} (oude prijs blijft staan)`);
    return false;
  }
}

async function main() {
  let wijzigingen = 0;
  const verdacht = [];

  for (const bestand of BESTANDEN) {
    console.log(`\n=== ${bestand.lijst} (${bestand.pad}) ===`);
    const data = JSON.parse(readFileSync(bestand.pad, "utf8"));

    for (const product of data[bestand.lijst] || []) {
      for (const aanbieding of product.aanbiedingen || []) {
        if (await updateAanbieding(product, aanbieding, bestand, verdacht)) wijzigingen++;
        await new Promise((r) => setTimeout(r, 1500)); // beleefde pauze tussen requests
      }
      // prijs_datum van het product = meest recente controle-datum van zijn aanbiedingen
      const datums = (product.aanbiedingen || []).map((a) => a.datum).filter(Boolean).sort();
      if (datums.length) product.prijs_datum = datums[datums.length - 1];
    }

    if (!DROOG) {
      data.laatst_bijgewerkt = VANDAAG;
      writeFileSync(bestand.pad, JSON.stringify(data, null, 2) + "\n", "utf8");
    }
  }
  // De warmtepomppagina's en sitemap worden hierna herbouwd door
  // scripts/genereer-warmtepomppaginas.mjs (zie de workflow).

  if (verdacht.length) {
    console.log(`\n!! ${verdacht.length} prijs(en) om na te lopen:`);
    for (const r of verdacht) console.log(`   - ${r}`);
  }

  console.log(`\nKlaar. ${wijzigingen} prijswijziging(en). laatst_bijgewerkt = ${VANDAAG}`);
}

main().catch((err) => {
  console.error("Onverwachte fout:", err);
  process.exit(1);
});
