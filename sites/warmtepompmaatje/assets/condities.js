/* ==========================================================================
   Onder welke omstandigheden geldt een getal?
   ==========================================================================

   Waarom dit bestand bestaat: bij een warmtepomp betekent hetzelfde getal
   verschillende dingen, afhankelijk van waar het gemeten is. Dat is precies
   dezelfde valkuil als een prijs excl. btw naast een prijs incl. btw, of een
   bruto pakketmaat naast een bruikbare capaciteit - en hier zit hij op de twee
   getallen waar een koper zijn keuze op baseert.

     Vermogen. "7 kW" is meestal het vermogen bij A7/W35: buiten 7 graden,
     aanvoer 35 graden. Dat is een milde dag, precies wanneer je de pomp het
     minst nodig hebt. Bij A-7/W35 - de kou waarvoor je hem koopt - levert
     hetzelfde apparaat fors minder. De Stiebel WPL 07 ACS heet 7 kW en levert
     er 2,08 bij A2/W35. Wie op het typenummer afgaat koopt een pomp die zijn
     huis op de koudste dag niet warm krijgt.

     SCOP. Het seizoensrendement hangt af van de aanvoertemperatuur. Bij 35
     graden (vloerverwarming) haalt een pomp ruim een punt meer dan bij 55
     graden (radiatoren in een bestaande woning). Een SCOP van 4,7 zonder die
     vermelding zegt dus niets.

   Norm van deze site:
     vermogen_kw   Prated volgens EU 811/2013 - het vermogen bij de
                   ontwerpbuitentemperatuur (-10 graden bij gemiddeld klimaat)
     scop          de labelwaarde bij 35 graden aanvoer, gemiddeld klimaat

   Waarom Prated en niet letterlijk A-7/W35: dat laatste staat in datasheets en
   lang niet elke fabrikant publiceert het. Prated staat voor elke pomp in de
   ISDE-meldcodelijst van RVO, is in Europese regelgeving gedefinieerd, en is
   het getal waar de Nederlandse subsidie op gebaseerd is. Het meet hetzelfde
   wat we willen weten - haalt deze pomp het op een koude dag - maar dan uit
   een bron die volledig en controleerbaar is.

   Datamodel:
     vermogen_conditie  "Prated"   = volgens de norm (EU 811/2013)
                        "A7/W35"   = de milde meting; vlijend, hoort een label
                        "onbekend" = nagezocht, fabrikant publiceert het niet
                        weggelaten = nog niet nagekeken
     vermogen_a7_kw     het A7-getal, als we het weten naast het A-7-getal
     scop_conditie      "35" | "55" | "onbekend" | weggelaten, idem

   Werkt zowel in de browser (window.Condities) als in Node (require).
   ========================================================================== */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Condities = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  function vermogenBevestigd(w) {
    return !!w && w.vermogen_conditie === "Prated";
  }

  function scopBevestigd(w) {
    return !!w && String(w.scop_conditie) === "35";
  }

  function vermogenToelichting(w) {
    if (!w || typeof w.vermogen_kw !== "number") return null;
    if (w.vermogen_conditie === "Prated") return null;
    if (w.vermogen_conditie === "A7/W35") {
      return "gemeten bij 7 graden buiten; op een koude dag levert hij minder";
    }
    if (w.vermogen_conditie === "onbekend") {
      return "de fabrikant publiceert niet bij welke buitentemperatuur dit geldt";
    }
    return "niet vastgesteld bij welke buitentemperatuur dit vermogen geldt";
  }

  function scopToelichting(w) {
    if (!w || typeof w.scop !== "number") return null;
    if (String(w.scop_conditie) === "35") return null;
    if (String(w.scop_conditie) === "55") {
      return "bij 55 graden aanvoer; bij 35 graden ligt dit ruim een punt hoger";
    }
    if (w.scop_conditie === "onbekend") {
      return "de fabrikant publiceert niet bij welke aanvoertemperatuur dit geldt";
    }
    return "niet vastgesteld bij welke aanvoertemperatuur dit geldt";
  }

  // Kleine labels, net als bij de capaciteit op batterijmaatje: alleen tonen
  // wat vastgesteld is of aantoonbaar vleit. Van de rest zegt de legenda één
  // keer wat er geldt - een waarschuwing op elke kaart wordt behang.
  function label(soort, w) {
    if (soort === "vermogen") {
      if (vermogenBevestigd(w)) return { tekst: "koude dag", klasse: "maat-bevestigd", titel: "Prated volgens EU 811/2013: het vermogen bij de ontwerpbuitentemperatuur, de maat waarop je een pomp kiest" };
      if (w && w.vermogen_conditie === "A7/W35") return { tekst: "bij 7 °C", klasse: "maat-bruto", titel: "Gemeten bij 7 graden buiten; op een koude dag levert hij minder" };
      return null;
    }
    if (scopBevestigd(w)) return { tekst: "bij 35 °C", klasse: "maat-bevestigd", titel: "Labelwaarde bij 35 graden aanvoer, gemiddeld klimaat" };
    if (w && String(w.scop_conditie) === "55") return { tekst: "bij 55 °C", klasse: "maat-bruto", titel: "Bij 55 graden aanvoer; bij 35 graden ligt dit ruim een punt hoger" };
    return null;
  }

  function labelHtml(soort, w) {
    const l = label(soort, w);
    return l ? ` <small class="${l.klasse}" title="${l.titel}">${l.tekst}</small>` : "";
  }

  return {
    vermogenBevestigd,
    scopBevestigd,
    vermogenToelichting,
    scopToelichting,
    label,
    labelHtml,
  };
});
