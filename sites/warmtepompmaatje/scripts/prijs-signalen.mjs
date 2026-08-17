/**
 * Waarom een prijs niet opgehaald kon worden, en wat daarvan een bericht is.
 *
 * Waarom dit bestaat: batterijmaatje meldde elke dag welke prijzen aandacht
 * vroegen - geweigerd, onbereikbaar, zonder leesbaar bedrag, verouderd - en
 * zonnestroommaatje en warmtepompmaatje niet. Die twee vingen elke fout op in
 * één catch die "oude prijs blijft staan" logde en verder niets. In de
 * workflow zag dat er hetzelfde uit: een groen vinkje. Het verschil was dat er
 * bij die twee niets gemeten werd.
 *
 * De twee scripts zijn onderling bijna gelijk, dus het hoort hier en niet twee
 * keer overgetypt.
 *
 * Wat hier bewust niet in zit: het ophalen zelf, het uitlezen van de prijs en
 * de plausibiliteitsgrens. Dat verschilt echt per site - een paneel rekent in
 * wattpiek, een warmtepomp heeft varianten met meldcodes - en dat samenvoegen
 * zou een gedeelde functie opleveren met drie vlaggen erin.
 *
 * Batterijmaatje heeft zijn eigen, uitgebreidere versie hiervan inline staan,
 * met bol-API en richtprijzen erbij. Die werkt en draait in productie; hem
 * hierheen halen is een aparte stap en niet iets om en passant te doen.
 */

import { haalPagina, haalMetBrowser } from "./prijs-uitlezen.mjs";

/** De soorten die we uit elkaar houden, met per soort wat een mens ermee moet. */
export const SOORTEN = {
  geweigerd: "de winkel weigert ons, ook met een browser",
  onbereikbaar: "de pagina is er niet meer",
  "zonder bedrag": "de pagina is er wel, maar toont geen leesbaar bedrag",
  verouderd: "al lang niet meer bevestigd",
};

export function nieuweSignalen() {
  return { geweigerd: [], onbereikbaar: [], geenPrijs: [], verouderd: [] };
}

/**
 * Zet een mislukte poging in de juiste bak.
 *
 * Het onderscheid dat telt: een 403 betekent dat de winkel ons niet binnenlaat
 * en dat er dus iets te regelen valt (een ander adres, of accepteren). Een 404
 * of een naam die niet oplost betekent dat de pagina weg is en dat er een
 * nieuwe URL moet komen. Die twee op één hoop gooien maakt de melding
 * onbruikbaar, en precies dat deed de oude catch.
 */
export function noteerFout(signalen, item, err) {
  const melding = String(err && err.message || err);
  const bak = /HTTP (403|429)/.test(melding) ? signalen.geweigerd : signalen.onbereikbaar;
  bak.push({ ...item, reden: melding });
}

/**
 * Haalt een pagina op, met een echte browser als terugval.
 *
 * Twee keer terugvallen, om twee verschillende redenen:
 *   - het gewone verzoek komt er niet doorheen.
 *   - de pagina antwoordt wel maar het bedrag wordt pas in de browser ingevuld.
 *
 * Elke mislukking is reden voor een tweede poging, niet alleen een 403 of 429.
 * Dat stond hier eerst wel zo, en dat kostte ons drie winkels: Memodo,
 * Volt-shop en Winkelman stonden als "onbereikbaar" in de lijst terwijl hun
 * productpagina's met precies onze URL gewoon in de zoekindex staan. Winkels
 * die bots weren doen dat ook met een 404 of een 400, en wie alleen naar de
 * code kijkt houdt een aanbieding voor dood die het doet. De linkcontrole
 * leerde dat vandaag al; dit is dezelfde les één script verderop.
 *
 * Alleen als terugval: een browser starten kost seconden, en de meeste winkels
 * antwoorden gewoon. Lukt het de browser ook niet, dan geldt de oorspronkelijke
 * fout - dus een 404 die een 404 blijft heet nog steeds onbereikbaar.
 */
export async function haalMetTerugval(url, leesPrijs) {
  let html;
  let viaBrowser = false;
  try {
    html = await haalPagina(url);
  } catch (err) {
    const uitBrowser = await haalMetBrowser(url).catch(() => null);
    if (!uitBrowser) throw err;
    html = uitBrowser;
    viaBrowser = true;
  }

  let uit = leesPrijs(html);
  if ((uit === null || uit === undefined || uit.prijs === null || uit.prijs === undefined) && !viaBrowser) {
    const uitBrowser = await haalMetBrowser(url).catch(() => null);
    if (uitBrowser) {
      html = uitBrowser;
      viaBrowser = true;
      uit = leesPrijs(html);
    }
  }
  return { html, uit, viaBrowser };
}

/**
 * Producten waarvan het getoonde bedrag al lang niet bevestigd is.
 *
 * Dezelfde grens als bij batterijmaatje: eenentwintig dagen. Dat ligt boven de
 * veertien waarop de bezoeker het al ziet staan, zodat hij het eerder weet dan
 * de beheerder.
 *
 * Wat er bewust niet in komt: een prijs die als mensenwerk is aangemerkt. Die
 * wordt nooit vanzelf jonger, dus die zou tot in de eeuwigheid in de lijst
 * blijven staan zonder dat iemand er iets aan kan doen.
 */
export function verzamelVerouderd(producten, vandaag, naDagen = 21) {
  const uit = [];
  const nu = new Date(`${vandaag}T12:00:00`);
  for (const p of producten || []) {
    if (p.prijs_controle === "handmatig") continue;
    const leverbaar = (p.aanbiedingen || []).filter((a) => a && typeof a.prijs_eur === "number" && a.niet_leverbaar !== true);
    const teWegen = leverbaar.length
      ? leverbaar.map((a) => ({ winkel: a.winkel, prijs: a.prijs_eur, datum: a.datum }))
      : typeof p.richtprijs_eur === "number"
        ? [{ winkel: p.prijs_bron || "richtprijs", prijs: p.richtprijs_eur, datum: p.prijs_datum }]
        : [];
    for (const w of teWegen) {
      const dagen = w.datum ? Math.round((nu - new Date(`${w.datum}T12:00:00`)) / 86400000) : null;
      if (dagen === null || dagen >= naDagen) {
        uit.push({ id: p.id, winkel: w.winkel, prijs: w.prijs, dagen });
      }
    }
  }
  return uit;
}

/** De signalen als vlakke lijst voor prijs-aandacht.mjs. */
export function puntenVan(signalen) {
  return [
    ...signalen.verouderd.map((v) => ({
      soort: "verouderd", id: v.id, winkel: v.winkel,
      tekst: `${v.id} @ ${v.winkel}: €${v.prijs} (${v.dagen === null ? "nooit bevestigd" : v.dagen + " dagen"})`,
    })),
    ...signalen.onbereikbaar.map((k) => ({
      soort: "onbereikbaar", id: k.id, winkel: k.winkel,
      tekst: `${k.id} @ ${k.winkel}: ${k.reden}`,
    })),
    ...signalen.geweigerd.map((g) => ({
      soort: "geweigerd", id: g.id, winkel: g.winkel,
      tekst: `${g.id} @ ${g.winkel}: ${g.reden}`,
    })),
    ...signalen.geenPrijs.map((g) => ({
      soort: "zonder bedrag", id: g.id, winkel: g.winkel,
      tekst: `${g.id} @ ${g.winkel}: geen leesbaar bedrag`,
    })),
  ];
}

/** Het rapport op het scherm, per soort gegroepeerd. */
export function toonSignalen(signalen) {
  const groepen = [
    ["onbereikbaar", signalen.onbereikbaar, (x) => `${x.id} @ ${x.winkel}: ${x.reden}\n     ${x.url || ""}`],
    ["geweigerd", signalen.geweigerd, (x) => `${x.id}  |  ${x.winkel}  |  ${x.reden}  |  ${x.url || ""}`],
    ["zonder leesbaar bedrag", signalen.geenPrijs, (x) => `${x.id}  |  ${x.winkel}  |  ${x.url || ""}`],
    ["al lang niet bevestigd", signalen.verouderd, (x) => `${x.id} @ ${x.winkel}: €${x.prijs} (${x.dagen === null ? "nooit bevestigd" : x.dagen + " dagen"})`],
  ];
  for (const [naam, lijst, regel] of groepen) {
    if (!lijst.length) continue;
    console.log(`\n${lijst.length} ${naam}:`);
    for (const x of lijst) console.log(`  ${regel(x)}`);
  }
}
