#!/usr/bin/env node
/**
 * Prijsverloop: de laagste winkelprijs per product, per dag.
 *
 * De prijsupdate overschrijft elke dag de bedragen in data/. Wat er gisteren
 * stond, zat alleen nog in de git-geschiedenis, en daar kijkt een bezoeker
 * niet. Dit script houdt het bij in data/prijsverloop.json, zodat het
 * overzicht een klein grafiekje en de productpagina een grotere grafiek kan
 * tonen, zoals de prijsgeschiedenis bij Tweakers.
 *
 * Wat er per dag wordt vastgelegd is precies het bedrag dat de lijst toont:
 * Prijs.beste() en Prijs.vergelijkPrijs() van de site zelf. Een richtprijs
 * telt niet mee; staat er die dag geen winkel met een prijs, dan is dat een
 * gat in de lijn (null) en geen bedrag dat nergens te betalen was.
 *
 * Opslag als wijzigingspunten: [datum, prijs] alleen als de prijs anders is
 * dan het vorige punt. Een prijs die drie weken gelijk blijft is één punt,
 * en "bijgewerkt" zegt tot wanneer hij gold.
 *
 *   node scripts/prijsverloop.mjs            vandaag erbij (de dagelijkse run)
 *   node scripts/prijsverloop.mjs --uit-git  opnieuw opbouwen uit de geschiedenis
 *   node scripts/prijsverloop.mjs --datum 2026-10-07
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

// Hoe ver terug de opslag gaat. De grafiek toont er hooguit drie maanden van;
// de rest is marge, zodat "laagste in een jaar" later kan zonder opnieuw te bouwen.
export const BEWAAR_DAGEN = 400;

const NIET_MEETELLEN = new Set(["nieuwe-modellen.json", "prijs-aandacht.json", "prijsverloop.json"]);

/** Het bedrag dat de lijst die dag toonde, of null als er geen winkelprijs was. */
export function laagsteWinkelprijs(item, Prijs) {
  const beste = Prijs.beste(item);
  if (!beste || beste.is_richtprijs) return null;
  const p = Prijs.vergelijkPrijs(beste);
  return typeof p === "number" && Number.isFinite(p) && p > 0 ? Math.round(p * 100) / 100 : null;
}

/** Voegt een dagstand toe aan een reeks wijzigingspunten. Muteert en geeft de reeks terug. */
export function voegPuntToe(reeks, datum, prijs) {
  const laatste = reeks[reeks.length - 1];
  if (laatste && laatste[0] > datum) return reeks; // ouder dan wat er al staat: niet herschrijven
  if (laatste && laatste[0] === datum) {
    laatste[1] = prijs;
    // Kwam deze dag uit op de prijs van het punt ervoor, dan is er geen wijziging meer.
    const vorige = reeks[reeks.length - 2];
    if (vorige && vorige[1] === prijs) reeks.pop();
    return reeks;
  }
  if (!laatste) {
    if (prijs !== null) reeks.push([datum, prijs]);
    return reeks;
  }
  if (laatste[1] !== prijs) reeks.push([datum, prijs]);
  return reeks;
}

const dagNummer = (datum) => Math.floor(Date.parse(`${datum}T12:00:00Z`) / 86400000);
const datumVan = (nummer) => new Date(nummer * 86400000).toISOString().slice(0, 10);

/**
 * Houdt de laatste `dagen` dagen over. Het punt dat vóór het begin van dat
 * venster gold, blijft staan op de begindatum, anders begint de lijn leeg.
 */
export function snoei(reeks, tot, dagen = BEWAAR_DAGEN) {
  const begin = datumVan(dagNummer(tot) - dagen);
  const binnen = reeks.filter(([d]) => d >= begin);
  const ervoor = reeks.filter(([d]) => d < begin).pop();
  if (ervoor && (!binnen.length || binnen[0][0] > begin)) binnen.unshift([begin, ervoor[1]]);
  return binnen;
}

/** Alle items uit de databestanden van deze site, op id. */
export function itemsUit(bestanden) {
  const uit = new Map();
  for (const data of bestanden) {
    for (const waarde of Object.values(data || {})) {
      if (!Array.isArray(waarde)) continue;
      for (const item of waarde) {
        if (item && typeof item === "object" && item.id && Array.isArray(item.aanbiedingen)) uit.set(item.id, item);
      }
    }
  }
  return uit;
}

/** Eén dagstand op alle producten toepassen. */
export function verwerkDag(verloop, items, datum, Prijs) {
  for (const [id, item] of items) {
    const reeks = verloop[id] || (verloop[id] = []);
    voegPuntToe(reeks, datum, laagsteWinkelprijs(item, Prijs));
    if (!reeks.length) delete verloop[id];
  }
  return verloop;
}

function vandaagInNederland() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Amsterdam" }).format(new Date());
}

function hoofd() {
  const SITE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const DATA = join(SITE, "data");
  const UIT = join(DATA, "prijsverloop.json");
  const Prijs = createRequire(import.meta.url)(join(SITE, "assets", "prijs.js"));
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--datum");
  const vandaag = i >= 0 ? argv[i + 1] : vandaagInNederland();

  const namen = readdirSync(DATA).filter((f) => f.endsWith(".json") && !NIET_MEETELLEN.has(f));
  const lees = (pad) => JSON.parse(readFileSync(pad, "utf8"));
  const nu = () => itemsUit(namen.map((f) => lees(join(DATA, f))));

  let verloop = {};
  if (argv.includes("--uit-git")) {
    // Per dag de laatste stand van elk bestand. Een dag waarop één bestand
    // veranderde, gebruikt voor de andere de stand van daarvoor.
    const git = (...a) => execFileSync("git", a, { cwd: SITE, encoding: "utf8", maxBuffer: 1 << 28 });
    const perDag = new Map();
    for (const f of namen) {
      const regels = git("log", "--reverse", "--format=%H %ad", "--date=short", "--", `data/${f}`).trim().split("\n").filter(Boolean);
      for (const r of regels) {
        const [hash, datum] = r.split(" ");
        if (!perDag.has(datum)) perDag.set(datum, new Map());
        perDag.get(datum).set(f, hash);
      }
    }
    const stand = new Map();
    for (const datum of [...perDag.keys()].sort()) {
      if (datum >= vandaag) break;
      for (const [f, hash] of perDag.get(datum)) {
        try { stand.set(f, JSON.parse(git("show", `${hash}:./data/${f}`))); } catch { /* bestand bestond nog niet of was kapot */ }
      }
      verwerkDag(verloop, itemsUit([...stand.values()]), datum, Prijs);
    }
    console.log(`Uit git: ${perDag.size} dag(en) met een wijziging in ${namen.join(", ")}.`);
  } else if (existsSync(UIT)) {
    verloop = lees(UIT).producten || {};
  }

  const items = nu();
  verwerkDag(verloop, items, vandaag, Prijs);
  // Producten die uit de lijst zijn verdwenen, gaan ook uit het verloop.
  for (const id of Object.keys(verloop)) {
    if (!items.has(id)) delete verloop[id];
    else verloop[id] = snoei(verloop[id], vandaag);
  }

  const gesorteerd = Object.fromEntries(Object.keys(verloop).sort().map((id) => [id, verloop[id]]));
  writeFileSync(UIT, JSON.stringify({
    toelichting: "Laagste winkelprijs incl. btw per product, als [datum, prijs] op de dagen dat hij veranderde; null = die dag geen winkel met een prijs. Gemaakt door scripts/prijsverloop.mjs.",
    bijgewerkt: vandaag,
    producten: gesorteerd,
  }) + "\n", "utf8");
  const punten = Object.values(gesorteerd).reduce((n, r) => n + r.length, 0);
  console.log(`prijsverloop.json: ${Object.keys(gesorteerd).length} producten, ${punten} wijzigingspunten, bijgewerkt ${vandaag}.`);
}

if (resolve(process.argv[1] || "") === resolve(fileURLToPath(import.meta.url))) hoofd();
