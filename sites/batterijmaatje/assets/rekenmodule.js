/* ==========================================================================
   Rekenmodule terugverdientijd thuisbatterij
   Eenvoudig, transparant jaarmodel. Alle aannames zijn instelbaar en worden
   onder het resultaat getoond. Bewust conservatief; geen verkooppraatje.

   Model in het kort (per jaar, situatie vanaf 2027, dus zonder saldering):

   1. Zelfverbruik-opslag (alleen met zonnepanelen)
      overschot        = jaaropwek x (1 - direct eigen verbruik)
      opslag           = min(overschot, bruikbare capaciteit x zonnedagen) x mismatchfactor
      opbrengst        = opslag x (stroomprijs x rendement - terugleververgoeding + terugleverkosten per kWh)
      Toelichting: elke opgeslagen kWh vervangt inkoop (x rendement wegens
      omzetverlies), kost je de misgelopen terugleververgoeding en scheelt
      terugleverkosten.

   2. Handel op uurprijzen (alleen met dynamisch contract)
      dagen            = dagen zonder zonneoverschot (met PV) of vrijwel alle dagen (zonder PV)
      winst per cyclus = bruikbare capaciteit x (ontlaadwaarde x rendement - laadprijs)
      opbrengst        = dagen x cycli per dag x winst per cyclus
      Toelichting: 's nachts of op goedkope uren laden, op dure (avond)uren
      je eigen verbruik dekken of terugleveren.

   3. Terugverdientijd = investering / totale jaarlijkse opbrengst
   ========================================================================== */

(function () {
  "use strict";

  const el = (id) => document.getElementById(id);

  const eurFmt = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const eur2Fmt = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
  const numFmt = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });
  const jaarFmt = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 });
  const eenDec = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 });

  let batterijen = [];

  // De investering waarmee gerekend wordt is de vergelijkprijs incl. btw: een
  // particulier betaalt nu eenmaal btw, dus rekenen met een prijs excl. btw
  // levert een terugverdientijd op die 21% te gunstig is.
  function bestePrijs(b) {
    return Prijs.vergelijkPrijs(Prijs.beste(b));
  }

  function getal(id, fallback) {
    const v = parseFloat(String(el(id).value).replace(",", "."));
    // Negatieve invoer (bijv. verbruik -500) zou onzinnige uitkomsten geven
    return Number.isFinite(v) ? Math.max(0, v) : fallback;
  }

  /* ------------------------------------------------------------------
     Berekening
     ------------------------------------------------------------------ */

  function bereken() {
    const heeftPv = el("inpPv").value === "ja";
    const contract = el("inpContract").value; // "vast" | "dynamisch"

    const opwek = heeftPv ? getal("inpOpwek", 3500) : 0;
    const eigenVerbruikPct = getal("inpEigenVerbruik", 30) / 100;

    const stroomprijs = getal("inpStroomprijs", 0.30);
    const terugleverVergoeding = getal("inpTeruglever", 0.05);
    const terugleverKosten = getal("inpTerugleverkosten", 0.02);
    const laadprijs = getal("inpLaadprijs", 0.15);
    const ontlaadwaarde = getal("inpOntlaadwaarde", 0.32);

    const investering = getal("inpInvestering", 0);
    const capaciteit = getal("inpCapaciteit", 0);
    const bruikbaarPct = getal("inpBruikbaar", 90) / 100;
    const rendement = getal("inpRendement", 90) / 100;
    const zonDagen = getal("inpZonDagen", 220);
    const mismatch = getal("inpMismatch", 85) / 100;
    const cycliPerDag = getal("inpCycli", 1);
    const extraOnbalans = getal("inpOnbalans", 0);
    const standbyWatt = getal("inpStandby", 10);
    const jaarVerbruik = getal("inpVerbruik", 2900);

    const bruikbareCap = capaciteit * bruikbaarPct;
    // Wat kan het huishouden per dag zinvol uit de batterij opmaken?
    // Aanname: ~70% van het verbruik valt buiten de zonuren (avond, nacht,
    // vroege ochtend). Een batterij groter dan dat levert per extra kWh
    // vrijwel niets op: hij raakt zijn stroom niet kwijt.
    const maxZinvolPerDag = (jaarVerbruik / 365) * 0.7;
    const effectieveCap = Math.min(bruikbareCap, maxZinvolPerDag);
    const teGroot = bruikbareCap > 0 && jaarVerbruik > 0 && bruikbareCap > maxZinvolPerDag * 1.15;

    // 1. Zelfverbruik-opslag (alleen met PV)
    let overschot = 0, opslagJaar = 0, opbrengstZelf = 0;
    if (heeftPv && bruikbareCap > 0) {
      overschot = opwek * (1 - eigenVerbruikPct);
      opslagJaar = Math.min(overschot, effectieveCap * zonDagen) * mismatch;
      const waardePerKwh = stroomprijs * rendement - terugleverVergoeding + terugleverKosten;
      opbrengstZelf = Math.max(0, opslagJaar * waardePerKwh);
    }

    // 2. Handel op uurprijzen (alleen dynamisch contract)
    let arbDagen = 0, opbrengstArb = 0, winstPerCyclus = 0;
    if (contract === "dynamisch" && bruikbareCap > 0) {
      arbDagen = heeftPv ? Math.max(0, 365 - zonDagen) : 350;
      // Ook hier begrensd op wat het huishouden per dag kan opmaken: de
      // ontlaadwaarde is immers gebaseerd op vermeden inkoop, niet op verkoop.
      winstPerCyclus = effectieveCap * (ontlaadwaarde * rendement - laadprijs);
      opbrengstArb = Math.max(0, arbDagen * cycliPerDag * winstPerCyclus);
    }

    // 3. Eigen (standby-)verbruik van de batterij: loopt 24 uur per dag door,
    // dus tegen de gewone (gemiddelde) stroomprijs, niet de goedkope laadprijs
    const standbyKwh = standbyWatt * 8760 / 1000;
    const kostenStandby = standbyKwh * stroomprijs;

    const totaal = opbrengstZelf + opbrengstArb + extraOnbalans - kostenStandby;
    const terugverdientijd = totaal > 0 && investering > 0 ? investering / totaal : null;

    toonResultaat({
      heeftPv, contract, investering, bruikbareCap,
      overschot, opslagJaar, opbrengstZelf,
      arbDagen, cycliPerDag, winstPerCyclus, opbrengstArb,
      extraOnbalans, standbyWatt, standbyKwh, kostenStandby, totaal, terugverdientijd,
      jaarVerbruik, maxZinvolPerDag, effectieveCap, teGroot,
      stroomprijs, terugleverVergoeding, laadprijs, ontlaadwaarde, rendement,
    });
  }

  /* ------------------------------------------------------------------
     Terugverdiengrafiek (zelfstandige SVG, geen libraries)
     Kleuren gevalideerd op contrast en kleurenblind-veiligheid:
     teal #0d9488 (opbrengst), amber #d97706 (investering)
     ------------------------------------------------------------------ */

  function terugverdienGrafiek(investering, jaarOpbrengst, terugverdientijd) {
    const H = Math.min(30, Math.max(15, Math.ceil(terugverdientijd) + 3)); // horizon in jaren
    const W = 640, HGT = 300, mL = 78, mR = 24, mT = 18, mB = 40;
    const pw = W - mL - mR, ph = HGT - mT - mB;
    const yMax = Math.max(investering, jaarOpbrengst * H) * 1.06;
    const x = (jaar) => mL + (jaar / H) * pw;
    const y = (eur) => mT + ph - (eur / yMax) * ph;

    // Rasterlijnen en y-labels (terughoudend: 4 stappen)
    let raster = "";
    for (let i = 0; i <= 4; i++) {
      const val = (yMax / 4) * i;
      raster += `<line x1="${mL}" x2="${W - mR}" y1="${y(val)}" y2="${y(val)}" stroke="#e5e7eb" stroke-width="1"/>` +
        `<text x="${mL - 8}" y="${y(val) + 4}" text-anchor="end" font-size="11" fill="#6b7280">${Math.round(val / 100) / 10}k</text>`;
    }
    // X-labels per 5 jaar
    let xlabels = "";
    for (let j = 0; j <= H; j += 5) {
      xlabels += `<text x="${x(j)}" y="${HGT - 14}" text-anchor="middle" font-size="11" fill="#6b7280">${j}</text>`;
    }

    // Opbrengstlijn met hoverpunten per jaar
    let pad = `M ${x(0)} ${y(0)}`;
    let punten = "";
    for (let j = 1; j <= H; j++) {
      pad += ` L ${x(j)} ${y(jaarOpbrengst * j)}`;
      punten += `<circle cx="${x(j)}" cy="${y(jaarOpbrengst * j)}" r="9" fill="transparent"><title>Na ${j} jaar: ${eurFmt.format(jaarOpbrengst * j)} bespaard (saldo ${eurFmt.format(jaarOpbrengst * j - investering)})</title></circle>`;
    }

    // Terugverdienpunt
    const bx = x(terugverdientijd), by = y(investering);
    const labelLinks = terugverdientijd > H * 0.55;

    return `
    <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:0.85rem;color:var(--kleur-tekst-licht);margin:16px 0 4px;">
      <span><span style="display:inline-block;width:14px;height:3px;background:#0d9488;border-radius:2px;vertical-align:middle;"></span> Opgetelde besparing</span>
      <span><span style="display:inline-block;width:14px;height:0;border-top:3px dashed #d97706;vertical-align:middle;"></span> Investering</span>
    </div>
    <svg viewBox="0 0 ${W} ${HGT}" style="width:100%;height:auto;" role="img" aria-label="Grafiek: de opgetelde besparing groeit elk jaar en kruist na ${jaarFmt.format(terugverdientijd)} jaar de investering van ${eurFmt.format(investering)}. De cijfers staan ook in de tabel hieronder.">
      ${raster}${xlabels}
      <text x="${W - mR}" y="${HGT - 2}" text-anchor="end" font-size="11" fill="#6b7280">jaren</text>
      <line x1="${mL}" x2="${W - mR}" y1="${y(investering)}" y2="${y(investering)}" stroke="#d97706" stroke-width="2" stroke-dasharray="6 5"/>
      <path d="${pad}" fill="none" stroke="#0d9488" stroke-width="2"/>
      <circle cx="${bx}" cy="${by}" r="6" fill="#0d9488" stroke="#ffffff" stroke-width="2"/>
      <text x="${bx + (labelLinks ? -10 : 10)}" y="${by - 12}" text-anchor="${labelLinks ? "end" : "start"}" font-size="12" font-weight="700" fill="#1f2937">terugverdiend na ${jaarFmt.format(terugverdientijd)} jaar</text>
      ${punten}
    </svg>`;
  }

  /* ------------------------------------------------------------------
     Resultaat tonen
     ------------------------------------------------------------------ */

  function toonResultaat(r) {
    const doel = el("resultaat");

    if (!r.investering || !r.bruikbareCap) {
      // Benoem wat er precies ontbreekt, in plaats van altijd naar stap 1 te wijzen
      const melding = r.bruikbareCap && !r.investering
        ? 'Er is een batterij gekozen, maar de <b>investering (€)</b> ontbreekt nog. Open "Alle getallen bekijken of aanpassen" en vul daar een bedrag in (bijvoorbeeld je offerteprijs).'
        : 'Kies bij stap 1 een batterij uit de lijst; het resultaat verschijnt hier direct. Wil je liever met eigen bedragen rekenen? Open dan "Alle getallen bekijken of aanpassen" en vul de investering en capaciteit zelf in.';
      doel.innerHTML = `<p class="datum-stempel">${melding}</p>`;
      return;
    }

    const bedragCel = (v) => `<td style="text-align:right;font-weight:700;">${eurFmt.format(v)}</td>`;
    const regels = [];
    if (r.heeftPv) {
      regels.push(`<tr><td>Opslag van eigen zonnestroom (ca. ${numFmt.format(r.opslagJaar)} kWh per jaar)</td>${bedragCel(r.opbrengstZelf)}</tr>`);
    }
    if (r.contract === "dynamisch") {
      regels.push(`<tr><td>Slim laden en ontladen op uurprijzen (${numFmt.format(r.arbDagen)} dagen, ${eur2Fmt.format(r.winstPerCyclus)} per cyclus)</td>${bedragCel(r.opbrengstArb)}</tr>`);
    }
    if (r.extraOnbalans > 0) {
      regels.push(`<tr><td>Opgegeven extra opbrengst (bijv. onbalansmarkt via aggregator)</td>${bedragCel(r.extraOnbalans)}</tr>`);
    }
    if (r.kostenStandby > 0) {
      regels.push(`<tr><td>Eigen stroomverbruik van de batterij (standby, ${numFmt.format(r.standbyWatt)} W ≈ ${numFmt.format(r.standbyKwh)} kWh per jaar)</td><td style="text-align:right;font-weight:700;color:var(--kleur-rood);">− ${eurFmt.format(r.kostenStandby)}</td></tr>`);
    }

    let oordeel = "";
    // Twee soorten meldingen: opvallende waarschuwingen die over déze invoer
    // gaan (max 1 a 2 gele kaders), en vaste kanttekeningen die bij elke
    // berekening gelden en compact in één inklapbaar blok staan.
    const waarschuwingen = [];
    const kanttekeningen = [];

    if (r.terugverdientijd == null) {
      oordeel = "<b>Met deze invoer levert de batterij per saldo niets op.</b> Controleer of het contracttype en de prijzen kloppen.";
    } else {
      const t = r.terugverdientijd;
      const kleur = t <= 8 ? "var(--kleur-groen)" : t <= 15 ? "var(--kleur-accent)" : "var(--kleur-rood)";
      oordeel = `<div style="font-size:2rem;font-weight:800;color:${kleur};">${jaarFmt.format(t)} jaar</div>
        <div class="datum-stempel">terugverdientijd bij een jaarlijkse opbrengst van ${eurFmt.format(r.totaal)}</div>`;
      if (t > 15) waarschuwingen.push('De berekende terugverdientijd is langer dan de levensduur die vaak wordt aangehouden (10 tot 15 jaar). Met deze invoer verdient de batterij zichzelf waarschijnlijk niet terug. Lees ook: <a href="uitleg.html#waarom-toch">is een thuisbatterij het waard bij een lange terugverdientijd?</a>');
      else if (t > 10) waarschuwingen.push('De terugverdientijd nadert de verwachte levensduur van de batterij (10 tot 15 jaar). Reken jezelf niet rijk en vergelijk meerdere scenario\'s. Lees ook: <a href="uitleg.html#waarom-toch">is een thuisbatterij het waard bij een lange terugverdientijd?</a>');
    }

    if (r.teGroot) {
      waarschuwingen.push(`<b>Deze batterij is waarschijnlijk te groot voor je verbruik.</b> Met ${numFmt.format(r.jaarVerbruik)} kWh per jaar maakt je huishouden buiten de zonuren maar zo'n ${eenDec.format(r.maxZinvolPerDag)} kWh per dag op, terwijl de batterij ${eenDec.format(r.bruikbareCap)} kWh bruikbaar heeft. De berekening telt daarom alleen de zinvol te gebruiken ${eenDec.format(r.effectieveCap)} kWh mee; een kleinere (goedkopere) batterij geeft vaak een kortere terugverdientijd.`);
    }
    if (r.contract === "vast" && !r.heeftPv) {
      waarschuwingen.push("Zonder zonnepanelen en zonder dynamisch contract kan een thuisbatterij vrijwel niets verdienen: er valt niets op te slaan en geen prijsverschil te benutten.");
    }
    if (r.contract === "dynamisch" && r.opbrengstArb > 0) {
      kanttekeningen.push("De opbrengst uit handel op uurprijzen is een schatting op basis van een vast gemiddeld prijsverschil; werkelijke spreads wisselen per dag en seizoen, en over stroom uit het net betaal je energiebelasting.");
    }
    if (r.extraOnbalans > 0) {
      kanttekeningen.push("Opbrengsten uit de onbalansmarkt zijn de afgelopen jaren gedaald en bieden geen garantie; TenneT waarschuwt daar expliciet voor.");
    }
    kanttekeningen.push("Tot en met 31 december 2026 geldt de salderingsregeling nog; deze berekening gaat uit van de situatie vanaf 2027.");
    kanttekeningen.push("Het model rekent niet met batterijdegradatie, rente of stijgende/dalende energieprijzen; zie de toelichting onderaan voor alle aannames.");

    const grafiek = r.terugverdientijd != null && r.terugverdientijd <= 27
      ? terugverdienGrafiek(r.investering, r.totaal, r.terugverdientijd)
      : "";

    const saldoRij = (jaar) =>
      `<tr><td>Na ${jaar} jaar</td><td style="text-align:right;">${eurFmt.format(r.totaal * jaar)}</td><td style="text-align:right;font-weight:700;color:${r.totaal * jaar - r.investering >= 0 ? "var(--kleur-groen)" : "var(--kleur-rood)"};">${eurFmt.format(r.totaal * jaar - r.investering)}</td></tr>`;

    doel.innerHTML = `
      <div style="text-align:center;padding:10px 0 18px;">${oordeel}</div>
      ${grafiek}
      <div style="overflow-x:auto;">
      <table class="vergelijk-tabel" style="min-width:0;">
        <thead><tr><th>Opbrengst per jaar</th><th style="text-align:right;">Bedrag</th></tr></thead>
        <tbody>
          ${regels.join("") || '<tr><td colspan="2">Geen opbrengsten met deze invoer.</td></tr>'}
          <tr><td style="font-weight:800;">Totaal per jaar</td><td style="font-weight:800;text-align:right;">${eurFmt.format(r.totaal)}</td></tr>
        </tbody>
      </table>
      </div>
      ${r.terugverdientijd != null ? `
      <div style="overflow-x:auto;margin-top:12px;">
      <table class="vergelijk-tabel" style="min-width:0;">
        <thead><tr><th>Verloop</th><th style="text-align:right;">Bespaard</th><th style="text-align:right;">Saldo t.o.v. investering</th></tr></thead>
        <tbody>
          ${saldoRij(5)}${saldoRij(10)}${saldoRij(15)}
        </tbody>
      </table>
      </div>` : ""}
      ${waarschuwingen.map((w) => `<div class="waarschuwing-kader" style="margin:12px 0;">${w}</div>`).join("")}
      ${kanttekeningen.length ? `<details class="kanttekeningen">
        <summary>Kanttekeningen bij deze berekening (${kanttekeningen.length})</summary>
        <ul>${kanttekeningen.map((k) => `<li>${k}</li>`).join("")}</ul>
      </details>` : ""}
    `;
  }

  /* ------------------------------------------------------------------
     Batterijkeuze en events
     ------------------------------------------------------------------ */

  // De eerlijkste investering om mee te rekenen: de totaalprijs compleet
  // gebruiksklaar als die bekend is (belangrijk bij installatiesystemen),
  // anders de beste winkelprijs.
  function investeringVoor(b) {
    if (b.totaalprijs_van_eur) return { bedrag: b.totaalprijs_van_eur, soort: "totaal" };
    const p = bestePrijs(b);
    return p ? { bedrag: p, soort: "winkel" } : null;
  }

  function vulBatterijKeuze() {
    const sel = el("inpBatterij");
    const metPrijs = batterijen.filter((b) => b.capaciteit_kwh && investeringVoor(b));
    const zonderPrijs = batterijen.filter((b) => b.capaciteit_kwh && !investeringVoor(b));
    const opties = metPrijs.map((b) => {
      const inv = investeringVoor(b);
      return `<option value="${b.id}">${b.merk} ${b.model} (${eurFmt.format(inv.bedrag)}${inv.soort === "totaal" ? " gebruiksklaar" : ""})</option>`;
    });
    const grijs = zonderPrijs.map((b) => `<option value="" disabled>${b.merk} ${b.model} (prijs op aanvraag; vul zelf een offertebedrag in)</option>`);
    sel.innerHTML = '<option value="">— Kies een batterij —</option>' + opties.join("") + grijs.join("");
  }

  function kiesBatterij(id) {
    const b = batterijen.find((x) => x.id === id);
    if (!b) return;
    const inv = investeringVoor(b);
    el("inpCapaciteit").value = b.capaciteit_kwh;
    el("inpInvestering").value = inv ? inv.bedrag : "";
    const hint = el("batterijHint");
    const delen = [];
    if (inv && inv.soort === "totaal") {
      delen.push(`Als investering is de indicatie compleet gebruiksklaar ingevuld (${eurFmt.format(inv.bedrag)}${b.totaalprijs_tot_eur ? ` tot ${eurFmt.format(b.totaalprijs_tot_eur)}` : ""}, incl. installatie). Heb je een offerte? Vul dan dat bedrag in bij "alle getallen".`);
    } else if (b.prijs_omvat) {
      delen.push(`Let op wat de prijs dekt: ${b.prijs_omvat}. Tel installatiekosten zelf op bij de investering als die er niet in zitten.`);
    }
    // De besparing wordt gerekend over de capaciteit hierboven, en die betekent
    // niet bij elke batterij hetzelfde: bij een bruto opgave haal je er minder
    // uit dan er staat, en valt de besparing dus lager uit dan hier berekend.
    // De vergelijker en de keuzehulp tonen dat al met een label; zonder deze
    // regel zou juist de pagina die er een bedrag aan hangt erover zwijgen.
    const capToelichting = Prijs.capaciteitToelichting(b);
    if (capToelichting) {
      delen.push(`Over de capaciteit van ${String(b.capaciteit_kwh).replace(".", ",")} kWh: ${capToelichting}. Haal je er minder uit, dan valt de besparing lager uit dan hieronder staat.`);
    }
    hint.textContent = delen.join(" ");
    bereken();
    // Op smalle schermen staat het resultaat onder het formulier en zou een
    // batterijkeuze anders onzichtbaar blijven: scroll er dan even naartoe.
    if (window.matchMedia("(max-width: 860px)").matches) {
      el("resultaat").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  /* ------------------------------------------------------------------
     Leveranciers: terugleverkosten automatisch invullen + tarieventabel
     (bron: data/leveranciers.json, maandelijks gecontroleerd)
     ------------------------------------------------------------------ */

  let leveranciersData = null;

  function vulLeveranciers() {
    const sel = el("inpLeverancier");
    if (!sel || !leveranciersData) return;
    const vast = leveranciersData.leveranciers.filter((l) => l.contract === "vast-variabel");
    const dyn = leveranciersData.leveranciers.filter((l) => l.contract === "dynamisch");
    const optie = (l) => `<option value="${l.id}">${l.naam}</option>`;
    sel.innerHTML = '<option value="">— Kies je leverancier (of sla over) —</option>' +
      `<optgroup label="Vast of variabel contract">${vast.map(optie).join("")}</optgroup>` +
      `<optgroup label="Dynamisch contract">${dyn.map(optie).join("")}</optgroup>`;
  }

  function kiesLeverancier() {
    const hint = el("leverancierHint");
    const l = (leveranciersData?.leveranciers || []).find((x) => x.id === el("inpLeverancier").value);
    if (!l) {
      hint.textContent = "Dan vullen wij de terugleverkosten alvast voor je in; zelf opzoeken hoeft niet.";
      bereken();
      return;
    }
    if (l.terugleverkosten_per_kwh_indicatie != null) {
      el("inpTerugleverkosten").value = l.terugleverkosten_per_kwh_indicatie;
    }
    if (l.contract === "dynamisch" && el("inpContract").value !== "dynamisch") {
      el("inpContract").value = "dynamisch";
      toggleContractVelden();
    }
    hint.textContent = `Ingevuld: ${l.terugleverkosten_omschrijving}. ` +
      (l.kanttekening ? l.kanttekening + " " : "") +
      `(peildatum ${l.peildatum}; indicatie, je contract is leidend)`;
    bereken();
  }

  function toonLeveranciersTabel() {
    const doel = el("leveranciersTabel");
    if (!doel || !leveranciersData) return;
    const rij = (l) => `
      <tr>
        <td><b>${l.naam}</b></td>
        <td>${l.terugleverkosten_omschrijving}</td>
        <td>${l.terugleververgoeding_omschrijving}</td>
        <td>${l.vanaf_2027 || "nog niet bekend"}</td>
        <td style="white-space:nowrap;"><a href="${l.bron}" target="_blank" rel="noopener">bron</a> · ${l.peildatum}</td>
      </tr>`;
    doel.innerHTML = `
      <div style="overflow-x:auto;background:var(--kleur-wit);border:1px solid var(--kleur-rand);border-radius:var(--radius);">
      <table class="vergelijk-tabel" style="min-width:760px;">
        <thead><tr><th>Leverancier</th><th>Terugleverkosten (nu)</th><th>Terugleververgoeding (nu)</th><th>Aangekondigd voor 2027</th><th>Bron</th></tr></thead>
        <tbody>${leveranciersData.leveranciers.map(rij).join("")}</tbody>
      </table>
      </div>`;
  }

  function togglePvVelden() {
    const heeftPv = el("inpPv").value === "ja";
    el("pvVelden").style.display = heeftPv ? "" : "none";
    el("veldPanelen").style.display = heeftPv ? "" : "none";
    bereken();
  }

  // Vertaalt het aantal panelen naar jaaropwek (ca. 350 kWh per paneel),
  // zodat bezoekers geen kWh-getal hoeven op te zoeken.
  function panelenNaarOpwek() {
    const n = parseInt(el("inpPanelen").value, 10);
    if (Number.isFinite(n) && n > 0) {
      el("inpOpwek").value = n * 350;
    }
    bereken();
  }

  function toggleContractVelden() {
    const dyn = el("inpContract").value === "dynamisch";
    el("dynVelden").style.display = dyn ? "" : "none";
    bereken();
  }

  async function init() {
    try {
      const res = await fetch("data/batterijen.json", { cache: "no-cache" });
      const data = await res.json();
      batterijen = data.batterijen || [];
      vulBatterijKeuze();

      const params = new URLSearchParams(location.search);
      const gekozen = params.get("batterij");
      if (gekozen && batterijen.some((b) => b.id === gekozen)) {
        el("inpBatterij").value = gekozen;
        kiesBatterij(gekozen);
      }
    } catch (err) {
      console.error("Batterijen konden niet geladen worden:", err);
    }

    try {
      const resL = await fetch("data/leveranciers.json", { cache: "no-cache" });
      leveranciersData = await resL.json();
      vulLeveranciers();
      toonLeveranciersTabel();
    } catch (err) {
      console.error("Leverancierstarieven konden niet geladen worden:", err);
      const doel = el("leveranciersTabel");
      if (doel) doel.innerHTML = '<p class="datum-stempel">De tarieventabel kon niet worden geladen.</p>';
    }

    el("inpBatterij").addEventListener("change", (e) => kiesBatterij(e.target.value));
    el("inpLeverancier").addEventListener("change", kiesLeverancier);
    el("inpPanelen").addEventListener("input", panelenNaarOpwek);
    el("inpPv").addEventListener("change", togglePvVelden);
    el("inpContract").addEventListener("change", toggleContractVelden);
    document.querySelectorAll("#rekenformulier input, #rekenformulier select").forEach((inp) => {
      inp.addEventListener("input", bereken);
    });

    togglePvVelden();
    toggleContractVelden();
    bereken();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
