/* ==========================================================================
   De gedeelde link van een vergelijking: /v/a~b~c (zie vercel.json).

   Een statische pagina heeft één og:image. Stuurt iemand een vergelijking door
   via WhatsApp, dan zag de ontvanger het algemene plaatje van de site, en niet
   welke producten er tegen elkaar stonden. Deze functie geeft de link een
   eigen titel, beschrijving en plaatje (/api/vergelijkkaart), en stuurt een
   bezoeker meteen door naar de vergelijker met dezelfde producten.

   Gedeeld door de drie sites via kern/. Wat per site verschilt staat in
   api/_site.js: naam, kleuren, en welke lijst bij welke soort hoort.
   ========================================================================== */
"use strict";

const SITE = require("./_site");

const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;

function soortVan(naam) {
  return SITE.soorten[naam] || SITE.soorten.standaard;
}

/* De producten bij een rij id's, in de volgorde van de link. Onbekende of
   rare id's vallen weg; dubbele ook. Hooguit vier. */
function producten(ids, soortNaam) {
  const soort = soortVan(soortNaam);
  const lijst = soort.lijst();
  const gezien = new Set();
  return String(ids || "").split("~")
    .filter((id) => ID.test(id) && !gezien.has(id) && gezien.add(id))
    .map((id) => lijst.find((p) => p.id === id))
    .filter(Boolean)
    .slice(0, 4);
}

const naamVan = (p) => (p.model.toLowerCase().startsWith(p.merk.toLowerCase()) ? p.model : `${p.merk} ${p.model}`);

function prijsVan(p) {
  const b = SITE.Prijs.beste(p);
  const w = b ? SITE.Prijs.vergelijkPrijs(b) : null;
  return typeof w === "number" ? w : null;
}

const euro = (w) => "€ " + Math.round(w).toLocaleString("nl-NL");

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

module.exports = { SITE, soortVan, producten, naamVan, prijsVan, euro, esc };
