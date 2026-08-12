#!/usr/bin/env node
/**
 * Hoeveel verschillende adviezen geeft de keuzehulp eigenlijk?
 *
 * Waarom dit bestaat: het vermoeden was "ik kom steeds op hetzelfde uit", en
 * dat is te meten in plaats van te beoordelen. Dit script voert de echte
 * keuzehulp in een browser alle antwoordcombinaties en telt de uitkomsten.
 * Bewust de echte module en geen nagebouwde kopie: anders meet je je kopie.
 *
 * Wat de eerste meting opleverde (12.960 combinaties):
 *   - 11 verschillende batterijen ooit op nummer 1, van de 41
 *   - 42 verschillende top-3en in totaal
 *   - een enkele batterij op nummer 1 in 32% van alle uitkomsten
 *
 * En vooral: aan de weging en de bandbreedte draaien hielp nauwelijks. De
 * oorzaak zit er onder. Het maatadvies komt voor huishoudens van 1 tot 5
 * personen altijd tussen 3,0 en 7,2 kWh uit, en in dat bereik liggen maar 11
 * plug-in batterijen en 4 installatiesystemen. Van de 41 zijn er dus maar 15
 * ooit een serieuze kandidaat. Dat is geen instelling maar rekenkunde.
 *
 * Gebruik:
 *   node scripts/keuzehulp-spreiding.mjs            huidige stand doormeten
 *   node scripts/keuzehulp-spreiding.mjs --banden   drie bandbreedtes vergelijken
 */

import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BANDEN = process.argv.includes("--banden");
const MIME = { ".html":"text/html;charset=utf-8", ".css":"text/css", ".js":"text/javascript",
  ".json":"application/json", ".webp":"image/webp", ".svg":"image/svg+xml", ".png":"image/png", ".ico":"image/x-icon" };

const server = http.createServer((q, r) => {
  const p = path.join(ROOT, decodeURIComponent(q.url.split("?")[0]));
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) { r.writeHead(404).end(); return; }
  r.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" });
  r.end(fs.readFileSync(p));
});
await new Promise((k) => server.listen(0, "127.0.0.1", k));
const poort = server.address().port;

const combinaties = [];
for (const personen of ["1","2","3","4","5"])
for (const pv of ["ja","nee"])
for (const panelen of [6,16])
for (const contract of ["dynamisch","vast"])
for (const installatie of ["zelf","installateur","beide"])
for (const budget of [0,2500,6000])
for (const noodstroom of [false,true]) {
  if (pv === "nee" && panelen !== 6) continue;
  combinaties.push({ personen, pv, panelen, contract, fase:"weet-niet", installatie,
                     homey:false, ha:false, noodstroom, budget, apparaten:0 });
}

async function meet(browser, label) {
  const pagina = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await pagina.goto(`http://127.0.0.1:${poort}/advies.html`, { waitUntil: "networkidle" });
  const rijen = await pagina.evaluate(async (cs) => {
    const el = (i) => document.getElementById(i);
    const zet = (i, v) => { el(i).value = String(v); el(i).dispatchEvent(new Event("change", { bubbles: true })); };
    const vink = (i, a) => { el(i).checked = a; el(i).dispatchEvent(new Event("change", { bubbles: true })); };
    el("advStart").click();
    const uit = [];
    for (const c of cs) {
      zet("advPersonen", c.personen); zet("advPv", c.pv); zet("advPanelen", c.panelen);
      el("advPanelen").dispatchEvent(new Event("input", { bubbles: true }));
      zet("advContract", c.contract); zet("advFase", c.fase); zet("advInstallatie", c.installatie);
      vink("advHomey", c.homey); vink("advHA", c.ha); vink("advNoodstroom", c.noodstroom);
      zet("advBudget", c.budget);
      uit.push([...document.querySelectorAll("#adviesResultaat .kaart-kop h3, #adviesResultaat h3")]
        .map((h) => h.textContent.trim()).filter(Boolean).slice(0, 3));
    }
    return uit;
  }, combinaties);
  await pagina.close();

  const gevuld = rijen.filter((t) => t.length);
  const eersten = {}, drietallen = {};
  for (const t of gevuld) { eersten[t[0]] = (eersten[t[0]] || 0) + 1; drietallen[t.join("|")] = 1; }
  const top = Object.entries(eersten).sort((a, b) => b[1] - a[1]);
  return { label, n: rijen.length, leeg: rijen.length - gevuld.length,
           eersten: Object.keys(eersten).length, drietallen: Object.keys(drietallen).length,
           winnaar: top[0], aandeel: Math.round(top[0][1] / gevuld.length * 100), lijst: top };
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
console.log(`${combinaties.length} antwoordcombinaties\n`);

if (BANDEN) {
  const PAD = resolve(ROOT, "assets/advies.js");
  const origineel = fs.readFileSync(PAD, "utf8");
  console.log("band          factor  nummers 1  top-3en  winnaar  leeg");
  try {
    for (const [onder, boven] of [[0.6,1.8],[0.8,1.4],[0.9,1.25]]) {
      fs.writeFileSync(PAD, origineel
        .replace(/const BAND_ONDER = [\d.]+;/, `const BAND_ONDER = ${onder};`)
        .replace(/const BAND_BOVEN = [\d.]+;/, `const BAND_BOVEN = ${boven};`));
      const r = await meet(browser, `${onder}/${boven}`);
      const factor = ((1.25 * boven) / (0.75 * onder)).toFixed(1);
      console.log(r.label.padEnd(9) + `x${factor}`.padStart(9) + String(r.eersten).padStart(10)
        + String(r.drietallen).padStart(9) + `${r.aandeel}%`.padStart(9) + `${Math.round(r.leeg / r.n * 100)}%`.padStart(6));
    }
  } finally {
    fs.writeFileSync(PAD, origineel);   // ook bij een fout de bron ongemoeid laten
    console.log("\nassets/advies.js teruggezet zoals het was.");
  }
} else {
  const r = await meet(browser, "huidig");
  console.log(`verschillende batterijen op nummer 1 : ${r.eersten}`);
  console.log(`verschillende top-3en                : ${r.drietallen}`);
  console.log(`zonder resultaat                     : ${Math.round(r.leeg / r.n * 100)}%`);
  console.log(`\nnummer 1, naar aandeel:`);
  for (const [naam, aantal] of r.lijst) {
    console.log(`  ${String(Math.round(aantal / (r.n - r.leeg) * 100)).padStart(3)}%  ${naam}`);
  }
}

await browser.close();
server.close();
