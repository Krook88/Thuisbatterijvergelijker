#!/usr/bin/env node
/**
 * Hoeveel verschillende adviezen geeft de keuzehulp eigenlijk?
 *
 * Zelfde vraag als op batterijmaatje, waar bleek dat 12.960 antwoordcombinaties
 * maar 42 verschillende top-3en opleverden. Dit script voert de echte keuzehulp
 * in een browser alle combinaties en telt de uitkomsten. Bewust de echte module
 * en geen nagebouwde kopie: anders meet je je kopie.
 *
 * Gebruik:
 *   node scripts/keuzehulp-spreiding.mjs
 */

import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
for (const gas of [800, 1200, 1800, 2500])
for (const cvKetel of ["recent", "oud", "geen"])
for (const isolatie of ["goed", "redelijk", "matig"])
for (const afgifte of ["vloer", "mix", "radiatoren"])
for (const buren of ["vrij", "dichtbij"])
for (const smartHome of ["geen", "home_assistant", "homey"])
for (const zon of [false, true])
for (const batterij of [false, true]) {
  combinaties.push({ gas, cvKetel, isolatie, afgifte, buren, smartHome, zon, batterij });
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const pagina = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await pagina.goto(`http://127.0.0.1:${poort}/advies.html`, { waitUntil: "networkidle" });
console.log(`${combinaties.length} antwoordcombinaties\n`);

const rijen = await pagina.evaluate(async (cs) => {
  const el = (i) => document.getElementById(i);
  const zet = (i, v) => { el(i).value = String(v); el(i).dispatchEvent(new Event("change", { bubbles: true })); };
  const vink = (i, a) => { el(i).checked = a; el(i).dispatchEvent(new Event("change", { bubbles: true })); };
  const uit = [];
  for (const c of cs) {
    zet("gasverbruik", c.gas); zet("cvKetel", c.cvKetel); zet("isolatie", c.isolatie);
    zet("afgifte", c.afgifte); zet("buren", c.buren); zet("smartHome", c.smartHome);
    vink("checkZon", c.zon); vink("checkBatterij", c.batterij);
    const namen = [...document.querySelectorAll("#adviesInhoud .advies-kaart h3")]
      .map((h) => h.textContent.trim()).filter(Boolean);
    const type = (el("adviesInhoud")?.innerText || "").match(/all-electric|hybride/i);
    uit.push({ top: namen.slice(0, 3), type: type ? type[0].toLowerCase() : "?" });
  }
  return uit;
}, combinaties);

// Welke vraag verandert het advies eigenlijk? Een vraag die de uitkomst nooit
// verandert kost de bezoeker moeite en levert hem niets - dat was op
// batterijmaatje de scherpste bevinding, dus meten we het hier ook.
const velden = ["gas","cvKetel","isolatie","afgifte","buren","smartHome","zon","batterij"];
const sleutel = (c, zonder) => velden.filter((v) => v !== zonder).map((v) => c[v]).join("|");
const invloed = [];
for (const veld of velden) {
  const groepen = new Map();
  combinaties.forEach((c, i) => {
    const k = sleutel(c, veld);
    if (!groepen.has(k)) groepen.set(k, new Set());
    // Op het hele drietal meten, niet op de eerste kaart. Sinds de drie assen
    // is kaart 1 altijd de pasvorm; de andere vragen sturen kaart 2 en 3, en
    // die zou je missen als je alleen naar de kop kijkt.
    groepen.get(k).add(rijen[i].top.join("|") || "(geen)");
  });
  let wisselt = 0;
  for (const set of groepen.values()) if (set.size > 1) wisselt++;
  invloed.push([veld, Math.round(wisselt / groepen.size * 100)]);
}

const gevuld = rijen.filter((r) => r.top.length);
const eersten = {}, drietallen = {}, ooit = new Set(), types = {};
for (const r of gevuld) {
  eersten[r.top[0]] = (eersten[r.top[0]] || 0) + 1;
  drietallen[r.top.join("|")] = 1;
  for (const n of r.top) ooit.add(n);
  types[r.type] = (types[r.type] || 0) + 1;
}
console.log(`verschillende pompen ooit getoond : ${ooit.size}`);
console.log(`verschillende eerste kaarten      : ${Object.keys(eersten).length}`);
console.log(`verschillende drietallen          : ${Object.keys(drietallen).length}`);
console.log(`zonder resultaat                  : ${Math.round((rijen.length - gevuld.length) / rijen.length * 100)}%`);
console.log(`\ngeadviseerd type: ${Object.entries(types).map(([k, v]) => `${k} ${Math.round(v / gevuld.length * 100)}%`).join(", ")}`);
console.log(`\nhoe vaak verandert het drietal als je alleen deze vraag anders beantwoordt?`);
for (const [veld, pct] of invloed.sort((a, b) => b[1] - a[1])) {
  console.log(`  ${veld.padEnd(11)}${String(pct).padStart(4)}%${pct === 0 ? "   << verandert nooit iets" : ""}`);
}

console.log(`\neerste kaart, naar aandeel:`);
for (const [naam, n] of Object.entries(eersten).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(Math.round(n / gevuld.length * 100)).padStart(3)}%  ${naam}`);
}

await browser.close();
server.close();
