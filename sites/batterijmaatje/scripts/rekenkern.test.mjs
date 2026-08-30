/**
 * Tests voor assets/rekenkern.js - de rekensom achter de terugverdientijd.
 *
 * Waarom deze er zijn: de wiskunde zat eerst midden in de DOM-code van
 * rekenmodule.js en werd door niets getest. Daardoor konden er fouten in
 * blijven staan die op het scherm nergens uit bleken. De gevallen hieronder
 * zijn geen bedachte randgevallen; het zijn de fouten die er echt in zaten,
 * elk met de schade erbij, zodat ze niet nog eens kunnen gebeuren.
 *
 * Draaien: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Rekenkern = require("../assets/rekenkern.js");
const batterijen = require("../data/batterijen.json").batterijen;
const leveranciers = require("../data/leveranciers.json").leveranciers;

// De Marstek Venus E met een dynamisch contract: het voorbeeld dat op de
// pagina staat uitgewerkt. capaciteit_soort is "bruikbaar", dus 100%.
const VOORBEELD = {
  capaciteit: 4.6,
  bruikbaarPct: 100,
  investering: 1299,
  contract: "dynamisch",
  terugleverKosten: 0,
};

const rond = (n, d = 0) => Math.round(n * 10 ** d) / 10 ** d;

/* ------------------------------------------------------------------
   Het aantal panelen moet de uitkomst veranderen
   ------------------------------------------------------------------ */

test("meer panelen leveren meer op, over het hele realistische bereik", () => {
  // Hier ging het mis: met min(overschot, capaciteit x zonnedagen) won de
  // capaciteitsgrens vanaf ongeveer vijf panelen altijd. Van 6 tot 30 panelen
  // kwam er exact hetzelfde bedrag uit, dus stond stap 2 van het formulier in
  // beeld zonder iets te doen. Wie zijn panelen telde, zag het getal niet
  // bewegen en concludeerde dat de tool kapot was.
  const opbrengst = (n) => Rekenkern.bereken({ ...VOORBEELD, opwek: n * 350 }).totaal;
  for (const n of [4, 6, 8, 10, 12, 16, 20, 30]) {
    assert.ok(opbrengst(n) > opbrengst(n - 2),
      `${n} panelen zou meer moeten opleveren dan ${n - 2}`);
  }
});

test("de opbrengst vlakt af in plaats van door te schieten", () => {
  // Meer panelen helpen, maar met steeds kleinere stappen: de batterij blijft
  // even groot. Een lineair verband zou net zo fout zijn als een harde knik.
  const o = (n) => Rekenkern.bereken({ ...VOORBEELD, opwek: n * 350 }).opslagJaar;
  const eersteStap = o(8) - o(6);
  const latereStap = o(22) - o(20);
  assert.ok(latereStap > 0, "ook grote arrays leveren nog iets extra's op");
  assert.ok(latereStap < eersteStap, "maar duidelijk minder dan de eerste panelen");
});

test("direct eigen verbruik verlaagt de opbrengst", () => {
  // Wat je al direct gebruikt, hoeft de batterij niet meer op te slaan. Ook
  // dit veld stond eerst stil.
  const laag = Rekenkern.bereken({ ...VOORBEELD, eigenVerbruikPct: 10 }).totaal;
  const hoog = Rekenkern.bereken({ ...VOORBEELD, eigenVerbruikPct: 70 }).totaal;
  assert.ok(laag > hoog, "bij 70% direct eigen verbruik blijft er minder over voor de batterij");
});

test("de opgevangen hoeveelheid blijft onder beide grenzen", () => {
  // Nooit meer dan er is, en nooit meer dan erin past.
  for (const gem of [0.5, 4, 11, 40]) {
    for (const ruimte of [0.5, 4.6, 20]) {
      const uit = Rekenkern.opgevangenPerDag(gem, ruimte);
      assert.ok(uit <= gem + 1e-9, "niet meer dan het overschot");
      assert.ok(uit <= ruimte + 1e-9, "niet meer dan de batterij kan opnemen");
    }
  }
});

/* ------------------------------------------------------------------
   De dagbegrenzing geldt over alle cycli samen
   ------------------------------------------------------------------ */

test("twee cycli per dag leveren niet meer op dan het huishouden opmaakt", () => {
  // De begrenzing zat per cyclus in plaats van per dag. Bij een gemiddeld
  // huishouden (2.900 kWh) leverde "2 cycli" daardoor 9,2 kWh per dag aan een
  // huis dat er buiten de zonuren maar 5,6 kWh opmaakt - en de pagina raadt
  // warmtepompbezitters expliciet aan om die 2 in te vullen.
  const max = Rekenkern.bereken(VOORBEELD).maxOntladingPerDag;
  for (const cycli of [1, 1.5, 2]) {
    const r = Rekenkern.bereken({ ...VOORBEELD, cycliPerDag: cycli });
    assert.ok(r.ontladenPerDag <= max + 1e-9,
      `${cycli} cycli ontlaadt ${r.ontladenPerDag} kWh, meer dan de ${max} kWh die eruit kan`);
  }
});

test("bij een hoger verbruik mag een tweede cyclus wél meetellen", () => {
  // Met een warmtepomp (7.000 kWh) kan het huishouden de tweede cyclus wel
  // opmaken. De begrenzing hoort mee te bewegen, niet hard te blokkeren.
  const een = Rekenkern.bereken({ ...VOORBEELD, jaarVerbruik: 7000, cycliPerDag: 1 });
  const twee = Rekenkern.bereken({ ...VOORBEELD, jaarVerbruik: 7000, cycliPerDag: 2 });
  assert.ok(twee.totaal > een.totaal, "een tweede cyclus levert hier wel extra op");
});

test("de batterij levert nooit meer dan het huishouden buiten de zonuren verbruikt", () => {
  // De harde bovengrens van het hele model, in één regel.
  for (const cap of [2, 5, 10, 20, 40]) {
    for (const verbruik of [1500, 2900, 7000]) {
      const r = Rekenkern.bereken({ ...VOORBEELD, capaciteit: cap, jaarVerbruik: verbruik, cycliPerDag: 2 });
      assert.ok(r.geleverdPerJaar <= verbruik * Rekenkern.AANDEEL_BUITEN_ZON + 1e-6,
        `${cap} kWh bij ${verbruik} kWh verbruik levert ${rond(r.geleverdPerJaar)} kWh, meer dan er opgemaakt kan worden`);
    }
  }
});

/* ------------------------------------------------------------------
   Een ongunstiger situatie mag nooit een gunstiger uitkomst geven
   ------------------------------------------------------------------ */

test("een vast contract verdient nooit sneller terug dan een dynamisch", () => {
  // Dit is de fout die de leverancierskiezer maakte. Wie een vaste
  // leverancier koos hield "dynamisch" staan én kreeg diens hoge
  // terugleverkosten erbij, waardoor de terugverdientijd juist korter werd
  // (4,8 naar 3,6 jaar). De bezoeker die er het slechtst voorstond kreeg zo
  // het mooiste getal te zien.
  for (const tlk of leveranciers.map((l) => l.terugleverkosten_per_kwh_indicatie).filter((n) => typeof n === "number")) {
    const vast = Rekenkern.bereken({ ...VOORBEELD, contract: "vast", terugleverKosten: tlk });
    const dyn = Rekenkern.bereken({ ...VOORBEELD, contract: "dynamisch", terugleverKosten: tlk });
    assert.ok(dyn.totaal >= vast.totaal,
      `bij terugleverkosten ${tlk} levert vast (${rond(vast.totaal)}) meer op dan dynamisch (${rond(dyn.totaal)})`);
  }
});

test("een duurdere batterij verdient zichzelf nooit sneller terug", () => {
  const goedkoop = Rekenkern.bereken({ ...VOORBEELD, investering: 1000 });
  const duur = Rekenkern.bereken({ ...VOORBEELD, investering: 3000 });
  assert.ok(duur.terugverdientijd > goedkoop.terugverdientijd);
});

test("meer standby-verbruik en een lager rendement maken het altijd slechter", () => {
  const basis = Rekenkern.bereken(VOORBEELD).totaal;
  assert.ok(Rekenkern.bereken({ ...VOORBEELD, standbyWatt: 25 }).totaal < basis);
  assert.ok(Rekenkern.bereken({ ...VOORBEELD, rendement: 75 }).totaal < basis);
});

/* ------------------------------------------------------------------
   Degradatie
   ------------------------------------------------------------------ */

test("degradatie verlengt de terugverdientijd en verlaagt de opgetelde besparing", () => {
  // De zustermodule voor zonnepanelen rekende hier al mee, deze niet - terwijl
  // de afname bij een batterij groter is. Op de rij "na 15 jaar" scheelde dat
  // ruim tien procent, en dat is net de rij waar mensen naar kijken.
  const zonder = Rekenkern.terugverdientijd(218, 1299, 0);
  const met = Rekenkern.terugverdientijd(218, 1299, 0.02);
  assert.ok(met > zonder);
  assert.ok(Rekenkern.besparingNa(218, 0.02, 15) < Rekenkern.besparingNa(218, 0, 15));
  assert.equal(rond(Rekenkern.besparingNa(218, 0, 10)), 2180, "zonder degradatie is het gewoon maal tien");
});

test("een batterij die zichzelf nooit terugverdient geeft null, geen getal", () => {
  assert.equal(Rekenkern.terugverdientijd(0, 1299, 0.02), null);
  assert.equal(Rekenkern.terugverdientijd(-50, 1299, 0.02), null);
  assert.equal(Rekenkern.terugverdientijd(218, 0, 0.02), null);
  // 5 euro per jaar op 1.299 euro haalt de veertig jaar niet
  assert.equal(Rekenkern.terugverdientijd(5, 1299, 0.02), null);
});

/* ------------------------------------------------------------------
   Bandbreedte
   ------------------------------------------------------------------ */

test("het bereik ligt om het middenscenario heen", () => {
  const b = Rekenkern.bandbreedte(VOORBEELD);
  assert.ok(b.laag < b.verwacht.terugverdientijd, "de gunstige kant is sneller");
  assert.ok(b.hoog > b.verwacht.terugverdientijd, "de ongunstige kant is trager");
});

test("het bereik van het voorbeeld overlapt met het onafhankelijke onderzoek", () => {
  // CE Delft/Vereniging Eigen Huis: 6,5 tot 22 jaar. Berenschot: 4 tot 12.
  // Een model dat daar volledig buiten valt, klopt niet met wat de pagina er
  // zelf onder als bron zet.
  const b = Rekenkern.bandbreedte(VOORBEELD);
  assert.ok(b.laag >= 3 && b.laag <= 12, `ondergrens ${rond(b.laag, 1)} jaar is niet plausibel`);
  assert.ok(b.hoog >= 8 && b.hoog <= 25, `bovengrens ${rond(b.hoog, 1)} jaar is niet plausibel`);
});

/* ------------------------------------------------------------------
   Randgevallen die de module niet mag laten omvallen
   ------------------------------------------------------------------ */

test("lege of onmogelijke invoer geeft geen NaN of Infinity", () => {
  const gevallen = [
    {},
    { capaciteit: 0, investering: 0 },
    { ...VOORBEELD, jaarVerbruik: 0 },
    { ...VOORBEELD, rendement: 0 },
    { ...VOORBEELD, zonDagen: 0 },
    { ...VOORBEELD, zonDagen: 365 },
    { ...VOORBEELD, opwek: 0 },
    { ...VOORBEELD, heeftPv: false, contract: "vast" },
  ];
  for (const g of gevallen) {
    const r = Rekenkern.bereken(g);
    for (const [sleutel, waarde] of Object.entries(r)) {
      if (typeof waarde !== "number") continue;
      assert.ok(Number.isFinite(waarde), `${sleutel} is ${waarde} bij invoer ${JSON.stringify(g)}`);
    }
  }
});

test("zonder zonnepanelen en zonder dynamisch contract levert de batterij niets op", () => {
  const r = Rekenkern.bereken({ ...VOORBEELD, heeftPv: false, contract: "vast" });
  assert.equal(r.opbrengstZelf, 0);
  assert.equal(r.opbrengstArb, 0);
  assert.ok(r.totaal < 0, "alleen het standby-verbruik blijft over");
  assert.equal(r.terugverdientijd, null);
});

test("een te grote batterij wordt herkend en levert niet meer op dan een passende", () => {
  // Bij een gelijke prijs per kWh: de grote batterij kost evenredig meer,
  // maar het huishouden kan de extra kWh niet opmaken. Een te grote accu
  // kopen is een van de duurste beginnersfouten, dus dat moet uit de
  // terugverdientijd blijken en niet alleen uit een waarschuwing.
  const perKwh = 300;
  const passend = Rekenkern.bereken({ ...VOORBEELD, capaciteit: 5, investering: 5 * perKwh });
  const enorm = Rekenkern.bereken({ ...VOORBEELD, capaciteit: 30, investering: 30 * perKwh });
  assert.equal(passend.teGroot, false);
  assert.equal(enorm.teGroot, true);
  // null betekent "verdient zich binnen veertig jaar niet terug", en dat is
  // een slechtere uitkomst dan elk getal - niet een ontbrekende waarde.
  assert.ok(enorm.terugverdientijd === null || enorm.terugverdientijd > passend.terugverdientijd,
    "dezelfde prijs per kWh, maar de extra capaciteit kan er niet uit");
  // En de opbrengst zelf loopt vast: zes keer zoveel accu is geen zes keer
  // zoveel besparing.
  assert.ok(enorm.totaal < passend.totaal * 2);
});

test("bij gelijke prijs per kWh loopt de terugverdientijd op met de maat", () => {
  const tvt = (cap) => Rekenkern.bereken({ ...VOORBEELD, capaciteit: cap, investering: cap * 300 }).terugverdientijd;
  assert.ok(tvt(5) < tvt(10), "10 kWh verdient trager terug dan 5 kWh");
  assert.ok(tvt(10) < tvt(20), "20 kWh verdient trager terug dan 10 kWh");
  assert.equal(tvt(30), null, "30 kWh bij een gemiddeld huishouden verdient zich niet terug");
});

/* ------------------------------------------------------------------
   De standaardwaarden moeten bij de gegevens van de site passen
   ------------------------------------------------------------------ */

test("de standaard terugleverkosten passen bij wat leveranciers echt rekenen", () => {
  // De oude standaard was 0,02 per kWh. Geen enkele leverancier in
  // data/leveranciers.json zat daar in de buurt: vast en variabel staan op
  // 0,11 tot 0,15, dynamisch op 0. Een standaardwaarde die bij niemand hoort,
  // hoort er niet te staan.
  const vast = leveranciers
    .filter((l) => l.contract === "vast-variabel" && typeof l.terugleverkosten_per_kwh_indicatie === "number")
    .map((l) => l.terugleverkosten_per_kwh_indicatie);
  assert.ok(vast.length >= 5, "te weinig leveranciers om een zinnige standaard op te baseren");
  const laagste = Math.min(...vast), hoogste = Math.max(...vast);
  assert.ok(Rekenkern.STANDAARD.terugleverKosten >= laagste && Rekenkern.STANDAARD.terugleverKosten <= hoogste,
    `standaard ${Rekenkern.STANDAARD.terugleverKosten} valt buiten ${laagste} tot ${hoogste}`);
});

test("de standaard is een vast contract, niet de gunstigste variant", () => {
  // De meeste huishoudens hebben geen dynamisch contract. Stond dat toch als
  // standaard ingesteld, dan was het eerste getal dat iedereen zag meteen het
  // mooiste dat het model kan maken.
  assert.equal(Rekenkern.STANDAARD.contract, "vast");
});

test("de standaard laad- en ontlaadprijs impliceren geen onrealistische spread", () => {
  // Beide bedragen zijn incl. belastingen, en die zijn aan weerskanten gelijk.
  // Het verschil is dus puur marktspread, elke dag van het jaar.
  const spread = Rekenkern.STANDAARD.ontlaadwaarde - Rekenkern.STANDAARD.laadprijs;
  assert.ok(spread <= Rekenkern.SPREAD_GRENS,
    `standaardspread ${rond(spread, 2)} is hoger dan de grens waarboven de module zelf waarschuwt`);
});

test("een optimistische spread wordt gesignaleerd", () => {
  const r = Rekenkern.bereken({ ...VOORBEELD, laadprijs: 0.15, ontlaadwaarde: 0.32 });
  assert.equal(r.spreadOptimistisch, true, "0,17 verschil per kWh hoort een waarschuwing te geven");
  const stil = Rekenkern.bereken({ ...VOORBEELD, laadprijs: 0.18, ontlaadwaarde: 0.30 });
  assert.equal(stil.spreadOptimistisch, false);
});

/* ------------------------------------------------------------------
   Het voorbeeld op de pagina moet blijven kloppen met de code
   ------------------------------------------------------------------ */

test("het rekenvoorbeeld op rekenmodule.html komt uit deze kern", () => {
  // De pagina rekende een Marstek Venus E van "5,12 kWh" voor, terwijl
  // batterijen.json 4,6 kWh zegt. De knop "open dit voorbeeld" gaf daardoor
  // 5,4 jaar waar de tabel erboven 4,8 jaar beloofde: twee antwoorden voor
  // hetzelfde voorbeeld op dezelfde pagina. Deze test legt vast dat de
  // getallen in de tekst uit de code komen.
  const b = batterijen.find((x) => x.id === "marstek-venus-e-3");
  assert.ok(b, "marstek-venus-e-3 staat niet meer in de gegevens");
  assert.equal(b.capaciteit_kwh, VOORBEELD.capaciteit,
    "de capaciteit in de gegevens wijkt af van het voorbeeld op de pagina");
  assert.equal(b.totaalprijs_van_eur, VOORBEELD.investering);

  const r = Rekenkern.bereken(VOORBEELD);
  assert.equal(rond(r.opslagJaar), 746);
  assert.equal(rond(r.opbrengstZelf), 164);
  assert.equal(r.arbDagen, 145);
  assert.equal(rond(r.opbrengstArb), 80);
  assert.equal(rond(r.kostenStandby), 26);
  assert.equal(rond(r.totaal), 218);
  assert.equal(rond(r.terugverdientijd, 1), 6.3);
  assert.equal(rond(Rekenkern.besparingNa(r.totaal, 0.02, 5)), 1047);
  assert.equal(rond(Rekenkern.besparingNa(r.totaal, 0.02, 10)), 1993);
  assert.equal(rond(Rekenkern.besparingNa(r.totaal, 0.02, 15)), 2848);
});

/* ------------------------------------------------------------------
   Btw-routes

   regelgeving.html beschrijft drie situaties; de module kende er een. Op een
   systeem van 5.990 euro scheelt dat 1.040 euro, de grootste knop aan de hele
   som.
   ------------------------------------------------------------------ */

test("het nultarief en de teruggave rekenen met het bedrag exclusief btw", () => {
  const incl = Rekenkern.bereken({ ...VOORBEELD, btwRoute: "incl" });
  const nul = Rekenkern.bereken({ ...VOORBEELD, btwRoute: "nul" });
  const terug = Rekenkern.bereken({ ...VOORBEELD, btwRoute: "terug" });
  assert.equal(incl.netInvestering, 1299);
  assert.equal(rond(nul.netInvestering), rond(1299 / Rekenkern.BTW_FACTOR));
  // Beide routes komen op hetzelfde netto bedrag uit; het verschil zit in de
  // voorwaarden, en dat hoort in de tekst en niet in de som.
  assert.equal(nul.netInvestering, terug.netInvestering);
  assert.ok(nul.terugverdientijd < incl.terugverdientijd);
});

test("de btw-factor loopt gelijk met prijs.js", () => {
  // Twee bestanden die allebei 1,21 hardcoderen, lopen ooit uiteen.
  const Prijs = require("../assets/prijs.js");
  assert.equal(Rekenkern.BTW_FACTOR, Prijs.BTW_FACTOR);
});

test("een onbekende btw-route valt terug op het veilige geval", () => {
  // Veilig = de bezoeker betaalt gewoon btw. Een typefout in een gedeelde URL
  // mag de terugverdientijd niet gunstiger maken dan hij is.
  for (const rommel of ["", "gratis", null, undefined, "NUL", 0]) {
    const r = Rekenkern.bereken({ ...VOORBEELD, btwRoute: rommel });
    assert.equal(r.btwRoute, "incl", `${JSON.stringify(rommel)} werd niet afgevangen`);
    assert.equal(r.netInvestering, 1299);
  }
});

test("het btw-voordeel is precies het btw-deel van de prijs", () => {
  const r = Rekenkern.bereken({ ...VOORBEELD, investering: 5990, btwRoute: "nul" });
  assert.equal(Math.round(r.btwVoordeel), Math.round(5990 * 21 / 121));
});

/* ------------------------------------------------------------------
   Vermogen

   vermogen_kw stond in de gegevens van alle 41 modellen en werd nergens
   gebruikt, terwijl het bij de goedkope plug-ins de echte grens is.
   ------------------------------------------------------------------ */

test("een laag vermogen begrenst wat er per dag doorheen gaat", () => {
  const zonder = Rekenkern.bereken({ ...VOORBEELD, vermogenKw: null });
  const zwak = Rekenkern.bereken({ ...VOORBEELD, vermogenKw: 0.8 });
  assert.ok(zwak.ontladenPerDag <= 0.8 * Rekenkern.PIEKUREN + 1e-9);
  assert.ok(zwak.ontladenPerDag < zonder.ontladenPerDag);
  assert.equal(zwak.vermogenKnelt, true);
  assert.ok(zwak.totaal < zonder.totaal, "minder vermogen mag nooit meer opleveren");
});

test("een ruim vermogen verandert niets", () => {
  const ruim = Rekenkern.bereken({ ...VOORBEELD, vermogenKw: 5 });
  const zonder = Rekenkern.bereken({ ...VOORBEELD, vermogenKw: null });
  assert.equal(rond(ruim.totaal, 4), rond(zonder.totaal, 4));
  assert.equal(ruim.vermogenKnelt, false);
});

test("de benodigde laaduren worden gemeld als ze de goedkope uren voorbijlopen", () => {
  const traag = Rekenkern.bereken({ ...VOORBEELD, capaciteit: 6.3, bruikbaarPct: 100, vermogenKw: 0.8 });
  assert.ok(traag.laaduren > 0);
  assert.equal(traag.laadurenKnelt, traag.laaduren > Rekenkern.LAADUREN_GRENS);
});

test("het vermogen uit de gegevens is bruikbaar voor de kern", () => {
  // Een lege string of een tekstje zou de begrenzing stilletjes uitschakelen.
  for (const b of batterijen) {
    if (b.vermogen_kw == null) continue;
    assert.equal(typeof b.vermogen_kw, "number", `${b.id} heeft een niet-numeriek vermogen`);
    assert.ok(b.vermogen_kw > 0, `${b.id} heeft vermogen ${b.vermogen_kw}`);
  }
});

/* ------------------------------------------------------------------
   Twee batterijen in dezelfde situatie
   ------------------------------------------------------------------ */

test("alleen het apparaat verschilt als je twee batterijen vergelijkt", () => {
  // De vergelijking is alleen eerlijk als het huishouden en de prijzen gelijk
  // blijven; anders vergelijk je twee verschillende sommen.
  const situatie = { ...VOORBEELD, jaarVerbruik: 4200, stroomprijs: 0.34 };
  const klein = Rekenkern.bereken({ ...situatie, capaciteit: 2.7, investering: 1230 });
  const groot = Rekenkern.bereken({ ...situatie, capaciteit: 10, investering: 5990 });
  assert.equal(klein.invoer.jaarVerbruik, groot.invoer.jaarVerbruik);
  assert.equal(klein.invoer.stroomprijs, groot.invoer.stroomprijs);
  assert.ok(klein.terugverdientijd < groot.terugverdientijd,
    "de goedkope plug-in verdient zich hier sneller terug dan het dure systeem");
});
