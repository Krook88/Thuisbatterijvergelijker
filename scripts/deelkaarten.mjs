#!/usr/bin/env node
/**
 * Maakt per productpagina een eigen deelplaatje (og:image, 1200 x 630).
 *
 * Waarom dit bestaat: deze sites moeten het hebben van iemand die een link
 * doorstuurt in WhatsApp of de familie-app. Tot nu toe kreeg elke productpagina
 * hetzelfde algemene plaatje, dus wie een Marstek Venus E deelde, liet de
 * ontvanger een batterij-icoon met "Batterijmaatje.nl" zien. Nu staat het
 * product er zelf op: de foto, de naam en drie getallen die je bij dat product
 * wilt weten.
 *
 * Er staat met opzet geen prijs op. WhatsApp en Facebook bewaren een voorbeeld
 * weken, en een plaatje met de prijs van vorige maand is erger dan geen prijs.
 * De prijs staat in og:description, en die is elke dag vers.
 *
 * Een plaatje wordt alleen opnieuw gemaakt als wat erop staat verandert: per
 * site houdt assets/deel/kaarten.json per product een vingerafdruk bij. De
 * dagelijkse prijsupdate draait dit dus zonder dat er elke dag zestig
 * plaatjes in de commit belanden.
 *
 *   node scripts/deelkaarten.mjs [--site <naam>] [--alleen id,id] [--alles]
 *
 * Draait op playwright, net als de schermafdrukken. Ontbreekt die, dan zegt
 * het script dat en stopt het; de generator valt dan terug op het algemene
 * plaatje.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const nl = (n) => String(n).replace(".", ",");
const naam = (p) => p.model.toLowerCase().startsWith(p.merk.toLowerCase()) ? p.model : `${p.merk} ${p.model}`;
const zonderHaakjes = (s) => s.replace(/\s*\([^)]*\)\s*$/, "").trim();

/* Per site: waar de producten staan, waar hun pagina's staan, en welke drie
   gegevens op het plaatje komen. Dat laatste is domeinkennis en verschilt per
   site, daarom staat dit hier en niet in kern/. */
const SITES = [
  {
    site: "batterijmaatje",
    domein: "Batterijmaatje.nl",
    bestand: "batterijen.json", sleutel: "batterijen", map: "batterij",
    icoon: "batterij",
    kleur: { primair: "#0f766e", inkt: "#0a3733", accent: "#f59e0b" },
    soort: "Thuisbatterij",
    onderregel: "Prijzen per winkel, koppelingen en terugverdientijd",
    titel: (b) => zonderHaakjes(naam(b)),
    feiten: (b) => [
      b.capaciteit_kwh && `${nl(b.capaciteit_kwh)} kWh bruikbaar`,
      b.vermogen_kw && `${nl(b.vermogen_kw)} kW`,
      { "plug-in": "Met stekker", "ac-gekoppeld": "AC-gekoppeld", "hybride": "Hybride omvormer" }[b.type],
    ],
  },
  {
    site: "warmtepompmaatje",
    domein: "Warmtepompmaatje.nl",
    bestand: "warmtepompen.json", sleutel: "warmtepompen", map: "pomp",
    icoon: "warmte",
    kleur: { primair: "#c2410c", inkt: "#431407", accent: "#f59e0b" },
    soort: "Warmtepomp",
    onderregel: "Prijs, ISDE-subsidie, geluid en slimme koppeling",
    titel: (w) => zonderHaakjes(naam(w)),
    feiten: (w) => [
      w.type === "hybride" ? "Hybride" : "All-electric",
      w.vermogen_kw && `${nl(w.vermogen_kw)} kW`,
      w.geluid_db && `${w.geluid_db} dB(A)`,
    ],
  },
  {
    site: "zonnestroommaatje",
    domein: "Zonnestroommaatje.nl",
    bestand: "panelen.json", sleutel: "panelen", map: "paneel",
    icoon: "zon",
    kleur: { primair: "#0369a1", inkt: "#0b3a5c", accent: "#f59e0b" },
    soort: "Zonnepaneel",
    onderregel: "Prijzen per winkel, garantie en opbrengst",
    titel: (p) => zonderHaakjes(naam(p)),
    feiten: (p) => [
      p.vermogen_wp && `${p.vermogen_wp} Wp`,
      p.rendement_pct && `${nl(p.rendement_pct)}% rendement`,
      p.uitvoering,
    ],
  },
];

const argv = process.argv.slice(2);
const waarde = (vlag) => { const i = argv.indexOf(vlag); return i >= 0 ? argv[i + 1] : null; };
const ALLEEN_SITE = waarde("--site");
const ALLEEN = (waarde("--alleen") || "").split(",").filter(Boolean);
const ALLES = argv.includes("--alles");

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const MIME = { ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };
const alsData = (pad) => {
  const ext = pad.slice(pad.lastIndexOf(".")).toLowerCase();
  return `data:${MIME[ext] || "application/octet-stream"};base64,${readFileSync(pad).toString("base64")}`;
};

function kaartHtml(cfg, p, siteMap, iconen) {
  const feiten = cfg.feiten(p).filter(Boolean).slice(0, 3);
  const foto = p.afbeelding && !/^https?:/i.test(p.afbeelding) && existsSync(join(siteMap, p.afbeelding))
    ? alsData(join(siteMap, p.afbeelding)) : null;
  const font = alsData(join(siteMap, "assets/fonts/figtree-variable.woff2"));
  const k = cfg.kleur;
  return `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><style>
@font-face { font-family: Figtree; src: url(${font}) format("woff2"); font-weight: 300 900; }
* { box-sizing: border-box; margin: 0; }
html, body { width: 1200px; height: 630px; }
body { font-family: Figtree, sans-serif; background: ${k.inkt}; color: #fff; display: grid;
  grid-template-columns: 1fr 500px; overflow: hidden;
  background-image: radial-gradient(circle at 85% 15%, ${k.primair}cc, transparent 60%); }
.tekst { padding: 64px 40px 56px 68px; display: flex; flex-direction: column; min-width: 0; }
.soort { font-size: 26px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: ${k.accent}; }
h1 { font-size: 64px; line-height: 1.05; font-weight: 800; margin-top: 14px; overflow-wrap: anywhere; }
.feiten { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px; }
.feit { font-size: 27px; font-weight: 700; padding: 9px 20px; border-radius: 999px;
  background: rgba(255,255,255,.12); border: 2px solid rgba(255,255,255,.22); white-space: nowrap; }
.voet { margin-top: auto; }
.onder { font-size: 25px; color: rgba(255,255,255,.82); }
.domein { font-size: 34px; font-weight: 800; margin-top: 8px; display: flex; align-items: center; gap: 12px; }
.domein svg { width: 36px; height: 36px; color: ${k.accent}; }
.beeld { margin: 44px 44px 44px 0; border-radius: 28px; background: #fff; display: flex;
  align-items: center; justify-content: center; overflow: hidden; }
.beeld img { width: 100%; height: 100%; object-fit: contain; padding: 30px; }
.beeld.leeg { background: rgba(255,255,255,.08); border: 2px solid rgba(255,255,255,.18); }
.beeld.leeg svg { width: 220px; height: 220px; color: ${k.accent}; }
</style></head><body>
<div class="tekst">
  <div class="soort">${esc(cfg.soort)}</div>
  <h1 id="titel">${esc(cfg.titel(p))}</h1>
  <div class="feiten">${feiten.map((f) => `<span class="feit">${esc(f)}</span>`).join("")}</div>
  <div class="voet">
    <div class="onder">${esc(cfg.onderregel)}</div>
    <div class="domein">${iconen.svg(cfg.icoon)}${esc(cfg.domein)}</div>
  </div>
</div>
<div class="beeld${foto ? "" : " leeg"}">${foto ? `<img src="${foto}" alt="">` : iconen.svg(cfg.icoon)}</div>
<script>
  /* Lange paneelnamen: maak de kop kleiner tot hij in drie regels past. */
  const h = document.getElementById("titel");
  let maat = 64;
  while (h.scrollHeight > maat * 1.05 * 3 + 4 && maat > 36) { maat -= 2; h.style.fontSize = maat + "px"; }
</script>
</body></html>`;
}

/* De vingerafdruk dekt alles wat op het plaatje komt, plus de opmaak zelf: een
   wijziging in dit script maakt dus vanzelf alle plaatjes opnieuw. */
const SCRIPT_HASH = createHash("sha1").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex");
function vingerafdruk(cfg, p, siteMap) {
  const h = createHash("sha1").update(SCRIPT_HASH).update(JSON.stringify([cfg.titel(p), cfg.feiten(p)]));
  if (p.afbeelding && existsSync(join(siteMap, p.afbeelding))) h.update(readFileSync(join(siteMap, p.afbeelding)));
  return h.digest("hex").slice(0, 16);
}

let pw;
try {
  pw = await import("playwright");
} catch {
  console.error("playwright ontbreekt; installeer met: npm i --no-save playwright");
  process.exit(1);
}
const eigen = "/opt/pw-browsers/chromium";
const browser = await pw.chromium.launch(existsSync(eigen) ? { executablePath: eigen } : {});
const pagina = await browser.newPage({ viewport: { width: 1200, height: 630 } });

let gemaakt = 0, ongewijzigd = 0, weg = 0;
for (const cfg of SITES) {
  if (ALLEEN_SITE && cfg.site !== ALLEEN_SITE) continue;
  const siteMap = join(ROOT, "sites", cfg.site);
  const { createRequire } = await import("node:module");
  const iconen = createRequire(join(siteMap, "x.js"))("./assets/iconen.js");
  const producten = JSON.parse(readFileSync(join(siteMap, "data", cfg.bestand), "utf8"))[cfg.sleutel] || [];
  const uitMap = join(siteMap, "assets/deel");
  mkdirSync(uitMap, { recursive: true });
  const lijstPad = join(uitMap, "kaarten.json");
  const lijst = existsSync(lijstPad) ? JSON.parse(readFileSync(lijstPad, "utf8")) : {};

  // Alleen producten met een eigen pagina; een verborgen product deelt niemand.
  const metPagina = producten.filter((p) => existsSync(join(siteMap, cfg.map, `${p.id}.html`)));
  const ids = new Set(metPagina.map((p) => p.id));

  for (const p of metPagina) {
    if (ALLEEN.length && !ALLEEN.includes(p.id)) continue;
    const afdruk = vingerafdruk(cfg, p, siteMap);
    const doel = join(uitMap, `${p.id}.jpg`);
    if (!ALLES && lijst[p.id] === afdruk && existsSync(doel)) { ongewijzigd++; continue; }
    await pagina.setContent(kaartHtml(cfg, p, siteMap, iconen), { waitUntil: "load" });
    await pagina.evaluate(() => document.fonts.ready);
    writeFileSync(doel, await pagina.screenshot({ type: "jpeg", quality: 84 }));
    lijst[p.id] = afdruk;
    gemaakt++;
  }

  // Plaatjes van producten die geen pagina meer hebben, ruimen we op.
  if (!ALLEEN.length) {
    for (const f of readdirSync(uitMap)) {
      const id = f.replace(/\.jpg$/, "");
      if (f.endsWith(".jpg") && !ids.has(id)) { rmSync(join(uitMap, f)); delete lijst[id]; weg++; }
    }
  }
  const gesorteerd = Object.fromEntries(Object.keys(lijst).sort().map((k) => [k, lijst[k]]));
  writeFileSync(lijstPad, JSON.stringify(gesorteerd, null, 2) + "\n");
}

await browser.close();
console.log(`Deelkaarten: ${gemaakt} gemaakt, ${ongewijzigd} ongewijzigd, ${weg} opgeruimd.`);
