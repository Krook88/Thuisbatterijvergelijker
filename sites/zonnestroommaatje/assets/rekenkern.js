/* ==========================================================================
   Zonnestroommaatje - rekenkern

   De som achter de rekenmodule en het energieplan. Die stond twee keer op de
   site, in rekenmodule.js en in energieplan.js, elk met eigen getallen voor
   teruglevering, en niets testte hem. Nu staat hij hier één keer, en
   scripts/rekenkern.test.mjs bewaakt hem.

   Geen DOM in dit bestand: het draait in de browser en onder node --test.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Rekenkern = factory();
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const DEGRADATIE_PER_JAAR = 0.004;   // 0,4% minder opbrengst per jaar
  const SALDERING_EINDJAAR = 2026;     // laatste jaar mét saldering (Wet beëindiging salderingsregeling)
  const LOOPTIJD_JAAR = 25;
  const MAX_JAAR = 40;

  /* Teruglevering

     Vanaf 2027: de leveranciers die iets hebben aangekondigd (Budget, Essent,
     Oxxio, Vattenfall) schrappen de terugleverkosten en vergoeden netto 0 tot
     3 cent. Hier stond 0,05 vergoeding min 0,02 kosten, netto 3 cent, terwijl
     batterijmaatje sinds oktober 2026 met de mediaan van die aankondigingen
     rekent (1 cent). Twee zustersites die elkaar tegenspreken; nu niet meer,
     rekenkern.test.mjs vergelijkt ze.

     Tot en met 2026: wie een vast of variabel contract heeft, betaalt nu
     0,11 tot 0,15 per teruggeleverde kWh. Hier stond 0,02 voor beide
     perioden, waardoor het jaar met saldering te gunstig uitviel. 0,13 is de
     mediaan van data/leveranciers.json op batterijmaatje. */
  const TERUGLEVERING_2027 = { vergoeding: 0.01, terugleverkosten: 0 };
  const TERUGLEVERKOSTEN_2026 = 0.13;

  const STANDAARD = {
    opwek: 3500,                 // kWh in jaar 1
    verbruik: 2900,
    stroomprijs: 0.30,
    vergoeding: TERUGLEVERING_2027.vergoeding,
    terugleverkosten: TERUGLEVERING_2027.terugleverkosten,
    terugleverkosten2026: TERUGLEVERKOSTEN_2026,
    eigenPct: 0.35,
    kosten: 0,
    startJaar: new Date().getFullYear(),
  };

  // Besparing in één jaar mét saldering: teruglevering wegstrepen tegen afname
  function besparingMetSaldering(opwek, s) {
    const eigen = Math.min(opwek * s.eigenPct, s.verbruik);
    const teruggeleverd = opwek - eigen;
    const afnameVanNet = Math.max(0, s.verbruik - eigen);
    const gesaldeerd = Math.min(teruggeleverd, afnameVanNet);
    const overschot = teruggeleverd - gesaldeerd;
    return eigen * s.stroomprijs + gesaldeerd * s.stroomprijs + overschot * s.vergoeding
      - teruggeleverd * s.terugleverkosten2026;
  }

  // Besparing in één jaar zonder saldering: alleen direct eigen verbruik is de
  // volle stroomprijs waard; eigen verbruik kan nooit meer zijn dan je verbruik
  function besparingZonderSaldering(opwek, s) {
    const eigen = Math.min(opwek * s.eigenPct, s.verbruik);
    const teruggeleverd = opwek - eigen;
    return eigen * s.stroomprijs + teruggeleverd * (s.vergoeding - s.terugleverkosten);
  }

  function besparingInJaar(opwek, s, jaar) {
    return jaar <= SALDERING_EINDJAAR ? besparingMetSaldering(opwek, s) : besparingZonderSaldering(opwek, s);
  }

  /* Jaar voor jaar optellen, met veroudering. Het aanschafjaar telt voor een
     half jaar mee. Het aanschafjaar volgt de kalender: met een vast 2026 kreeg
     wie in 2027 koopt een half jaar saldering dat hij nooit krijgt. */
  function bereken(invoer) {
    const s = Object.assign({}, STANDAARD, invoer);
    let cumulatief = 0, jaren = 0, terugverdientijd = null, besparing25 = 0;
    for (let j = 0; j <= MAX_JAAR; j++) {
      const jaar = s.startJaar + j;
      const deel = j === 0 ? 0.5 : 1;
      const opwekDitJaar = s.opwek * Math.max(0, 1 - DEGRADATIE_PER_JAAR * j);
      const besparing = besparingInJaar(opwekDitJaar, s, jaar) * deel;
      if (j < LOOPTIJD_JAAR) besparing25 += besparing;
      const vorige = cumulatief;
      cumulatief += besparing;
      jaren += deel;
      if (terugverdientijd === null && s.kosten > 0 && cumulatief >= s.kosten && besparing > 0) {
        terugverdientijd = jaren - deel + ((s.kosten - vorige) / besparing) * deel;
      }
    }
    return {
      invoer: s,
      metSaldering: besparingMetSaldering(s.opwek, s),
      zonderSaldering: besparingZonderSaldering(s.opwek, s),
      terugverdientijd,
      besparing25,
    };
  }

  /* Bandbreedte

     Eén getal met een decimaal doet alsof de stroomprijs over vijftien jaar
     vaststaat en elk dak precies de vuistregel haalt. Dezelfde som, nog eens
     met een ongunstige en een gunstige set aannames. Bescheiden marges:
     normale onzekerheid, niet het uiterste. De kosten schuiven alleen mee als
     ze geschat zijn; een offertebedrag is geen aanname. */
  const MARGES = {
    stroomprijs: [0.85, 1.15],
    opwek: [0.92, 1.05],
    eigenPct: [0.85, 1.15],
  };
  const KOSTEN_MARGE = [1.2, 0.95];

  function bandbreedte(invoer, kostenGeschat) {
    const basis = Object.assign({}, STANDAARD, invoer);
    const kant = (k) => {
      const uit = Object.assign({}, basis);
      for (const veld of Object.keys(MARGES)) uit[veld] = basis[veld] * MARGES[veld][k];
      uit.eigenPct = Math.min(1, uit.eigenPct);
      if (kostenGeschat) uit.kosten = basis.kosten * KOSTEN_MARGE[k];
      return bereken(uit);
    };
    const ongunstig = kant(0), gunstig = kant(1);
    return {
      verwacht: bereken(basis), ongunstig, gunstig,
      laag: gunstig.terugverdientijd, hoog: ongunstig.terugverdientijd,
    };
  }

  return {
    DEGRADATIE_PER_JAAR, SALDERING_EINDJAAR, LOOPTIJD_JAAR, MAX_JAAR,
    TERUGLEVERING_2027, TERUGLEVERKOSTEN_2026, STANDAARD, MARGES, KOSTEN_MARGE,
    besparingMetSaldering, besparingZonderSaldering, bereken, bandbreedte,
  };
});
