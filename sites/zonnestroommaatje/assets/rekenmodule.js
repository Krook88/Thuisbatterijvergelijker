/* ==========================================================================
   Zonnestroommaatje - rekenmodule opbrengst en terugverdientijd
   Rekent per paneel en per situatie de jaaropbrengst, de besparing per
   jaar (met en zonder saldering) en de terugverdientijd uit.
   ========================================================================== */

(function () {
  "use strict";

  const el = (id) => document.getElementById(id);

  const eurFmt = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const kwhFmt = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });

  // Vaste aannames (toegelicht op de pagina onder "Hoe rekenen wij?")
  const DEGRADATIE_PER_JAAR = 0.004;   // 0,4% minder opbrengst per jaar
  const VASTE_INSTALLATIEKOSTEN = 1200; // omvormer, bekabeling, voorrijden
  const KOSTEN_PER_PANEEL = 130;        // montagemateriaal en arbeid per paneel
  const SALDERING_EINDJAAR = 2026;      // laatste jaar mét saldering
  const START_JAAR = 2026;              // aanschafjaar; telt voor een half jaar mee
  const CO2_PER_KWH = 0.27;             // kg CO2 per kWh Nederlandse stroommix (indicatie, co2emissiefactoren.nl)

  let panelen = [];

  function gekozenPaneel() {
    const id = el("keuzePaneel").value;
    return panelen.find((p) => p.id === id) || null;
  }

  function invoer() {
    const p = gekozenPaneel();
    const wpPerPaneel = p ? p.vermogen_wp : 440;
    const prijsPerPaneel = p ? (p.richtprijs_eur || 70) : 70;
    const aantal = Math.max(1, Number(el("aantalPanelen").value) || 10);
    const eigenSysteemprijs = Number(el("systeemprijs").value) || 0;
    return {
      paneel: p,
      aantal,
      wpTotaal: wpPerPaneel * aantal,
      verbruik: Math.max(1, Number(el("jaarverbruik").value) || 2900),
      factor: (Number(el("dakligging").value) || 0.9) * (Number(el("schaduw").value) || 1),
      stroomprijs: Number(el("stroomprijs").value) || 0.30,
      vergoeding: Number(el("vergoeding").value) || 0,
      terugleverkosten: Number(el("terugleverkosten").value) || 0,
      eigenPct: Math.min(100, Math.max(5, Number(el("eigenverbruik").value) || 35)) / 100,
      kosten: eigenSysteemprijs > 0 ? eigenSysteemprijs : Math.round(prijsPerPaneel * aantal + VASTE_INSTALLATIEKOSTEN + KOSTEN_PER_PANEEL * aantal),
      kostenGeschat: eigenSysteemprijs <= 0,
    };
  }

  // Besparing in één jaar mét saldering: teruglevering wegstrepen tegen afname
  function besparingMetSaldering(opwek, s) {
    const eigen = opwek * s.eigenPct;
    const teruggeleverd = opwek - eigen;
    const afnameVanNet = Math.max(0, s.verbruik - eigen);
    const gesaldeerd = Math.min(teruggeleverd, afnameVanNet);
    const overschot = teruggeleverd - gesaldeerd;
    return eigen * s.stroomprijs + gesaldeerd * s.stroomprijs + overschot * s.vergoeding - teruggeleverd * s.terugleverkosten;
  }

  // Besparing in één jaar zonder saldering: alleen direct eigen verbruik is de
  // volle stroomprijs waard; eigen verbruik kan nooit meer zijn dan je verbruik
  function besparingZonderSaldering(opwek, s) {
    const eigen = Math.min(opwek * s.eigenPct, s.verbruik);
    const teruggeleverd = opwek - eigen;
    return eigen * s.stroomprijs + teruggeleverd * (s.vergoeding - s.terugleverkosten);
  }

  function bereken() {
    const s = invoer();
    // wpTotaal is in Wp, factor in kWh per Wp per jaar; opwek dus in kWh
    const opwek = Math.round(s.wpTotaal * s.factor);

    const metSaldering = besparingMetSaldering(opwek, s);
    const zonderSaldering = besparingZonderSaldering(opwek, s);

    // Terugverdientijd: jaar voor jaar optellen, met veroudering.
    // Het aanschafjaar telt voor een half jaar mee.
    let cumulatief = 0;
    let terugverdientijd = null;
    let jaren = 0;
    for (let jaar = START_JAAR; jaar <= START_JAAR + 40; jaar++) {
      const degradatie = Math.max(0, 1 - DEGRADATIE_PER_JAAR * (jaar - START_JAAR));
      const opwekDitJaar = opwek * degradatie;
      const besparing = (jaar <= SALDERING_EINDJAAR ? besparingMetSaldering(opwekDitJaar, s) : besparingZonderSaldering(opwekDitJaar, s))
        * (jaar === START_JAAR ? 0.5 : 1);
      const vorige = cumulatief;
      cumulatief += besparing;
      jaren += jaar === START_JAAR ? 0.5 : 1;
      if (terugverdientijd === null && cumulatief >= s.kosten && besparing > 0) {
        const fractie = (s.kosten - vorige) / besparing;
        terugverdientijd = jaren - (jaar === START_JAAR ? 0.5 : 1) + fractie * (jaar === START_JAAR ? 0.5 : 1);
      }
    }

    // Totale besparing over 25 jaar (met veroudering, saldering alleen in het startjaar)
    let besparing25 = 0;
    for (let j = 0; j < 25; j++) {
      const degradatie = Math.max(0, 1 - DEGRADATIE_PER_JAAR * j);
      const opwekDitJaar = opwek * degradatie;
      besparing25 += (START_JAAR + j <= SALDERING_EINDJAAR ? besparingMetSaldering(opwekDitJaar, s) : besparingZonderSaldering(opwekDitJaar, s))
        * (j === 0 ? 0.5 : 1);
    }

    const dekking = Math.round((opwek / s.verbruik) * 100);
    const co2 = Math.round(opwek * CO2_PER_KWH);
    const p = s.paneel;

    const tvtTekst = terugverdientijd === null
      ? "meer dan 40 jaar"
      : `${terugverdientijd.toFixed(1).replace(".", ",")} jaar`;

    const overdimensionering = opwek > s.verbruik * 1.3;

    el("resultaatInhoud").innerHTML = `
      <div class="resultaat-groot">${tvtTekst}</div>
      <p class="hint" style="margin:0 0 14px;">geschatte terugverdientijd${s.kostenGeschat ? " (bij geschatte installatiekosten)" : ""}</p>
      <div class="resultaat-rij"><span>Opgesteld vermogen</span><b>${kwhFmt.format(s.wpTotaal)} Wp (${s.aantal} × ${p ? p.vermogen_wp : 440} Wp)</b></div>
      <div class="resultaat-rij"><span>Jaaropbrengst (jaar 1)</span><b>${kwhFmt.format(opwek)} kWh</b></div>
      <div class="resultaat-rij"><span>Dekking van je verbruik</span><b>${dekking}%</b></div>
      <div class="resultaat-rij"><span>Besparing per jaar t/m 2026 <small>(met saldering)</small></span><b>${eurFmt.format(metSaldering)}</b></div>
      <div class="resultaat-rij"><span>Besparing per jaar vanaf 2027</span><b>${eurFmt.format(zonderSaldering)} <small style="font-weight:400;color:var(--kleur-tekst-licht);">(≈ ${eurFmt.format(zonderSaldering / 12)} per maand)</small></b></div>
      <div class="resultaat-rij"><span>Investering ${s.kostenGeschat ? "<small>(schatting incl. montage en omvormer)</small>" : ""}</span><b>${eurFmt.format(s.kosten)}</b></div>
      <div class="resultaat-rij"><span>Totale besparing over 25 jaar</span><b>${eurFmt.format(besparing25)}</b></div>
      <div class="resultaat-rij"><span>Netto voordeel over 25 jaar</span><b>${eurFmt.format(besparing25 - s.kosten)}</b></div>
      <div class="resultaat-rij"><span>Vermeden CO₂-uitstoot per jaar <small>(indicatie)</small></span><b>circa ${kwhFmt.format(co2)} kg</b></div>
      ${overdimensionering ? `<p class="hint" style="margin-top:12px;background:var(--kleur-accent-licht);border-radius:8px;padding:10px 12px;">${Iconen.svg("let-op")} Je wekt fors meer op dan je verbruikt. Na 2027 levert dat overschot weinig op. Overweeg minder panelen, of verhoog je eigen verbruik met bijvoorbeeld een <a href="https://batterijmaatje.nl/" target="_blank" rel="noopener">thuisbatterij</a>, een <a href="https://warmtepompmaatje.nl/" target="_blank" rel="noopener">warmtepomp</a> of slim laden van een elektrische auto.</p>` : ""}
      ${p ? `<p style="margin-top:14px;"><a href="paneel/${encodeURIComponent(p.id)}.html">Alle details van de ${escapeHtml(naamVan(p))} ${Iconen.svg("pijl-rechts")}</a></p>` : ""}
      <p class="hint" style="margin-top:10px;">Indicatie op basis van jouw invoer en onze aannames; geen financieel advies.</p>
    `;
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  const naamVan = (p) => p.model.toLowerCase().startsWith(p.merk.toLowerCase()) ? p.model : `${p.merk} ${p.model}`;

  async function init() {
    try {
      const res = await fetch("data/panelen.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      panelen = (data.panelen || []).slice().sort((a, b) => naamVan(a).localeCompare(naamVan(b), "nl"));

      const select = el("keuzePaneel");
      select.innerHTML = panelen.map((p) =>
        `<option value="${escapeHtml(p.id)}">${escapeHtml(naamVan(p))} — ${p.vermogen_wp} Wp, ${eurFmt.format(p.richtprijs_eur || 0)}</option>`
      ).join("");

      // Voorselectie via ?paneel=<id>&aantal=<n> (vanuit de vergelijker,
      // paneelpagina's en de systeem-samensteller)
      const params = new URLSearchParams(location.search);
      const gevraagd = params.get("paneel");
      if (gevraagd && panelen.some((p) => p.id === gevraagd)) select.value = gevraagd;
      const gevraagdAantal = Number(params.get("aantal"));
      if (gevraagdAantal >= 1 && gevraagdAantal <= 60) el("aantalPanelen").value = gevraagdAantal;

      ["keuzePaneel", "aantalPanelen", "jaarverbruik", "dakligging", "schaduw",
       "stroomprijs", "vergoeding", "terugleverkosten", "eigenverbruik", "systeemprijs"].forEach((id) => {
        el(id).addEventListener("input", bereken);
        el(id).addEventListener("change", bereken);
      });

      bereken();
    } catch (err) {
      el("resultaatInhoud").innerHTML = '<p class="hint">De paneelgegevens konden niet worden geladen. Vernieuw de pagina of probeer het later opnieuw.</p>';
      console.error("Fout bij laden panelen.json:", err);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
