/* ==========================================================================
   Prijsalarm: aanmelden, bevestigen, afmelden

   POST { actie: "aanmelden", batterij, email, drempel }  -> bevestigingsmail
   POST { actie: "bevestig", token }                      -> alarm loopt
   POST { actie: "afmelden", token }                      -> alarm weg
   GET  ?bevestig=<token> of ?afmelden=<token>            -> door naar de
        batterijpagina, waar een knop de POST doet

   Waarom de links in de mail niet zelf bevestigen of afmelden: veel
   mailprogramma's en virusscanners openen links vooraf om ze te keuren. Een
   link die bij openen al iets doet, wordt dan door de scanner aangeklikt, en
   iemand is aangemeld of afgemeld zonder het zelf te doen. Een knop op de
   pagina drukt een scanner niet in.

   Opslag in dezelfde Upstash Redis als de teller (api/_opslag.js):
     pa:<token>          hash: email, batterij, drempel, status, aangemaakt,
                         prijsBijAanmelden, laatstGemeld
     pa:actief           set van tokens met status "actief"
     pa:adres:<email>    set van tokens per adres, voor de grens per adres
   Een onbevestigde aanmelding verloopt na twee dagen vanzelf.

   Mail via de mailserver van TransIP (api/_mail.js), met dezelfde
   omgevingsvariabelen als het contactformulier.
   ========================================================================== */

"use strict";

const { randomBytes } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { instellingen, opdrachten } = require("./_opslag");
const Mail = require("./_mail");
const PA = require("./_prijsalarm");

const MINIMALE_INVULTIJD_MS = 2000;
const RATELIMIET_AANTAL = 5;
const RATELIMIET_VENSTER_MS = 10 * 60 * 1000;
const verzoeken = new Map();
const eur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

function magVerzenden(ip) {
  const nu = Date.now();
  const eerder = (verzoeken.get(ip) || []).filter((t) => nu - t < RATELIMIET_VENSTER_MS);
  if (eerder.length >= RATELIMIET_AANTAL) return false;
  eerder.push(nu);
  verzoeken.set(ip, eerder);
  if (verzoeken.size > 500) for (const [k, v] of verzoeken) if (!v.some((t) => nu - t < RATELIMIET_VENSTER_MS)) verzoeken.delete(k);
  return true;
}

function batterijen() {
  const data = JSON.parse(readFileSync(join(process.cwd(), "data", "site", "batterijen.json"), "utf8"));
  return data.batterijen || data;
}

function site(req) {
  const host = String(req.headers.host || "").toLowerCase();
  return /^[a-z0-9.-]+(:\d+)?$/.test(host) ? host : "batterijmaatje.nl";
}

const geldigToken = (t) => typeof t === "string" && /^[a-f0-9]{32}$/.test(t);

async function lees(token) {
  const [velden] = await opdrachten([["HGETALL", `pa:${token}`]]);
  if (!Array.isArray(velden) || !velden.length) return null;
  const uit = {};
  for (let i = 0; i < velden.length; i += 2) uit[velden[i]] = velden[i + 1];
  return uit;
}

function naam(b) { return `${b.merk} ${b.model}`; }

async function aanmelden(req, res, invoer) {
  if (String(invoer.website || "")) return res.status(200).json({ ok: true, bericht: "Kijk in je mail om het alarm te bevestigen." });
  const geopend = Number(invoer.geopend_op);
  if (Number.isFinite(geopend) && geopend > 0 && Date.now() - geopend >= 0 && Date.now() - geopend < MINIMALE_INVULTIJD_MS) {
    return res.status(400).json({ fout: "Dat ging wel erg snel. Probeer het nog een keer." });
  }
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "onbekend";
  if (!magVerzenden(ip)) return res.status(429).json({ fout: "Er zijn net meerdere alarmen aangevraagd. Probeer het over een paar minuten opnieuw." });

  const lijst = batterijen();
  const n = PA.nakijken(invoer, lijst);
  if (n.fout) return res.status(400).json({ fout: n.fout, veld: n.veld });

  // Grens per adres. Verlopen aanmeldingen staan nog in de set; die tellen
  // niet mee en gaan er hier uit.
  const [tokens] = await opdrachten([["SMEMBERS", `pa:adres:${n.email}`]]);
  const bestaan = tokens && tokens.length ? await opdrachten(tokens.map((t) => ["EXISTS", `pa:${t}`])) : [];
  const weg = (tokens || []).filter((t, i) => !bestaan[i]);
  if (weg.length) await opdrachten([["SREM", `pa:adres:${n.email}`, ...weg]]);
  if ((tokens || []).length - weg.length >= PA.MAX_PER_ADRES) {
    return res.status(400).json({ fout: `Op dit adres lopen al ${PA.MAX_PER_ADRES} prijsalarmen. Meld er eerst een af via de link in een eerdere mail.` });
  }

  const token = randomBytes(16).toString("hex");
  await opdrachten([
    ["HSET", `pa:${token}`, "email", n.email, "batterij", n.batterij, "drempel", String(n.drempel), "status", "wacht",
      "aangemaakt", new Date().toISOString(), "prijsBijAanmelden", n.prijsBijAanmelden === null ? "" : String(n.prijsBijAanmelden)],
    ["EXPIRE", `pa:${token}`, String(PA.BEVESTIG_BINNEN_S)],
    ["SADD", `pa:adres:${n.email}`, token],
  ]);

  const b = lijst.find((x) => x.id === n.batterij);
  const host = site(req);
  const link = `https://${host}/api/prijsalarm?bevestig=${token}`;
  const voorwaarde = `zodra de beste winkelprijs op of onder ${eur.format(n.drempel)} komt`;
  try {
    await Mail.verstuur({
      aan: n.email,
      onderwerp: `Bevestig je prijsalarm voor de ${naam(b)}`,
      tekst: [
        "Hallo,",
        "",
        `Iemand, hopelijk jij, vroeg op ${host} om een mail ${voorwaarde} voor de ${naam(b)}.`,
        "",
        `Bevestig dat via deze link: ${link}`,
        "",
        "Deed je dit niet, dan hoef je niets te doen. Zonder bevestiging vervalt de aanvraag na twee dagen en hoor je niets meer van me.",
      ].join("\n"),
      html: Mail.mailOpmaak({
        titel: "Bevestig je prijsalarm",
        intro: `Iemand, hopelijk jij, vroeg om een mail ${Mail.ontsnap(voorwaarde)} voor de <b>${Mail.ontsnap(naam(b))}</b>. ` +
          `<a href="${Mail.ontsnap(link)}" style="color:${Mail.KLEUR.primair};font-weight:700;">Bevestig het prijsalarm</a>.`,
        rijen: [],
        bericht: "",
        voettekst: "Deed je dit niet, dan hoef je niets te doen. Zonder bevestiging vervalt de aanvraag na twee dagen.",
        site: host,
      }),
    });
  } catch (f) {
    console.error("prijsalarm: bevestigingsmail mislukt:", f.message);
    await opdrachten([["DEL", `pa:${token}`], ["SREM", `pa:adres:${n.email}`, token]]);
    return res.status(502).json({ fout: "De bevestigingsmail kon niet verstuurd worden. Probeer het later nog eens." });
  }
  return res.status(200).json({ ok: true, bericht: `Kijk in je mail (${n.email}) en bevestig het alarm. Daarna krijg je bericht ${voorwaarde}.` });
}

async function bevestig(res, token) {
  const a = await lees(token);
  if (!a) return res.status(404).json({ fout: "Dit alarm bestaat niet meer. Een aanvraag die niet binnen twee dagen bevestigd wordt, vervalt; vraag hem opnieuw aan." });
  await opdrachten([["HSET", `pa:${token}`, "status", "actief"], ["PERSIST", `pa:${token}`], ["SADD", "pa:actief", token]]);
  return res.status(200).json({ ok: true, bericht: `Je prijsalarm loopt. Je krijgt een mail zodra de prijs op of onder ${eur.format(Number(a.drempel))} komt.` });
}

async function afmelden(res, token) {
  const a = await lees(token);
  if (!a) return res.status(200).json({ ok: true, bericht: "Dit alarm bestond al niet meer. Je krijgt er geen mail meer over." });
  await opdrachten([["DEL", `pa:${token}`], ["SREM", "pa:actief", token], ["SREM", `pa:adres:${a.email}`, token]]);
  return res.status(200).json({ ok: true, bericht: "Je prijsalarm is gestopt. Je krijgt er geen mail meer over." });
}

function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(String(req.body || "{}")); } catch { return {}; }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  if (!instellingen() || !Mail.ingesteld()) {
    return res.status(503).json({ fout: "Het prijsalarm is nog niet ingesteld." });
  }
  try {
    if (req.method === "GET") {
      // Uit de mail: door naar de batterijpagina, waar een knop de actie doet.
      const q = req.query || {};
      const soort = q.bevestig ? "bevestig" : q.afmelden ? "afmelden" : null;
      const token = q.bevestig || q.afmelden;
      if (!soort || !geldigToken(token)) { res.statusCode = 302; res.setHeader("Location", "/"); return res.end(); }
      const a = await lees(token);
      const pad = a && /^[a-z0-9-]+$/.test(a.batterij) ? `/batterij/${a.batterij}.html` : "/";
      res.statusCode = 302;
      res.setHeader("Location", `${pad}?prijsalarm=${soort}&t=${token}#prijsalarm`);
      return res.end();
    }
    if (req.method !== "POST") return res.status(405).json({ fout: "Alleen POST of een link uit de mail." });
    const invoer = body(req);
    if (invoer.actie === "aanmelden") return await aanmelden(req, res, invoer);
    if (!geldigToken(invoer.token)) return res.status(400).json({ fout: "Deze link klopt niet." });
    if (invoer.actie === "bevestig") return await bevestig(res, invoer.token);
    if (invoer.actie === "afmelden") return await afmelden(res, invoer.token);
    return res.status(400).json({ fout: "Onbekende actie." });
  } catch (f) {
    console.error("prijsalarm:", f.message);
    return res.status(502).json({ fout: "Er ging iets mis. Probeer het later nog eens." });
  }
};
