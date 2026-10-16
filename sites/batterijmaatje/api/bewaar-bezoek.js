/* ==========================================================================
   Dagelijkse kopie van de bezoekcijfers naar Redis, voor het verloop op
   batterijmaatje.nl/statistieken (zie api/_bezoek.js). Vercel roept dit één
   keer per dag aan via "crons" in vercel.json.

   Staat CRON_SECRET in Vercel, dan alleen met die sleutel (Vercel stuurt hem
   zelf mee). Zonder sleutel mag iedereen hem aanroepen; dat kan geen kwaad,
   want hij kopieert alleen, en hooguit één keer per uur.
   ========================================================================== */

"use strict";

const { instellingen } = require("./_opslag");
const { bewaarHooguitPerUur } = require("./_bezoek");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  const geheim = process.env.CRON_SECRET;
  if (geheim && req.headers.authorization !== `Bearer ${geheim}`) { res.status(401).json({ fout: "geen toegang" }); return; }
  if (!instellingen()) { res.status(503).json({ fout: "geen opslag ingesteld" }); return; }
  try {
    const n = await bewaarHooguitPerUur();
    res.status(200).json(n === null ? { overgeslagen: "al gedaan dit uur" } : { bewaard: n });
  } catch (f) {
    console.error("bewaar-bezoek:", f.message);
    res.status(502).json({ fout: f.message });
  }
};
