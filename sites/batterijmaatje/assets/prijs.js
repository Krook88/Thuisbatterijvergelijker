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
     batterij.capaciteit_soort   Waar het getal in capaciteit_kwh vandaan komt:
                                 "bruikbaar"  = wat je er echt uit haalt (de norm)
                                 "nominaal"   = de bruto pakketmaat
                                 "onbekend"   = nagezocht, maar de fabrikant
                                                publiceert het niet
                                 weggelaten   = nog niet nagekeken
                                 Zie hieronder waarom dit een apart veld is.
     batterij.capaciteit_nominaal_kwh
                                 De bruto opgave, als die bekend is naast de
                                 bruikbare.

   Over capaciteit, en waarom hier hetzelfde speelt als bij btw: fabrikanten
   geven twee verschillende getallen op. De bruto pakketmaat ("nominaal") en wat
   je er werkelijk uit haalt ("bruikbaar"), en dat scheelt tot twintig procent.
   Zet je die naast elkaar zonder onderscheid, dan lijkt een batterij goedkoper
   per kWh zonder dat er iets goedkoper is - precies dezelfde fout als een prijs
   excl. btw naast een prijs incl. btw.

   De norm van deze site is de bruikbare capaciteit: dat is wat de besparing
   bepaalt. Zolang dat voor een model niet is vastgesteld hoort de site dat te
   zeggen in plaats van te doen alsof, en daar is capaciteit_soort voor.
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

  // Is voor dit model vastgesteld dat het getal de bruikbare capaciteit is?
  // Zo niet, dan mag de site de prijs per kWh nog wel tonen - een indicatie is
  // beter dan niets - maar niet als hard vergelijkbaar getal presenteren.
  function capaciteitBevestigd(b) {
    return !!b && b.capaciteit_soort === "bruikbaar";
  }

  function capaciteitToelichting(b) {
    if (!b || typeof b.capaciteit_kwh !== "number") return null;
    if (b.capaciteit_soort === "bruikbaar") return null;
    if (b.capaciteit_soort === "nominaal") {
      return "fabrieksopgave bruto; bruikbaar ligt lager";
    }
    if (b.capaciteit_soort === "onbekend") {
      return "de fabrikant publiceert niet hoeveel hiervan bruikbaar is";
    }
    return "niet vastgesteld of dit de bruto- of de bruikbare capaciteit is";
  }

  /* Maten: in welke groottes je hetzelfde systeem kunt kopen.

     REDACTIE.md: capaciteitsvarianten van één systeem krijgen samen één
     regel. Dat houdt de lijst leesbaar, maar dan moet de bezoeker de maten wel
     kunnen zien. batterij.maten is een oplopende lijst van uitvoeringen
     ({ kwh, nominaal_kwh?, opbouw?, prijs_eur?, prijs_datum? }); kwh volgt
     dezelfde maat als capaciteit_kwh, en capaciteit_kwh zelf staat erin: dat
     is de uitvoering waar de prijs van de regel bij hoort.

     Zonder maten valt alles terug op capaciteit_kwh en uitbreidbaar_tot_kwh. */
  function maten(b) {
    if (!b || !Array.isArray(b.maten) || b.maten.length === 0) return null;
    return b.maten.filter((m) => m && typeof m.kwh === "number").slice().sort((x, y) => x.kwh - y.kwh);
  }

  // Van de kleinste tot de grootste uitvoering die je kunt kopen.
  function capaciteitBereik(b) {
    if (!b || typeof b.capaciteit_kwh !== "number") return null;
    const m = maten(b);
    const min = m ? Math.min(m[0].kwh, b.capaciteit_kwh) : b.capaciteit_kwh;
    const max = Math.max(b.capaciteit_kwh, m ? m[m.length - 1].kwh : 0, b.uitbreidbaar_tot_kwh || 0);
    return { min, max };
  }

  // De capaciteitsfilters van de vergelijker. Tot 4, 4 tot 10, meer dan 10.
  const CAPACITEIT_FILTERS = {
    klein: { laag: 0, hoog: 4, binnen: (k) => k < 4 },
    middel: { laag: 4, hoog: 10, binnen: (k) => k >= 4 && k <= 10 },
    groot: { laag: 10, hoog: Infinity, binnen: (k) => k > 10 },
  };

  /* Is dit systeem in deze grootte te koop? Een batterij van 4,6 kWh die je
     uitbreidt tot 13,8 kWh hoort ook bij "groot": eerst keek het filter alleen
     naar de basismaat, en dan viel het merendeel van de uitbreidbare systemen
     weg bij wie een grote batterij zoekt. */
  function capaciteitInFilter(b, filter) {
    const f = CAPACITEIT_FILTERS[filter];
    if (!f) return true;
    const r = capaciteitBereik(b);
    if (!r) return false;
    if (f.binnen(r.min) || f.binnen(r.max)) return true;
    return r.min < f.laag && r.max > f.hoog;
  }

  /* Valt de basismaat buiten het filter, welke uitvoering past er dan wel?
     Geeft { kwh, opbouw? } van de kleinste passende maat, { kwh: null } als
     het systeem alleen via uitbreiden in het bereik komt zonder bekende maten,
     of null als de basismaat zelf al past. */
  function maatInFilter(b, filter) {
    const f = CAPACITEIT_FILTERS[filter];
    if (!f || !b || typeof b.capaciteit_kwh !== "number" || f.binnen(b.capaciteit_kwh)) return null;
    if (!capaciteitInFilter(b, filter)) return null;
    const m = maten(b);
    const passend = m && m.find((x) => f.binnen(x.kwh));
    return passend ? passend : { kwh: null };
  }

  // Prijs per kWh van één uitvoering, alleen als die uitvoering een eigen prijs heeft.
  function maatPrijsPerKwh(maat) {
    if (!maat || !Number.isFinite(maat.prijs_eur) || !maat.kwh) return null;
    return Math.round(maat.prijs_eur / maat.kwh);
  }

  // Een klein label achter de capaciteit. Bewust alleen bij wat vastgesteld is:
  // van de meeste modellen weten we het nog niet, en 39 waarschuwingen op 41
  // kaarten leest niemand meer - dan wordt het behang in plaats van een signaal.
  // Wat de standaard is als er geen label staat, zegt de legenda één keer.
  function capaciteitLabel(b) {
    if (!b || typeof b.capaciteit_kwh !== "number") return null;
    if (b.capaciteit_soort === "bruikbaar") {
      return { tekst: "bruikbaar", klasse: "maat-bevestigd", titel: "Dit is wat je er werkelijk uit haalt, niet de bruto pakketmaat" };
    }
    if (b.capaciteit_soort === "nominaal") {
      return { tekst: "bruto", klasse: "maat-bruto", titel: "Fabrieksopgave van het hele pakket; wat je er bruikbaar uit haalt ligt lager" };
    }
    return null;
  }

  // Klaar om in HTML te zetten; hier zit geen invoer van buiten in, alle drie
  // de teksten staan hierboven.
  // Hetzelfde voor het vermogen. "max" is het getal dat je in dagelijks gebruik
  // niet haalt - Marstek geeft 800 W on-grid en 2500 W off-grid, en het tweede
  // stond bij ons in het veld. Dat hoort de bezoeker te zien, want de kaart
  // suggereert anders dat zo'n batterij zijn avondpiek dekt.
  function vermogenLabel(b) {
    if (!b || typeof b.vermogen_kw !== "number") return null;
    if (b.vermogen_conditie === "continu") {
      return { tekst: "continu", klasse: "maat-bevestigd", titel: "Dit levert hij aanhoudend aan je huis" };
    }
    if (b.vermogen_conditie === "max") {
      return { tekst: "maximum", klasse: "maat-bruto", titel: "Een piek- of off-grid maximum; in dagelijks gebruik ligt het lager. " + (b.vermogen_bron || "") };
    }
    // 800 W is de veiligheidsafspraak voor een gedeelde groep, geen eigenschap
    // van de batterij. Zonder dit label lijkt zo'n toestel drie keer zwakker
    // dan een buurmodel waarvan de fabrikant het volle vermogen opgeeft,
    // terwijl het om dezelfde soort apparaten gaat.
    if (b.vermogen_conditie === "stopcontact") {
      return { tekst: "stopcontactgrens", klasse: "maat-bruto", titel: "Dit is de 800 W die op een gedeelde groep is toegestaan, niet wat het toestel kan. " + (b.vermogen_bron || "") };
    }
    // Een derde geval kwam uit een handleiding die een lezer opstuurde. De
    // Zendure 4000 Mix levert in het stopcontact 800 W en het volle vermogen
    // pas na een vaste aansluiting door een installateur. Dat is geen piek en
    // geen stopcontactgrens. Zonder eigen label leest "4 kW continu" als iets
    // wat je uit de doos krijgt, en bij een stekkerbatterij is dat precies de
    // verwachting die de site niet moet wekken.
    if (b.vermogen_conditie === "vaste-aansluiting") {
      return { tekst: "vaste aansluiting", klasse: "maat-bruto", titel: "Dit haalt hij pas met een vaste aansluiting door een installateur; in een gewoon stopcontact levert hij 800 W. " + (b.vermogen_bron || "") };
    }
    return null;
  }

  function vermogenLabelHtml(b) {
    const l = vermogenLabel(b);
    return l ? ` <small class="${l.klasse}" title="${l.titel}">${l.tekst}</small>` : "";
  }

  // Mag de site zeggen dat dit vermogen iets dekt? Alleen als vaststaat dat het
  // de continue waarde is; anders belooft ze iets op basis van een piek.
  function vermogenDektIets(b) {
    return !!b && b.vermogen_conditie === "continu";
  }

  function capaciteitLabelHtml(b) {
    const l = capaciteitLabel(b);
    return l ? ` <small class="${l.klasse}" title="${l.titel}">${l.tekst}</small>` : "";
  }

  function prijsPerKwh(b) {
    const aanbieding = beste(b);
    const prijs = vergelijkPrijs(aanbieding);
    if (!prijs || !b || !b.capaciteit_kwh) return null;
    return Math.round(prijs / b.capaciteit_kwh);
  }

  /* Wat een opgeslagen kWh over de levensduur kost: de prijs gedeeld door
     cycli maal capaciteit. Een goedkope batterij met weinig cycli kan zo
     duurder uitvallen dan een duurdere die twee keer zo lang meegaat. Het is
     een bovengrens van de levensduur (de fabrieksopgave, vaak tot 70 of 80%
     restcapaciteit), dus het werkelijke bedrag ligt iets hoger. Alleen met
     een actuele prijs en een bekend aantal cycli. */
  function prijsPerOpgeslagenKwh(b) {
    const prijs = vergelijkPrijs(beste(b));
    if (!prijs || !b || !b.capaciteit_kwh || !Number.isInteger(b.cycli) || b.cycli <= 0) return null;
    return Math.round((prijs / (b.cycli * b.capaciteit_kwh)) * 1000) / 1000;
  }

  // Korte toevoeging achter de prijs, zodat de bezoeker ziet waaróm het bedrag
  // afwijkt van wat de winkel toont.
  function prijsToelichting(aanbieding) {
    const delen = [];
    if (isOmgerekend(aanbieding)) delen.push("winkelprijs excl. btw, hier omgerekend");
    if (aanbieding && aanbieding.omvat) delen.push(aanbieding.omvat);
    return delen.join(" · ");
  }

  /* Hoe oud is de prijs die de bezoeker ziet?

     De site zegt "prijzen dagelijks gecontroleerd", en voor de meeste modellen
     klopt dat. Maar niet elke winkel laat zich uitlezen: bij een deel staat het
     bedrag stil terwijl de pagina eromheen elke dag ververst wordt. Dan klopt
     de belofte niet meer, en dat hoort de bezoeker te zien bij het bedrag zelf
     in plaats van weggestopt in de uitklap.

     Veertien dagen is de grens. Dat is ver voorbij "dagelijks", en het ligt
     onder de eenentwintig dagen waarop de dagelijkse run zelf aan de bel trekt:
     de bezoeker weet het dus eerder dan de beheerder. Veel lager kan niet
     zonder dat het behang wordt, en een label op elke kaart leest niemand. */
  const PRIJS_OUD_NA_DAGEN = 14;

  // De datum hoort bij het bedrag dat groot in beeld staat, niet bij het
  // product als geheel: bij een winkelprijs die van die aanbieding, bij een
  // richtprijs die van de richtprijs. Heeft de aanbieding zelf geen datum, dan
  // weten we het niet - en dan is prijs_datum erbij halen een datum plakken op
  // iets waar hij niet over gaat.
  function prijsDatum(item) {
    const a = beste(item);
    if (!a) return null;
    if (a.is_richtprijs) return (item && item.prijs_datum) || null;
    return a.datum || null;
  }

  function prijsOuderdom(item, nu) {
    const datum = prijsDatum(item);
    if (typeof datum !== "string") return null;
    const toen = new Date(datum + "T12:00:00");
    if (Number.isNaN(toen.getTime())) return null;
    const dagen = Math.round(((nu ? new Date(nu) : new Date()) - toen) / 86400000);
    return dagen > 0 ? dagen : 0;
  }

  // null zolang de prijs vers genoeg is, zodat de aanroeper niets van de grens
  // hoeft te weten. Het opmaken van de datum blijft hierbuiten: dat doet de
  // kaart al, en twee datumopmakers gaan een keer uit elkaar lopen.
  /* Na zestig dagen zonder bevestiging telt een prijs niet meer mee in de
     volgorde op prijs en voor het kenmerk "laagste prijs": hij staat er nog,
     met zijn datum, maar achter de prijzen die wel actueel zijn. Reviewers
     vonden prijzen van juli bovenaan een lijst die "dagelijks gecontroleerd"
     heet. */
  const PRIJS_TE_OUD_NA_DAGEN = 60;
  function prijsTeOud(item, nu) {
    const dagen = prijsOuderdom(item, nu);
    return dagen !== null && dagen > PRIJS_TE_OUD_NA_DAGEN;
  }

  function prijsOuderdomLabel(item, nu) {
    const dagen = prijsOuderdom(item, nu);
    if (dagen === null || dagen < PRIJS_OUD_NA_DAGEN) return null;
    return { dagen: dagen, datum: prijsDatum(item) };
  }

  return {
    BTW_FACTOR,
    PRIJS_OUD_NA_DAGEN,
    prijsDatum,
    prijsOuderdom,
    prijsOuderdomLabel,
    prijsTeOud,
    prijsPerOpgeslagenKwh,
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
    capaciteitBevestigd,
    capaciteitToelichting,
    capaciteitLabel,
    capaciteitLabelHtml,
    maten,
    capaciteitBereik,
    capaciteitInFilter,
    maatInFilter,
    maatPrijsPerKwh,
    vermogenLabel,
    vermogenLabelHtml,
    vermogenDektIets,
    prijsPerKwh,
    prijsToelichting,
  };
});
