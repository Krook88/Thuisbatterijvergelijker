/* ==========================================================================
   Prijsalarm - de beslissingen, los van mail en opslag

   Een bezoeker laat op een batterijpagina zijn e-mailadres achter, met of
   zonder bedrag. Zodra de beste winkelprijs onder dat bedrag zakt, krijgt hij
   één mail. Daalt de prijs daarna nog verder, dan nog een; blijft hij gelijk
   of stijgt hij, dan niet.

   Alles hier is een pure functie, zodat scripts/prijsalarm.test.mjs het kan
   vastleggen. api/prijsalarm.js (aanmelden, bevestigen, afmelden) en
   api/prijsalarm-check.js (de dagelijkse ronde) doen de mail en de opslag.

   Bestanden in api/ die met een liggend streepje beginnen, maakt Vercel geen
   eigen adres van.
   ========================================================================== */

"use strict";

const Prijs = require("../assets/prijs.js");

// Een aanmelding die niet bevestigd wordt, verdwijnt na twee dagen vanzelf.
const BEVESTIG_BINNEN_S = 2 * 24 * 3600;
// Per e-mailadres niet meer dan dit aantal lopende alarmen: genoeg voor wie
// echt twijfelt, te weinig om iemands postvak mee vol te laten lopen.
const MAX_PER_ADRES = 10;
// Hoeveel mails de dagelijkse ronde hooguit verstuurt. TransIP begrenst het
// aantal mails per mailbox per dag; ruim daaronder blijven houdt de mailbox
// voor gewone post bruikbaar.
const MAX_MAILS_PER_RONDE = 200;

function lijktOpEmail(waarde) {
  const t = String(waarde || "").trim();
  return t.length <= 254 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i.test(t);
}

/* De prijs waarop een alarm let: de beste winkelprijs incl. btw, zoals de
   batterijpagina hem toont. Geen alarm op een richtprijs (daar valt niets af
   te rekenen), op een prijs die te oud is of op een batterij die nergens meer
   leverbaar is: zie Prijs.prijsAchteraan. */
function alarmPrijs(b, nu) {
  if (!b) return null;
  const a = Prijs.beste(b);
  if (!a || a.is_richtprijs) return null;
  if (Prijs.prijsAchteraan(b, nu)) return null;
  const p = Prijs.vergelijkPrijs(a);
  return typeof p === "number" && p > 0 ? p : null;
}

/* Een aanmelding nakijken. Geeft { fout } of { email, batterij, drempel }.
   Zonder bedrag geldt: elke daling onder de prijs van vandaag. */
function nakijken(invoer, batterijen, nu) {
  const email = String((invoer && invoer.email) || "").trim().toLowerCase();
  if (!lijktOpEmail(email)) return { fout: "Vul een geldig e-mailadres in.", veld: "email" };
  const id = String((invoer && invoer.batterij) || "");
  const b = (batterijen || []).find((x) => x.id === id);
  if (!b) return { fout: "Deze batterij ken ik niet." };
  const nuPrijs = alarmPrijs(b, nu);
  const ruw = String(invoer.drempel == null ? "" : invoer.drempel).trim().replace(/[€\s.]/g, "").replace(",", ".");
  let drempel;
  if (ruw === "") {
    if (nuPrijs === null) return { fout: "Er is nu geen winkelprijs om een daling tegen af te zetten. Vul een bedrag in.", veld: "drempel" };
    drempel = nuPrijs - 1;
  } else {
    drempel = Math.round(Number(ruw));
    if (!Number.isFinite(drempel) || drempel < 50 || drempel > 100000) return { fout: "Vul een bedrag in euro's in, of laat het veld leeg.", veld: "drempel" };
  }
  return { email, batterij: id, drempel, prijsBijAanmelden: nuPrijs };
}

/* De dagelijkse ronde: welke alarmen krijgen vandaag een mail? Een alarm
   krijgt er een als de prijs op of onder zijn drempel staat én lager is dan
   bij de vorige mail. Zo komt er geen mail per dag zolang een prijs laag
   blijft, en wel een als hij nog verder zakt. */
function teMelden(alarmen, batterijen, nu) {
  const perId = new Map((batterijen || []).map((b) => [b.id, b]));
  const uit = [];
  for (const a of alarmen || []) {
    if (!a || a.status !== "actief") continue;
    const p = alarmPrijs(perId.get(a.batterij), nu);
    if (p === null) continue;
    const drempel = Number(a.drempel);
    const vorige = a.laatstGemeld === undefined || a.laatstGemeld === null || a.laatstGemeld === "" ? null : Number(a.laatstGemeld);
    if (p <= drempel && (vorige === null || p < vorige)) uit.push({ alarm: a, prijs: p, batterij: perId.get(a.batterij) });
    if (uit.length >= MAX_MAILS_PER_RONDE) break;
  }
  return uit;
}

module.exports = { BEVESTIG_BINNEN_S, MAX_PER_ADRES, MAX_MAILS_PER_RONDE, lijktOpEmail, alarmPrijs, nakijken, teMelden };
