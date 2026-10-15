/* ==========================================================================
   Warmtepompmaatje - rekenkern

   De som achter de rekenmodule én de keuzehulp. Die stond eerst twee keer op
   de site, in rekenmodule.js en in advies.js, en liep uit elkaar: de
   rekenmodule rekende met het rendement van de gekozen pomp, de keuzehulp met
   vaste getallen. Dezelfde situatie gaf daardoor op twee pagina's een andere
   besparing, en niets testte dat. Nu staat de som hier één keer, en
   scripts/rekenkern.test.mjs bewaakt hem.

   Geen DOM in dit bestand: het draait in de browser en onder node --test.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Rekenkern = factory();
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const AANDEEL_VERWARMING = 0.75;   // circa 75% van het gas gaat naar verwarming (Milieu Centraal)
  const KWH_PER_M3 = 8.8;            // nuttige warmte per m3 gas via een moderne cv-ketel
  const HYBRIDE_DEKKING = 0.6;       // aandeel van de totale warmtevraag dat een hybride overneemt
  const HYBRIDE_SCOP = 4.5;          // hybride draait vooral op gunstige momenten
  const ALLEL_SCOP = 4.0;            // all-electric praktijkrendement voor verwarming

  // De labelwaarde is optimistisch: gemeten op een testbank bij 35 graden
  // aanvoer en gemiddeld klimaat. In een echte woning ligt het lager door
  // stilstandsverliezen, tapwater tussendoor en een installatie die zelden
  // perfect is ingeregeld. De vaste getallen hierboven zijn praktijkwaarden;
  // deze factor brengt een labelwaarde op diezelfde noemer.
  const PRAKTIJKFACTOR = 0.87;
  const TAPWATER_COP = 2.5;          // warm water en koken via boilervat en inductie
  const INSTALLATIE = { hybride: 2500, "all-electric": 4500 };
  const LEVENSDUUR_JAAR = 15;        // gemiddelde levensduur van een warmtepomp
  const CO2_PER_M3 = 1.78;           // kg CO2 per m3 aardgas (co2emissiefactoren.nl)
  const CO2_PER_KWH = 0.27;          // kg CO2 per kWh Nederlandse stroommix (indicatie)
  const MAX_JAAR = 40;               // daarboven noemen we geen getal meer

  const STANDAARD = {
    type: "hybride",
    gas: 1200,
    gasprijs: 1.45,
    stroomprijs: 0.30,
    vastrecht: 350,
    afsluitkosten: 700,
    gasAf: false,
    // null en niet 0: van een pomp zonder bekende prijs mag je geen
    // terugverdientijd uitrekenen. Met 0 telde het toestel als gratis.
    toestelPrijs: null,
    installatie: null,               // null = schatting uit INSTALLATIE
    isde: 0,
    pomp: null,                      // { scop, scop_conditie } of null
    ketelVervangen: false,
    // Voor de bandbreedte: het rendement en de geschatte installatiekosten
    // schuiven mee met de ongunstige of gunstige kant. 1 = middenscenario.
    scopFactor: 1,
    installatieFactor: 1,
    // Een nieuwe cv-ketel inclusief plaatsing kost volgens de Consumentenbond
    // 1.600 tot 3.400 euro (peildatum augustus 2026); dit is ruwweg het midden.
    ketelprijs: 2500,
  };

  /* Het rendement van deze pomp, niet van een gemiddelde pomp.

     Alleen gebruiken als vaststaat dat de SCOP bij 35 graden aanvoer geldt.
     Bij 55 graden ligt hij ruim een punt lager, en zonder die vermelding zou
     een pomp met een gunstig ogend getal een te mooie terugverdientijd
     krijgen. Staat het niet vast, dan null: de aanroeper rekent dan met de
     praktijkwaarde. */
  function eigenScop(pomp) {
    if (!pomp || typeof pomp.scop !== "number" || String(pomp.scop_conditie) !== "35") return null;
    return pomp.scop * PRAKTIJKFACTOR;
  }

  function terugverdientijd(investering, besparingJaar) {
    if (!(besparingJaar > 0)) return null;
    const t = Math.max(0, investering) / besparingJaar;
    return t > MAX_JAAR ? null : t;
  }

  function bereken(invoer) {
    const s = Object.assign({}, STANDAARD, invoer);
    const allel = s.type === "all-electric";
    const gas = Math.max(0, s.gas);

    const scopEigen = eigenScop(s.pomp);
    const scop = (scopEigen || (allel ? ALLEL_SCOP : HYBRIDE_SCOP)) * s.scopFactor;

    let gasBespaard, stroomKwh;
    if (!allel) {
      // De hybride neemt circa 60% van de totale warmtevraag over (circa 80%
      // van de verwarming; warm water en piekkou blijven bij de ketel).
      gasBespaard = gas * HYBRIDE_DEKKING;
      stroomKwh = (gasBespaard * KWH_PER_M3) / scop;
    } else {
      // All-electric vervangt alles: verwarming via de pomp, warm water via
      // het boilervat.
      const verwarmingGas = gas * AANDEEL_VERWARMING;
      gasBespaard = gas;
      stroomKwh = (verwarmingGas * KWH_PER_M3) / scop + ((gas - verwarmingGas) * KWH_PER_M3) / TAPWATER_COP;
    }

    const gasAf = allel && s.gasAf;
    const vastrechtBesparing = gasAf ? s.vastrecht : 0;
    const besparingJaar = gasBespaard * s.gasprijs + vastrechtBesparing - stroomKwh * s.stroomprijs;

    const installatieGeschat = !(s.installatie > 0);
    // Alleen een geschatte installatie schuift mee: een bedrag uit een offerte
    // is geen aanname meer.
    const installatie = installatieGeschat
      ? INSTALLATIE[allel ? "all-electric" : "hybride"] * s.installatieFactor
      : s.installatie;
    const prijsOnbekend = typeof s.toestelPrijs !== "number";
    const investering = (prijsOnbekend ? 0 : s.toestelPrijs) + installatie + (gasAf ? s.afsluitkosten : 0);
    const netto = Math.max(0, investering - s.isde);
    const tvt = prijsOnbekend ? null : terugverdientijd(netto, besparingJaar);

    /* Tegenover een nieuwe cv-ketel

       Wie zijn ketel toch moet vervangen, kiest niet tussen een warmtepomp en
       niets doen, maar tussen een warmtepomp en een nieuwe ketel. Dan telt
       alleen de meerprijs. De som zette de hele investering tegenover nul,
       en gaf daardoor precies de bezoeker met de dringendste vraag - "mijn
       ketel is op, wat nu?" - een te lange terugverdientijd voor all-electric.

       Bij een hybride werkt het andersom: die draait naast een ketel, dus de
       nieuwe ketel koop je in beide gevallen. De meerprijs blijft dan de
       pomp zelf, maar de totale uitgave is ketel plus pomp, en dat hoort de
       bezoeker te zien. */
    let tegenoverKetel = null;
    if (s.ketelVervangen) {
      const meerprijs = allel ? Math.max(0, netto - s.ketelprijs) : netto;
      tegenoverKetel = {
        ketelprijs: s.ketelprijs,
        meerprijs,
        totaleUitgave: allel ? netto : netto + s.ketelprijs,
        ketelBlijftNodig: !allel,
        tvt: prijsOnbekend ? null : terugverdientijd(meerprijs, besparingJaar),
      };
    }

    return {
      invoer: s,
      scop, eigenScop: scopEigen !== null,
      gasBespaard, gasOver: gas - gasBespaard, stroomKwh,
      vastrechtBesparing, besparingJaar,
      installatie, installatieGeschat,
      investering, netto, prijsOnbekend, tvt,
      besparingLevensduur: besparingJaar * LEVENSDUUR_JAAR,
      co2: gasBespaard * CO2_PER_M3 - stroomKwh * CO2_PER_KWH,
      tegenoverKetel,
    };
  }

  /* ------------------------------------------------------------------
     Bandbreedte

     Eén getal met een decimaal ("7,0 jaar") suggereert een precisie die deze
     som niet heeft. De gasprijs kan over vijftien jaar alle kanten op, het
     rendement in een echte woning hangt af van de inregeling, en de
     installatie is een schatting zolang er geen offerte ligt. Batterijmaatje
     toont daarom al een bereik; deze module nu ook.

     De marges zijn bewust bescheiden: normale onzekerheid, niet het uiterste.
     De installatie heeft de breedste en scheefste marge, omdat offertes in de
     praktijk vaker boven de schatting uitkomen dan eronder.
     ------------------------------------------------------------------ */
  const MARGES = {
    gasprijs: [0.85, 1.15],
    stroomprijs: [1.15, 0.85],
    scopFactor: [0.9, 1.08],
    installatieFactor: [1.4, 0.9],
  };

  function metMarge(basis, kant) {
    const uit = Object.assign({}, STANDAARD, basis);
    for (const veld of Object.keys(MARGES)) uit[veld] = uit[veld] * MARGES[veld][kant];
    return uit;
  }

  function bandbreedte(invoer) {
    const verwacht = bereken(invoer);
    const ongunstig = bereken(metMarge(invoer, 0));
    const gunstig = bereken(metMarge(invoer, 1));
    const ketel = (r) => (r.tegenoverKetel ? r.tegenoverKetel.tvt : null);
    return {
      verwacht, ongunstig, gunstig,
      // null aan de bovenkant: de ongunstige kant verdient zich binnen
      // MAX_JAAR niet terug, dus is er geen bovengrens om te noemen.
      laag: gunstig.tvt, hoog: ongunstig.tvt,
      ketelLaag: ketel(gunstig), ketelHoog: ketel(ongunstig),
    };
  }

  return {
    AANDEEL_VERWARMING, KWH_PER_M3, HYBRIDE_DEKKING, HYBRIDE_SCOP, ALLEL_SCOP,
    PRAKTIJKFACTOR, TAPWATER_COP, INSTALLATIE, LEVENSDUUR_JAAR, MAX_JAAR,
    STANDAARD, MARGES,
    eigenScop, terugverdientijd, bereken, bandbreedte,
  };
});
