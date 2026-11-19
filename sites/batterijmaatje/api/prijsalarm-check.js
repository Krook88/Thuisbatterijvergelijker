/* ==========================================================================
   Prijsalarm: de dagelijkse ronde

   Vercel roept dit één keer per dag aan ("crons" in vercel.json), na de
   prijsupdate van 05:30 UTC en de deploy die daarop volgt. De prijzen komen
   uit data/site/batterijen.json van die deploy; welke alarmen een mail
   krijgen, beslist api/_prijsalarm.js (teMelden).

   Staat CRON_SECRET in Vercel, dan alleen met die sleutel (Vercel stuurt hem
   zelf mee), net als api/bewaar-bezoek.js.
   ========================================================================== */

"use strict";

const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { instellingen, opdrachten } = require("./_opslag");
const Mail = require("./_mail");
const PA = require("./_prijsalarm");

const SITE = "batterijmaatje.nl";
const eur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

function alsObject(velden) {
  const uit = {};
  for (let i = 0; i < (velden || []).length; i += 2) uit[velden[i]] = velden[i + 1];
  return uit;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  const geheim = process.env.CRON_SECRET;
  if (geheim && req.headers.authorization !== `Bearer ${geheim}`) return res.status(401).json({ fout: "geen toegang" });
  if (!instellingen() || !Mail.ingesteld()) return res.status(503).json({ fout: "opslag of mail niet ingesteld" });

  try {
    const data = JSON.parse(readFileSync(join(process.cwd(), "data", "site", "batterijen.json"), "utf8"));
    const batterijen = data.batterijen || data;
    const [tokens] = await opdrachten([["SMEMBERS", "pa:actief"]]);
    if (!tokens || !tokens.length) return res.status(200).json({ alarmen: 0, gemeld: 0 });
    const ruw = await opdrachten(tokens.map((t) => ["HGETALL", `pa:${t}`]));
    const alarmen = ruw.map((v, i) => Object.assign(alsObject(v), { token: tokens[i] }));
    // Een token zonder hash (handmatig gewist) hoort niet meer in de set.
    const wees = alarmen.filter((a) => !a.email).map((a) => a.token);
    if (wees.length) await opdrachten([["SREM", "pa:actief", ...wees]]);

    const lijst = PA.teMelden(alarmen.filter((a) => a.email), batterijen);
    const bode = Mail.postbode();
    let gemeld = 0;
    for (const { alarm, prijs, batterij } of lijst) {
      const naam = `${batterij.merk} ${batterij.model}`;
      const pagina = `https://${SITE}/batterij/${batterij.id}.html`;
      const af = `https://${SITE}/api/prijsalarm?afmelden=${alarm.token}`;
      try {
        await Mail.verstuur({
          aan: alarm.email,
          onderwerp: `Prijsalarm: de ${naam} kost nu ${eur.format(prijs)}`,
          tekst: [
            "Hallo,",
            "",
            `De ${naam} staat nu op ${eur.format(prijs)} incl. btw. Je vroeg om een mail bij ${eur.format(Number(alarm.drempel))} of minder.`,
            "",
            `Alle winkels en het prijsverloop: ${pagina}`,
            "",
            "Zakt de prijs nog verder, dan hoor je het weer. Blijft hij zo, dan niet.",
            `Geen mail meer over deze batterij: ${af}`,
          ].join("\n"),
          html: Mail.mailOpmaak({
            titel: `De ${naam} kost nu ${eur.format(prijs)}`,
            intro: `Je vroeg om een mail bij ${eur.format(Number(alarm.drempel))} of minder. ` +
              `<a href="${Mail.ontsnap(pagina)}" style="color:${Mail.KLEUR.primair};font-weight:700;">Bekijk alle winkels en het prijsverloop</a>.`,
            rijen: [],
            bericht: "",
            voettekst: `Zakt de prijs nog verder, dan hoor je het weer. Geen mail meer over deze batterij? Afmelden kan via ${af}`,
            site: SITE,
          }),
        }, bode);
        await opdrachten([["HSET", `pa:${alarm.token}`, "laatstGemeld", String(prijs), "gemeldOp", new Date().toISOString()]]);
        gemeld++;
      } catch (f) {
        console.error("prijsalarm-check: mail mislukt voor", alarm.token, f.message);
      }
    }
    return res.status(200).json({ alarmen: alarmen.length, gemeld });
  } catch (f) {
    console.error("prijsalarm-check:", f.message);
    return res.status(502).json({ fout: f.message });
  }
};
