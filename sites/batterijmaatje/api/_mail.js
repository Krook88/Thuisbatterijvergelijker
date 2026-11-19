/* ==========================================================================
   Mail voor het prijsalarm: opmaak en verzending via de mailserver van
   TransIP, dezelfde instellingen als het contactformulier (api/contact.js):
   SMTP_GEBRUIKER, SMTP_WACHTWOORD, CONTACT_VAN, SMTP_HOST, SMTP_POORT.

   De opmaak is een kopie van die in contact.js. Die laat ik ongemoeid: hij
   werkt, staat op drie sites in een eigen variant, en een gedeelde mailmodule
   voor één functie extra kost meer dan deze veertig regels.
   ========================================================================== */

"use strict";


const SMTP_TIJDSLIMIET_MS = 8000;

const KLEUR = {
  inkt: "#0a3733",
  primair: "#0f766e",
  accent: "#f59e0b",
  papier: "#f6f3ec",
  rand: "#e7e1d3",
  tekst: "#24312f",
  tekstLicht: "#5d6d6a",
  wit: "#ffffff",
};

const LETTER = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function ontsnap(waarde) {
  return String(waarde == null ? "" : waarde)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

// Regeleinden in het bericht van de bezoeker moeten zichtbaar blijven, maar de
// tekst mag geen HTML kunnen injecteren.
function alinea(inhoud) {
  return ontsnap(inhoud).replaceAll("\n", "<br>");
}

function mailOpmaak({ titel, intro, rijen, bericht, voettekst, site }) {
  const rijenHtml = (rijen || [])
    .map(
      ([label, waarde]) => `
              <tr>
                <td style="padding:6px 0;font-family:${LETTER};font-size:14px;color:${KLEUR.tekstLicht};width:120px;vertical-align:top;">${ontsnap(label)}</td>
                <td style="padding:6px 0;font-family:${LETTER};font-size:15px;color:${KLEUR.tekst};font-weight:600;">${waarde}</td>
              </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${ontsnap(titel)}</title></head>
<body style="margin:0;padding:0;background:${KLEUR.papier};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${KLEUR.papier};padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${KLEUR.wit};border:1px solid ${KLEUR.rand};border-radius:14px;overflow:hidden;">
        <tr>
          <td style="background:${KLEUR.inkt};padding:18px 24px;">
            <span style="font-family:${LETTER};font-size:17px;font-weight:700;color:${KLEUR.wit};">Batterij<span style="color:${KLEUR.accent};">maatje</span></span>
          </td>
        </tr>
        <tr>
          <td style="padding:24px;">
            <h1 style="margin:0 0 10px;font-family:${LETTER};font-size:19px;line-height:1.3;color:${KLEUR.inkt};">${ontsnap(titel)}</h1>
            <p style="margin:0 0 18px;font-family:${LETTER};font-size:15px;line-height:1.6;color:${KLEUR.tekst};">${intro}</p>
            ${rijenHtml ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${KLEUR.rand};border-bottom:1px solid ${KLEUR.rand};margin-bottom:18px;">${rijenHtml}</table>` : ""}
            ${bericht ? `<div style="background:${KLEUR.papier};border-left:3px solid ${KLEUR.accent};border-radius:0 8px 8px 0;padding:14px 16px;font-family:${LETTER};font-size:15px;line-height:1.6;color:${KLEUR.tekst};">${alinea(bericht)}</div>` : ""}
          </td>
        </tr>
        <tr>
          <td style="border-top:1px solid ${KLEUR.rand};padding:16px 24px;">
            <p style="margin:0;font-family:${LETTER};font-size:13px;line-height:1.5;color:${KLEUR.tekstLicht};">${ontsnap(voettekst)}</p>
            <p style="margin:8px 0 0;font-family:${LETTER};font-size:13px;">
              <a href="https://${ontsnap(site)}/" style="color:${KLEUR.primair};text-decoration:underline;">${ontsnap(site)}</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function ingesteld() {
  return !!(process.env.SMTP_GEBRUIKER && process.env.SMTP_WACHTWOORD);
}

function postbode() {
  const poort = Number(process.env.SMTP_POORT) || 465;
  // Pas hier geladen, zodat de opmaak ook zonder nodemailer te testen is.
  return require("nodemailer").createTransport({
    host: process.env.SMTP_HOST || "smtp.transip.email",
    port: poort,
    secure: poort === 465,
    auth: { user: process.env.SMTP_GEBRUIKER, pass: process.env.SMTP_WACHTWOORD },
    connectionTimeout: SMTP_TIJDSLIMIET_MS,
    greetingTimeout: SMTP_TIJDSLIMIET_MS,
    socketTimeout: SMTP_TIJDSLIMIET_MS,
  });
}

/* Eén mail. Gebruik voor een ronde met veel mails dezelfde postbode, dan
   blijft de verbinding open. */
async function verstuur({ aan, onderwerp, tekst, html }, bode) {
  const van = process.env.CONTACT_VAN || process.env.SMTP_GEBRUIKER;
  await (bode || postbode()).sendMail({
    from: { name: "Batterijmaatje prijsalarm", address: van },
    to: aan,
    subject: onderwerp,
    text: tekst,
    html,
  });
}

module.exports = { ontsnap, mailOpmaak, KLEUR, ingesteld, postbode, verstuur };
