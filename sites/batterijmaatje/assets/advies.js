/* ==========================================================================
   Keuzehulp: adviseert een accugrootte (kWh) en de best passende batterijen.

   Maatadvies (vuistregels, bewust als bandbreedte gepresenteerd):
   - Met zonnepanelen: je slaat het dagelijkse zomeroverschot op, maar meer
     opslaan dan je 's avonds en 's nachts verbruikt is zinloos.
       dagoverschot_zomer  = (opwek x (1 - direct eigen verbruik)) / 365 x 1,5
       avondnachtverbruik  = jaarverbruik / 365 x 0,6
       advies              = min(dagoverschot_zomer, avondnachtverbruik), bandbreedte +/- 25%
   - Zonder zonnepanelen, met dynamisch contract: je verschuift het deel van
     je dagverbruik dat flexibel is naar goedkope uren.
       advies = jaarverbruik / 365 x 0,6, bandbreedte +/- 25%
   - Zonder zonnepanelen en zonder dynamisch contract: een batterij kan dan
     vrijwel niets verdienen; dat zeggen we eerlijk.

   Matching: filtert data/batterijen.json op fase, installatievoorkeur,
   smart home-eisen, dynamisch contract en budget, en rangschikt op
   (1) hoe goed de capaciteit past, (2) prijs per kWh, (3) koppelgemak.
   ========================================================================== */

(function () {
  "use strict";

  const el = (id) => document.getElementById(id);
  const eurFmt = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const jaarFmt = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 });
  const kwhFmt = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 });

  let batterijen = [];
  let merkLogos = {};

  /* ------------------------------------------------------------------ */

  // Zelfde prijslogica als de vergelijker: budget en ranking gaan over de
  // vergelijkprijs incl. btw, anders wint een groothandelsprijs excl. btw
  // altijd van een eerlijke consumentenprijs.
  const bestePrijs = Prijs.beste;

  function vergelijkPrijs(b) {
    const prijs = Prijs.vergelijkPrijs(bestePrijs(b));
    return prijs === null ? Infinity : prijs;
  }

  function driewaardig(v) {
    if (v && typeof v === "object") return v.status || "deels";
    if (v === true) return "ja";
    if (typeof v === "string" && v.trim()) return "deels";
    return "nee";
  }

  function vierwaardig(v) {
    if (v === undefined || v === null) return "onbekend";
    return driewaardig(v);
  }

  // Koppel-score: zelfde formule als de vergelijker (assets/app.js) en uitleg.html#koppel-score
  function koppelScore(b) {
    const punt = (v) => { const s = driewaardig(v); return s === "ja" ? 2 : s === "deels" ? 1 : 0; };
    return punt(b.homey) + punt(b.home_assistant) + punt(b.dynamisch_contract);
  }

  function koppelScoreBadge(b) {
    const score = koppelScore(b);
    const klasse = score >= 5 ? "koppel-hoog" : score >= 3 ? "koppel-midden" : "koppel-laag";
    return `<span class="badge koppel-score ${klasse}" title="Punten voor Homey, Home Assistant en dynamisch contract (2 per volledige, 1 per gedeeltelijke ondersteuning)">${Iconen.svg("koppeling")} Koppel-score ${score}/6</span>`;
  }

  function getal(id, fallback) {
    const v = parseFloat(String(el(id).value).replace(",", "."));
    return Number.isFinite(v) ? v : fallback;
  }

  /* De keuzehulp vraagt negen dingen uit en gaf er tot nu toe één door: de
     batterij-id. Wie hier zorgvuldig invulde dat hij een dynamisch contract en
     6.000 kWh verbruik heeft, landde in een rekenmodule die uitging van een
     vast contract en 2.900 kWh, en mocht alles opnieuw typen. De sleutels
     hieronder zijn dezelfde als die de rekenmodule in zijn adresbalk zet. */
  function rekenmoduleLink(b) {
    const params = new URLSearchParams({ batterij: b.id });
    const verbruik = el("advVerbruik").value;
    const pv = el("advPv").value;
    const contract = el("advContract").value;
    if (verbruik) params.set("verbruik", verbruik);
    if (pv) params.set("pv", pv);
    if (contract) params.set("contract", contract);
    if (pv === "ja") {
      const panelen = el("advPanelen").value;
      const opwek = el("advOpwek").value;
      if (panelen) params.set("panelen", panelen);
      if (opwek) params.set("opwek", opwek);
    }
    return `rekenmodule.html?${params.toString()}`;
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  /* ------------------------------------------------------------------
     Hoe streng de keuzehulp selecteert
     ------------------------------------------------------------------

     De bandbreedte rond het maatadvies stond op 0,6 tot 1,8 keer de al ruime
     marge, en dat komt neer op 0,45 tot 2,25 keer het advies zelf: een factor
     vijf tussen de kleinste en de grootste batterij die nog "past". Daardoor
     selecteerde de band nauwelijks nog, en won steeds dezelfde batterij die er
     toevallig middenin viel. Uit 12.960 doorgerekende antwoordcombinaties
     kwamen maar 42 verschillende top-3en.

     Strakker geeft een eerlijker advies maar vaker een lege lijst. Deze twee
     getallen zijn de knop waaraan je draait; scripts/keuzehulp-spreiding.mjs
     rekent elke stand door.
     ------------------------------------------------------------------ */

  const BAND_ONDER = 0.8;   // maal de ondergrens van het maatadvies
  const BAND_BOVEN = 1.4;   // maal de bovengrens

  /* ------------------------------------------------------------------
     Maatadvies
     ------------------------------------------------------------------ */

  // Geschatte avondpiek in kW: basislast van 0,4 kW voor sluimerverbruik
  // (koelkast, vriezer, modem/internetkastjes, verlichting, tv)
  // plus de apparaten die de bezoeker aanvinkt als "vaak tegelijk aan".
  // Indicatieve vermogens; bedoeld als vuistregel, geen installatieadvies.
  function avondPiekKw() {
    let kw = 0.4;
    document.querySelectorAll(".avond-apparaat:checked").forEach((n) => { kw += parseFloat(n.dataset.kw) || 0; });
    return Math.round(kw * 10) / 10;
  }

  function berekenMaat() {
    const jaarverbruik = getal("advVerbruik", 2900);
    const heeftPv = el("advPv").value === "ja";
    const opwek = heeftPv ? getal("advOpwek", 3500) : 0;
    const dynamisch = el("advContract").value === "dynamisch";

    const avondNacht = (jaarverbruik / 365) * 0.6;
    const piekKw = avondPiekKw();

    if (heeftPv) {
      const dagOverschotZomer = ((opwek * 0.7) / 365) * 1.5;
      const kern = Math.min(dagOverschotZomer, Math.max(avondNacht, 1));
      return { laag: kern * 0.75, hoog: kern * 1.25, kern, basis: "pv", dynamisch, avondNacht, dagOverschotZomer, piekKw };
    }
    if (dynamisch) {
      return { laag: avondNacht * 0.75, hoog: avondNacht * 1.25, kern: avondNacht, basis: "dynamisch", dynamisch, avondNacht, piekKw };
    }
    return { laag: 0, hoog: 0, kern: 0, basis: "geen", dynamisch, avondNacht, piekKw };
  }

  /* ------------------------------------------------------------------
     Batterijen matchen
     ------------------------------------------------------------------ */

  function match(maat) {
    const fase = el("advFase").value;           // "1" | "3" | "weet-niet"
    const installatie = el("advInstallatie").value; // "zelf" | "installateur" | "beide"
    const homey = el("advHomey").checked;
    const ha = el("advHA").checked;
    const noodstroom = el("advNoodstroom").checked;
    const budget = getal("advBudget", 0);

    /* Waarom viel er iets af?

       Deze lijst bestond al, werd netjes teruggegeven en werd nergens gelezen.
       Daardoor liep een bezoeker die alles wegfilterde tegen een doodlopend
       eind: wel een maatadvies, geen enkele batterij, en de mededeling "van de
       0 batterijen die bij jouw antwoorden passen". Dat overkomt altijd
       dezelfde combinatie - een eenpersoonshuishouden dat een installateur wil
       en 2.500 euro te besteden heeft - en dat kan ook niet, want van de 18
       systemen die een installateur plaatst kost de goedkoopste 3.500 euro.
       Nu telt hij per antwoord hoeveel er op afvallen, zodat de uitkomst kan
       zeggen welk antwoord je moet loslaten in plaats van niets. */
    const afval = {};
    const valAf = (sleutel) => { afval[sleutel] = (afval[sleutel] || 0) + 1; return false; };

    const kandidaten = batterijen.filter((b) => {
      const prijs = bestePrijs(b);
      if (!b.capaciteit_kwh) return false;

      // Fase: bij een 1-fase aansluiting vallen 3-fase-only systemen af
      if (fase === "1" && b.fase === "3-fase") return valAf("fase");

      // Installatievoorkeur
      if (installatie === "zelf" && b.installatie !== "zelf") return valAf("installatie");
      if (installatie === "installateur" && b.installatie !== "installateur") return valAf("installatie");

      // Smart home-eisen
      if (homey && driewaardig(b.homey) === "nee") return valAf("homey");
      if (ha && driewaardig(b.home_assistant) === "nee") return valAf("ha");

      // Noodstroom: alleen batterijen waarvan bevestigd is dat het kan
      if (noodstroom && !["ja", "deels"].includes(vierwaardig(b.noodstroom))) return valAf("noodstroom");

      // Dynamisch contract als dat het (enige) verdienmodel is
      if (maat.basis === "dynamisch" && driewaardig(b.dynamisch_contract) === "nee") return valAf("dynamisch");

      // Budget op wat de bezoeker werkelijk kwijt is, niet op de kale
      // apparaatprijs. Dat scheelt: de SolaX T-BAT kost 1.625 euro als toestel
      // en 5.700 gebruiksklaar. Op apparaatprijs filteren beloofde dus een
      // batterij die vier keer zo duur uitpakt.
      //
      // Kennen we de complete prijs niet, dan laten we hem door in plaats van
      // hem weg te gooien: negen van de eenenveertig hebben dat bedrag nog
      // niet, en die stilzwijgend laten afvallen is erger dan ze tonen met de
      // melding dat het bedrag onbekend is (dat doet waaromTekst).
      //
      // En op de bovenkant van de range, niet de onderkant. Een systeem dat
      // "3.400 tot 4.200 euro" kost, hoort niet te verschijnen bij een budget
      // van 3.500: je weet dan al dat het waarschijnlijk niet uitkomt. Alleen
      // de onderkant toetsen is dezelfde soort optimistische afronding als
      // rekenen met een prijs excl. btw.
      if (budget > 0) {
        const onder = typeof b.totaalprijs_van_eur === "number" ? b.totaalprijs_van_eur : null;
        const boven = typeof b.totaalprijs_tot_eur === "number" ? b.totaalprijs_tot_eur : onder;
        if (boven !== null && boven > budget) return valAf("budget");
      }

      // Capaciteit: past binnen ruime marge rond het advies,
      // of is modulair uitbreidbaar tot binnen de bandbreedte
      const past = b.capaciteit_kwh >= maat.laag * BAND_ONDER && b.capaciteit_kwh <= maat.hoog * BAND_BOVEN;
      const uitbreidbaar = b.uitbreidbaar_tot_kwh && b.capaciteit_kwh <= maat.hoog && b.uitbreidbaar_tot_kwh >= maat.laag;
      if (!past && !uitbreidbaar) return valAf("maat");

      return true;
    });

    // Drie antwoorden op drie vragen, in plaats van een ranglijst waarvan we de
    // kop tonen.
    //
    // Waarom dit anders is: een ranglijst met een gewogen score levert altijd
    // drie buren op. Nummer 2 en 3 scoren dan een paar honderdsten lager dan
    // nummer 1 en lijken "net iets minder", terwijl ze in de praktijk vrijwel
    // hetzelfde zijn. Doormeten liet zien hoe erg dat was: over 12.960
    // antwoordcombinaties kwamen er maar 42 verschillende top-3en uit, en stond
    // een enkele batterij in bijna een derde van alle gevallen bovenaan.
    //
    // Aan de weging draaien hielp niet, en aan de bandbreedte ook nauwelijks.
    // De oorzaak zit eronder: het maatadvies komt voor huishoudens van 1 tot 5
    // personen altijd tussen 3 en 7,2 kWh uit, en in dat bereik liggen maar elf
    // plug-ins en vier installatiesystemen. Uit vier kandidaten kun je geen
    // gevarieerde top drie samenstellen.
    //
    // Dus tonen we niet de beste drie, maar de beste op drie verschillende
    // vragen. Die drie zijn gegarandeerd verschillend en zeggen elk iets.
    const gemeten = kandidaten.map((b) => {
      const prijs = bestePrijs(b);
      const kaal = prijs ? Prijs.vergelijkPrijs(prijs) : null;
      // Per kWh op wat je werkelijk kwijt bent. Kennen we dat niet, dan rekenen
      // we met de apparaatprijs en zegt de kaart erbij dat installatie er nog
      // bij komt - anders lijkt een installatiesysteem spotgoedkoop.
      const compleet = typeof b.totaalprijs_van_eur === "number" ? b.totaalprijs_van_eur : null;
      const perKwh = kaal ? kaal / b.capaciteit_kwh : 9999;
      const perKwhCompleet = (compleet ?? kaal) ? (compleet ?? kaal) / b.capaciteit_kwh : 9999;
      const afwijking = Math.abs(b.capaciteit_kwh - maat.kern) / Math.max(maat.kern, 1);
      return { b, prijs, perKwh, perKwhCompleet, afwijking, compleetBekend: compleet !== null };
    });

    const assen = [
      { sleutel: "pasvorm", label: "Beste pasvorm",
        uitleg: "capaciteit ligt het dichtst bij je geadviseerde maat",
        orde: (x, z) => x.afwijking - z.afwijking },
      // Deze as vergelijkt alleen batterijen waarvan we de complete prijs
      // kennen. Zou hij ook de andere meenemen, dan wint stelselmatig een
      // systeem waarvan we de installatiekosten nog niet weten: dat rekent dan
      // met de kale apparaatprijs en lijkt daardoor twee tot vier keer zo
      // goedkoop. Dat is dezelfde fout als een prijs excl. btw naast een prijs
      // incl. btw zetten, en die maken we hier niet.
      //
      // Kennen we van geen enkele kandidaat de complete prijs, dan vergelijken
      // we op apparaatprijs en zegt het label dat erbij.
      { sleutel: "prijs", label: "Voordeligst per kWh",
        alleenCompleet: true,
        uitleg: "laagste prijs per kWh opslag, gerekend over de complete prijs inclusief installatie",
        uitlegKaal: "laagste prijs per kWh opslag over de apparaatprijs; van deze systemen ken ik de complete prijs niet",
        orde: (x, z) => x.perKwhCompleet - z.perKwhCompleet },
      { sleutel: "sturing", label: "Beste aansturing",
        uitleg: "meeste punten voor Homey, Home Assistant en dynamisch contract",
        orde: (x, z) => (koppelScore(z.b) - koppelScore(x.b)) || (x.perKwhCompleet - z.perKwhCompleet) },
    ];

    // Elke as krijgt zijn eigen winnaar. Is die al gekozen door een eerdere as,
    // dan schuift deze door naar de volgende - anders staat dezelfde batterij
    // er drie keer, en dat is precies het probleem dat we oplossen.
    const gekozen = [];
    for (const as of assen) {
      const metCompleet = gemeten.filter((k) => k.compleetBekend);
      const opCompleet = as.alleenCompleet && metCompleet.length > 0;
      const veld = opCompleet ? metCompleet : gemeten;
      const gesorteerd = [...veld].sort(as.orde);
      const vrij = gesorteerd.find((k) => !gekozen.some((g) => g.b.id === k.b.id));
      if (vrij) {
        gekozen.push({
          ...vrij,
          as: as.label,
          asUitleg: as.alleenCompleet && !opCompleet ? as.uitlegKaal : as.uitleg,
          asSleutel: as.sleutel,
        });
      }
    }

    return { top: gekozen, totaal: kandidaten.length, afval };
  }

  /* ------------------------------------------------------------------
     Rendering
     ------------------------------------------------------------------ */

  /* Wat levert deze batterij op?

     De keuzehulp adviseerde een maat en drie modellen, maar noemde nergens een
     bedrag of een termijn - terwijl dat de vraag is waarmee mensen hier zitten.
     De som komt uit assets/rekenkern.js, dezelfde kern als de rekenmodule
     gebruikt, zodat de twee pagina's niet elk hun eigen antwoord geven. De
     keuzehulp vraagt alles al uit wat die kern nodig heeft.

     Bewust een bereik en geen enkel getal, om dezelfde reden als daar: de
     uitkomst hangt af van aannames die niemand vooraf kent. */
  function terugverdienRegel(b) {
    if (typeof Rekenkern === "undefined") return "";
    const investering = typeof b.totaalprijs_van_eur === "number"
      ? b.totaalprijs_van_eur
      : (bestePrijs(b) ? Prijs.vergelijkPrijs(bestePrijs(b)) : 0);
    if (!investering || !b.capaciteit_kwh) return "";

    const heeftPv = el("advPv").value === "ja";
    const invoer = {
      heeftPv,
      contract: el("advContract").value === "dynamisch" ? "dynamisch" : "vast",
      opwek: heeftPv ? getal("advOpwek", 3500) : 0,
      jaarVerbruik: getal("advVerbruik", 2900),
      capaciteit: b.capaciteit_kwh,
      bruikbaarPct: Prijs.capaciteitBevestigd(b) ? 100 : 90,
      vermogenKw: b.vermogen_kw || null,
      investering,
    };
    const band = Rekenkern.bandbreedte(invoer);
    const r = band.verwacht;
    if (r.totaal <= 0 || r.terugverdientijd == null) {
      return '<div class="koppelgemak"><span class="uitleg"><b>Terugverdientijd:</b> met deze antwoorden levert hij per saldo niets op. <a href="rekenmodule.html?batterij=' + encodeURIComponent(b.id) + '">Reken het zelf na</a>.</span></div>';
    }
    const bereik = band.hoog != null
      ? `${jaarFmt.format(band.laag)} tot ${jaarFmt.format(band.hoog)} jaar`
      : `vanaf ${jaarFmt.format(band.laag)} jaar`;
    return `<div class="koppelgemak"><span class="uitleg"><b>Terugverdientijd:</b> ${bereik}, bij ongeveer ${eurFmt.format(r.totaal)} per jaar. Indicatie op basis van je antwoorden; <a href="${escapeHtml(rekenmoduleLink(b))}">pas de aannames aan</a>.</span></div>`;
  }

  function waaromTekst(b, maat) {
    const redenen = [];
    if (Math.abs(b.capaciteit_kwh - maat.kern) / Math.max(maat.kern, 1) <= 0.3) {
      redenen.push("de capaciteit sluit goed aan op je geadviseerde maat");
    } else if (b.uitbreidbaar_tot_kwh && b.capaciteit_kwh < maat.laag) {
      redenen.push("modulair uitbreidbaar tot je geadviseerde maat");
    } else if (b.capaciteit_kwh > maat.hoog) {
      redenen.push("let op: ruimer dan je geadviseerde maat; alleen zinvol als je verbruik echt gaat groeien (warmtepomp, elektrische auto), anders betaal je voor capaciteit die je niet opmaakt");
    } else {
      redenen.push("de capaciteit valt binnen je bandbreedte");
    }
    if (maat.piekKw > 0.4 && b.vermogen_kw) {
      // Alleen beloven dat het vermogen iets dekt als vaststaat dat het de
      // continue waarde is. Marstek geeft 800 W on-grid en 2500 W off-grid op,
      // en met dat tweede getal zou de keuzehulp beweren dat hij een avondpiek
      // van 2,2 kW aankan terwijl hij er in huis 0,8 levert.
      if (b.vermogen_kw >= maat.piekKw && !Prijs.vermogenDektIets(b)) {
        redenen.push(`het opgegeven vermogen (${String(b.vermogen_kw).replace(".", ",")} kW) ligt boven jouw avondgebruik (ca. ${String(maat.piekKw).replace(".", ",")} kW), maar van deze batterij is niet vastgesteld of dat het vermogen is dat hij aanhoudend levert`);
      } else if (b.vermogen_kw >= maat.piekKw) {
        redenen.push(`het vermogen (${String(b.vermogen_kw).replace(".", ",")} kW) dekt jouw avondgebruik (ca. ${String(maat.piekKw).replace(".", ",")} kW)`);
      } else {
        redenen.push(`let op: het vermogen (${String(b.vermogen_kw).replace(".", ",")} kW) ligt onder jouw geschatte avondpiek (ca. ${String(maat.piekKw).replace(".", ",")} kW); het net vult automatisch aan, maar dat deel bespaart dan niet`);
      }
    }
    if (b.installatie === "zelf") redenen.push("zelf aan te sluiten zonder installateur");
    if ((b.koppeling_gemak || 0) >= 4) redenen.push("koppelt makkelijk aan bestaande zonnepanelen");
    if (driewaardig(b.dynamisch_contract) !== "nee" && maat.dynamisch) redenen.push("geschikt voor je dynamische contract");
    return redenen.slice(0, 4).join(", ");
  }

  /* Geen enkele batterij over: zeg welk antwoord dat deed

     Zonder dit stond er "van de 0 batterijen die bij jouw antwoorden passen",
     en verder niets. De bezoeker weet dan wel dat het niet lukt, maar niet wat
     hij eraan kan doen - terwijl het meestal aan één antwoord ligt dat hij
     zonder bezwaar wat ruimer kan zetten. */
  const AFVAL_UITLEG = {
    budget: ["je budget", "verhoog het bedrag of laat het leeg"],
    installatie: ["je keuze voor wie het plaatst", 'kies "maakt niet uit"'],
    maat: ["de geadviseerde accugrootte", "daar is op dit moment geen model voor in de vergelijking"],
    noodstroom: ["de eis van noodstroom", "vink die uit als het geen harde eis is"],
    fase: ["je 1-fase aansluiting", "controleer of dat klopt"],
    homey: ["de eis van Homey-ondersteuning", "vink die uit als het geen harde eis is"],
    ha: ["de eis van Home Assistant", "vink die uit als het geen harde eis is"],
    dynamisch: ["de eis dat hij met een dynamisch contract overweg kan", "die hoort bij je contractkeuze"],
  };

  function geenTreffers(afval) {
    // De grootste veroorzaker eerst: dat is het antwoord waaraan draaien het
    // meeste oplevert.
    const gesorteerd = Object.entries(afval || {})
      .filter(([sleutel]) => AFVAL_UITLEG[sleutel])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2);
    const zinnen = gesorteerd.map(([sleutel, aantal]) => {
      const [wat, wat_dan] = AFVAL_UITLEG[sleutel];
      return `<li><b>${escapeHtml(wat)}</b> liet ${aantal} ${aantal === 1 ? "model" : "modellen"} afvallen — ${escapeHtml(wat_dan)}</li>`;
    });
    return `
      <h2 class="advies-kop">Geen batterij die aan al je antwoorden voldoet</h2>
      <div class="waarschuwing-kader">
        <p>Het maatadvies hierboven klopt, maar er staat op dit moment geen model in de vergelijking dat aan álle voorwaarden voldoet. Meestal ligt dat aan één antwoord:</p>
        <ul>${zinnen.join("") || "<li>de combinatie van je antwoorden is te smal</li>"}</ul>
        <p>Pas er één aan en het advies verschijnt direct. Of <a href="index.html">bekijk alle batterijen in de vergelijker</a> en filter daar zelf.</p>
      </div>`;
  }

  function render() {
    const doel = el("adviesResultaat");

    const maat = berekenMaat();
    const heeftPv = el("advPv").value === "ja";

    if (maat.basis === "geen") {
      doel.innerHTML = `
        <div class="waarschuwing-kader"><b>Eerlijk advies: wacht nog even met een batterij.</b>
        Zonder zonnepanelen en zonder dynamisch energiecontract valt er niets op te slaan en geen prijsverschil te benutten; een thuisbatterij verdient zich dan vrijwel zeker niet terug.
        Overweeg eerst een dynamisch contract of zonnepanelen, en kom daarna terug. Lees ook <a href="regelgeving.html">wat de regels betekenen</a>.</div>`;
      return;
    }

    const { top, totaal, afval } = match(maat);

    const maatUitleg = maat.basis === "pv"
      ? `Gebaseerd op je zomerse zonnestroom-overschot (ca. ${kwhFmt.format(maat.dagOverschotZomer)} kWh per dag) en je avond- en nachtverbruik (ca. ${kwhFmt.format(maat.avondNacht)} kWh per dag): meer opslaan dan je 's avonds gebruikt heeft geen zin.`
      : `Gebaseerd op het deel van je dagverbruik dat je naar goedkope uren kunt verschuiven (ca. ${kwhFmt.format(maat.avondNacht)} kWh per dag).`;

    let kaarten = "";
    if (!top.length) {
      kaarten = '<div class="leeg-melding">Geen batterijen gevonden die aan al je eisen voldoen. Verruim je budget of laat een smart home-eis los; of bekijk <a href="index.html">de volledige vergelijker</a>.</div>';
    } else {
      kaarten = `<div class="kaarten-grid advies-grid">` + top.map(({ b, prijs, perKwh, perKwhCompleet, as, asUitleg, compleetBekend }, i) => `
        <article class="batterij-kaart">
          <div class="kaart-kop">
            <div>
              <div class="merk">${as ? `<span class="advies-as" title="${escapeHtml(asUitleg)}">${escapeHtml(as)}</span> · ` : ""}${merkLogos[b.merk] ? `<img class="merk-logo" src="${escapeHtml(merkLogos[b.merk])}" alt="" loading="lazy"> ` : ""}${escapeHtml(b.merk)}</div>
              <h3><a class="kop-link" href="batterij/${encodeURIComponent(b.id)}.html" title="Alle details van de ${escapeHtml(b.merk)} ${escapeHtml(b.model)}">${escapeHtml(b.model)}</a></h3>
              <span class="type-badge type-${escapeHtml(b.type)}">${escapeHtml({ "plug-in": "Plug-in (stopcontact)", "ac-gekoppeld": "AC-gekoppeld", "hybride": "Hybride omvormer" }[b.type] || b.type)}</span>
              <div class="advies-score">${koppelScoreBadge(b)}</div>
            </div>
          </div>
          <div class="kaart-specs">
            <div class="spec"><span class="spec-label">Capaciteit</span><span class="spec-waarde">${String(b.capaciteit_kwh).replace(".", ",")} kWh${Prijs.capaciteitLabelHtml(b)}${b.uitbreidbaar_tot_kwh ? ` <small>(tot ${String(b.uitbreidbaar_tot_kwh).replace(".", ",")})</small>` : ""}</span></div>
            <div class="spec"><span class="spec-label">Prijs incl. btw</span><span class="spec-waarde" title="${escapeHtml(Prijs.prijsToelichting(prijs))}">${prijs ? eurFmt.format(Prijs.vergelijkPrijs(prijs)) : "op aanvraag"}</span></div>
            <div class="spec"><span class="spec-label">Per kWh${compleetBekend ? " compleet" : ""}</span><span class="spec-waarde" title="${escapeHtml((compleetBekend ? "Gerekend over de complete prijs inclusief installatie" : "Gerekend over de apparaatprijs; de complete prijs ken ik voor dit systeem niet") + (Prijs.capaciteitToelichting(b) ? " - " + Prijs.capaciteitToelichting(b) : ""))}">${prijs ? eurFmt.format(Math.round(perKwhCompleet)) : "n.b."}</span></div>
            <div class="spec"><span class="spec-label">Installatie</span><span class="spec-waarde">${b.installatie === "zelf" ? "Zelf" : "Installateur"}</span></div>
          </div>
          <div class="koppelgemak"><span class="uitleg"><b>Waarom deze past:</b> ${escapeHtml(waaromTekst(b, maat))}.</span></div>
          ${terugverdienRegel(b)}
          <div class="koppelgemak"><span class="uitleg">Compleet gebruiksklaar (indicatie): <b>${b.totaalprijs_van_eur ? eurFmt.format(b.totaalprijs_van_eur) + (b.totaalprijs_tot_eur ? " tot " + eurFmt.format(b.totaalprijs_tot_eur) : "") : "niet vastgesteld"}</b>${b.totaalprijs_van_eur ? "" : (b.totaalprijs_geschat_van_eur
            ? `<br><small>Schatting: ${eurFmt.format(b.totaalprijs_geschat_van_eur)} tot ${eurFmt.format(b.totaalprijs_geschat_tot_eur)} - het toestel plus ${eurFmt.format(500)} tot ${eurFmt.format(2000)} installatie. Van dit systeem heb ik geen complete prijs uit een bron, dus telt hij niet mee in de vergelijking op prijs per kWh.</small>`
            : `<br><small>Ik heb voor dit systeem geen prijs inclusief installatie gevonden.</small>`)}</span></div>
          ${b.prijs_omvat ? `<div class="koppelgemak"><span class="uitleg">Winkelprijs dekt: ${escapeHtml(b.prijs_omvat)}</span></div>` : ""}
          <div class="kaart-acties advies-acties">
            ${prijs && prijs.url ? `<a class="knop" href="${escapeHtml(prijs.affiliate_url || prijs.url)}" target="_blank" rel="noopener${prijs.affiliate_url ? " sponsored" : ""}" aria-label="Bekijk de aanbieding van de ${escapeHtml(b.merk)} ${escapeHtml(b.model)}">Bekijk aanbieding ${Iconen.svg("pijl-rechts")}</a>` : ""}
            <a class="knop knop-secundair" href="${escapeHtml(rekenmoduleLink(b))}" aria-label="Bereken de terugverdientijd van de ${escapeHtml(b.merk)} ${escapeHtml(b.model)}">Terugverdientijd</a>
          </div>
        </article>`).join("") + "</div>";
    }

    doel.innerHTML = `
      <div class="info-kader advies-uitkomst">
        <span class="uitkomst-label">Geadviseerde accugrootte</span>
        <div class="uitkomst-getal">${kwhFmt.format(maat.laag)} tot ${kwhFmt.format(maat.hoog)} kWh</div>
        <div class="uitkomst-uitleg">${maatUitleg}</div>
      </div>
      ${maat.piekKw > 0.4 ? `<div class="info-kader advies-uitkomst tweede">
        <span class="uitkomst-label">Handig ontlaadvermogen voor jouw avondgebruik</span>
        <div class="uitkomst-getal kleiner">ca. ${String(maat.piekKw).replace(".", ",")} kW of meer</div>
        <div class="uitkomst-uitleg">Schatting op basis van de apparaten die je aanvinkte, plus ca. 0,4 kW basislast voor sluimerverbruik (koelkast, vriezer, modem, verlichting, tv). Levert een batterij minder, dan is dat geen probleem: het stroomnet vult automatisch aan, maar over dat deel bespaar je op dat moment niet. Wil je <b>noodstroom</b>, dan is voldoende vermogen wél belangrijk: bij een storing is er geen net om bij te springen.</div>
      </div>` : ""}
      ${heeftPv ? `<div class="waarschuwing-kader">${new Date() < new Date("2027-01-01")
        ? "Let op: tot en met 31 december 2026 geldt de salderingsregeling nog, waardoor opslaan van eigen zonnestroom financieel weinig oplevert. Dit advies kijkt naar de situatie daarna."
        : "De salderingsregeling is per 1 januari 2027 vervallen: eigen zonnestroom opslaan levert nu wél op, want teruggeleverde stroom brengt nog maar een paar cent per kWh op."}</div>` : ""}
      ${totaal === 0 ? geenTreffers(afval) : `
      <h2 class="advies-kop">Drie kanten van de keuze</h2>
      <p class="advies-kop-uitleg">Van de ${totaal} batterijen die bij jouw antwoorden passen, toon ik niet de beste drie maar de beste op drie verschillende vragen. Dat scheelt: een ranglijst levert vrijwel altijd drie vergelijkbare buren op, terwijl deze drie elk iets anders goed doen.</p>`}
      ${kaarten}
      <p class="advies-naar-vergelijker"><a href="index.html">Bekijk alle batterijen in de vergelijker</a></p>
    `;
  }

  /* ------------------------------------------------------------------
     Events en init
     ------------------------------------------------------------------ */

  function koppelPresets() {
    el("advPersonen").addEventListener("change", (e) => {
      const presets = { "1": 1800, "2": 2700, "3": 3300, "4": 3900, "5": 4400 };
      if (presets[e.target.value]) { el("advVerbruik").value = presets[e.target.value]; }
      render();
    });
    el("advPanelen").addEventListener("input", (e) => {
      const n = parseInt(e.target.value, 10);
      if (Number.isFinite(n) && n > 0) { el("advOpwek").value = n * 350; }
      render();
    });
    el("advPv").addEventListener("change", () => {
      el("pvVragen").style.display = el("advPv").value === "ja" ? "" : "none";
      render();
    });
  }

  async function init() {
    try {
      const res = await fetch("data/batterijen.json", { cache: "no-cache" });
      const data = await res.json();
      batterijen = data.batterijen || [];
      merkLogos = data.merk_logos || {};
    } catch (err) {
      console.error("Batterijen konden niet geladen worden:", err);
    }
    koppelPresets();
    document.querySelectorAll("#adviesFormulier input, #adviesFormulier select").forEach((inp) => {
      inp.addEventListener("input", render);
      inp.addEventListener("change", render);
    });

    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
