/* ==========================================================================
   Ontvanger van de eigen teller (assets/teller.js op de drie sites).

   Telt per dag op hoe vaak er naar een andere site wordt doorgeklikt (per
   site, domein, product en pagina) en hoe lang pagina's zichtbaar open
   stonden (in blokjes, plus het totaal aan seconden om een gemiddelde te
   kunnen geven). Er wordt geen IP-adres, geen browserkenmerk en geen tijdstip
   per bezoek bewaard: alleen tellers per dag, die na 400 dagen vervallen.

   De drie sites sturen hierheen met navigator.sendBeacon. Dat is een
   eenvoudig verzoek zonder voorafgaande CORS-controle, dus de controle op
   herkomst gebeurt hier: alleen de eigen domeinen worden geteld.
   ========================================================================== */

"use strict";

const { instellingen, opdrachten } = require("./_opslag");

const HERKOMST = new Set([
  "https://batterijmaatje.nl", "https://www.batterijmaatje.nl",
  "https://warmtepompmaatje.nl", "https://www.warmtepompmaatje.nl",
  "https://zonnestroommaatje.nl", "https://www.zonnestroommaatje.nl",
]);
const SITES = new Set(["bat", "pomp", "zon"]);
const BEWAAR_SECONDEN = 400 * 24 * 3600;

// De grenzen van de blokjes, in seconden. Een gemiddelde alleen zegt weinig
// als de helft na drie tellen weg is en de rest een kwartier blijft.
const BLOKJES = [[10, "0-10s"], [30, "10-30s"], [120, "30s-2m"], [600, "2-10m"], [Infinity, "10m+"]];
// Een tabblad dat een nacht open stond is geen lezer van acht uur.
const MAX_SECONDEN = 1800;

function blokje(sec) {
  return BLOKJES.find(([grens]) => sec < grens)[1];
}

function gegevens(req) {
  let ruw = req.body;
  if (Buffer.isBuffer(ruw)) ruw = ruw.toString("utf8");
  if (typeof ruw === "string") {
    if (ruw.length > 1000) return null;
    try { ruw = JSON.parse(ruw); } catch { return null; }
  }
  return ruw && typeof ruw === "object" ? ruw : null;
}

const DOMEIN = /^[a-z0-9.-]{1,80}$/;
const PRODUCT = /^[a-z0-9-]{0,80}$/;
const PAD = /^\/[A-Za-z0-9._\/-]{0,119}$/;

/** De Redis-opdrachten voor één bericht, of null als het bericht niet deugt. */
function teOpdrachten(g, dag) {
  if (!g || !SITES.has(g.s)) return null;
  if (g.t === "klik") {
    if (!DOMEIN.test(String(g.w || "")) || !PRODUCT.test(String(g.p || "")) || !PAD.test(String(g.b || ""))) return null;
    const sleutel = `klik:${dag}`;
    return [["HINCRBY", sleutel, `${g.s}|${g.w}|${g.p}|${g.b}`, 1], ["EXPIRE", sleutel, BEWAAR_SECONDEN]];
  }
  if (g.t === "tijd") {
    const sec = Number(g.d);
    if (!PAD.test(String(g.b || "")) || !Number.isFinite(sec) || sec < 0) return null;
    const telt = Math.min(Math.round(sec), MAX_SECONDEN);
    const sleutel = `tijd:${dag}`;
    const basis = `${g.s}|${g.b}`;
    return [
      ["HINCRBY", sleutel, `${basis}|n`, 1],
      ["HINCRBY", sleutel, `${basis}|sec`, telt],
      ["HINCRBY", sleutel, `${basis}|${blokje(telt)}`, 1],
      ["EXPIRE", sleutel, BEWAAR_SECONDEN],
    ];
  }
  return null;
}

module.exports = async function handler(req, res) {
  const herkomst = req.headers.origin || "";
  if (HERKOMST.has(herkomst)) res.setHeader("Access-Control-Allow-Origin", herkomst);
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).end(); return; }
  if (!HERKOMST.has(herkomst)) { res.status(403).end(); return; }
  // Zonder opslag is er niets te tellen; de site moet daar niet over struikelen.
  if (!instellingen()) { res.status(204).end(); return; }

  const lijst = teOpdrachten(gegevens(req), new Date().toISOString().slice(0, 10));
  if (!lijst) { res.status(400).end(); return; }
  try {
    await opdrachten(lijst);
  } catch (fout) {
    console.error("Teller:", fout && fout.message);
  }
  res.status(204).end();
};

module.exports.teOpdrachten = teOpdrachten;
module.exports.blokje = blokje;
