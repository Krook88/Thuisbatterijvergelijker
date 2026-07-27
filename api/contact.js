/* ==========================================================================
   Contactformulier - serverloze functie op Vercel
   ==========================================================================

   De site is verder volledig statisch. Deze ene functie bestaat omdat een
   formulier iets moet doen met wat de bezoeker invult: het bericht wordt per
   mail doorgestuurd naar het adres uit CONTACT_AAN.

   Waarom niet gewoon een mailto-link? Die opent het mailprogramma van de
   bezoeker, en op telefoons of bij webmail werkt dat vaak niet. Bovendien
   moet iemand dan zelf bedenken wat hij erin zet; een formulier vraagt om de
   dingen waar je iets aan hebt.

   Instellen (Vercel: Settings -> Environment Variables):

     RESEND_API_KEY   Sleutel van resend.com. Zonder deze sleutel accepteert
                      het formulier niets en krijgt de bezoeker het mailadres
                      te zien, in plaats van dat zijn bericht stilletjes
                      verdwijnt.
     CONTACT_AAN      Ontvanger, bijvoorbeeld info@batterijmaatje.nl.
     CONTACT_VAN      Afzender op een domein dat bij Resend geverifieerd is,
                      bijvoorbeeld formulier@batterijmaatje.nl. De bezoeker
                      komt in Reply-To te staan, zodat "beantwoorden" naar hem
                      gaat en niet naar het formulier.

   Zolang RESEND_API_KEY ontbreekt geeft de functie een nette melding met het
   mailadres erin. Het formulier is dan dus niet stuk, alleen niet actief.
   ========================================================================== */

"use strict";

const FALLBACK_ADRES = "info@batterijmaatje.nl";

const LIMIETEN = {
  naam: 100,
  email: 254,
  onderwerp: 150,
  bericht: 5000,
};

// Een mens heeft tijd nodig om een formulier in te vullen. Een bot plakt zijn
// tekst er in milliseconden in. Dit is geen waterdichte controle, maar het
// scheelt het gros van de geautomatiseerde troep zonder de bezoeker lastig te
// vallen met een puzzel.
const MINIMALE_INVULTIJD_MS = 3000;

// Grofmazige rem per IP. Serverloze functies draaien in meerdere instanties,
// dus dit vangt niet alles af; het beperkt vooral herhaald verzenden vanaf
// dezelfde bezoeker. Echte bescherming tegen een gerichte aanval hoort in de
// firewall van Vercel, niet hier.
const RATELIMIET_AANTAL = 5;
const RATELIMIET_VENSTER_MS = 10 * 60 * 1000;
const verzendingen = new Map();

function magVerzenden(ip) {
  const nu = Date.now();
  const eerder = (verzendingen.get(ip) || []).filter((t) => nu - t < RATELIMIET_VENSTER_MS);
  if (eerder.length >= RATELIMIET_AANTAL) return false;
  eerder.push(nu);
  verzendingen.set(ip, eerder);
  // Oude IP's opruimen zodat de map niet blijft groeien binnen een instantie
  if (verzendingen.size > 500) {
    for (const [sleutel, tijden] of verzendingen) {
      if (!tijden.some((t) => nu - t < RATELIMIET_VENSTER_MS)) verzendingen.delete(sleutel);
    }
  }
  return true;
}

function tekst(waarde, maximum) {
  return String(waarde == null ? "" : waarde).trim().slice(0, maximum);
}

// Bewust ruim: een adres definitief valideren kan alleen door er iets heen te
// sturen, en te streng afwijzen kost echte berichten.
function lijktOpEmail(waarde) {
  return /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(waarde);
}

function velden(req) {
  const body = req.body;
  if (!body) return {};
  if (typeof body === "string") {
    try { return JSON.parse(body); } catch { return Object.fromEntries(new URLSearchParams(body)); }
  }
  return body;
}

function wilJson(req) {
  return String(req.headers["accept"] || "").includes("application/json");
}

function antwoord(req, res, status, boodschap, veld) {
  if (wilJson(req)) {
    return res.status(status).json({ ok: status === 200, boodschap, veld });
  }
  // Zonder JavaScript: terug naar de pagina met de uitkomst in de URL, zodat
  // de bezoeker ziet wat er gebeurd is in plaats van een kale JSON-regel.
  const parameter = status === 200 ? "verzonden=1" : `fout=${encodeURIComponent(boodschap)}`;
  res.setHeader("Location", `/contact.html?${parameter}#formulier`);
  return res.status(303).end();
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return antwoord(req, res, 405, "Deze pagina verwacht een ingevuld formulier.");
  }

  const data = velden(req);

  // Honingpot: een veld dat onzichtbaar is voor bezoekers maar door veel bots
  // wordt ingevuld. Is het gevuld, dan doen we alsof alles goed ging: een bot
  // die een foutmelding krijgt, probeert het net zo lang tot het wel lukt.
  if (tekst(data.website, 100)) {
    return antwoord(req, res, 200, "Bedankt, je bericht is verstuurd.");
  }

  // De tijd komt van de klok van de bezoeker, en die kan verkeerd staan. Alleen
  // afwijzen bij een verschil dat klopt maar te klein is; loopt de klok voor
  // (negatief verschil) of ver achter, dan slaan we de controle over in plaats
  // van een echt bericht te weigeren.
  const geopend = Number(data.geopend_op);
  const invultijd = Date.now() - geopend;
  if (Number.isFinite(geopend) && invultijd >= 0 && invultijd < MINIMALE_INVULTIJD_MS) {
    return antwoord(req, res, 400, "Het formulier werd wel erg snel verstuurd. Probeer het nog een keer.");
  }

  const naam = tekst(data.naam, LIMIETEN.naam);
  const email = tekst(data.email, LIMIETEN.email);
  const onderwerp = tekst(data.onderwerp, LIMIETEN.onderwerp) || "Bericht via het contactformulier";
  const bericht = tekst(data.bericht, LIMIETEN.bericht);

  if (!naam) return antwoord(req, res, 400, "Vul je naam in.", "naam");
  if (!lijktOpEmail(email)) return antwoord(req, res, 400, "Vul een e-mailadres in waarop we je kunnen bereiken.", "email");
  if (bericht.length < 10) return antwoord(req, res, 400, "Schrijf even kort waar je bericht over gaat.", "bericht");

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "onbekend";
  if (!magVerzenden(ip)) {
    return antwoord(req, res, 429, "Er zijn net meerdere berichten verstuurd. Probeer het over een paar minuten opnieuw.");
  }

  const sleutel = process.env.RESEND_API_KEY;
  const aan = process.env.CONTACT_AAN || FALLBACK_ADRES;
  const van = process.env.CONTACT_VAN;

  if (!sleutel || !van) {
    console.warn("Contactformulier: RESEND_API_KEY of CONTACT_VAN ontbreekt, bericht niet verstuurd.");
    return antwoord(req, res, 503, `Het formulier is nog niet ingesteld. Mail zolang naar ${aan}.`);
  }

  const regels = [
    `Naam: ${naam}`,
    `E-mail: ${email}`,
    `Onderwerp: ${onderwerp}`,
    "",
    bericht,
    "",
    "---",
    `Verstuurd via het contactformulier op ${req.headers["host"] || "de site"}`,
  ];

  try {
    const reactie = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${sleutel}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: van,
        to: [aan],
        reply_to: email,
        subject: `[Contactformulier] ${onderwerp}`,
        text: regels.join("\n"),
      }),
    });

    if (!reactie.ok) {
      const details = await reactie.text();
      console.error("Contactformulier: Resend gaf", reactie.status, details.slice(0, 500));
      return antwoord(req, res, 502, `Het versturen lukte niet. Mail ons rechtstreeks op ${aan}.`);
    }
  } catch (fout) {
    console.error("Contactformulier: versturen mislukt:", fout && fout.message);
    return antwoord(req, res, 502, `Het versturen lukte niet. Mail ons rechtstreeks op ${aan}.`);
  }

  return antwoord(req, res, 200, "Bedankt, je bericht is verstuurd. Je krijgt doorgaans binnen een dag antwoord.");
};
