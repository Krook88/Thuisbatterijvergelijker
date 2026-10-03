/**
 * Verwachtingen die al voorbij zijn.
 *
 * Op de pagina van de Marstek Venus E 3.0 stond in oktober 2026 nog dat de
 * opvolger "rond begin augustus 2026" geleverd zou worden. Op het moment van
 * schrijven klopte dat. Twee maanden later leest het als een site die niemand
 * meer bijhoudt, en dat is erger dan een fout bedrag: het zegt iets over alle
 * andere zinnen.
 *
 * datumteksten.mjs vangt al "geldt nog tot en met ...". Dit is de andere vorm:
 * een zin die iets verwacht ("verwacht", "pre-order", "eerste leveringen
 * vanaf") en daar een moment aan hangt (een maand, een kwartaal, Prinsjesdag).
 * Is dat moment voorbij, dan moet iemand de zin nakijken.
 *
 * Wat er bewust niet onder valt: een zin die terugkijkt. "Zendure verkocht dit
 * model in augustus 2026 nog als pre-order" blijft waar, ook in 2028, want hij
 * zegt wanneer het zo was. Zo hoort een verwachting ook geschreven te worden
 * als hij moet blijven staan.
 */

const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli",
  "augustus", "september", "oktober", "november", "december"];

const VERWACHT = /\b(?:verwacht(?:e|en)?|pre-?order|eerste leveringen|levering(?:en)? (?:rond|vanaf|in)|leverbaar vanaf|verzending vanaf|komt (?:rond|in)|gepland (?:voor|in))\b/i;

// Een zin die terugkijkt draagt zijn eigen peildatum en blijft waar.
const TERUGBLIK = /\b(?:was|waren|verkocht|verkochten|noemde|noemden|stond|stonden|had|hadden|kwam|kwamen)\b/i;

const MOMENT = new RegExp(
  String.raw`\b(?:(?:begin|medio|eind)\s+)?(${MAANDEN.join("|")})(?:\s+(20\d{2}))?\b` +
  String.raw`|\bQ([1-4])\s+(20\d{2})\b` +
  String.raw`|\bPrinsjesdag\s+(20\d{2})\b`,
  "gi");

/** Het laatste moment waarop de verwachting nog kan uitkomen. */
function einde(m, jaarUitZin) {
  if (m[1]) {
    const jaar = Number(m[2] || jaarUitZin);
    if (!jaar) return null;
    return new Date(jaar, MAANDEN.indexOf(m[1].toLowerCase()) + 1, 0, 23, 59, 59);
  }
  if (m[3]) return new Date(Number(m[4]), Number(m[3]) * 3, 0, 23, 59, 59);
  if (m[5]) return new Date(Number(m[5]), 8, 30, 23, 59, 59); // Prinsjesdag valt in september
  return null;
}

/** Zichtbare tekst in zinnen. Een punt in "Venus E 3.0" of "€ 1.199" breekt geen zin. */
export function zinnen(html) {
  const tekst = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
  return tekst.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(€])/);
}

/**
 * Geeft de zinnen terug die iets verwachten op een moment dat voorbij is.
 * Zonder jaartal in de zin gaat hij uit van het eerste jaartal dat er wel in
 * staat; staat er geen, dan laat hij de zin met rust in plaats van te gokken.
 */
export function verlopenVerwachtingen(html, nu = new Date()) {
  const uit = [];
  for (const zin of zinnen(html)) {
    if (!VERWACHT.test(zin) || TERUGBLIK.test(zin)) continue;
    const jaarUitZin = (zin.match(/\b(20\d{2})\b/) || [])[1];
    let laatste = null;
    for (const m of zin.matchAll(MOMENT)) {
      const e = einde(m, jaarUitZin);
      if (e && (!laatste || e > laatste)) laatste = e;
    }
    if (laatste && laatste < nu) uit.push({ zin: zin.trim(), tot: laatste });
  }
  return uit;
}
