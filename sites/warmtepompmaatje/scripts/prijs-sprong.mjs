/**
 * Wat er gebeurt met een prijs die te ver van de vorige ligt.
 *
 * De prijsupdate neemt een bedrag dat meer dan een kwart van de vorige prijs
 * afwijkt niet over, en dat blijft zo: zo'n sprong is net zo vaak een
 * uitleesfout (de losse module op een pagina waar ook het pakket staat) als
 * een echte prijswijziging. Maar tot oktober 2026 bleef het daar ook bij. De
 * sprong kwam in de lijst "te controleren" en wachtte op een mens, en tot die
 * er was bleef de site de oude prijs tonen als actuele prijs van die winkel.
 * Stekker-batterij.nl vroeg op 21 oktober € 1.950 voor de Hyxi Halo, en de
 * site bleef € 619 noemen.
 *
 * Nu beslist de prijsupdate zelf, zodra hij dezelfde afwijkende prijs drie
 * runs achter elkaar ziet. Eén keer kan toeval zijn; drie keer hetzelfde
 * bedrag is wat er op de pagina staat. Dan:
 *
 *   - ligt het bedrag binnen een kwart van wat de andere winkels voor
 *     hetzelfde product vragen (of van de richtprijs als er geen andere
 *     winkels zijn), dan is het een echte prijswijziging en neemt hij hem over;
 *   - anders zet hij de aanbieding op niet leverbaar ("prijs wijkt af"). Hij
 *     telt dan niet meer mee voor de kopprijs en de site noemt hem niet meer
 *     als actuele prijs. De andere winkels blijven gewoon staan.
 *
 * Komt de winkel later terug op een bedrag dat bij de oude prijs past, dan
 * gaat de markering er vanzelf weer af (hersteld()). Een markering die door
 * iets anders gezet is (voorraad, pagina weg, met de hand) raakt deze regel
 * niet aan.
 */

export const RUNS = 3;
export const MARGE = { onder: 0.75, boven: 1.25 };
export const DOOR = "prijs wijkt af";
// Binnen 3% telt als hetzelfde bedrag: een winkel die € 1.949 en dan € 1.950
// vraagt, staat niet opnieuw op dag één.
const ZELFDE = 0.03;

export function mediaan(getallen) {
  const g = getallen.filter((n) => typeof n === "number" && n > 0).sort((a, b) => a - b);
  if (!g.length) return null;
  const m = Math.floor(g.length / 2);
  return g.length % 2 ? g[m] : (g[m - 1] + g[m]) / 2;
}

/**
 * Het bedrag om een afwijkende prijs tegen te houden: de mediaan van wat de
 * andere leverbare winkels voor dit product vragen, en anders de richtprijs.
 * prijsVan rekent een aanbieding om naar dezelfde basis als het nieuwe bedrag
 * (bijvoorbeeld inclusief btw).
 */
export function referentie(aanbiedingen, eigen, prijsVan, richtprijs = null) {
  const anderen = (aanbiedingen || [])
    .filter((a) => a && a !== eigen && a.niet_leverbaar !== true)
    .map(prijsVan);
  return mediaan(anderen) ?? (typeof richtprijs === "number" && richtprijs > 0 ? richtprijs : null);
}

/**
 * Houdt per aanbieding bij hoe vaak hetzelfde afwijkende bedrag gezien is, en
 * geeft terug wat er nu mee moet:
 *   "wachten"    nog geen drie runs; de oude prijs blijft, de melding ook
 *   "overnemen"  een echte prijswijziging; de aanroeper slaat het bedrag op
 *   "uitgezet"   de aanbieding is nu niet leverbaar ("prijs wijkt af")
 *   "blijft"     hij stond al op niet leverbaar
 * Een tweede run op dezelfde dag telt niet als extra run.
 */
export function sprong(aanbieding, nieuw, ref, vandaag) {
  const vorig = aanbieding.afwijking;
  const zelfde = vorig && typeof vorig.prijs === "number" && Math.abs(nieuw / vorig.prijs - 1) <= ZELFDE;
  const runs = !zelfde ? 1 : vorig.laatst === vandaag ? vorig.runs : vorig.runs + 1;
  aanbieding.afwijking = { prijs: nieuw, sinds: zelfde ? vorig.sinds : vandaag, laatst: vandaag, runs };
  if (runs < RUNS) return "wachten";
  if (ref && nieuw >= ref * MARGE.onder && nieuw <= ref * MARGE.boven) {
    hersteld(aanbieding);
    return "overnemen";
  }
  if (aanbieding.niet_leverbaar) return "blijft";
  aanbieding.niet_leverbaar = true;
  aanbieding.niet_leverbaar_door = DOOR;
  return "uitgezet";
}

/**
 * Na een gewoon overgenomen prijs: de telling kan weg, en een markering die
 * deze regel zelf gezet heeft ook. Geeft true als de aanbieding weer meetelt.
 */
export function hersteld(aanbieding) {
  delete aanbieding.afwijking;
  if (aanbieding.niet_leverbaar && aanbieding.niet_leverbaar_door === DOOR) {
    delete aanbieding.niet_leverbaar;
    delete aanbieding.niet_leverbaar_door;
    return true;
  }
  return false;
}
