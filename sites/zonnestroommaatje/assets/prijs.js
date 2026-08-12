/* ==========================================================================
   Prijslogica - één bron van waarheid voor de hele site
   ==========================================================================

   Waarom dit bestand bestaat, en waarom pas nu.

   Bij zonnepanelen speelt de btw-vraag niet: op de levering en installatie van
   zonnepanelen bij een woning geldt in Nederland het nultarief, dus incl. en
   excl. btw zijn daar hetzelfde bedrag. Dat staat ook zo in panelen.json
   ("0% btw bij levering voor een woning").

   Bij een los verkochte omvormer geldt dat nultarief niet, en daar verkopen
   veel winkels aan installateurs: hun prijzen staan zonder btw. De toelichting
   in omvormers.json wist dat al ("sommige winkels tonen prijzen exclusief
   btw"), maar de vergelijking deed er niets mee en koos simpelweg het laagste
   getal. Een prijs excl. btw wint dan altijd van een eerlijke prijs incl. btw,
   zonder dat er iets goedkoper is.

   Wat dat concreet aanrichtte: bij de APsystems DS3 stond € 145 (excl. btw,
   dus € 175) als beste prijs, terwijl een andere winkel € 149 incl. btw
   vroeg. De duurste van de twee stond bovenaan.

   Daarom rekent alles hier eerst om naar één maatstaf - de vergelijkprijs,
   altijd incl. btw - en gebruiken de vergelijker, de keuzehulp, de
   systeembouwer, het energieplan en de generator dezelfde functies.

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
                                 dan de richtprijs, bijvoorbeeld "excl. gateway".
                                 Zolang dit veld gevuld is, gelden de richtprijs
                                 en deze aanbieding niet als hetzelfde product en
                                 wordt er dus geen korting berekend.
     product.richtprijs_btw_inbegrepen
                                 Idem voor de richtprijs zelf.

   Hoe btw_inbegrepen in de data komt: scripts/update-prices.mjs leest wat de
   winkelpagina over btw zegt en meldt het wanneer dat afwijkt van wat wij
   aannemen. Melden, niet stilzwijgend aanpassen - een pagina die "excl. btw"
   zegt kan het ook over verzendkosten hebben. Het veld zetten blijft een
   menselijke beslissing.

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

  function geldigeAanbiedingen(p) {
    return ((p && p.aanbiedingen) || []).filter((a) => a && typeof a.prijs_eur === "number" && !nietLeverbaar(a));
  }

  // De richtprijs als aanbieding-achtig object, zodat de rest van de code geen
  // onderscheid hoeft te maken tussen "winkel gevonden" en "alleen richtprijs".
  function richtprijsAlsAanbieding(p) {
    if (!p || typeof p.richtprijs_eur !== "number") return null;
    return {
      winkel: p.prijs_bron || "richtprijs (indicatie)",
      prijs_eur: p.richtprijs_eur,
      url: p.product_url,
      btw_inbegrepen: p.richtprijs_btw_inbegrepen !== false,
      // Geen winkel gevonden: dit is een indicatie, geen bedrag dat je ergens
      // kunt afrekenen.
      is_richtprijs: true,
    };
  }

  // De goedkoopste aanbieding, gekozen op vergelijkprijs en niet op het rauwe
  // getal: anders wint een prijs excl. btw altijd van een eerlijke prijs incl.
  // Bij een gelijke stand wint de aanbieding met een controledatum, zodat het
  // verste gecontroleerde bedrag niet zomaar bovenaan blijft staan.
  function beste(p) {
    const lijst = geldigeAanbiedingen(p);
    if (lijst.length) {
      return lijst.reduce((min, a) => {
        const va = vergelijkPrijs(a), vm = vergelijkPrijs(min);
        if (va < vm) return a;
        if (va === vm && a.datum && !min.datum) return a;
        return min;
      });
    }
    return richtprijsAlsAanbieding(p);
  }

  // Dekt deze aanbieding hetzelfde als de richtprijs? Zo niet, dan is het
  // verschil tussen beide geen korting maar een verschil in wat je krijgt.
  function zelfdeSamenstelling(aanbieding) {
    return !aanbieding || !aanbieding.omvat;
  }

  // Korting bestaat alleen als twee vergelijkbare bedragen worden vergeleken:
  // dezelfde samenstelling en allebei omgerekend naar incl. btw.
  function heeftKorting(p) {
    const aanbieding = beste(p);
    const richtprijs = richtprijsAlsAanbieding(p);
    if (!aanbieding || !richtprijs || aanbieding.is_richtprijs) return false;
    if (!zelfdeSamenstelling(aanbieding)) return false;
    return vergelijkPrijs(aanbieding) < vergelijkPrijs(richtprijs) * 0.97;
  }

  // De van-prijs die je mag doorstrepen, of null als doorstrepen zou misleiden.
  function vanPrijs(p) {
    if (!heeftKorting(p)) return null;
    return vergelijkPrijs(richtprijsAlsAanbieding(p));
  }

  // De maatstaf waarop panelen onderling te vergelijken zijn. Niet afronden:
  // het gaat om centen per wattpiek, en een paneel van € 0,19 per Wp is echt
  // goedkoper dan een van € 0,24.
  // Wat kost deze omvormer voor een dak van n panelen?
  //
  // Waarom dit nodig is: micro-omvormers worden per stuk verkocht en je hebt er
  // een per paneel (Enphase) of per twee panelen (APsystems). Een string-
  // omvormer is een apparaat voor de hele installatie. Die bedragen naast
  // elkaar zetten vergelijkt een onderdeel met een compleet systeem: Enphase
  // stond op 109 euro naast een SolarEdge van 1.050, terwijl je er voor twaalf
  // panelen twaalf van nodig hebt plus een gateway.
  //
  // De keuzehulp koos daardoor in elk scenario dezelfde twee omvormers, ook
  // voor iemand zonder schaduw die met een gewone string-omvormer goedkoper uit
  // was geweest. Dezelfde fout als een prijs excl. btw naast een prijs incl.
  // btw, of een bruto capaciteit naast een bruikbare.
  //
  // panelen_per_eenheid = null betekent: een eenheid voor de hele installatie.
  function systeemPrijs(omvormer, aantalPanelen) {
    const basis = vergelijkPrijs(beste(omvormer));
    if (basis === null) return null;
    const per = omvormer && omvormer.panelen_per_eenheid;
    if (!per) return basis;
    const n = Math.max(1, Math.ceil((aantalPanelen || 1) / per));
    return basis * n + (omvormer.systeem_toeslag_eur || 0);
  }

  function prijsPerWp(p) {
    const prijs = vergelijkPrijs(beste(p));
    if (!prijs || !p || !p.vermogen_wp) return null;
    return prijs / p.vermogen_wp;
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
    prijsPerWp,
    systeemPrijs,
    prijsToelichting,
  };
});
