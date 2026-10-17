/* ==========================================================================
   Rekenkern thuisbatterij - de wiskunde, los van het scherm
   ==========================================================================

   Waarom dit bestand bestaat: de rekensom zat eerst midden in de DOM-code van
   rekenmodule.js. Daardoor kon niets hem testen, en zijn er fouten in blijven
   staan die niemand zag: een veld dat de uitkomst niet veranderde, een
   leverancierskeuze die de terugverdientijd juist korter maakte, en een
   voorbeeld op de pagina dat niet meer klopte met de code eronder. Alles hier
   is een pure functie van zijn invoer, zodat scripts/rekenkern.test.mjs elke
   aanname kan vastleggen.

   Het model in het kort (per jaar, situatie vanaf 2027, dus zonder saldering):

   1. Zelfverbruik-opslag (alleen met zonnepanelen)
      Op dagen met zonneoverschot gaat het overschot de batterij in en vervangt
      het 's avonds inkoop. Niet elke dag levert evenveel overschot: in maart
      haal je de batterij niet vol en in juni loopt hij over. Daarom rekent het
      model niet met het jaargemiddelde, maar met een spreiding over de dagen
      (zie opgeslagenPerDag hieronder).

   2. Handel op uurprijzen (alleen met dynamisch contract)
      Op dagen zonder zonneoverschot laden op goedkope uren en ontladen op dure
      uren. Begrensd door wat het huishouden per dag kan opmaken - ook als er
      meer dan één cyclus per dag wordt gedraaid.

   3. Terugverdientijd volgt uit de opgetelde besparing, met degradatie.

   Alles rekent op de uitgaande kWh (wat het huishouden echt gebruikt) waar het
   om verbruik gaat, en op de ingaande kWh (wat de batterij opneemt) waar het om
   opslag gaat. Die twee door elkaar halen scheelt het rendement, dus zo'n 10%.
   ========================================================================== */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Rekenkern = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  // Welk deel van het jaarverbruik valt buiten de zonuren (avond, nacht,
  // vroege ochtend)? Alleen dat deel kan een batterij bedienen.
  const AANDEEL_BUITEN_ZON = 0.7;

  // Dagen per jaar dat er zonder zonnepanelen gehandeld kan worden. Geen 365:
  // storingen, afwezigheid en dagen zonder bruikbare spreiding bestaan.
  const HANDELSDAGEN_ZONDER_PV = 350;

  // Boven deze impliciete spread (ontlaadwaarde min laadprijs) is de invoer
  // optimistischer dan een gemiddelde dag op de day-ahead-markt rechtvaardigt.
  const SPREAD_GRENS = 0.15;

  // Gelijk aan Prijs.BTW_FACTOR; rekenkern.test.mjs bewaakt dat ze niet
  // uiteenlopen. Hier apart gedefinieerd omdat deze kern verder niets nodig
  // heeft en zo los te testen blijft.
  const BTW_FACTOR = 1.21;

  /* Alle bedragen op deze site zijn incl. btw, en dat blijft de standaard: een
     particulier betaalt nu eenmaal btw. Maar regelgeving.html beschrijft twee
     routes waarlangs je die 21% niet of niet blijvend betaalt, en dat is de
     grootste knop aan de hele som - op een systeem van 5.990 euro gaat het om
     1.040 euro. De module die er een bedrag aan hangt, hoorde daarover niet te
     zwijgen terwijl de regelgevingspagina het uitlegt.

       incl  je betaalt 21% btw en houdt dat (losse aankoop, het gewone geval)
       nul   nultarief, als de batterij gelijktijdig met zonnepanelen als een
             levering wordt geinstalleerd
       terug je vraagt de btw terug als btw-ondernemer, wat kan als je
             aantoonbaar handelt via een dynamisch contract

     De laatste twee komen op hetzelfde netto bedrag uit; het verschil zit in
     de voorwaarden en in het feit dat je bij "terug" eerst voorschiet. Dat
     verschil hoort in de tekst thuis, niet in de som. */
  const BTW_ROUTES = ["incl", "nul", "terug"];

  // Hoeveel uur duurt de avondpiek waarin de batterij zijn stroom kwijt moet?
  // Grofweg 17 tot 21 uur. Een batterij met weinig vermogen krijgt er in dat
  // venster minder doorheen dan zijn capaciteit suggereert.
  const PIEKUREN = 4;

  // Boven dit aantal aaneengesloten laaduren val je buiten de paar echt
  // goedkope nachturen en loopt de gemiddelde laadprijs op.
  const LAADUREN_GRENS = 4;

  /* ------------------------------------------------------------------
     Teruglevering vanaf 2027, per contractsoort

     De module zegt te rekenen met de situatie na de saldering, maar telde de
     terugleverkosten van 2026 (0,12) plus een vergoeding van 0,05 als winst
     van de batterij. Netto kostte elke teruggeleverde kWh daarmee 7 cent. De
     leveranciers die voor 2027 iets hebben aangekondigd (Budget, Essent, Oxxio,
     Vattenfall) komen netto uit tussen 0 en 3 cent vergoeding: de kosten
     vervallen, de vergoeding wordt een paar cent. Met de oude standaard lag de
     opbrengst van een batterij bij een vast contract een kwart te hoog.

     Het getal voor "vast" is de mediaan van die aankondigingen;
     rekenkern.test.mjs bewaakt dat het met data/leveranciers.json blijft
     kloppen. Dynamisch blijft 0,05 vergoeding zonder kosten.
     ------------------------------------------------------------------ */
  const TERUGLEVERING = {
    vast: { terugleverVergoeding: 0.01, terugleverKosten: 0 },
    dynamisch: { terugleverVergoeding: 0.05, terugleverKosten: 0 },
  };

  const STANDAARD = {
    heeftPv: true,
    contract: "vast",
    opwek: 3500,
    eigenVerbruikPct: 30,
    stroomprijs: 0.30,
    terugleverVergoeding: TERUGLEVERING.vast.terugleverVergoeding,
    terugleverKosten: TERUGLEVERING.vast.terugleverKosten,
    laadprijs: 0.15,
    ontlaadwaarde: 0.30,
    investering: 0,
    capaciteit: 0,
    bruikbaarPct: 90,
    rendement: 90,
    zonDagen: 220,
    mismatch: 90,
    cycliPerDag: 1,
    extraOnbalans: 0,
    standbyWatt: 10,
    jaarVerbruik: 2900,
    // Van de jaarnota, in kWh per jaar. 0 = niet ingevuld; dan schat de kern
    // ze uit opwek, direct eigen verbruik en jaarverbruik.
    teruglevering: 0,
    afname: 0,
    degradatiePct: 2,
    btwRoute: "incl",
    // null = onbekend vermogen, dan begrenst de kern er niet op
    vermogenKw: null,
  };

  /* ------------------------------------------------------------------
     Hoeveel overschot vangt een batterij van deze maat op?

     De eerste versie rekende min(jaaroverschot, capaciteit x zonnedagen). Dat
     is een harde knik: zodra het overschot groter is dan wat de batterij in een
     jaar kan opnemen - bij een gemiddelde batterij al vanaf zo'n vijf panelen -
     wint de capaciteitsgrens altijd, en verandert het aantal panelen de
     uitkomst niet meer. Het veld "hoeveel panelen" stond dus in het formulier
     zonder iets te doen.

     Wat er in werkelijkheid gebeurt: het dagoverschot wisselt sterk. Op een
     grijze dag in maart komt de batterij niet vol, op een dag in juni loopt hij
     over. Het model beschrijft die spreiding met een exponentiële verdeling
     rond het gemiddelde dagoverschot - de standaardkeuze voor een grootheid die
     niet negatief kan zijn en waarvan de kleine waarden het talrijkst zijn.

     Voor E[min(dagoverschot, ruimte)] geeft dat een gesloten vorm:

         opgevangen = gemiddelde x (1 - e^(-ruimte / gemiddelde))

     Die loopt netjes op met zowel het overschot als de capaciteit en vlakt
     vanzelf af, in plaats van er tegenaan te knallen.
     ------------------------------------------------------------------ */
  function opgevangenPerDag(gemiddeldOverschot, ruimte) {
    if (!(gemiddeldOverschot > 0) || !(ruimte > 0)) return 0;
    return gemiddeldOverschot * (1 - Math.exp(-ruimte / gemiddeldOverschot));
  }

  /* De standaard voor teruglevering hangt aan het contract. Zonder dit kreeg
     de keuzehulp, die geen tarieven meegeeft, bij een dynamisch contract de
     terugleverkosten van een vast contract erbij. */
  function metStandaard(invoer) {
    const contract = invoer && invoer.contract === "dynamisch" ? "dynamisch" : "vast";
    return Object.assign({}, STANDAARD, TERUGLEVERING[contract], invoer);
  }

  /* Wat rekent deze leverancier vanaf 2027 voor een teruggeleverde kWh?
     Geeft null als er niets is aangekondigd. Is maar een van de twee bedragen
     bekend, dan vult de rest aan met de huidige terugleverkosten of de
     standaardvergoeding, en zegt "volledig" dat het een mengsel is. */
  function teruglevering2027(l) {
    if (!l) return null;
    const v = l.terugleververgoeding_2027_per_kwh;
    const k = l.terugleverkosten_2027_per_kwh;
    const heeftV = typeof v === "number", heeftK = typeof k === "number";
    if (!heeftV && !heeftK) return null;
    const soort = l.contract === "dynamisch" ? "dynamisch" : "vast";
    return {
      terugleverVergoeding: heeftV ? v : TERUGLEVERING[soort].terugleverVergoeding,
      terugleverKosten: heeftK ? k : (typeof l.terugleverkosten_per_kwh_indicatie === "number" ? l.terugleverkosten_per_kwh_indicatie : 0),
      volledig: heeftV && heeftK,
    };
  }

  /* De mediaan van wat leveranciers met een volledige aankondiging netto
     vergoeden (vergoeding min kosten). Bron voor TERUGLEVERING.vast. */
  function mediaanNetto2027(leveranciers) {
    const netto = (leveranciers || [])
      .filter((l) => l.contract === "vast-variabel")
      .map(teruglevering2027)
      .filter((t) => t && t.volledig)
      .map((t) => t.terugleverVergoeding - t.terugleverKosten)
      .sort((a, b) => a - b);
    if (!netto.length) return null;
    const m = Math.floor(netto.length / 2);
    return netto.length % 2 ? netto[m] : (netto[m - 1] + netto[m]) / 2;
  }

  /* Wat er per jaar teruggaat naar het net. De teruglevering op de jaarnota
     is gemeten; de rest is een schatting uit het aantal panelen en een
     aandeel direct eigen verbruik dat per huis sterk verschilt. */
  function overschotVan(i) {
    if (!i.heeftPv) return 0;
    if (i.teruglevering > 0) return i.teruglevering;
    return i.opwek * (1 - i.eigenVerbruikPct / 100);
  }

  function bereken(invoer) {
    const i = metStandaard(invoer);

    const heeftPv = i.heeftPv;
    const opwek = heeftPv ? i.opwek : 0;
    const eigenVerbruik = i.eigenVerbruikPct / 100;
    const rendement = i.rendement / 100;
    const mismatch = i.mismatch / 100;

    // Opslagruimte aan de ingaande kant (wat de batterij opneemt).
    const bruikbareCap = i.capaciteit * (i.bruikbaarPct / 100);
    // Wat het huishouden per dag buiten de zonuren kan opmaken, aan de
    // uitgaande kant (wat er uit de batterij komt).
    //
    // Staat de afname op de jaarnota, dan is dat de betere maat: een batterij
    // kan nooit meer vervangen dan je uit het net haalt, en met panelen valt
    // die afname vrijwel helemaal buiten de zonuren. Zonder jaarnota blijft
    // het een schatting uit het totale verbruik.
    const metAfname = i.afname > 0;
    const maxOntladingPerDag = metAfname ? i.afname / 365 : (i.jaarVerbruik / 365) * AANDEEL_BUITEN_ZON;
    // Diezelfde grens, teruggerekend naar de ingaande kant.
    const ruimtePerDag = Math.min(bruikbareCap, rendement > 0 ? maxOntladingPerDag / rendement : 0);

    const teGroot = bruikbareCap > 0 && (metAfname || i.jaarVerbruik > 0) &&
      bruikbareCap * rendement > maxOntladingPerDag * 1.15;

    /* De ingevoerde investering is altijd incl. btw (zie prijs.js). Bij het
       nultarief of een geslaagde teruggave betaal je die 21% niet, dus telt
       alleen het bedrag exclusief mee in de terugverdientijd. */
    const btwRoute = BTW_ROUTES.includes(i.btwRoute) ? i.btwRoute : "incl";
    const netInvestering = btwRoute === "incl" ? i.investering : i.investering / BTW_FACTOR;
    const btwVoordeel = i.investering - netInvestering;

    /* 1. Zelfverbruik-opslag */
    let overschot = 0, opslagJaar = 0, opbrengstZelf = 0, waardePerKwh = 0;
    if (heeftPv && bruikbareCap > 0 && i.zonDagen > 0) {
      overschot = overschotVan(i);
      const perDag = opgevangenPerDag(overschot / i.zonDagen, ruimtePerDag);
      opslagJaar = perDag * i.zonDagen * mismatch;
      // Elke opgeslagen kWh vervangt inkoop (x rendement wegens omzetverlies),
      // kost de misgelopen terugleververgoeding en scheelt terugleverkosten.
      waardePerKwh = i.stroomprijs * rendement - i.terugleverVergoeding + i.terugleverKosten;
      opbrengstZelf = Math.max(0, opslagJaar * waardePerKwh);
    }

    /* 2. Handel op uurprijzen */
    let arbDagen = 0, opbrengstArb = 0, ontladenPerDag = 0, geladenPerDag = 0, winstPerDag = 0;
    if (i.contract === "dynamisch" && bruikbareCap > 0) {
      arbDagen = heeftPv ? Math.max(0, 365 - i.zonDagen) : HANDELSDAGEN_ZONDER_PV;
      // De dagbegrenzing hoort over alle cycli samen te gelden. Stond ze per
      // cyclus, dan leverde "2 cycli per dag" twee keer een volle dagbehoefte
      // aan een huishouden dat er maar één opmaakt.
      ontladenPerDag = Math.min(bruikbareCap * rendement * i.cycliPerDag, maxOntladingPerDag);
      /* Derde grens, naast de capaciteit en het huishoudverbruik: het vermogen.
         Een batterij van 0,8 kW krijgt er in de vier uur avondpiek hooguit
         3,2 kWh doorheen, hoeveel er ook in zit. Dit veld stond in de
         gegevens van alle 41 modellen en werd nergens gebruikt. */
      if (i.vermogenKw > 0) {
        ontladenPerDag = Math.min(ontladenPerDag, i.vermogenKw * PIEKUREN);
      }
      geladenPerDag = rendement > 0 ? ontladenPerDag / rendement : 0;
      winstPerDag = ontladenPerDag * i.ontlaadwaarde - geladenPerDag * i.laadprijs;
      opbrengstArb = Math.max(0, arbDagen * winstPerDag);
    }

    /* 3. Eigen verbruik van de batterij: 24 uur per dag, dus tegen de gewone
       gemiddelde stroomprijs, niet tegen de goedkope laadprijs. */
    const standbyKwh = i.standbyWatt * 8760 / 1000;
    const kostenStandby = standbyKwh * i.stroomprijs;

    const totaal = opbrengstZelf + opbrengstArb + i.extraOnbalans - kostenStandby;

    const spread = i.ontlaadwaarde - i.laadprijs;

    // Hoeveel uur aaneengesloten laden vraagt dit per dag? Boven een uur of
    // vier zijn de goedkoopste nachturen op en klopt de laadprijs niet meer.
    const laaduren = i.vermogenKw > 0 && geladenPerDag > 0 ? geladenPerDag / i.vermogenKw : 0;
    const vermogenKnelt = i.vermogenKw > 0 && i.contract === "dynamisch" &&
      bruikbareCap * rendement * i.cycliPerDag > i.vermogenKw * PIEKUREN + 1e-9 &&
      maxOntladingPerDag > i.vermogenKw * PIEKUREN;

    return {
      invoer: i,
      btwRoute, netInvestering, btwVoordeel,
      laaduren, vermogenKnelt,
      metJaarnota: { teruglevering: heeftPv && i.teruglevering > 0, afname: metAfname },
      laadurenKnelt: laaduren > LAADUREN_GRENS,
      bruikbareCap, maxOntladingPerDag, ruimtePerDag, teGroot,
      overschot, opslagJaar, opbrengstZelf, waardePerKwh,
      arbDagen, ontladenPerDag, geladenPerDag, winstPerDag, opbrengstArb,
      standbyKwh, kostenStandby,
      totaal,
      spread,
      spreadOptimistisch: i.contract === "dynamisch" && spread > SPREAD_GRENS,
      terugverdientijd: terugverdientijd(totaal, netInvestering, i.degradatiePct / 100),
      geleverdPerJaar: opslagJaar * rendement + arbDagen * ontladenPerDag,
    };
  }

  /* ------------------------------------------------------------------
     Eerst dit: overstappen zonder batterij

     Wie terugleverkosten betaalt, ziet die in deze som terug als opbrengst
     van de batterij: elke kWh die hij opslaat, hoeft hij niet tegen kosten
     terug te leveren. Maar dat voordeel is ook te halen zonder één euro te
     investeren, door over te stappen naar een contract zonder die kosten. In
     een voorbeeld met 3.500 kWh opwek en 0,12 terugleverkosten leverde
     overstappen meer op dan de batterij zelf.

     Deze functie geeft daarom twee getallen: wat overstappen alleen al
     scheelt, en wat de batterij dáárna nog toevoegt. Het tweede is de eerlijke
     opbrengst van de batterij. Het alternatief rekent met de standaard voor
     een vast contract in 2027 (TERUGLEVERING.vast), niet met nul kosten en
     een hoge vergoeding: dat is wat de markt nu aankondigt.

     null als er niets te halen valt: geen panelen, al een dynamisch contract,
     of geen netto kosten op teruglevering die het alternatief niet heeft.
     ------------------------------------------------------------------ */
  function zonderBatterij(invoer) {
    const i = metStandaard(invoer);
    if (!i.heeftPv || i.contract === "dynamisch" || !(overschotVan(i) > 0)) return null;
    const alt = TERUGLEVERING.vast;
    const verschilPerKwh = (i.terugleverKosten - i.terugleverVergoeding) -
      (alt.terugleverKosten - alt.terugleverVergoeding);
    if (!(verschilPerKwh > 0)) return null;
    const teruggeleverd = overschotVan(i);
    const naOverstap = bereken(Object.assign({}, invoer, alt));
    return {
      teruggeleverd,
      verschilPerKwh,
      besparing: teruggeleverd * verschilPerKwh,
      naOverstap,
    };
  }

  /* ------------------------------------------------------------------
     Opgetelde besparing en terugverdientijd, mét degradatie

     Een batterij levert in jaar tien minder dan in jaar één. De zustermodule
     voor zonnepanelen rekende daar al mee (0,4% per jaar); deze deed dat niet,
     terwijl de afname bij een batterij juist een stuk groter is. Op de
     terugverdientijd scheelt dat weinig, op de rij "na 15 jaar" een procent of
     dertien - en dat is nu net de rij waar mensen naar kijken.
     ------------------------------------------------------------------ */
  function besparingNa(jaarOpbrengst, degradatie, jaren) {
    let som = 0;
    for (let j = 1; j <= jaren; j++) som += jaarOpbrengst * Math.pow(1 - degradatie, j - 1);
    return som;
  }

  /* Hoe een terugverdientijd beoordeeld wordt, overal op de site: de kleur
     in de rekenhulp, de regel in de keuzehulp en het plaatje bij een gedeelde
     uitslag. Gemeten aan de 10 tot 15 jaar die een thuisbatterij meegaat:
     tot 5 jaar ruim terugverdiend, tot 12 jaar terugverdiend met weinig
     marge, daarboven dicht bij of voorbij het moment dat hij op is. Geen
     terugverdientijd (hij levert per saldo niets op) telt als slecht. */
  const OORDEEL = { goedTot: 5, matigTot: 12 };
  function oordeel(t) {
    if (t == null || !Number.isFinite(t)) return "slecht";
    return t <= OORDEEL.goedTot ? "goed" : t <= OORDEEL.matigTot ? "matig" : "slecht";
  }

  function terugverdientijd(jaarOpbrengst, investering, degradatie) {
    if (!(jaarOpbrengst > 0) || !(investering > 0)) return null;
    let som = 0;
    for (let j = 1; j <= 40; j++) {
      const ditJaar = jaarOpbrengst * Math.pow(1 - degradatie, j - 1);
      if (som + ditJaar >= investering) return j - 1 + (investering - som) / ditJaar;
      som += ditJaar;
    }
    return null; // binnen een mensenleven verdient dit zich niet terug
  }

  /* ------------------------------------------------------------------
     Bandbreedte

     Eén getal met een decimaal suggereert een precisie die dit model niet
     heeft. Dezelfde batterij komt op 4 of op 12 jaar uit, afhankelijk van
     aannames die niemand vooraf kent. Daarom rekent de module de som ook door
     met een ongunstige en een gunstige set, en toont ze als bereik.

     De marges hieronder zijn bewust bescheiden: het gaat om normale
     onzekerheid over marktprijzen en praktijkrendement, niet om het uiterste
     dat denkbaar is.
     ------------------------------------------------------------------ */
  const MARGES = {
    stroomprijs: [0.85, 1.15],
    ontlaadwaarde: [0.85, 1.15],
    laadprijs: [1.15, 0.85],
    terugleverVergoeding: [1.4, 0.6],
    rendement: [0.94, 1.03],
    mismatch: [0.9, 1.05],
    standbyWatt: [1.5, 0.7],
  };

  function metMarge(basis, kant) {
    const uit = Object.assign({}, basis);
    for (const veld of Object.keys(MARGES)) {
      uit[veld] = basis[veld] * MARGES[veld][kant];
    }
    uit.rendement = Math.min(99, uit.rendement);
    uit.mismatch = Math.min(100, uit.mismatch);
    return uit;
  }

  function bandbreedte(invoer) {
    const i = metStandaard(invoer);
    const ongunstig = bereken(metMarge(i, 0));
    const gunstig = bereken(metMarge(i, 1));
    return {
      ongunstig, gunstig,
      verwacht: bereken(i),
      // null als de ongunstige kant zich niet terugverdient: dan is er geen
      // bovengrens en moet de module dat zeggen in plaats van een getal tonen.
      laag: gunstig.terugverdientijd,
      hoog: ongunstig.terugverdientijd,
    };
  }

  return {
    AANDEEL_BUITEN_ZON,
    HANDELSDAGEN_ZONDER_PV,
    SPREAD_GRENS,
    BTW_FACTOR,
    BTW_ROUTES,
    PIEKUREN,
    LAADUREN_GRENS,
    STANDAARD,
    TERUGLEVERING,
    MARGES,
    OORDEEL,
    oordeel,
    metStandaard,
    teruglevering2027,
    mediaanNetto2027,
    zonderBatterij,
    opgevangenPerDag,
    bereken,
    besparingNa,
    terugverdientijd,
    bandbreedte,
  };
});
