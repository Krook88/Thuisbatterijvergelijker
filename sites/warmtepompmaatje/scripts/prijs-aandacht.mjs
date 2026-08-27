/**
 * Wat vraagt er vandaag aandacht dat gisteren nog niet vroeg?
 *
 * Waarom dit bestaat: de dagelijkse run werd rood zodra er íéts aandacht
 * vroeg, en dat was elke dag. Bij batterijmaatje stonden er zevenentwintig
 * punten open, waarvan een deel nooit opgelost kan worden - drie winkels
 * weren bots met een 403 en dat blijven ze doen. Zo'n controle is binnen een
 * week behang: hij staat altijd rood, dus niemand kijkt meer, en dan meldt hij
 * niets meer terwijl hij wel rood is.
 *
 * De workflow schreef dat zelf al op, bij een andere controle:
 *
 *   "Faalt de run niet: een controle die rood kan blijven staan omdat een
 *    fabrikant iets niet publiceert, leest niemand meer."
 *
 * Dat gold ook hier, en daar heb ik overheen gelezen toen ik die stap bouwde.
 *
 * Wat er nu gebeurt: er ligt een lijst met wat we al weten. Alleen wat daar
 * niet in staat is nieuws, en alleen daarvan wordt de run rood. Wat eraf gaat
 * is goed nieuws en wordt gemeld. Wat er ongewijzigd in blijft staan telt mee
 * in het totaal maar houdt de run niet tegen - dat is een werkvoorraad, geen
 * alarm, en die hoort in het rapport.
 *
 * De lijst staat in de site zelf (data/prijs-aandacht.json) en wordt door
 * dezelfde run gecommit. Dat is met opzet: hij hoort bij de gegevens van die
 * site, hij is met de hand te lezen, en wie een punt wil "vergeten" haalt de
 * regel eruit.
 *
 * Eén punt is pas nieuws als het de volgende run ook nog opduikt. Dat scheelde
 * op 27 augustus zes van de zeven meldingen. Om 16:41 stond zonnestroommaatje
 * rood op vier omvormers bij Zonnige Winkel zonder leesbaar bedrag en op een
 * 403 bij Stroomwinkel en bij WarmteBeheer; om 17:45 gaven alle zes gewoon
 * weer een prijs. Alleen J en M Zonnepanelen hield stand. Winkels haperen -
 * een trage pagina, een botfilter dat even aanslaat - en een melding die
 * daarvan rood wordt meldt het weer, en de dag erna nog eens.
 *
 * Dus: de eerste keer dat een punt opduikt gaat het in de lijst en gebeurt er
 * verder niets. Staat het er de volgende run nóg, dan is het nieuws en wordt
 * de run rood. Is het dan weg, dan verdwijnt het stil - het is nooit gemeld,
 * dus het hoeft ook niet opgelost te heten. Wachten kost hooguit een dag, en
 * dat is de prijs voor een rood dat iets betekent.
 *
 * Punten uit een lijst van vóór deze regel hebben geen `bevestigd` en gelden
 * als bevestigd. Anders zou de eerste run ze allemaal opnieuw als onbevestigd
 * wegschrijven en de run erna alsnog in één klap als nieuws melden.
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";

/**
 * Twee namen voor hetzelfde probleem.
 *
 * De AEG bij AH Voordeelshop maakte batterijmaatje in zijn eentje elke dag
 * rood. Die winkel weert ons met een 403; lukt het de browser wel om binnen te
 * komen, dan staat er geen leesbaar bedrag op de pagina. Welke van de twee we
 * te zien krijgen hangt af van of de browser er die run doorheen kwam. Zo
 * wisselde hij per run tussen "geweigerd" en "zonder bedrag", en telde elke
 * wissel als één nieuw punt plus één opgelost punt.
 *
 * Voor een mens is het één situatie met één antwoord: deze winkel geeft ons
 * geen prijs. Dus tellen ze als hetzelfde punt. Het rapport blijft wel de
 * werkelijke soort noemen, want dat is het verschil tussen "ze houden ons
 * buiten" en "we mogen binnen maar er staat niets".
 *
 * Wat hier nadrukkelijk niet bij hoort is "onbereikbaar". Van geweigerd naar
 * een pagina die niet meer bestaat is wél een verandering die iemand hoort te
 * zien: dan moet er een nieuwe URL komen.
 */
const FAMILIE = { geweigerd: "zonder prijs", "zonder bedrag": "zonder prijs" };

export function familieVan(soort) {
  return FAMILIE[soort] || soort;
}

/**
 * Een sleutel die hetzelfde punt op twee dagen herkent, en twee verschillende
 * punten uit elkaar houdt. Bewust zonder bedrag erin: een prijs die van 850
 * naar 860 kruipt is niet elke dag een nieuw probleem.
 */
export function sleutelVan(soort, item) {
  return [familieVan(soort), item.id, item.winkel || ""].join("|");
}

/**
 * Staat dit punt al vast, of is het vandaag voor het eerst gezien?
 *
 * Ontbreekt het veld, dan is het bevestigd: die lijsten zijn geschreven vóór
 * deze regel bestond, en hun punten stonden er toen al dagen in.
 */
export function isBevestigd(punt) {
  return !punt || punt.bevestigd !== false;
}

/** De lijst met wat we al weten, als sleutel => {sinds, soort, tekst, bevestigd}. */
export function leesBekend(pad) {
  if (!existsSync(pad)) return new Map();
  try {
    const rauw = JSON.parse(readFileSync(pad, "utf8"));
    return new Map(Object.entries(rauw.punten || {}));
  } catch {
    // Liever opnieuw beginnen dan de run laten klappen op een half bestand.
    // Gevolg is één dag ruis, en dat is minder erg dan een run die niet draait.
    return new Map();
  }
}

/**
 * Vergelijkt wat er vandaag ligt met wat we al wisten.
 *
 *   huidig   [{soort, id, winkel, tekst}]
 *   bekend   uitkomst van leesBekend()
 *   vandaag  "2026-08-16"
 *
 * Vier uitkomsten in plaats van drie:
 *
 *   afwachten    vandaag voor het eerst gezien. Gaat in de lijst, maakt de run
 *                niet rood, want winkels haperen.
 *   nieuw        stond er de vorige run ook al: dit is het nieuws.
 *   onveranderd  al bevestigd en nog steeds open. De werkvoorraad.
 *   opgelost     was bevestigd en is weg. Goed nieuws, dus melden.
 *   vervallen    was onbevestigd en is weg. Nooit gemeld, dus stil eraf.
 */
export function vergelijk(huidig, bekend, vandaag) {
  const nu = new Map();
  for (const item of huidig) {
    const s = sleutelVan(item.soort, item);
    // Zelfde punt twee keer op één dag telt één keer.
    if (!nu.has(s)) nu.set(s, item);
  }

  const afwachten = [];
  const nieuw = [];
  const onveranderd = [];
  const punten = {};

  for (const [s, item] of nu) {
    const eerder = bekend.get(s);
    const sinds = eerder ? eerder.sinds : vandaag;
    // Vanaf de tweede keer staat het vast; alleen de allereerste keer niet.
    const bevestigd = Boolean(eerder);
    punten[s] = { sinds, soort: item.soort, tekst: item.tekst, bevestigd };
    if (!eerder) afwachten.push({ ...item, sinds });
    else if (isBevestigd(eerder)) onveranderd.push({ ...item, sinds });
    else nieuw.push({ ...item, sinds });
  }

  const opgelost = [];
  const vervallen = [];
  for (const [s, eerder] of bekend) {
    if (nu.has(s)) continue;
    (isBevestigd(eerder) ? opgelost : vervallen).push({ sleutel: s, ...eerder });
  }

  return { nieuw, opgelost, onveranderd, afwachten, vervallen, punten };
}

export function schrijfBekend(pad, punten, vandaag) {
  const gesorteerd = {};
  for (const s of Object.keys(punten).sort()) gesorteerd[s] = punten[s];
  writeFileSync(pad, JSON.stringify({ bijgewerkt: vandaag, punten: gesorteerd }, null, 2) + "\n", "utf8");
}

/** Hoeveel dagen staat dit punt al open? */
export function dagenOpen(sinds, vandaag) {
  const a = new Date(`${sinds}T12:00:00`), b = new Date(`${vandaag}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * Meldt de uitkomst: naar het scherm, naar de samenvatting van de run, en als
 * outputs voor de workflow.
 *
 * De output heet alarm en is "true" of "false", geen getal. Een getal was hier
 * al een keer de valstrik: de stap keek naar `outputs.aandacht != '0'` en
 * GitHub rekent een ontbrekende output om naar 0, waardoor de stap op de twee
 * sites die dit niet schrijven stilletjes werd overgeslagen in plaats van te
 * melden dat er niets gemeten werd.
 */
export function meldAandacht(site, uitkomst, vandaag) {
  const { nieuw, opgelost, onveranderd, afwachten = [], vervallen = [] } = uitkomst;
  const totaal = nieuw.length + onveranderd.length;

  console.log(`\n${site}: ${nieuw.length} nieuw, ${opgelost.length} opgelost, ${totaal} open in totaal.`);
  for (const n of nieuw) console.log(`  + NIEUW  ${n.soort}: ${n.tekst}`);
  for (const o of opgelost) console.log(`  - opgelost  ${o.soort}: ${o.tekst}`);
  if (afwachten.length) {
    console.log(`  ${afwachten.length} vandaag voor het eerst gezien; nieuws zodra het er de volgende run nog is:`);
    for (const a of afwachten) console.log(`    ? ${a.soort}: ${a.tekst}`);
  }
  if (vervallen.length) {
    console.log(`  ${vervallen.length} kwam op en was weer weg voordat het nieuws werd:`);
    for (const v of vervallen) console.log(`    . ${v.soort}: ${v.tekst}`);
  }
  if (onveranderd.length) {
    const oudste = [...onveranderd].sort((a, b) => String(a.sinds).localeCompare(String(b.sinds)))[0];
    const dagen = dagenOpen(oudste.sinds, vandaag);
    console.log(`  ${onveranderd.length} al bekend, de oudste sinds ${oudste.sinds}${dagen === null ? "" : ` (${dagen} dagen)`}.`);
  }

  if (process.env.GITHUB_STEP_SUMMARY && (nieuw.length || opgelost.length || afwachten.length || vervallen.length)) {
    const regels = [`### ${site}: ${nieuw.length} nieuw, ${opgelost.length} opgelost`, ""];
    if (nieuw.length) {
      regels.push("**Nieuw sinds de vorige run.** Hier is vandaag iets veranderd:", "",
        "| soort | wat |", "| --- | --- |",
        ...nieuw.map((n) => `| ${n.soort} | ${n.tekst} |`), "");
    }
    if (opgelost.length) {
      regels.push("**Opgelost.**", "",
        ...opgelost.map((o) => `- ${o.soort}: ${o.tekst}`), "");
    }
    if (afwachten.length) {
      regels.push(`**${afwachten.length} vandaag voor het eerst gezien.** Nog geen alarm: staat het er de volgende run nog, dan wordt het gemeld.`, "",
        ...afwachten.map((a) => `- ${a.soort}: ${a.tekst}`), "");
    }
    if (vervallen.length) {
      regels.push(`**${vervallen.length} kwam op en was weer weg** voordat het nieuws werd. Winkelhik, geen werk.`, "",
        ...vervallen.map((v) => `- ${v.soort}: ${v.tekst}`), "");
    }
    regels.push(`Daarnaast staan er ${onveranderd.length} punten open die we al kenden; die staan in \`data/prijs-aandacht.json\`.`, "");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, regels.join("\n") + "\n");
  }

  if (process.env.GITHUB_OUTPUT) {
    const staart = afwachten.length ? `, ${afwachten.length} vandaag voor het eerst gezien` : "";
    const kort = (nieuw.length
      ? `${nieuw.length} nieuw (${nieuw.map((n) => n.soort).filter((s, i, a) => a.indexOf(s) === i).join(", ")}), ${totaal} open in totaal`
      : `niets nieuws, ${totaal} open in totaal`) + staart;
    appendFileSync(process.env.GITHUB_OUTPUT, [
      `alarm=${nieuw.length ? "true" : "false"}`,
      `aandacht_nieuw=${nieuw.length}`,
      `aandacht_opgelost=${opgelost.length}`,
      `aandacht_afwachten=${afwachten.length}`,
      `aandacht_totaal=${totaal}`,
      `aandacht_kort=${kort}`,
      "",
    ].join("\n"));
  }

  return { alarm: nieuw.length > 0, totaal };
}
