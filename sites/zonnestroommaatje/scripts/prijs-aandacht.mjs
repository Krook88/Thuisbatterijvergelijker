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
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";

/**
 * Een sleutel die hetzelfde punt op twee dagen herkent, en twee verschillende
 * punten uit elkaar houdt. Bewust zonder bedrag erin: een prijs die van 850
 * naar 860 kruipt is niet elke dag een nieuw probleem.
 */
export function sleutelVan(soort, item) {
  return [soort, item.id, item.winkel || ""].join("|");
}

/** De lijst met wat we al weten, als sleutel => {sinds, soort, tekst}. */
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
 */
export function vergelijk(huidig, bekend, vandaag) {
  const nu = new Map();
  for (const item of huidig) {
    const s = sleutelVan(item.soort, item);
    // Zelfde punt twee keer op één dag telt één keer.
    if (!nu.has(s)) nu.set(s, item);
  }

  const nieuw = [];
  const onveranderd = [];
  const punten = {};

  for (const [s, item] of nu) {
    const eerder = bekend.get(s);
    const sinds = eerder ? eerder.sinds : vandaag;
    punten[s] = { sinds, soort: item.soort, tekst: item.tekst };
    (eerder ? onveranderd : nieuw).push({ ...item, sinds });
  }

  const opgelost = [];
  for (const [s, eerder] of bekend) {
    if (!nu.has(s)) opgelost.push({ sleutel: s, ...eerder });
  }

  return { nieuw, opgelost, onveranderd, punten };
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
  const { nieuw, opgelost, onveranderd } = uitkomst;
  const totaal = nieuw.length + onveranderd.length;

  console.log(`\n${site}: ${nieuw.length} nieuw, ${opgelost.length} opgelost, ${totaal} open in totaal.`);
  for (const n of nieuw) console.log(`  + NIEUW  ${n.soort}: ${n.tekst}`);
  for (const o of opgelost) console.log(`  - opgelost  ${o.soort}: ${o.tekst}`);
  if (onveranderd.length) {
    const oudste = [...onveranderd].sort((a, b) => String(a.sinds).localeCompare(String(b.sinds)))[0];
    const dagen = dagenOpen(oudste.sinds, vandaag);
    console.log(`  ${onveranderd.length} al bekend, de oudste sinds ${oudste.sinds}${dagen === null ? "" : ` (${dagen} dagen)`}.`);
  }

  if (process.env.GITHUB_STEP_SUMMARY && (nieuw.length || opgelost.length)) {
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
    regels.push(`Daarnaast staan er ${onveranderd.length} punten open die we al kenden; die staan in \`data/prijs-aandacht.json\`.`, "");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, regels.join("\n") + "\n");
  }

  if (process.env.GITHUB_OUTPUT) {
    const kort = nieuw.length
      ? `${nieuw.length} nieuw (${nieuw.map((n) => n.soort).filter((s, i, a) => a.indexOf(s) === i).join(", ")}), ${totaal} open in totaal`
      : `niets nieuws, ${totaal} open in totaal`;
    appendFileSync(process.env.GITHUB_OUTPUT, [
      `alarm=${nieuw.length ? "true" : "false"}`,
      `aandacht_nieuw=${nieuw.length}`,
      `aandacht_opgelost=${opgelost.length}`,
      `aandacht_totaal=${totaal}`,
      `aandacht_kort=${kort}`,
      "",
    ].join("\n"));
  }

  return { alarm: nieuw.length > 0, totaal };
}
