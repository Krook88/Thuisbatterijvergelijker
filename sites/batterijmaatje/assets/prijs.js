/* ==========================================================================
   Prijslogica - één bron van waarheid voor de hele site
   ==========================================================================

   Waarom dit bestand bestaat: prijzen op deze site komen uit verschillende
   winkels en dekken niet allemaal hetzelfde. De ene prijs is een kale module
   excl. btw bij een groothandel, de andere een stekkerklaar apparaat incl. btw
   bij een consumentenwinkel. Wie die getallen ongewijzigd naast elkaar zet,
   vergelijkt appels met peren: een prijs excl. btw lijkt 21% goedkoper zonder
   dat er iets goedkoper is.

   Daarom rekent alles hier eerst om naar één maatstaf - de vergelijkprijs,
   altijd incl. btw - en gebruiken de vergelijker, de keuzehulp, de rekenmodule
   en de generator van de batterijpagina's dezelfde functies.

   Datamodel (alle velden optioneel, de standaard is de veiligste aanname):

     aanbieding.niet_leverbaar   true = de winkel voert dit artikel op dit moment
                                 niet. Wordt alleen gezet door een bron die het
                                 zelf zegt (de bol-API antwoordt met 404), nooit
                                 op basis van een gok. Zo'n aanbieding telt niet
                                 mee voor de kopprijs maar blijft wel in de
                                 winkellijst staan; komt het artikel terug, dan
                                 valt de markering bij de eerstvolgende controle
                                 vanzelf af.
     aanbieding.btw_inbegrepen   false = deze winkelprijs is excl. btw.
                                 Weggelaten betekent incl. btw, zoals gebruikelijk
                                 bij consumentenverkoop in Nederland.
     aanbieding.omvat            Korte tekst als deze aanbieding iets anders dekt
                                 dan de richtprijs, bijvoorbeeld "excl. P1-meter".
                                 Zolang dit veld gevuld is, gelden de richtprijs
                                 en deze aanbieding niet als hetzelfde product en
                                 wordt er dus geen korting berekend.
     batterij.richtprijs_btw_inbegrepen
                                 Idem voor de richtprijs zelf.

   Werkt zowel in de browser (window.Prijs) als in Node (require).
   ========================================================================== */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Prijs = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const BTW_FACTOR = 1.21;

  // Een prijs geldt als incl. btw tenzij het databestand het tegendeel zegt.
  function inclusiefBtw(item) {
    return !item || item.btw_inbegrepen !== false;
  }

  // De vergelijkprijs: hetzelfde getal voor iedereen, altijd incl. btw.
  // Dit is het enige bedrag waarop gesorteerd, gefilterd en gerekend mag worden.
  function vergelijkPrijs(aanbieding) {
    if (!aanbieding || typeof aanbieding.prijs_eur !== "number") return null;
    return inclusiefBtw(aanbieding)
      ? aanbieding.prijs_eur
      : Math.round(aanbieding.prijs_eur * BTW_FACTOR);
  }

  // Is de winkelprijs omgerekend, dan mag de site dat niet stilzwijgend doen.
  function isOmgerekend(aanbieding) {
    return !!aanbieding && !inclusiefBtw(aanbieding);
  }

  // Een aanbieding die de winkel niet meer voert is geen aanbieding meer. Ze
  // blijft wel in de gegevens staan: gooien we haar weg, dan is de winkel-URL
  // weg en moet iemand die opnieuw opzoeken zodra het artikel terugkomt.
  function nietLeverbaar(aanbieding) {
    return !!aanbieding && aanbieding.niet_leverbaar === true;
  }

  function geldigeAanbiedingen(b) {
    return ((b && b.aanbiedingen) || []).filter((a) => a && typeof a.prijs_eur === "number" && !nietLeverbaar(a));
  }

  // De richtprijs als aanbieding-achtig object, zodat de rest van de code geen
  // onderscheid hoeft te maken tussen "winkel gevonden" en "alleen richtprijs".
  function richtprijsAlsAanbieding(b) {
    if (!b || typeof b.richtprijs_eur !== "number") return null;
    return {
      winkel: b.prijs_bron || "richtprijs",
      prijs_eur: b.richtprijs_eur,
      url: b.product_url,
      btw_inbegrepen: b.richtprijs_btw_inbegrepen !== false,
      // Geen winkel gevonden: dit is een indicatie, geen bedrag dat je ergens
      // kunt afrekenen. De kaart benoemt dat, anders leest "richtprijs" als
      // de naam van een webshop.
      is_richtprijs: true,
    };
  }

  // De goedkoopste aanbieding, gekozen op vergelijkprijs en niet op het rauwe
  // getal: anders wint een prijs excl. btw altijd van een eerlijke prijs incl.
  function beste(b) {
    const lijst = geldigeAanbiedingen(b);
    if (lijst.length) {
      return lijst.reduce((min, a) => (vergelijkPrijs(a) < vergelijkPrijs(min) ? a : min));
    }
    return richtprijsAlsAanbieding(b);
  }

  // Dekt deze aanbieding hetzelfde als de richtprijs? Zo niet, dan is het
  // verschil tussen beide geen korting maar een verschil in wat je krijgt.
  function zelfdeSamenstelling(aanbieding) {
    return !aanbieding || !aanbieding.omvat;
  }

  // Korting bestaat alleen als twee vergelijkbare bedragen worden vergeleken:
  // dezelfde samenstelling en allebei omgerekend naar incl. btw.
  function heeftKorting(b) {
    const aanbieding = beste(b);
    const richtprijs = richtprijsAlsAanbieding(b);
    if (!aanbieding || !richtprijs) return false;
    if (!zelfdeSamenstelling(aanbieding)) return false;
    return vergelijkPrijs(aanbieding) < vergelijkPrijs(richtprijs) * 0.97;
  }

  // De van-prijs die je mag doorstrepen, of null als doorstrepen zou misleiden.
  function vanPrijs(b) {
    if (!heeftKorting(b)) return null;
    return vergelijkPrijs(richtprijsAlsAanbieding(b));
  }

  function prijsPerKwh(b) {
    const aanbieding = beste(b);
    const prijs = vergelijkPrijs(aanbieding);
    if (!prijs || !b || !b.capaciteit_kwh) return null;
    return Math.round(prijs / b.capaciteit_kwh);
  }

  // Korte toevoeging achter de prijs, zodat de bezoeker ziet waaróm het bedrag
  // afwijkt van wat de winkel toont.
  function prijsToelichting(aanbieding) {
    const delen = [];
    if (isOmgerekend(aanbieding)) delen.push("winkelprijs excl. btw, hier omgerekend");
    if (aanbieding && aanbieding.omvat) delen.push(aanbieding.omvat);
    return delen.join(" · ");
  }

  return {
    BTW_FACTOR,
    inclusiefBtw,
    vergelijkPrijs,
    isOmgerekend,
    nietLeverbaar,
    geldigeAanbiedingen,
    richtprijsAlsAanbieding,
    beste,
    zelfdeSamenstelling,
    heeftKorting,
    vanPrijs,
    prijsPerKwh,
    prijsToelichting,
  };
});
