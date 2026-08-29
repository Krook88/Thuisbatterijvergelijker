/**
 * Tot wanneer een prijs in het zoekresultaat mag blijven staan.
 *
 * Google laat een prijs weg zodra `priceValidUntil` verstreken is, en toont
 * geen beschikbaarheid als `availability` ontbreekt. Beide stonden er niet,
 * terwijl de prijs in het zoekresultaat juist is waar deze sites het van
 * moeten hebben.
 *
 * Waarom dit een eigen bestand is: deze regel stond woord voor woord in alle
 * drie de generatoren, inclusief de twee opmerkingen hieronder die allebei uit
 * een misser komen. Drie kopieën van een regel die je maar op één manier goed
 * kunt hebben, is precies waar `kern/` voor bedoeld is - zie README.md, "Wat er
 * in kern hoort". De titelhulpjes ernaast zijn met opzet níét meeverhuisd: die
 * lezen `TITEL_MAX` en het merkachtervoegsel van hun eigen site, en dan is
 * delen duurder dan kopiëren.
 */

// Dertig dagen na de laatste prijscontrole. De workflow draait dagelijks, dus
// in de praktijk schuift die elke dag mee; valt de update een tijd uit, dan
// verloopt de vermelding vanzelf in plaats van een oude prijs te blijven
// beloven.
const DAGEN = 30;

export function houdbaarTot(datum, vandaag = new Date()) {
  // Zonder prijsdatum weten we niet hoe vers het bedrag is, en dan is
  // "geldig tot over dertig dagen" een belofte die nergens op steunt. Er stond
  // hier new Date() als terugval, waardoor die datum elke dag een dag opschoof:
  // het bestand veranderde dagelijks zonder dat er iets aan de pagina veranderde,
  // en Google kreeg een houdbaarheidsdatum voor een prijs die nooit bevestigd is.
  if (!datum) return null;
  const vanaf = new Date(datum);
  if (Number.isNaN(vanaf.getTime())) return null;
  vanaf.setDate(vanaf.getDate() + DAGEN);
  const tot = vanaf.toISOString().slice(0, 10);
  // Een datum die al verstreken is publiceren is erger dan er geen zetten:
  // Google negeert de prijs dan actief. Dat gebeurt zodra een winkel niet meer
  // door het prijsscript bereikt wordt en de datum blijft staan - bij
  // batterijmaatje gold dat voor twaalf producten. Die staleness hoort in het
  // rapport van verse-data.mjs thuis, niet in de markup.
  return tot > vandaag.toISOString().slice(0, 10) ? tot : null;
}
