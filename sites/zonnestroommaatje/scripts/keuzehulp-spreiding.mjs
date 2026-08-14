#!/usr/bin/env node
/**
 * Hoeveel verschillende adviezen geeft de keuzehulp eigenlijk?
 *
 * Zelfde meting als op batterijmaatje en warmtepompmaatje. Daar bleek dat een
 * gewogen ranglijst waarvan je de kop toont altijd dezelfde buren oplevert, en
 * dat sommige vragen de uitkomst helemaal nooit veranderden. Dit script voert
 * de echte keuzehulp in een browser alle antwoordcombinaties en telt mee.
 * Bewust de echte module en geen nagebouwde kopie: anders meet je je kopie.
 *
 * Deze site adviseert twee dingen tegelijk - panelen en omvormers - en die
 * worden apart geteld: het is heel goed mogelijk dat de ene lijst varieert en
 * de andere niet.
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
for (const verbruik of [1800, 4500])
for (const dakligging of ["0.9", "0.75"])
for (const maxPanelen of [6, 20])
for (const auto of [false, true])
for (const warmtepomp of [false, true])
for (const batterijPlan of ["nee", "later", "ja"])
for (const smartHome of ["geen", "home_assistant", "homey"])
for (const voorkeur of ["prijs", "rendement", "zekerheid"])
for (const fullBlack of [false, true])
for (const schaduw of ["geen", "beetje", "veel"]) {
  combinaties.push({ verbruik, dakligging, maxPanelen, auto, warmtepomp, batterijPlan, smartHome, voorkeur, fullBlack, schaduw });
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const pagina = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await pagina.goto(`http://127.0.0.1:${poort}/advies.html`, { waitUntil: "networkidle" });
console.log(`${combinaties.length} antwoordcombinaties\n`);

const rijen = await pagina.evaluate(async (cs) => {
  const el = (i) => document.getElementById(i);
  const zet = (i, v) => { const n = el(i); if (!n) return; n.value = String(v); n.dispatchEvent(new Event("change", { bubbles: true })); n.dispatchEvent(new Event("input", { bubbles: true })); };
  const vink = (i, a) => { const n = el(i); if (!n) return; n.checked = a; n.dispatchEvent(new Event("change", { bubbles: true })); };
  const uit = [];
  for (const c of cs) {
    zet("verbruik", c.verbruik); zet("dakligging", c.dakligging); zet("maxPanelen", c.maxPanelen);
    vink("checkAuto", c.auto); vink("checkWarmtepomp", c.warmtepomp);
    zet("batterijPlan", c.batterijPlan); zet("smartHome", c.smartHome);
    zet("voorkeur", c.voorkeur); vink("checkFullBlack", c.fullBlack); zet("schaduw", c.schaduw);
    const koppen = [...document.querySelectorAll("#adviesInhoud .advies-kaart h3")].map((h) => h.textContent.trim()).filter(Boolean);
    // De paneeladviezen staan met een link naar paneel/, de omvormers zonder.
    const panelen = [...document.querySelectorAll("#adviesInhoud .advies-kaart h3 a[href^='paneel/']")].map((a) => a.textContent.trim());
    const omvormers = koppen.filter((k) => !panelen.includes(k));
    uit.push({ panelen: panelen.slice(0, 3), omvormers: omvormers.slice(0, 2) });
  }
  return uit;
}, combinaties);

const velden = ["verbruik","dakligging","maxPanelen","auto","warmtepomp","batterijPlan","smartHome","voorkeur","fullBlack","schaduw"];
const sleutel = (c, zonder) => velden.filter((v) => v !== zonder).map((v) => c[v]).join("|");

function rapport(naam, haal) {
  const setjes = {}, ooit = new Set();
  for (const r of rijen) { const t = haal(r); if (!t.length) continue; setjes[t.join("|")] = 1; for (const n of t) ooit.add(n); }
  console.log(`\n${naam}`);
  console.log(`  verschillende combinaties : ${Object.keys(setjes).length}`);
  console.log(`  ooit getoond              : ${ooit.size}`);
  const invloed = [];
  for (const veld of velden) {
    const groepen = new Map();
    combinaties.forEach((c, i) => {
      const k = sleutel(c, veld);
      if (!groepen.has(k)) groepen.set(k, new Set());
      groepen.get(k).add(haal(rijen[i]).join("|") || "(geen)");
    });
    let wisselt = 0;
    for (const set of groepen.values()) if (set.size > 1) wisselt++;
    invloed.push([veld, Math.round(wisselt / groepen.size * 100)]);
  }
  console.log(`  invloed per vraag:`);
  for (const [veld, pct] of invloed.sort((a, b) => b[1] - a[1])) {
    console.log(`    ${veld.padEnd(13)}${String(pct).padStart(4)}%${pct === 0 ? "   << verandert nooit iets" : ""}`);
  }
}

rapport("Panelen (top 3)", (r) => r.panelen);
rapport("Omvormers (top 2)", (r) => r.omvormers);

await browser.close();
server.close();
