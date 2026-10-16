/* ==========================================================================
   Gegevens voor batterijmaatje.nl/statistieken, achter een wachtwoord.

   Haalt per site de bezoekcijfers op bij Vercel Web Analytics en telt daar de
   eigen teller bij op (doorklikken en verblijfstijd, zie api/teller.js). De
   pagina zelf is statisch; zonder het goede wachtwoord geeft deze functie
   niets terug.

   Instellen (Vercel -> project batterijmaatje -> Settings -> Environment
   Variables):
     DASHBOARD_WACHTWOORD  het wachtwoord voor de pagina
     STATISTIEK_TOKEN      een toegangssleutel van Vercel (Account Settings ->
                           Tokens), met leesrechten op het team. VERCEL_TOKEN
                           werkt ook.
   Plus de opslag uit api/_opslag.js voor doorklikken, verblijfstijd en het
   verloop over langere tijd (zie api/_bezoek.js).
   ========================================================================== */

"use strict";

const crypto = require("node:crypto");
const { instellingen, opdrachten } = require("./_opslag");
const { TEAM, SITES, niet, vercel, dagVan, bewaarHooguitPerUur, verloop } = require("./_bezoek");
const PERIODES = [7, 14, 30];
const BLOKJES = ["0-10s", "10-30s", "30s-2m", "2-10m", "10m+"];

// Een wachtwoord raden kost tijd: per IP vijf pogingen per kwartier.
const POGINGEN = 5;
const VENSTER_MS = 15 * 60 * 1000;
const mislukt = new Map();

function magProberen(ip) {
  const nu = Date.now();
  const eerder = (mislukt.get(ip) || []).filter((t) => nu - t < VENSTER_MS);
  mislukt.set(ip, eerder);
  return eerder.length < POGINGEN;
}

// Spaties en regeleinden aan de randen tellen niet mee: die komen er makkelijk
// bij als je het wachtwoord in Vercel of in het veld plakt.
function juistWachtwoord(gegeven) {
  const echt = (process.env.DASHBOARD_WACHTWOORD || "").trim();
  if (!echt) return false;
  const a = crypto.createHash("sha256").update(String(gegeven || "").trim()).digest();
  const b = crypto.createHash("sha256").update(echt).digest();
  return crypto.timingSafeEqual(a, b);
}

function gegevens(req) {
  let ruw = req.body;
  if (Buffer.isBuffer(ruw)) ruw = ruw.toString("utf8");
  if (typeof ruw === "string") { try { ruw = JSON.parse(ruw); } catch { return {}; } }
  return ruw && typeof ruw === "object" ? ruw : {};
}

function venster(dagen) {
  const nu = new Date();
  const start = new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), nu.getUTCDate() - (dagen - 1)));
  const lijst = [];
  for (let d = new Date(start); d <= nu; d.setUTCDate(d.getUTCDate() + 1)) lijst.push(d.toISOString().slice(0, 10));
  return { since: start.toISOString(), until: nu.toISOString(), dagen: lijst };
}

async function bezoek(site, v) {
  const basis = { projectId: site.project, teamId: TEAM, since: v.since, until: v.until };
  const per = (by, limit) => vercel("/v1/query/web-analytics/visits/aggregate", { ...basis, by, limit });
  const [totaal, perDag, paginas, herkomst, apparaat] = await Promise.all([
    vercel("/v1/query/web-analytics/visits/count", basis),
    per("day", 31), per("requestPath", 10), per("referrerHostname", 8), per("deviceType", 5),
  ]);
  return {
    totaal: { bezoekers: totaal.visitors || 0, weergaven: totaal.pageviews || 0 },
    perDag: perDag.map((r) => ({ dag: dagVan(r), bezoekers: r.visitors, weergaven: r.pageviews })),
    paginas: paginas.filter((r) => !niet(r.requestPath)).map((r) => ({ pagina: r.requestPath, bezoekers: r.visitors, weergaven: r.pageviews })),
    herkomst: herkomst.map((r) => ({ herkomst: r.referrerHostname || "", bezoekers: r.visitors, weergaven: r.pageviews })),
    apparaat: apparaat.map((r) => ({ apparaat: r.deviceType || "", bezoekers: r.visitors, weergaven: r.pageviews })),
  };
}

function paren(lijst) {
  const uit = {};
  for (let i = 0; i + 1 < (lijst || []).length; i += 2) uit[lijst[i]] = Number(lijst[i + 1]) || 0;
  return uit;
}

async function eigenTeller(v) {
  if (!instellingen()) return { ingesteld: false };
  const antwoorden = await opdrachten(v.dagen.flatMap((d) => [["HGETALL", `klik:${d}`], ["HGETALL", `tijd:${d}`]]));
  const kliks = new Map();
  const tijd = new Map();
  antwoorden.forEach((r, i) => {
    for (const [veld, n] of Object.entries(paren(r))) {
      // De statistiekenpagina zelf telt niet; zie api/_bezoek.js.
      if (niet(veld.split("|")[i % 2 === 0 ? 3 : 1])) continue;
      if (i % 2 === 0) {
        kliks.set(veld, (kliks.get(veld) || 0) + n);
      } else {
        const delen = veld.split("|");
        const soort = delen.pop();
        const sleutel = delen.join("|");
        const rij = tijd.get(sleutel) || { n: 0, sec: 0, blokjes: Object.fromEntries(BLOKJES.map((b) => [b, 0])) };
        if (soort === "n") rij.n += n;
        else if (soort === "sec") rij.sec += n;
        else if (soort in rij.blokjes) rij.blokjes[soort] += n;
        tijd.set(sleutel, rij);
      }
    }
  });
  return {
    ingesteld: true,
    kliks: [...kliks].map(([veld, aantal]) => {
      const [site, domein, product, pagina] = veld.split("|");
      return { site, domein, product, pagina, aantal };
    }).sort((a, b) => b.aantal - a.aantal),
    tijd: [...tijd].map(([veld, rij]) => {
      const [site, pagina] = veld.split("|");
      return { site, pagina, ...rij };
    }).sort((a, b) => b.n - a.n),
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  if (req.method !== "POST") { res.status(405).json({ fout: "alleen POST" }); return; }
  if (!(process.env.DASHBOARD_WACHTWOORD || "").trim()) { res.status(503).json({ fout: "Er is nog geen DASHBOARD_WACHTWOORD ingesteld in Vercel." }); return; }

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "onbekend";
  if (!magProberen(ip)) { res.status(429).json({ fout: "Te vaak een verkeerd wachtwoord. Probeer het over een kwartier opnieuw." }); return; }
  const g = gegevens(req);
  if (!juistWachtwoord(g.wachtwoord)) {
    mislukt.get(ip).push(Date.now());
    res.status(401).json({ fout: "Dat wachtwoord klopt niet." });
    return;
  }

  const dagen = PERIODES.includes(Number(g.dagen)) ? Number(g.dagen) : 7;
  const v = venster(dagen);
  const fouten = [];
  const sites = await Promise.all(SITES.map(async (s) => {
    try { return { id: s.id, naam: s.naam, ...(await bezoek(s, v)) }; } catch (f) {
      fouten.push(`${s.naam}: ${f.message}`);
      return { id: s.id, naam: s.naam, fout: f.message };
    }
  }));
  let teller;
  try { teller = await eigenTeller(v); } catch (f) {
    fouten.push(`Eigen teller: ${f.message}`);
    teller = { ingesteld: true, fout: f.message };
  }
  let lang = null;
  try {
    await bewaarHooguitPerUur();
    lang = await verloop();
  } catch (f) {
    fouten.push(`Verloop: ${f.message}`);
  }
  res.status(200).json({ periode: { dagen, since: v.since, until: v.until, lijst: v.dagen }, sites, teller, verloop: lang, fouten });
};
