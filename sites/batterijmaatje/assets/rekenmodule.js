/* ==========================================================================
   Rekenmodule terugverdientijd thuisbatterij - schermlaag

   De rekensom zelf staat in assets/rekenkern.js en wordt getest door
   scripts/rekenkern.test.mjs. Dit bestand doet alleen het scherm: velden
   uitlezen, de kern aanroepen en de uitkomst tonen. Die scheiding is er omdat
   de wiskunde die hier eerst tussen de DOM-code stond door niets werd getest,
   en er daardoor fouten in konden blijven zitten die niemand zag.
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
  let leveranciersData = null;
  // Heeft de bezoeker de terugleverkosten zelf aangeraakt? Zo ja, dan laat de
  // module dat veld met rust bij een contractwissel.
  let terugleverkostenAangeraakt = false;

  // De investering waarmee gerekend wordt is de vergelijkprijs incl. btw: een
  // particulier betaalt nu eenmaal btw, dus rekenen met een prijs excl. btw
  // levert een terugverdientijd op die 21% te gunstig is.
  function bestePrijs(b) {
    return Prijs.vergelijkPrijs(Prijs.beste(b));
  }

  function getal(id, fallback) {
    const veld = el(id);
    if (!veld) return fallback;
    const v = parseFloat(String(veld.value).replace(",", "."));
    // Negatieve invoer (bijv. verbruik -500) zou onzinnige uitkomsten geven
    return Number.isFinite(v) ? Math.max(0, v) : fallback;
  }

  /* ------------------------------------------------------------------
     Terugleverkosten horen bij het contract

     Leveranciers met een dynamisch contract rekenen geen terugleverkosten;
     leveranciers met een vast of variabel contract wel, en fors. Eén vaste
     standaardwaarde van 0,02 hoorde dus bij niemand. Het bedrag hieronder is
     de mediaan uit data/leveranciers.json, zodat het meebeweegt als die tabel
     wordt bijgewerkt.
     ------------------------------------------------------------------ */
  const TERUGLEVERKOSTEN_VAST_TERUGVAL = 0.12;

  function standaardTerugleverkosten(contract) {
    if (contract === "dynamisch") return 0;
    const lijst = (leveranciersData?.leveranciers || [])
      .filter((l) => l.contract === "vast-variabel" && typeof l.terugleverkosten_per_kwh_indicatie === "number")
      .map((l) => l.terugleverkosten_per_kwh_indicatie)
      .sort((a, b) => a - b);
    if (!lijst.length) return TERUGLEVERKOSTEN_VAST_TERUGVAL;
    const m = Math.floor(lijst.length / 2);
    const mediaan = lijst.length % 2 ? lijst[m] : (lijst[m - 1] + lijst[m]) / 2;
    return Math.round(mediaan * 100) / 100;
  }

  function pasTerugleverkostenAan() {
    if (terugleverkostenAangeraakt) return;
    el("inpTerugleverkosten").value = standaardTerugleverkosten(el("inpContract").value);
  }

  /* ------------------------------------------------------------------
     Invoer verzamelen en doorrekenen
     ------------------------------------------------------------------ */

  function invoer() {
    const heeftPv = el("inpPv").value === "ja";
    return {
      heeftPv,
      contract: el("inpContract").value,
      opwek: heeftPv ? getal("inpOpwek", 3500) : 0,
      eigenVerbruikPct: getal("inpEigenVerbruik", 30),
      stroomprijs: getal("inpStroomprijs", 0.30),
      terugleverVergoeding: getal("inpTeruglever", 0.05),
      terugleverKosten: getal("inpTerugleverkosten", 0.12),
      laadprijs: getal("inpLaadprijs", 0.15),
      ontlaadwaarde: getal("inpOntlaadwaarde", 0.30),
      investering: getal("inpInvestering", 0),
      capaciteit: getal("inpCapaciteit", 0),
      bruikbaarPct: getal("inpBruikbaar", 90),
      rendement: getal("inpRendement", 90),
      zonDagen: getal("inpZonDagen", 220),
      mismatch: getal("inpMismatch", 90),
      cycliPerDag: getal("inpCycli", 1),
      extraOnbalans: getal("inpOnbalans", 0),
      standbyWatt: getal("inpStandby", 10),
      jaarVerbruik: getal("inpVerbruik", 2900),
      degradatiePct: getal("inpDegradatie", 2),
    };
  }

  function bereken() {
    const i = invoer();
    toonResultaat(Rekenkern.bereken(i), Rekenkern.bandbreedte(i));
  }

  /* ------------------------------------------------------------------
     Terugverdiengrafiek (zelfstandige SVG, geen libraries)
     Kleuren gevalideerd op contrast en kleurenblind-veiligheid:
     teal #0d9488 (opbrengst), amber #d97706 (investering)
     ------------------------------------------------------------------ */

  function terugverdienGrafiek(investering, jaarOpbrengst, degradatie, terugverdientijd) {
    const H = Math.min(30, Math.max(15, Math.ceil(terugverdientijd) + 3)); // horizon in jaren
    const W = 640, HGT = 300, mL = 78, mR = 24, mT = 18, mB = 40;
    const pw = W - mL - mR, ph = HGT - mT - mB;
    const cum = (j) => Rekenkern.besparingNa(jaarOpbrengst, degradatie, j);
    const yMax = Math.max(investering, cum(H)) * 1.06;
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

    // Opbrengstlijn met hoverpunten per jaar. De lijn buigt licht af: de
    // batterij levert in jaar tien minder dan in jaar één.
    let pad = `M ${x(0)} ${y(0)}`;
    let punten = "";
    for (let j = 1; j <= H; j++) {
      pad += ` L ${x(j)} ${y(cum(j))}`;
      punten += `<circle cx="${x(j)}" cy="${y(cum(j))}" r="9" fill="transparent"><title>Na ${j} jaar: ${eurFmt.format(cum(j))} bespaard (saldo ${eurFmt.format(cum(j) - investering)})</title></circle>`;
    }

    // Terugverdienpunt
    const bx = x(terugverdientijd), by = y(investering);
    const labelLinks = terugverdientijd > H * 0.55;

    return `
    <div style="display:flex;gap: var(--ruimte-14);flex-wrap:wrap;font-size:var(--tekst-15);color:var(--kleur-tekst-licht);margin: var(--ruimte-14) 0 var(--ruimte-4);">
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

  function toonResultaat(r, band) {
    const doel = el("resultaat");
    const i = r.invoer;

    if (!i.investering || !r.bruikbareCap) {
      // Benoem wat er precies ontbreekt, in plaats van altijd naar stap 1 te wijzen
      const melding = r.bruikbareCap && !i.investering
        ? 'Er is een batterij gekozen, maar de <b>investering (€)</b> ontbreekt nog. Open "Alle getallen bekijken of aanpassen" en vul daar een bedrag in (bijvoorbeeld je offerteprijs).'
        : 'Kies bij stap 1 een batterij uit de lijst; het resultaat verschijnt hier direct. Wil je liever met eigen bedragen rekenen? Open dan "Alle getallen bekijken of aanpassen" en vul de investering en capaciteit zelf in.';
      doel.innerHTML = `<p class="datum-stempel">${melding}</p>`;
      return;
    }

    const bedragCel = (v) => `<td style="text-align:right;font-weight:700;">${eurFmt.format(v)}</td>`;
    const regels = [];
    if (i.heeftPv) {
      regels.push(`<tr><td>Opslag van eigen zonnestroom (ca. ${numFmt.format(r.opslagJaar)} kWh per jaar)</td>${bedragCel(r.opbrengstZelf)}</tr>`);
    }
    if (i.contract === "dynamisch") {
      regels.push(`<tr><td>Slim laden en ontladen op uurprijzen (${numFmt.format(r.arbDagen)} dagen, ${eenDec.format(r.ontladenPerDag)} kWh per dag, ${eur2Fmt.format(r.winstPerDag)} per dag)</td>${bedragCel(r.opbrengstArb)}</tr>`);
    }
    if (i.extraOnbalans > 0) {
      regels.push(`<tr><td>Opgegeven extra opbrengst (bijv. onbalansmarkt via aggregator)</td>${bedragCel(i.extraOnbalans)}</tr>`);
    }
    if (r.kostenStandby > 0) {
      regels.push(`<tr><td>Eigen stroomverbruik van de batterij (standby, ${numFmt.format(i.standbyWatt)} W ≈ ${numFmt.format(r.standbyKwh)} kWh per jaar)</td><td style="text-align:right;font-weight:700;color:var(--kleur-rood);">− ${eurFmt.format(r.kostenStandby)}</td></tr>`);
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
      // Bewust een bereik en geen enkel getal: dezelfde batterij komt op 4 of
      // op 12 jaar uit, afhankelijk van aannames die niemand vooraf kent. Eén
      // getal met een decimaal doet alsof die onzekerheid er niet is.
      const bereik = band.laag != null
        ? (band.hoog != null
            ? `${jaarFmt.format(band.laag)} tot ${jaarFmt.format(band.hoog)} jaar`
            : `vanaf ${jaarFmt.format(band.laag)} jaar`)
        : `${jaarFmt.format(t)} jaar`;
      oordeel = `<div style="font-size:var(--tekst-28);font-weight:800;color:${kleur};">${bereik}</div>
        <div class="datum-stempel">terugverdientijd, met ${eurFmt.format(r.totaal)} opbrengst per jaar (middenscenario ${jaarFmt.format(t)} jaar)</div>`;
      if (t > 15) waarschuwingen.push('De berekende terugverdientijd is langer dan de levensduur die vaak wordt aangehouden (10 tot 15 jaar). Met deze invoer verdient de batterij zichzelf waarschijnlijk niet terug. Lees ook: <a href="uitleg.html#waarom-toch">is een thuisbatterij het waard bij een lange terugverdientijd?</a>');
      else if (t > 10) waarschuwingen.push('De terugverdientijd nadert de verwachte levensduur van de batterij (10 tot 15 jaar). Reken jezelf niet rijk en vergelijk meerdere scenario\'s. Lees ook: <a href="uitleg.html#waarom-toch">is een thuisbatterij het waard bij een lange terugverdientijd?</a>');
    }

    if (r.teGroot) {
      waarschuwingen.push(`<b>Deze batterij is waarschijnlijk te groot voor je verbruik.</b> Met ${numFmt.format(i.jaarVerbruik)} kWh per jaar maakt je huishouden buiten de zonuren maar zo'n ${eenDec.format(r.maxOntladingPerDag)} kWh per dag op, terwijl deze batterij er ${eenDec.format(r.bruikbareCap)} kWh in kwijt kan. De berekening telt daarom alleen mee wat je er echt uit haalt; een kleinere (goedkopere) batterij geeft vaak een kortere terugverdientijd.`);
    }
    if (i.contract === "vast" && !i.heeftPv) {
      waarschuwingen.push("Zonder zonnepanelen en zonder dynamisch contract kan een thuisbatterij vrijwel niets verdienen: er valt niets op te slaan en geen prijsverschil te benutten.");
    }
    if (r.spreadOptimistisch) {
      waarschuwingen.push(`<b>Het ingevulde prijsverschil is optimistisch.</b> Laden voor ${eur2Fmt.format(i.laadprijs)} en ontladen tegen ${eur2Fmt.format(i.ontlaadwaarde)} betekent ${eur2Fmt.format(r.spread)} verschil per kWh, elke dag van het jaar. Beide bedragen zijn incl. belastingen en die zijn aan weerskanten gelijk, dus dat verschil is puur marktspread. Op een gemiddelde dag is die kleiner; verlaag de ontlaadwaarde of verhoog de laadprijs voor een realistischer beeld.`);
    }
    if (i.contract === "dynamisch" && r.opbrengstArb > 0) {
      kanttekeningen.push("De opbrengst uit handel op uurprijzen is een schatting op basis van een vast gemiddeld prijsverschil; werkelijke spreads wisselen per dag en seizoen, en over stroom uit het net betaal je energiebelasting.");
    }
    if (i.extraOnbalans > 0) {
      kanttekeningen.push("Opbrengsten uit de onbalansmarkt zijn de afgelopen jaren gedaald en bieden geen garantie; TenneT waarschuwt daar expliciet voor.");
    }
    // Deze zin hangt aan de kalender: vanaf 1 januari 2027 is "geldt nog" niet
    // meer waar. Hij past zich daarom aan in plaats van te verouderen.
    kanttekeningen.push(new Date() < new Date("2027-01-01")
      ? "Tot en met 31 december 2026 geldt de salderingsregeling nog; deze berekening gaat uit van de situatie daarna."
      : "De salderingsregeling is per 1 januari 2027 vervallen; deze berekening gaat uit van de situatie zonder saldering.");
    kanttekeningen.push(`Het getoonde bereik komt van dezelfde som met een ongunstige en een gunstige set aannames (stroomprijs, prijsverschil, rendement en standby-verbruik). Het middenscenario is niet waarschijnlijker dan de randen.`);
    kanttekeningen.push(`De berekening rekent met ${eenDec.format(i.degradatiePct)}% capaciteitsverlies per jaar, maar niet met rente of met stijgende of dalende energieprijzen; zie de toelichting onderaan voor alle aannames.`);

    const grafiek = r.terugverdientijd != null && r.terugverdientijd <= 27
      ? terugverdienGrafiek(i.investering, r.totaal, i.degradatiePct / 100, r.terugverdientijd)
      : "";

    const saldoRij = (jaar) => {
      const bespaard = Rekenkern.besparingNa(r.totaal, i.degradatiePct / 100, jaar);
      const saldo = bespaard - i.investering;
      return `<tr><td>Na ${jaar} jaar</td><td style="text-align:right;">${eurFmt.format(bespaard)}</td><td style="text-align:right;font-weight:700;color:${saldo >= 0 ? "var(--kleur-groen)" : "var(--kleur-rood)"};">${eurFmt.format(saldo)}</td></tr>`;
    };

    doel.innerHTML = `
      <div style="text-align:center;padding: var(--ruimte-10) 0 var(--ruimte-20);">${oordeel}</div>
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
      <div style="overflow-x:auto;margin-top: var(--ruimte-10);">
      <table class="vergelijk-tabel" style="min-width:0;">
        <thead><tr><th>Verloop</th><th style="text-align:right;">Bespaard</th><th style="text-align:right;">Saldo t.o.v. investering</th></tr></thead>
        <tbody>
          ${saldoRij(5)}${saldoRij(10)}${saldoRij(15)}
        </tbody>
      </table>
      </div>` : ""}
      ${waarschuwingen.map((w) => `<div class="waarschuwing-kader" style="margin: var(--ruimte-10) 0;">${w}</div>`).join("")}
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
    sel.innerHTML = '<option value="">Kies een batterij…</option>' + opties.join("") + grijs.join("");
  }

  function kiesBatterij(id) {
    const b = batterijen.find((x) => x.id === id);
    if (!b) return;
    const inv = investeringVoor(b);
    el("inpCapaciteit").value = b.capaciteit_kwh;
    el("inpInvestering").value = inv ? inv.bedrag : "";

    /* Het bruikbare deel hangt af van wat het capaciteitsgetal betekent. Staat
       er al de bruikbare capaciteit, dan is er niets meer af te halen: de vaste
       90% haalde er dan een tweede keer 10% af bij de 17 modellen waarvoor dat
       is vastgesteld. Bij een bruto opgave hoort die correctie er juist wel. */
    const bevestigd = Prijs.capaciteitBevestigd(b);
    el("inpBruikbaar").value = bevestigd ? 100 : 90;

    const hint = el("batterijHint");
    const delen = [];
    if (inv && inv.soort === "totaal") {
      delen.push(`Als investering is de indicatie compleet gebruiksklaar ingevuld (${eurFmt.format(inv.bedrag)}${b.totaalprijs_tot_eur ? ` tot ${eurFmt.format(b.totaalprijs_tot_eur)}` : ""}, incl. installatie). Heb je een offerte? Vul dan dat bedrag in bij "alle getallen".`);
    } else if (b.prijs_omvat) {
      delen.push(`Let op wat de prijs dekt: ${b.prijs_omvat}. Tel installatiekosten zelf op bij de investering als die er niet in zitten.`);
    }
    // De besparing wordt gerekend over de capaciteit hierboven, en die betekent
    // niet bij elke batterij hetzelfde: bij een bruto opgave haal je er minder
    // uit dan er staat. De vergelijker en de keuzehulp tonen dat al met een
    // label; zonder deze regel zou juist de pagina die er een bedrag aan hangt
    // erover zwijgen.
    const capToelichting = Prijs.capaciteitToelichting(b);
    if (capToelichting) {
      delen.push(`Over de capaciteit van ${String(b.capaciteit_kwh).replace(".", ",")} kWh: ${capToelichting}. De berekening houdt daarom 90% aan als bruikbaar deel; haal je er minder uit, dan valt de besparing lager uit.`);
    } else {
      delen.push(`De ${String(b.capaciteit_kwh).replace(".", ",")} kWh hierboven is de bruikbare capaciteit, dus die telt volledig mee.`);
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
     Leveranciers: contract en terugleverkosten automatisch invullen
     (bron: data/leveranciers.json, maandelijks gecontroleerd)
     ------------------------------------------------------------------ */

  function vulLeveranciers() {
    const sel = el("inpLeverancier");
    if (!sel || !leveranciersData) return;
    const vast = leveranciersData.leveranciers.filter((l) => l.contract === "vast-variabel");
    const dyn = leveranciersData.leveranciers.filter((l) => l.contract === "dynamisch");
    const optie = (l) => `<option value="${l.id}">${l.naam}</option>`;
    sel.innerHTML = '<option value="">Kies je leverancier (of sla over)…</option>' +
      `<optgroup label="Vast of variabel contract">${vast.map(optie).join("")}</optgroup>` +
      `<optgroup label="Dynamisch contract">${dyn.map(optie).join("")}</optgroup>`;
  }

  function kiesLeverancier() {
    const hint = el("leverancierHint");
    const l = (leveranciersData?.leveranciers || []).find((x) => x.id === el("inpLeverancier").value);
    if (!l) {
      hint.textContent = "Dan vul ik het contracttype en de terugleverkosten alvast voor je in; zelf opzoeken hoeft niet.";
      bereken();
      return;
    }

    /* Het contract volgt de leverancier in béide richtingen.

       Hier zat de ergste fout van de module. Alleen een dynamische leverancier
       zette het contract om; wie een vaste leverancier koos hield het
       standaard ingestelde "dynamisch" staan én kreeg diens hoge
       terugleverkosten erbij. Uitkomst: de handelsopbrengst die hij nooit kan
       verdienen plus het volledige terugleverkosten-voordeel, waardoor de
       terugverdientijd juist kórter werd (4,8 naar 3,6 jaar) in plaats van
       langer. Precies de bezoeker die er het slechtst voorstaat kreeg zo het
       mooiste getal te zien. */
    const past = l.contract === "dynamisch" ? "dynamisch" : "vast";
    if (el("inpContract").value !== past) {
      el("inpContract").value = past;
      toggleContractVelden({ stil: true });
    }
    if (l.terugleverkosten_per_kwh_indicatie != null) {
      el("inpTerugleverkosten").value = l.terugleverkosten_per_kwh_indicatie;
      // Een leverancierskeuze is een expliciete keuze; een latere
      // contractwissel mag dit bedrag niet zomaar overschrijven.
      terugleverkostenAangeraakt = true;
    }
    hint.textContent = `Ingevuld: ${past === "dynamisch" ? "dynamisch contract" : "vast of variabel contract"}, ${l.terugleverkosten_omschrijving}. ` +
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

  /* Een leverancier en een contracttype die elkaar tegenspreken, bestaan niet.
     Wisselt de bezoeker het contract terwijl er een leverancier staat die dat
     niet levert, dan vervalt die keuze. Zonder dit blijft "Vattenfall" staan
     bij een dynamisch contract, mét diens terugleverkosten van 0,12 - met de
     hand precies de combinatie die de kiezer eerst automatisch maakte. */
  function vergeetLeverancierBijWissel() {
    const sel = el("inpLeverancier");
    if (!sel || !sel.value) return;
    const l = (leveranciersData?.leveranciers || []).find((x) => x.id === sel.value);
    if (!l) return;
    const past = l.contract === "dynamisch" ? "dynamisch" : "vast";
    if (past === el("inpContract").value) return;
    sel.value = "";
    terugleverkostenAangeraakt = false;
    el("leverancierHint").textContent =
      `${l.naam} levert geen ${el("inpContract").value === "dynamisch" ? "dynamisch" : "vast of variabel"} contract, dus die keuze is vervallen. Kies eventueel opnieuw je leverancier.`;
  }

  function toggleContractVelden(opties) {
    const dyn = el("inpContract").value === "dynamisch";
    el("dynVelden").style.display = dyn ? "" : "none";
    if (!opties || !opties.stil) vergeetLeverancierBijWissel();
    pasTerugleverkostenAan();
    if (!opties || !opties.stil) bereken();
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

      /* Wie op de vergelijker zijn jaarverbruik invulde, hoeft dat hier niet
         opnieuw te doen. Het komt mee in de link (?verbruik=) en staat anders
         nog in localStorage. Andersom geldt hetzelfde: wat je hier invult is
         straks de baan van de dagmaat. */
      if (typeof Dagmaat !== "undefined") {
        const veld = el("inpVerbruik");
        const uitUrl = params.get("verbruik");
        const bekend = uitUrl ? Dagmaat.verbruikVan(uitUrl) : Dagmaat.lees();
        if (veld && bekend !== Dagmaat.VERBRUIK_STANDAARD) {
          veld.value = bekend;
          bereken();
        }
        if (veld) veld.addEventListener("change", () => Dagmaat.schrijf(veld.value));
      }
    } catch (err) {
      console.error("Batterijen konden niet geladen worden:", err);
    }

    try {
      const resL = await fetch("data/leveranciers.json", { cache: "no-cache" });
      leveranciersData = await resL.json();
      vulLeveranciers();
      toonLeveranciersTabel();
      pasTerugleverkostenAan();
    } catch (err) {
      console.error("Leverancierstarieven konden niet geladen worden:", err);
      const doel = el("leveranciersTabel");
      if (doel) doel.innerHTML = '<p class="datum-stempel">De tarieventabel kon niet worden geladen.</p>';
    }

    el("inpBatterij").addEventListener("change", (e) => kiesBatterij(e.target.value));
    el("inpLeverancier").addEventListener("change", kiesLeverancier);
    el("inpPanelen").addEventListener("input", panelenNaarOpwek);
    el("inpPv").addEventListener("change", togglePvVelden);
    el("inpContract").addEventListener("change", () => toggleContractVelden());
    el("inpTerugleverkosten").addEventListener("input", () => { terugleverkostenAangeraakt = true; });
    document.querySelectorAll("#rekenformulier input, #rekenformulier select").forEach((inp) => {
      inp.addEventListener("input", bereken);
    });

    togglePvVelden();
    toggleContractVelden({ stil: true });
    bereken();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
