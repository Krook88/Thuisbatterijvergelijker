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

  // Vaste aannames (toegelicht op de pagina onder "Hoe rekenen wij?"). De som
  // zelf staat in assets/rekenkern.js, getest door scripts/rekenkern.test.mjs.
  // Eén bedrag voor omvormer, bekabeling en voorrijden. Dat is een redelijke
  // schatting zolang je niet weet welke omvormer het wordt, maar het verschil
  // is groot: een Growatt kost 540 euro en een Enphase-systeem voor twaalf
  // panelen 1.558. Komt de bezoeker uit de keuzehulp, dan weten we welke
  // omvormer erbij is geadviseerd en rekenen we met die prijs.
  const VASTE_INSTALLATIEKOSTEN = 1200; // omvormer, bekabeling, voorrijden
  const BEKABELING_EN_VOORRIJDEN = 450; // wat er overblijft als de omvormer apart geteld wordt
  const KOSTEN_PER_PANEEL = 130;        // montagemateriaal en arbeid per paneel
  const CO2_PER_KWH = 0.27;             // kg CO2 per kWh Nederlandse stroommix (indicatie, co2emissiefactoren.nl)

  let panelen = [];
  let omvormers = [];
  let gekozenOmvormer = null;

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
      terugleverkosten2026: Rekenkern.TERUGLEVERKOSTEN_2026,
      eigenPct: Math.min(100, Math.max(5, Number(el("eigenverbruik").value) || 35)) / 100,
      omvormerPrijs: gekozenOmvormer ? Prijs.systeemPrijs(gekozenOmvormer, aantal) : null,
      omvormer: gekozenOmvormer,
      kosten: eigenSysteemprijs > 0
        ? eigenSysteemprijs
        : Math.round(prijsPerPaneel * aantal + KOSTEN_PER_PANEEL * aantal
            + (gekozenOmvormer ? Prijs.systeemPrijs(gekozenOmvormer, aantal) + BEKABELING_EN_VOORRIJDEN : VASTE_INSTALLATIEKOSTEN)),
      kostenGeschat: eigenSysteemprijs <= 0,
    };
  }

  function bereken() {
    const s = invoer();
    // wpTotaal is in Wp, factor in kWh per Wp per jaar; opwek dus in kWh
    const opwek = Math.round(s.wpTotaal * s.factor);

    const band = Rekenkern.bandbreedte({ ...s, opwek }, s.kostenGeschat);
    const { metSaldering, zonderSaldering, terugverdientijd, besparing25 } = band.verwacht;

    const dekking = Math.round((opwek / s.verbruik) * 100);
    const co2 = Math.round(opwek * CO2_PER_KWH);
    const p = s.paneel;

    const getal = (t) => t.toFixed(1).replace(".", ",");
    const jaren = (t) => t === null ? "meer dan 40 jaar" : `${getal(t)} jaar`;
    // Bewust een bereik en geen enkel getal: zie Rekenkern.bandbreedte.
    const tvtTekst = band.laag === null ? "meer dan 40 jaar"
      : band.hoog === null ? `vanaf ${getal(band.laag)} jaar`
      : getal(band.laag) === getal(band.hoog) ? jaren(band.laag)
      : `${getal(band.laag)} tot ${getal(band.hoog)} jaar`;

    const overdimensionering = opwek > s.verbruik * 1.3;

    el("resultaatInhoud").innerHTML = `
      <div class="resultaat-groot">${tvtTekst}</div>
      <p class="hint" style="margin: 0 0 var(--ruimte-14);">terugverdientijd, middenscenario ${jaren(terugverdientijd)}. Het bereik komt van dezelfde som met een ongunstige en een gunstige set aannames: stroomprijs 15% hoger of lager, opbrengst 8% lager of 5% hoger, eigen verbruik 15% lager of hoger${s.kostenGeschat ? ", en de geschatte investering 20% hoger of 5% lager. Heb je een offerte? Vul de systeemprijs in, dan wordt het bereik smaller" : ""}.</p>
      <div class="resultaat-rij"><span>Opgesteld vermogen</span><b>${kwhFmt.format(s.wpTotaal)} Wp (${s.aantal} × ${p ? p.vermogen_wp : 440} Wp)</b></div>
      <div class="resultaat-rij"><span>Jaaropbrengst (jaar 1)</span><b>${kwhFmt.format(opwek)} kWh</b></div>
      <div class="resultaat-rij"><span>Dekking van je verbruik</span><b>${dekking}%</b></div>
      <div class="resultaat-rij"><span>Besparing per jaar t/m 2026 <small>(met saldering)</small></span><b>${eurFmt.format(metSaldering)}</b></div>
      <div class="resultaat-rij"><span>Besparing per jaar vanaf 2027</span><b>${eurFmt.format(zonderSaldering)} <small style="font-weight:400;color:var(--kleur-tekst-licht);">(≈ ${eurFmt.format(zonderSaldering / 12)} per maand)</small></b></div>
      <div class="resultaat-rij"><span>Investering ${s.kostenGeschat ? "<small>(schatting incl. montage en omvormer)</small>" : ""}</span><b>${eurFmt.format(s.kosten)}</b></div>
      ${s.kostenGeschat && s.omvormer ? `<p class="hint" style="margin: 0 0 var(--ruimte-6);">Inclusief de ${escapeHtml(s.omvormer.merk)} ${escapeHtml(s.omvormer.model)} uit je advies: ${eurFmt.format(s.omvormerPrijs)}${s.omvormer.panelen_per_eenheid ? ` voor ${Math.ceil(s.aantal / s.omvormer.panelen_per_eenheid)} stuks` : ""}, plus ${eurFmt.format(BEKABELING_EN_VOORRIJDEN)} bekabeling en voorrijden.</p>` : ""}
      <div class="resultaat-rij"><span>Totale besparing over 25 jaar</span><b>${eurFmt.format(besparing25)}</b></div>
      <div class="resultaat-rij"><span>Netto voordeel over 25 jaar</span><b>${eurFmt.format(besparing25 - s.kosten)}</b></div>
      <div class="resultaat-rij"><span>Vermeden CO₂-uitstoot per jaar <small>(indicatie)</small></span><b>circa ${kwhFmt.format(co2)} kg</b></div>
      ${overdimensionering ? `<p class="hint" style="margin-top: var(--ruimte-10);background:var(--kleur-accent-licht);border-radius:var(--radius-klein);padding: var(--ruimte-10) var(--ruimte-10);">${Iconen.svg("let-op")} Je wekt fors meer op dan je verbruikt. Na 2027 levert dat overschot weinig op. Overweeg minder panelen, of verhoog je eigen verbruik met bijvoorbeeld een <a href="https://batterijmaatje.nl/" target="_blank" rel="noopener">thuisbatterij</a>, een <a href="https://warmtepompmaatje.nl/" target="_blank" rel="noopener">warmtepomp</a> of slim laden van een elektrische auto.</p>` : ""}
      ${p ? `<p style="margin-top: var(--ruimte-14);"><a href="paneel/${encodeURIComponent(p.id)}.html">Alle details van de ${escapeHtml(naamVan(p))} ${Iconen.svg("pijl-rechts")}</a></p>` : ""}
      <p class="hint" style="margin-top: var(--ruimte-10);">Indicatie op basis van jouw invoer en mijn aannames; geen financieel advies.</p>
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
      const [res, resOmv] = await Promise.all([
        fetch("data/site/panelen.json", { cache: "no-cache" }),
        fetch("data/site/omvormers.json", { cache: "no-cache" }).catch(() => null),
      ]);
      if (resOmv && resOmv.ok) omvormers = (await resOmv.json()).omvormers || [];
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      panelen = (data.panelen || []).slice().sort((a, b) => naamVan(a).localeCompare(naamVan(b), "nl"));

      const select = el("keuzePaneel");
      select.innerHTML = panelen.map((p) =>
        `<option value="${escapeHtml(p.id)}">${escapeHtml(naamVan(p))} (${p.vermogen_wp} Wp, ${eurFmt.format(p.richtprijs_eur || 0)})</option>`
      ).join("");

      // Voorselectie via ?paneel=<id>&aantal=<n> (vanuit de vergelijker,
      // paneelpagina's en de systeem-samensteller)
      const params = new URLSearchParams(location.search);
      const gevraagd = params.get("paneel");
      if (gevraagd && panelen.some((p) => p.id === gevraagd)) select.value = gevraagd;
      const gevraagdAantal = Number(params.get("aantal"));
      if (gevraagdAantal >= 1 && gevraagdAantal <= 60) el("aantalPanelen").value = gevraagdAantal;
      // ?omvormer=<id> komt uit de keuzehulp: dan rekenen we met de prijs van
      // die omvormer voor dit aantal panelen in plaats van met een vast bedrag.
      const gevraagdeOmvormer = params.get("omvormer");
      if (gevraagdeOmvormer) gekozenOmvormer = omvormers.find((o) => o.id === gevraagdeOmvormer) || null;

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
