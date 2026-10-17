/* ==========================================================================
   Oordeel over een terugverdientijd. Gedeeld door de drie sites
   (kern/assets/oordeel.js), want het energieplan op zonnestroommaatje
   beoordeelt alle drie de producten naast elkaar.

   De regel is overal dezelfde, gemeten aan hoe lang het apparaat meegaat:
   - groen (goed): binnen de helft van de kortste levensduur;
   - oranje (matig): tot 80% van de langste levensduur;
   - rood (slecht): daarboven, of als het per saldo niets oplevert.

   Thuisbatterij 10 tot 15 jaar   -> groen tot 5, oranje tot 12
   Warmtepomp    15 tot 20 jaar   -> groen tot 7, oranje tot 16
   Zonnepanelen  25 jaar          -> groen tot 12, oranje tot 20

   De getallen staan hier uitgeschreven en niet als formule, zodat je ze kunt
   aanpassen zonder de regel te moeten volgen.
   ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Oordeel = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  var GRENZEN = {
    batterij: { goedTot: 5, matigTot: 12, levensduur: "10 tot 15 jaar" },
    warmtepomp: { goedTot: 7, matigTot: 16, levensduur: "15 tot 20 jaar" },
    zonnepanelen: { goedTot: 12, matigTot: 20, levensduur: "25 jaar" },
  };

  /* "goed", "matig" of "slecht". Geen terugverdientijd telt als slecht. */
  function van(soort, t) {
    var g = GRENZEN[soort];
    if (!g) throw new Error("Onbekende soort voor het oordeel: " + soort);
    if (t == null || !isFinite(t)) return "slecht";
    return t <= g.goedTot ? "goed" : t <= g.matigTot ? "matig" : "slecht";
  }

  var KLEUR = { goed: "var(--kleur-groen-donker)", matig: "var(--kleur-accent-donker)", slecht: "var(--kleur-rood)" };

  return { GRENZEN: GRENZEN, KLEUR: KLEUR, van: van };
});
