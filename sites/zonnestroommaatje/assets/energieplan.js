/* ==========================================================================
   Zonnestroommaatje - Jouw energieplan
   Eén intake, een gefaseerd plan voor het hele huis: isoleren, warmtepomp,
   zonnepanelen en thuisbatterij, in de bewezen volgorde. Gebruikt dezelfde
   vuistregels als de keuzehulpen en rekenmodules van de maatje-sites;
   alle aannames staan op de pagina onder "Hoe rekenen wij?".
   ========================================================================== */

(function () {
  "use strict";

  const el = (id) => document.getElementById(id);
  const eurFmt = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const numFmt = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });

  // Vaste aannames, gelijk aan de rekenmodules van de zustersites
  // Gas- en stroomprijs zijn standaardwaarden; de bezoeker kan ze aanpassen.
  const VERGOEDING = 0.05;          // terugleververgoeding vanaf 2027, euro per kWh
  const TERUGLEVERKOSTEN = 0.02;    // euro per teruggeleverde kWh
  const VASTRECHT_GAS = 350;        // vaste gaskosten per jaar
  // Warmtepomp: toestel en ISDE voor een gemiddelde pomp van elk type. De
  // installatie, de afsluitkosten en de som zelf komen uit de rekenkern van
  // warmtepompmaatje (assets/rekenkern-warmtepomp.js), zodat "Bereken exact"
  // op hetzelfde bedrag uitkomt.
  const WP = {
    hybride: { toestel: 3300, isde: 2100, label: "hybride warmtepomp" },
    allel: { toestel: 7300, isde: 3000, label: "all-electric warmtepomp" },
  };
  // Zonnepanelen (zelfde schatting als onze rekenmodule)
  const WP_PANEEL = 440;            // wattpiek per paneel
  const OPBRENGST_FACTOR = 0.9;     // kWh per Wp per jaar (zuidoost/zuidwest)
  const VASTE_INSTALLATIE = 1200;   // omvormer, bekabeling, voorrijden
  const KOSTEN_PER_PANEEL = 130;    // montage per paneel
  // Thuisbatterij (vuistregels, bron: Batterijmaatje)
  const BATTERIJ_EUR_PER_KWH = 350; // richtprijs per kWh capaciteit, incl. gangbare installatie

  let panelen = [];

  function invoer() {
    return {
      // Een leeg veld is "weet ik niet" (1.200 m³), maar 0 is 0: wie al van het
      // gas af is, kreeg anders een warmtepomp die 1.200 m³ gas bespaarde.
      gas: el("gasverbruik").value === "" ? 1200 : Math.max(0, Number(el("gasverbruik").value) || 0),
      stroom: Math.max(500, Number(el("stroomverbruik").value) || 2900),
      dakMax: Math.max(1, Math.round(Number(el("dak").value) || 12)), // panelen die passen
      isolatie: el("isolatie").value,           // goed | redelijk | matig
      cvKetel: el("cvKetel").value,             // recent | oud | geen
      afgifte: el("afgifte").value,             // vloer | mix | radiatoren
      woning: el("woning").value,               // tussen | hoek | vrijstaand
      contract: el("contract").value,           // vast | variabel | dynamisch
      heeftPanelen: el("checkHeeftPanelen").checked,
      heeftPomp: el("checkHeeftPomp").checked,
      heeftBatterij: el("checkHeeftBatterij").checked,
      // Leeg = onbekend; dan de oude aanname (90% van het verbruik).
      opwekNu: el("opwekNu").value === "" ? null : Math.max(0, Number(el("opwekNu").value) || 0),
      gasprijs: Number(el("gasprijs").value) > 0 ? Number(el("gasprijs").value) : 1.45,
      stroomprijs: Number(el("stroomprijs").value) > 0 ? Number(el("stroomprijs").value) : 0.30,
    };
  }

  function gemiddeldePaneelprijs() {
    const prijzen = panelen.map((p) => p.richtprijs_eur).filter((n) => n > 0);
    if (!prijzen.length) return 70;
    return Math.round(prijzen.reduce((a, b) => a + b, 0) / prijzen.length);
  }

  /* ------------------------------------------------------------------
     De vier stappen doorrekenen
     ------------------------------------------------------------------ */

  function planStappen(s) {
    const stappen = [];

    // Stap 1: isoleren (advies, geen bedragen; wij vergelijken geen isolatie)
    if (s.isolatie !== "goed") {
      stappen.push({
        icoon: Iconen.svg("huis"), titel: "Eerst: isolatie op orde",
        advies: s.isolatie === "matig"
          ? "Je huis is matig geïsoleerd. Isoleren is de goedkoopste besparing en maakt elke volgende stap kleiner en goedkoper: je hebt daarna een kleinere warmtepomp en minder panelen nodig. Begin hier."
          : "Je huis is redelijk geïsoleerd. Check of vloer-, spouw- of dakisolatie nog loont voordat je de warmtepomp kiest; elke bespaarde m³ gas maakt de volgende stappen kleiner.",
        bedragen: null,
        knoppen: [{ tekst: `Check je isolatie op Verbeterjehuis ${Iconen.svg("pijl-rechts")}`, url: "https://www.verbeterjehuis.nl/verbetercheck", extern: true }],
      });
    }

    // Stap 2: warmtepomp (zelfde typekeuze als de keuzehulp van Warmtepompmaatje:
    // goed geïsoleerd of geen ketel = all-electric, redelijk mét (deels)
    // vloerverwarming ook; anders is hybride de veilige route)
    let pompKwh = 0, gasNa = s.gas, vastrechtNa = VASTRECHT_GAS;
    if (!s.heeftPomp && s.gas >= 300) {
      const allElectric = s.cvKetel === "geen" || s.isolatie === "goed" || (s.isolatie === "redelijk" && s.afgifte !== "radiatoren");
      const wp = allElectric ? WP.allel : WP.hybride;
      // Dezelfde som als de rekenhulp van warmtepompmaatje (geleend als
      // assets/rekenkern-warmtepomp.js), met een gemiddelde pomp van dit type.
      const W = window.RekenkernWarmtepomp;
      const r = W.bereken(Object.assign({}, W.STANDAARD, {
        type: allElectric ? "all-electric" : "hybride",
        gas: s.gas, gasprijs: s.gasprijs, stroomprijs: s.stroomprijs, vastrecht: VASTRECHT_GAS,
        toestelPrijs: wp.toestel, isde: wp.isde, gasAf: allElectric,
        ketelVervangen: s.cvKetel === "oud",
      }));
      pompKwh = r.stroomKwh;
      gasNa = r.gasOver;
      if (allElectric) vastrechtNa = 0;
      const k = r.tegenoverKetel;
      const investering = r.netto;
      const besparing = r.besparingJaar;
      // Is de ketel toch op, dan telt bij all-electric alleen de meerprijs
      // boven een nieuwe ketel; een hybride heeft die ketel er hoe dan ook bij nodig.
      const tvt = k ? k.tvt : r.tvt;
      const ketelZin = k
        ? (allElectric
          ? ` Je ketel is toch aan vervanging toe: de terugverdientijd telt alleen wat dit méér kost dan een nieuwe cv-ketel (circa ${eurFmt.format(k.ketelprijs)}).`
          : ` Je ketel is aan vervanging toe, en een hybride werkt naast een ketel: reken een nieuwe erbij (circa ${eurFmt.format(k.ketelprijs)}), of overweeg all-electric na isoleren.`)
        : "";
      const geluidZin = s.woning !== "vrijstaand" ? " Kies een stille buitenunit: met buren op de erfgrens geldt in de nacht een eis van 40 dB." : "";
      stappen.push({
        icoon: Iconen.svg("aanbieding"), titel: `Warmtepomp: ${wp.label}`,
        advies: (allElectric
          ? (s.cvKetel === "geen"
            ? "Zonder cv-ketel is hybride niet mogelijk; all-electric is de logische keuze en levert de hoogste subsidie op."
            : s.isolatie === "goed"
              ? "Je huis is goed geïsoleerd: all-electric kan de ketel volledig vervangen en je kunt helemaal van het gas af."
              : "Met redelijke isolatie en (deels) vloerverwarming kan all-electric, mits de installateur het warmteverlies doorrekent.")
          : `${s.isolatie === "matig" ? "Bij matige isolatie" : "Met alleen radiatoren"} is hybride de veilige route: circa 60% gasbesparing, de ketel vangt piekkou en warm water op.`) + ketelZin + geluidZin,
        soort: "warmtepomp",
        bedragen: { investering, subsidie: wp.isde, besparing, tvt },
        knoppen: [
          { tekst: `Doe de warmtepomp-keuzehulp ${Iconen.svg("pijl-rechts")}`, url: "https://warmtepompmaatje.nl/advies.html", extern: true },
          { tekst: `Bereken exact ${Iconen.svg("pijl-rechts")}`, url: `https://warmtepompmaatje.nl/rekenmodule.html?gas=${s.gas}`, extern: true },
        ],
      });
    }

    // Stap 3: zonnepanelen, gedimensioneerd op het verbruik ná de warmtepomp
    const verbruikNa = s.stroom + Math.round(pompKwh);
    let opwek = 0, eigenPct = 0.35;
    if (!s.heeftPanelen) {
      const perPaneel = WP_PANEEL * OPBRENGST_FACTOR; // kWh per paneel per jaar
      const gewenst = Math.ceil(verbruikNa / perPaneel);
      // Minstens 6 panelen, tenzij het dak er minder heeft.
      const aantal = Math.min(s.dakMax, Math.max(6, gewenst));
      opwek = Math.round(aantal * perPaneel);
      if (pompKwh > 0) eigenPct = 0.45; // een slim aangestuurde pomp verhoogt het eigen verbruik
      const prijsPaneel = gemiddeldePaneelprijs();
      const investering = prijsPaneel * aantal + VASTE_INSTALLATIE + KOSTEN_PER_PANEEL * aantal;
      const eigen = Math.min(opwek * eigenPct, verbruikNa);
      const teruggeleverd = opwek - eigen;
      const besparing = eigen * s.stroomprijs + teruggeleverd * (VERGOEDING - TERUGLEVERKOSTEN);
      stappen.push({
        icoon: Iconen.svg("zon"), titel: `Zonnepanelen: ${aantal} panelen (${numFmt.format(aantal * WP_PANEEL)} Wp)`,
        advies: `Gedimensioneerd op je stroomverbruik ná de warmtepomp (${numFmt.format(verbruikNa)} kWh per jaar${gewenst > aantal ? `; je dak begrenst het aantal op ${aantal}` : ""}). Jaaropbrengst circa ${numFmt.format(opwek)} kWh.`,
        soort: "zonnepanelen",
        bedragen: { investering, subsidie: 0, besparing },
        knoppen: [
          { tekst: `Vergelijk zonnepanelen ${Iconen.svg("pijl-rechts")}`, url: "index.html" },
          { tekst: `Bereken exact ${Iconen.svg("pijl-rechts")}`, url: `rekenmodule.html?aantal=${aantal}` },
        ],
      });
    } else {
      // Wat de bezoeker invult; anders de aanname dat de bestaande panelen het
      // huidige verbruik grotendeels dekken.
      opwek = s.opwekNu !== null ? s.opwekNu : Math.round(s.stroom * 0.9);
    }

    // Stap 4: thuisbatterij (alleen zinvol met panelen)
    if (!s.heeftBatterij && (opwek > 0 || s.heeftPanelen)) {
      // Grootte zoals de keuzehulp van batterijmaatje: niet meer opslaan dan
      // je zomers overhoudt, en niet meer dan je 's avonds en 's nachts
      // gebruikt. Afgerond op een halve kWh.
      const B = window.RekenkernBatterij;
      const avondNacht = (verbruikNa / 365) * B.AANDEEL_BUITEN_ZON;
      const dagOverschotZomer = ((opwek * 0.7) / 365) * 1.5;
      const capaciteit = Math.max(2, Math.round(Math.min(dagOverschotZomer, Math.max(avondNacht, 1)) * 2) / 2);
      const investering = Math.round(capaciteit * BATTERIJ_EUR_PER_KWH);
      // En de opbrengst met de rekenkern van batterijmaatje (geleend als
      // assets/rekenkern-batterij.js), dus hetzelfde getal als de rekenhulp daar.
      const r = B.bereken(B.metStandaard({
        heeftPv: true,
        contract: s.contract === "dynamisch" ? "dynamisch" : "vast",
        opwek, jaarVerbruik: verbruikNa, eigenVerbruikPct: Math.round(eigenPct * 100),
        capaciteit, investering, stroomprijs: s.stroomprijs, ontlaadwaarde: s.stroomprijs,
      }));
      const besparing = r.totaal;
      const tvt = r.terugverdientijd;
      // Met een vast contract is dezelfde batterij vaak een ander verhaal dan
      // met een dynamisch; dat verschil hoort de bezoeker te zien.
      const dyn = s.contract === "dynamisch" ? null : B.bereken(B.metStandaard({
        heeftPv: true, contract: "dynamisch",
        opwek, jaarVerbruik: verbruikNa, eigenVerbruikPct: Math.round(eigenPct * 100),
        capaciteit, investering, stroomprijs: s.stroomprijs, ontlaadwaarde: s.stroomprijs,
      }));
      const kwh1 = (n) => String(Math.round(n * 10) / 10).replace(".", ",");
      stappen.push({
        icoon: Iconen.svg("batterij"), titel: `Thuisbatterij: circa ${kwh1(capaciteit)} kWh`,
        advies: `Afgestemd op wat je zomers overhoudt (circa ${kwh1(dagOverschotZomer)} kWh per dag) en wat je 's avonds en 's nachts gebruikt (circa ${kwh1(avondNacht)} kWh per dag). ` +
          (s.contract === "dynamisch"
            ? "Met je dynamische contract telt ook slim laden op goedkope uren mee."
            : dyn && dyn.terugverdientijd !== null
              ? `Met een dynamisch contract laadt hij ook op goedkope uren: dan ${eurFmt.format(dyn.totaal)} per jaar en een terugverdientijd van ${String(Math.round(dyn.terugverdientijd * 10) / 10).replace(".", ",")} jaar. Hierboven reken ik met je huidige contract.`
              : "Met een dynamisch contract kan hij extra verdienen op goedkope uren; met je huidige contract reken ik dat niet mee."),
        soort: "batterij",
        bedragen: { investering, subsidie: 0, besparing, tvt },
        knoppen: [{ tekst: `Doe de batterij-keuzehulp ${Iconen.svg("pijl-rechts")}`, url: "https://batterijmaatje.nl/advies.html", extern: true }],
      });
    }

    // Stap 5: dynamisch energiecontract (gratis stap; alleen zinvol met iets
    // slims om te sturen: warmtepomp of thuisbatterij, nu of in het plan)
    const krijgtPomp = pompKwh > 0, krijgtBatterij = stappen.some((st) => st.soort === "batterij" && stapOordeel(st).oordeel !== "slecht");
    if (s.contract !== "dynamisch" && (krijgtPomp || krijgtBatterij || s.heeftPomp || s.heeftBatterij)) {
      const flex = [
        (krijgtPomp || s.heeftPomp) && "je warmtepomp kan het boilervat opwarmen op de goedkoopste uren",
        (krijgtBatterij || s.heeftBatterij) && "je batterij laadt goedkoop en dekt de dure avond",
      ].filter(Boolean).join(" en ");
      stappen.push({
        icoon: Iconen.svg("stroom"), titel: "Sluitstuk: overweeg een dynamisch energiecontract",
        advies: `Je betaalt dan de uurprijs van de stroombeurs in plaats van één ${s.contract === "vast" ? "vaste" : "variabele"} prijs. Zonder flexibiliteit is dat een gok, maar na dit plan heb je die flexibiliteit juist wél: ${flex}. Slimme sturing verschuift je verbruik automatisch naar goedkope uren; de winst daarvan zit nog níet in de bedragen hierboven, het is dus een bonus. Vergelijk wel de opslag per kWh en de vaste kosten per leverancier.`,
        bedragen: null,
        knoppen: [
          { tekst: `Uitleg met grafiek en rekenvoorbeeld ${Iconen.svg("pijl-rechts")}`, url: "https://batterijmaatje.nl/uitleg.html#vast-of-dynamisch", extern: true },
          { tekst: `Onafhankelijke uitleg (Milieu Centraal) ${Iconen.svg("pijl-rechts")}`, url: "https://www.milieucentraal.nl/energie-besparen/inzicht-in-je-energierekening/dynamisch-energiecontract/", extern: true },
        ],
      });
    }

    return { stappen, gasNa, vastrechtNa, pompKwh };
  }

  /* ------------------------------------------------------------------
     Renderen
     ------------------------------------------------------------------ */

  /* Per stap een terugverdientijd met hetzelfde oordeel als op de
     zustersites (assets/oordeel.js): elk apparaat gemeten aan zijn eigen
     levensduur. Eén totaal voor het hele plan verstopte een batterij die
     zich niet terugverdient achter een warmtepomp die dat wel doet. */
  const DUIDING = { goed: "ruim binnen de levensduur", matig: "met weinig marge op de levensduur", slecht: "loont bij deze getallen (nog) niet" };
  function stapOordeel(stap) {
    const b = stap.bedragen;
    if (!b || !stap.soort) return null;
    // De warmtepomp en de batterij geven hun eigen terugverdientijd mee (uit
    // hun rekenkern, met veroudering en de ketel), zodat hij gelijk is aan de
    // rekenhulp; de panelen rekenen hier eenvoudig.
    const tvt = b.tvt !== undefined ? b.tvt : (b.besparing > 0 ? b.investering / b.besparing : null);
    return { tvt, oordeel: Oordeel.van(stap.soort, tvt) };
  }
  const jaar = (t) => t === null ? "niet terug" : `${t.toFixed(1).replace(".", ",")} jaar`;

  function stapKaart(stap, nummer) {
    const b = stap.bedragen;
    const o = stapOordeel(stap);
    return `
    <div class="plan-stap${o && o.oordeel === "slecht" ? " plan-stap-niet" : ""}">
      <div class="plan-stap-kop"><span class="plan-nummer">${nummer}</span><span class="plan-icoon">${stap.icoon}</span><h3>${stap.titel}</h3></div>
      <p class="plan-advies">${o && o.oordeel === "slecht" ? `<b>Bij deze getallen verdient ${({ batterij: "een thuisbatterij", warmtepomp: "een warmtepomp", zonnepanelen: "zonnepanelen" })[stap.soort]} zich niet terug binnen de levensduur, en telt deze stap niet mee in het totaal hierboven.</b> Kom hierop terug als de prijzen dalen of je situatie verandert. ` : ""}${stap.advies}</p>
      ${b ? `<div class="plan-bedragen">
        <span>Investering${b.subsidie ? " na subsidie" : ""}: <b>${eurFmt.format(b.investering)}</b>${b.subsidie ? ` <small>(ISDE − ${eurFmt.format(b.subsidie)} verrekend)</small>` : ""}</span>
        <span>Besparing: <b>${eurFmt.format(b.besparing)} per jaar</b></span>
        ${o ? `<span>Terugverdientijd: <b style="color:${Oordeel.KLEUR[o.oordeel]};">${jaar(o.tvt)}</b> <small>(${DUIDING[o.oordeel]}; een ${({ zonnepanelen: "zonnepaneel", batterij: "thuisbatterij", warmtepomp: "warmtepomp" })[stap.soort]} gaat ${Oordeel.GRENZEN[stap.soort].levensduur} mee)</small></span>` : ""}
      </div>` : ""}
      <p class="plan-knoppen">${stap.knoppen.map((k) => `<a class="knop knop-secundair" href="${k.url}"${k.extern ? ' target="_blank" rel="noopener"' : ""}>${k.tekst}</a>`).join(" ")}</p>
    </div>`;
  }

  function bereken() {
    const s = invoer();
    const { stappen } = planStappen(s);

    // Het totaal telt alleen de stappen die zich binnen hun levensduur
    // terugverdienen; een stap die dat niet doet staat er wel, met de reden.
    const nietLonend = stappen.filter((st) => { const o = stapOordeel(st); return o && o.oordeel === "slecht"; });
    const metBedragen = stappen.filter((st) => st.bedragen && !nietLonend.includes(st));
    const totInvestering = metBedragen.reduce((t, st) => t + st.bedragen.investering, 0);
    const totBesparing = metBedragen.reduce((t, st) => t + st.bedragen.besparing, 0);
    const tvt = totBesparing > 0 ? totInvestering / totBesparing : null;

    // Voor/na: energiekosten per jaar (na = voor minus alle besparingen, dus altijd consistent)
    const voor = s.gas * s.gasprijs + (s.gas > 0 ? VASTRECHT_GAS : 0) + s.stroom * s.stroomprijs;
    const na = Math.max(0, voor - totBesparing);
    const maxT = Math.max(voor, na) || 1;

    const allesGedaan = !stappen.length;

    el("planInhoud").innerHTML = allesGedaan
      ? `<p>${Iconen.svg("groen")} Mooi bezig: je hebt de grote stappen al gezet. Check mijn vergelijkers voor optimalisatie, bijvoorbeeld een <a href="omvormers.html">slimmere omvormer</a> of <a href="https://batterijmaatje.nl/" target="_blank" rel="noopener">een grotere batterij</a>.</p>`
      : `
      ${metBedragen.length ? `<div class="plan-samenvatting">
        <div class="resultaat-groot">${tvt === null ? "?" : tvt.toFixed(1).replace(".", ",") + " jaar"}</div>
        <p class="hint" style="margin: 0 0 var(--ruimte-10);">terugverdientijd van ${nietLonend.length ? `het plan zonder ${nietLonend.map((st) => ({ batterij: "de thuisbatterij", warmtepomp: "de warmtepomp", zonnepanelen: "de zonnepanelen" })[st.soort]).join(" en ")}, die bij deze getallen niet ${nietLonend.length > 1 ? "lonen" : "loont"}` : "het hele plan"}</p>
        <div class="plan-totalen">
          <span>Totale investering (na subsidie): <b>${eurFmt.format(totInvestering)}</b></span>
          <span>Totale besparing: <b>${eurFmt.format(totBesparing)} per jaar</b> <small>(≈ ${eurFmt.format(totBesparing / 12)} per maand)</small></span>
        </div>
        <div class="vgl-tabel" style="margin-top: var(--ruimte-10);">
          <div class="vgl-rij"><span class="vgl-label">Energiekosten nu</span><div class="vgl-balk"><span style="width:${(voor / maxT) * 100}%;background:var(--kleur-primair);"></span></div><b class="vgl-bedrag">${eurFmt.format(voor)}</b></div>
          <div class="vgl-rij"><span class="vgl-label">Na het plan</span><div class="vgl-balk"><span style="width:${(na / maxT) * 100}%;background:var(--kleur-groen, #16a34a);"></span></div><b class="vgl-bedrag">${eurFmt.format(na)}</b></div>
        </div>
        <p class="hint" style="margin: var(--ruimte-6) 0 0;">${Iconen.svg("tip")} Alles tegelijk hoeft niet: elke stap staat op zichzelf en bespaart direct. Veel mensen spreiden de stappen over meerdere jaren.</p>
      </div>` : ""}
      ${stappen.map((st, i) => stapKaart(st, i + 1)).join("")}
      <p class="hint" style="margin-top: var(--ruimte-10);">Indicatie op basis van vuistregels en gemiddelde prijzen; geen offerte of financieel advies. Per stap rekent de gekoppelde tool het exact voor je door. <a href="javascript:window.print()">${Iconen.svg("printen")} Plan afdrukken</a></p>
    `;
    deelPlan(metBedragen.length ? { totBesparing } : null, allesGedaan);
  }

  /* Het plan doorsturen. De invoer gaat mee in de link (assets/delen.js),
     dus wie hem opent ziet hetzelfde plan. Het bericht zelf is kort en
     noemt alleen wat het oplevert: de rest staat achter de link. */
  // Er is een deelplaatje per € 100 besparing, tot € 5.000 (zie
  // scripts/deelkaarten.mjs, PLAN_STAP en PLAN_MAX). Het bedrag eronder komt
  // erop: "ruim € 2.500" bij € 2.558.
  const PLAN_STAP = 100;
  const PLAN_MAX = 5000;
  function planSleutel(besparing) {
    const n = Math.min(PLAN_MAX, Math.floor(besparing / PLAN_STAP) * PLAN_STAP);
    return n >= PLAN_STAP ? `plan-${n}` : "plan";
  }

  function deelPlan(totaal, allesGedaan) {
    if (!window.Delen) return;
    Delen.schrijfUrl(el("planFormulier"));
    if (allesGedaan) return;
    const bericht = totaal && totaal.totBesparing > 0
      ? `Met mijn energieplan bespaar ik ${eurFmt.format(totaal.totBesparing)} per jaar. Zie mijn plan:`
      : "Zo ziet mijn energieplan eruit. Zie mijn plan:";
    Delen.uitslag(el("planInhoud"), {
      sleutel: totaal ? planSleutel(totaal.totBesparing) : "plan",
      vraag: "Laat anderen zien wat jouw plan oplevert.",
      bericht,
    });
  }

  async function init() {
    if (window.Delen) Delen.onthoud(el("planFormulier"));
    try {
      const res = await fetch("data/site/panelen.json", { cache: "no-cache" });
      if (res.ok) panelen = (await res.json()).panelen || [];
    } catch (err) { console.error("panelen.json niet geladen:", err); }
    ["gasverbruik", "stroomverbruik", "dak", "isolatie", "cvKetel", "afgifte", "woning", "contract"].forEach((id) => {
      el(id).addEventListener("input", bereken);
      el(id).addEventListener("change", bereken);
    });
    ["opwekNu", "gasprijs", "stroomprijs"].forEach((id) => {
      el(id).addEventListener("input", bereken);
      el(id).addEventListener("change", bereken);
    });
    const toonOpwek = () => { el("opwekVeld").hidden = !el("checkHeeftPanelen").checked; };
    el("checkHeeftPanelen").addEventListener("change", toonOpwek);
    toonOpwek();
    ["checkHeeftPanelen", "checkHeeftPomp", "checkHeeftBatterij"].forEach((id) => el(id).addEventListener("change", bereken));
    // Een gedeeld plan: zet de antwoorden terug voordat er gerekend wordt.
    if (window.Delen) Delen.herstel(el("planFormulier"));
    bereken();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
