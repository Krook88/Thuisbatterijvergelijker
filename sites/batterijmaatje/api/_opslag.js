/* ==========================================================================
   Opslag voor de eigen teller: Upstash Redis, via zijn REST-ingang.

   Waarom Redis: een teller moet optellen terwijl er tegelijk bezoekers
   binnenkomen, en HINCRBY doet dat in één stap. Een bestand lezen, er één bij
   optellen en terugschrijven verliest tellingen zodra twee bezoeken elkaar
   kruisen. Upstash heeft een gratis laag die voor deze sites ruim volstaat.

   Instellen: Vercel -> project batterijmaatje -> Storage -> Upstash for Redis
   (gratis), verbinden met dit project. Dat zet de omgevingsvariabelen
   KV_REST_API_URL en KV_REST_API_TOKEN (of UPSTASH_REDIS_REST_URL en
   UPSTASH_REDIS_REST_TOKEN; beide namen werken). Zonder die variabelen doet
   de teller niets, en de statistiekenpagina zegt dat erbij.

   Bestanden in api/ die met een liggend streepje beginnen, maakt Vercel geen
   eigen adres van.
   ========================================================================== */

"use strict";

function instellingen() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

/** Voert een reeks Redis-opdrachten uit in één verzoek. Geeft de resultaten. */
async function opdrachten(lijst) {
  const inst = instellingen();
  if (!inst) throw new Error("geen opslag ingesteld");
  const res = await fetch(`${inst.url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${inst.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(lijst),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`opslag gaf HTTP ${res.status}`);
  const uit = await res.json();
  return uit.map((r) => {
    if (r && r.error) throw new Error(`opslag: ${r.error}`);
    return r ? r.result : null;
  });
}

module.exports = { instellingen, opdrachten };
