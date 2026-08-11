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
  const GASPRIJS = 1.45;            // euro per m3
  const STROOMPRIJS = 0.30;         // euro per kWh
  const VERGOEDING = 0.05;          // terugleververgoeding vanaf 2027, euro per kWh
  const TERUGLEVERKOSTEN = 0.02;    // euro per teruggeleverde kWh
  const KWH_PER_M3 = 8.8;           // nuttige warmte per m3 gas
  const VASTRECHT_GAS = 350;        // vaste gaskosten per jaar
  const AFSLUITKOSTEN = 700;        // eenmalig, bij van het gas af
  // Warmtepomp-indicaties (afgerond op de wpm-rekenmodule en ISDE 2026)
  const WP = {
    hybride: { toestel: 3300, installatie: 2500, isde: 2100, label: "hybride warmtepomp" },
    allel: { toestel: 7300, installatie: 4500, isde: 3000, label: "all-electric warmtepomp" },
  };
  // Zonnepanelen (zelfde schatting als onze rekenmodule)
  const WP_PANEEL = 440;            // wattpiek per paneel
  const OPBRENGST_FACTOR = 0.9;     // kWh per Wp per jaar (zuidoost/zuidwest)
  const VASTE_INSTALLATIE = 1200;   // omvormer, bekabeling, voorrijden
  const KOSTEN_PER_PANEEL = 130;    // montage per paneel
  const DAK_MAX = { klein: 8, gemiddeld: 12, groot: 20 };
  // Thuisbatterij (vuistregels, bron: Batterijmaatje)
  const BATTERIJ_EUR_PER_KWH = 350; // richtprijs per kWh capaciteit, incl. gangbare installatie

  let panelen = [];

  function invoer() {
    return {
      gas: Math.max(0, Number(el("gasverbruik").value) || 1200),
      stroom: Math.max(500, Number(el("stroomverbruik").value) || 2900),
      dak: el("dak").value,                     // klein | gemiddeld | groot
      isolatie: el("isolatie").value,           // goed | redelijk | matig
      cvKetel: el("cvKetel").value,             // recent | oud | geen
      afgifte: el("afgifte").value,             // vloer | mix | radiatoren
      woning: el("woning").value,               // tussen | hoek | vrijstaand
      contract: el("contract").value,           // vast | variabel | dynamisch
      heeftPanelen: el("checkHeeftPanelen").checked,
      heeftPomp: el("checkHeeftPomp").checked,
      heeftBatterij: el("checkHeeftBatterij").checked,
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
      let gasBespaard;
      if (allElectric) {
        gasBespaard = s.gas;
        const verwarmingGas = s.gas * 0.75;
        pompKwh = (verwarmingGas * KWH_PER_M3) / 4.0 + ((s.gas - verwarmingGas) * KWH_PER_M3) / 2.5;
        gasNa = 0; vastrechtNa = 0;
      } else {
        gasBespaard = s.gas * 0.6;
        pompKwh = (gasBespaard * KWH_PER_M3) / 4.5;
        gasNa = s.gas - gasBespaard;
      }
      const investering = wp.toestel + wp.installatie + (allElectric ? AFSLUITKOSTEN : 0) - wp.isde;
      const besparing = gasBespaard * GASPRIJS + (allElectric ? VASTRECHT_GAS : 0) - pompKwh * STROOMPRIJS;
      const geluidZin = s.woning !== "vrijstaand" ? " Kies een stille buitenunit: met buren op de erfgrens geldt in de nacht een eis van 40 dB." : "";
      stappen.push({
        icoon: Iconen.svg("aanbieding"), titel: `Warmtepomp: ${wp.label}`,
        advies: (allElectric
          ? (s.cvKetel === "geen"
            ? "Zonder cv-ketel is hybride niet mogelijk; all-electric is de logische keuze en levert de hoogste subsidie op."
            : s.isolatie === "goed"
              ? "Je huis is goed geïsoleerd: all-electric kan de ketel volledig vervangen en je kunt helemaal van het gas af."
              : "Met redelijke isolatie en (deels) vloerverwarming kan all-electric, mits de installateur het warmteverlies doorrekent.")
          : `${s.isolatie === "matig" ? "Bij matige isolatie" : "Met alleen radiatoren"} is hybride de veilige route: circa 60% gasbesparing, de ketel vangt piekkou en warm water op.` + (s.cvKetel === "oud" ? " Let op: je ketel is aan vervanging toe; reken een nieuwe mee of overweeg all-electric na isoleren." : "")) + geluidZin,
        bedragen: { investering, subsidie: wp.isde, besparing },
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
      const aantal = Math.max(6, Math.min(DAK_MAX[s.dak] || 12, gewenst));
      opwek = Math.round(aantal * perPaneel);
      if (pompKwh > 0) eigenPct = 0.45; // een slim aangestuurde pomp verhoogt het eigen verbruik
      const prijsPaneel = gemiddeldePaneelprijs();
      const investering = prijsPaneel * aantal + VASTE_INSTALLATIE + KOSTEN_PER_PANEEL * aantal;
      const eigen = Math.min(opwek * eigenPct, verbruikNa);
      const teruggeleverd = opwek - eigen;
      const besparing = eigen * STROOMPRIJS + teruggeleverd * (VERGOEDING - TERUGLEVERKOSTEN);
      stappen.push({
        icoon: Iconen.svg("zon"), titel: `Zonnepanelen: ${aantal} panelen (${numFmt.format(aantal * WP_PANEEL)} Wp)`,
        advies: `Gedimensioneerd op je stroomverbruik ná de warmtepomp (${numFmt.format(verbruikNa)} kWh per jaar${gewenst > aantal ? `; je dak begrenst het aantal op ${aantal}` : ""}). Jaaropbrengst circa ${numFmt.format(opwek)} kWh.`,
        bedragen: { investering, subsidie: 0, besparing },
        knoppen: [
          { tekst: `Vergelijk zonnepanelen ${Iconen.svg("pijl-rechts")}`, url: "index.html" },
          { tekst: `Bereken exact ${Iconen.svg("pijl-rechts")}`, url: `rekenmodule.html?aantal=${aantal}` },
        ],
      });
    } else {
      opwek = Math.round(s.stroom * 0.9); // aanname: bestaande panelen dekken het huidige verbruik grotendeels
    }

    // Stap 4: thuisbatterij (alleen zinvol met panelen)
    if (!s.heeftBatterij && (opwek > 0 || s.heeftPanelen)) {
      const capaciteit = pompKwh > 0 || s.heeftPomp ? 10 : 7;
      const investering = capaciteit * BATTERIJ_EUR_PER_KWH;
      // De batterij verhoogt het eigen verbruik van je opwek met circa 25 procentpunt
      const extraEigen = Math.min(opwek * 0.25, Math.max(0, verbruikNa - opwek * eigenPct));
      const besparing = extraEigen * (STROOMPRIJS - (VERGOEDING - TERUGLEVERKOSTEN));
      stappen.push({
        icoon: Iconen.svg("batterij"), titel: `Thuisbatterij: circa ${capaciteit} kWh`,
        advies: `${pompKwh > 0 || s.heeftPomp ? "Met een warmtepomp past een wat grotere batterij om de avond te overbruggen. " : ""}De batterij vangt je middagopwek op voor de avond en kan met een dynamisch contract extra verdienen op goedkope uren (die bonus rekenen wij hier niet mee).`,
        bedragen: { investering, subsidie: 0, besparing },
        knoppen: [{ tekst: `Doe de batterij-keuzehulp ${Iconen.svg("pijl-rechts")}`, url: "https://batterijmaatje.nl/advies.html", extern: true }],
      });
    }

    // Stap 5: dynamisch energiecontract (gratis stap; alleen zinvol met iets
    // slims om te sturen: warmtepomp of thuisbatterij, nu of in het plan)
    const krijgtPomp = pompKwh > 0, krijgtBatterij = stappen.some((st) => st.icoon === Iconen.svg("batterij"));
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

  function stapKaart(stap, nummer) {
    const b = stap.bedragen;
    return `
    <div class="plan-stap">
      <div class="plan-stap-kop"><span class="plan-nummer">${nummer}</span><span class="plan-icoon">${stap.icoon}</span><h3>${stap.titel}</h3></div>
      <p class="plan-advies">${stap.advies}</p>
      ${b ? `<div class="plan-bedragen">
        <span>Investering${b.subsidie ? " na subsidie" : ""}: <b>${eurFmt.format(b.investering)}</b>${b.subsidie ? ` <small>(ISDE − ${eurFmt.format(b.subsidie)} verrekend)</small>` : ""}</span>
        <span>Besparing: <b>${eurFmt.format(b.besparing)} per jaar</b></span>
      </div>` : ""}
      <p class="plan-knoppen">${stap.knoppen.map((k) => `<a class="knop knop-secundair" href="${k.url}"${k.extern ? ' target="_blank" rel="noopener"' : ""}>${k.tekst}</a>`).join(" ")}</p>
    </div>`;
  }

  function bereken() {
    const s = invoer();
    const { stappen } = planStappen(s);

    const metBedragen = stappen.filter((st) => st.bedragen);
    const totInvestering = metBedragen.reduce((t, st) => t + st.bedragen.investering, 0);
    const totBesparing = metBedragen.reduce((t, st) => t + st.bedragen.besparing, 0);
    const tvt = totBesparing > 0 ? totInvestering / totBesparing : null;

    // Voor/na: energiekosten per jaar (na = voor minus alle besparingen, dus altijd consistent)
    const voor = s.gas * GASPRIJS + (s.gas > 0 ? VASTRECHT_GAS : 0) + s.stroom * STROOMPRIJS;
    const na = Math.max(0, voor - totBesparing);
    const maxT = Math.max(voor, na) || 1;

    const allesGedaan = !stappen.length;

    el("planInhoud").innerHTML = allesGedaan
      ? `<p>${Iconen.svg("groen")} Mooi bezig: je hebt de grote stappen al gezet. Check onze vergelijkers voor optimalisatie, bijvoorbeeld een <a href="omvormers.html">slimmere omvormer</a> of <a href="https://batterijmaatje.nl/" target="_blank" rel="noopener">een grotere batterij</a>.</p>`
      : `
      ${metBedragen.length ? `<div class="plan-samenvatting">
        <div class="resultaat-groot">${tvt === null ? "?" : tvt.toFixed(1).replace(".", ",") + " jaar"}</div>
        <p class="hint" style="margin:0 0 10px;">terugverdientijd van het hele plan</p>
        <div class="plan-totalen">
          <span>Totale investering (na subsidie): <b>${eurFmt.format(totInvestering)}</b></span>
          <span>Totale besparing: <b>${eurFmt.format(totBesparing)} per jaar</b> <small>(≈ ${eurFmt.format(totBesparing / 12)} per maand)</small></span>
        </div>
        <div class="vgl-tabel" style="margin-top:12px;">
          <div class="vgl-rij"><span class="vgl-label">Energiekosten nu</span><div class="vgl-balk"><span style="width:${(voor / maxT) * 100}%;background:var(--kleur-primair);"></span></div><b class="vgl-bedrag">${eurFmt.format(voor)}</b></div>
          <div class="vgl-rij"><span class="vgl-label">Na het plan</span><div class="vgl-balk"><span style="width:${(na / maxT) * 100}%;background:var(--kleur-groen, #16a34a);"></span></div><b class="vgl-bedrag">${eurFmt.format(na)}</b></div>
        </div>
        <p class="hint" style="margin:8px 0 0;">${Iconen.svg("tip")} Alles tegelijk hoeft niet: elke stap staat op zichzelf en bespaart direct. Veel mensen spreiden de stappen over meerdere jaren.</p>
      </div>` : ""}
      ${stappen.map((st, i) => stapKaart(st, i + 1)).join("")}
      <p class="hint" style="margin-top:12px;">Indicatie op basis van vuistregels en gemiddelde prijzen; geen offerte of financieel advies. Per stap rekent de gekoppelde tool het exact voor je door. <a href="javascript:window.print()">${Iconen.svg("printen")} Plan afdrukken</a></p>
    `;
  }

  async function init() {
    try {
      const res = await fetch("data/panelen.json", { cache: "no-cache" });
      if (res.ok) panelen = (await res.json()).panelen || [];
    } catch (err) { console.error("panelen.json niet geladen:", err); }
    ["gasverbruik", "stroomverbruik", "dak", "isolatie", "cvKetel", "afgifte", "woning", "contract"].forEach((id) => {
      el(id).addEventListener("input", bereken);
      el(id).addEventListener("change", bereken);
    });
    ["checkHeeftPanelen", "checkHeeftPomp", "checkHeeftBatterij"].forEach((id) => el(id).addEventListener("change", bereken));
    bereken();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
