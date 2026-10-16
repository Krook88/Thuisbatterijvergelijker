/* ==========================================================================
   Bezoekcijfers van Vercel Web Analytics, gedeeld door api/statistieken.js
   en api/bewaar-bezoek.js.

   Twee dingen die hier geregeld zijn:
   - De statistiekenpagina zelf telt niet mee. Sinds 15 oktober laadt die
     pagina het script van Vercel niet meer, maar wat er daarvoor gemeten is,
     staat er nog; FILTER laat het weg, ook uit de totalen.
   - Het verloop. Vercel bewaart op het gratis abonnement 31 dagen. Daarom
     kopieert bewaarBezoek() de dagcijfers van de laatste 31 dagen naar Redis
     (bezoek:<site>, veld = dag, waarde = "bezoekers|weergaven"), zonder
     vervaldatum. Eén keer per dag via de cron in vercel.json, en ook als het
     dashboard opent. Een dag wordt pas bewaard als hij voorbij is.
   ========================================================================== */

"use strict";

const { instellingen, opdrachten } = require("./_opslag");

const TEAM = "team_3Q2FvBRGQODhAhXNG1l8Rh5l";
const SITES = [
  { id: "bat", naam: "Batterijmaatje", project: "prj_zysv4GAPccLancOMdcQfFfYsOOZD" },
  { id: "pomp", naam: "Warmtepompmaatje", project: "prj_DXkh8j1iPy1Wni7ZPSnMgkFi37sU" },
  { id: "zon", naam: "Zonnestroommaatje", project: "prj_GMOVA08i5ouj51He5vIuuAn1mRt5" },
];
const FILTER = "environment eq 'production' and requestPath ne '/statistieken.html' and requestPath ne '/statistieken'";
const niet = (pad) => /^\/statistieken(\.html)?$/.test(String(pad || ""));

// Kent Vercel het filter niet (HTTP 400), dan zonder: liever cijfers met de
// statistiekenpagina erin dan geen cijfers.
let filterWerkt = true;

async function vercel(pad, params) {
  const token = process.env.STATISTIEK_TOKEN || process.env.VERCEL_TOKEN;
  if (!token) throw new Error("geen STATISTIEK_TOKEN ingesteld");
  const haal = async (metFilter) => {
    const zoek = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) for (const w of [].concat(v)) zoek.append(k, w);
    if (metFilter) zoek.append("filter", FILTER);
    return fetch(`https://api.vercel.com${pad}?${zoek}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
  };
  const metFilter = filterWerkt;
  let res = await haal(metFilter);
  if (res.status === 400 && metFilter) { filterWerkt = false; res = await haal(false); }
  if (!res.ok) throw new Error(`Vercel gaf HTTP ${res.status}`);
  return (await res.json()).data;
}

const dagVan = (r) => String(r.timestamp || r.day || "").slice(0, 10);

/** Kopieert de afgelopen 31 dagen naar Redis. Geeft het aantal bewaarde dagen. */
async function bewaarBezoek(nu = new Date()) {
  const vandaag = nu.toISOString().slice(0, 10);
  const since = new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), nu.getUTCDate() - 30)).toISOString();
  const lijsten = await Promise.all(SITES.map((s) =>
    vercel("/v1/query/web-analytics/visits/aggregate", { projectId: s.project, teamId: TEAM, since, until: nu.toISOString(), by: "day", limit: 31 })
      .then((rijen) => ({ s, rijen }))));
  const opdr = [];
  for (const { s, rijen } of lijsten) {
    for (const r of rijen) {
      const dag = dagVan(r);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dag) && dag < vandaag) opdr.push(["HSET", `bezoek:${s.id}`, dag, `${r.visitors || 0}|${r.pageviews || 0}`]);
    }
  }
  if (opdr.length) await opdrachten(opdr);
  return opdr.length;
}

/** bewaarBezoek, maar hooguit één keer per uur. Geeft null als hij oversloeg. */
async function bewaarHooguitPerUur() {
  if (!instellingen()) return null;
  const [mag] = await opdrachten([["SET", "bezoek:laatst", String(Date.now()), "NX", "EX", 3600]]);
  if (mag !== "OK") return null;
  return bewaarBezoek();
}

/** Alle bewaarde dagen per site: { bat: [{dag, bezoekers, weergaven}], ... }. */
async function verloop() {
  if (!instellingen()) return null;
  const antwoorden = await opdrachten(SITES.map((s) => ["HGETALL", `bezoek:${s.id}`]));
  const uit = {};
  SITES.forEach((s, i) => {
    const lijst = antwoorden[i] || [];
    const rijen = [];
    for (let j = 0; j + 1 < lijst.length; j += 2) {
      const [b, w] = String(lijst[j + 1]).split("|").map(Number);
      rijen.push({ dag: lijst[j], bezoekers: b || 0, weergaven: w || 0 });
    }
    uit[s.id] = rijen.sort((a, b) => (a.dag < b.dag ? -1 : 1));
  });
  return uit;
}

module.exports = { TEAM, SITES, FILTER, niet, vercel, dagVan, bewaarBezoek, bewaarHooguitPerUur, verloop };
