/* ==========================================================================
   Zonnestroommaatje - systeem-samensteller
   Combineert een zonnepaneel (met aantal) en een omvormer, checkt of de
   combinatie technisch klopt en rekent de systeemprijs uit met per onderdeel
   de goedkoopst gevonden winkel. De compatibiliteitsregels staan onderbouwd
   op de pagina zelf (#hoe-checken-wij) en de velden komen uit
   data/omvormers.json (blok "samensteller").
   ========================================================================== */

(function () {
  "use strict";

  const el = (id) => document.getElementById(id);

  const eurFmt = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const numFmt = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });

  let panelen = [];
  let omvormers = [];

  const state = { paneel: null, omvormer: null, aantal: 8, schaduw: "geen", batterij: "nee", smart: "geen" };

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  const naamVan = (p) => p.model.toLowerCase().startsWith(p.merk.toLowerCase()) ? p.model : `${p.merk} ${p.model}`;

  function koopUrl(a) {
    return (a && (a.affiliate_url || a.url)) || "";
  }

  function bestePrijs(x) {
    const aanbiedingen = (x.aanbiedingen || []).filter((a) => a && a.prijs_eur);
    if (aanbiedingen.length) {
      // Bij gelijke prijs wint de aanbieding met controledatum (geverifieerd)
      return aanbiedingen.reduce((min, a) => (a.prijs_eur < min.prijs_eur || (a.prijs_eur === min.prijs_eur && a.datum && !min.datum) ? a : min));
    }
    if (x.richtprijs_eur) return { winkel: null, prijs_eur: x.richtprijs_eur, url: x.product_url };
    return null;
  }

  function winkelFragment(beste, suffix) {
    if (!beste) return "";
    if (!beste.winkel) return `<small>richtprijs (indicatie)${suffix || ""}</small>`;
    const url = koopUrl(beste);
    const naam = url
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener${beste.affiliate_url ? " sponsored" : ""}">${escapeHtml(beste.winkel)}</a>`
      : escapeHtml(beste.winkel);
    return `<small>goedkoopst bij ${naam}${suffix || ""}</small>`;
  }

  function driewaardig(v) {
    if (v && typeof v === "object") return { status: v.status || "deels", tekst: v.tekst || "" };
    if (v === true) return { status: "ja", tekst: "Ja" };
    if (typeof v === "string" && v.trim()) return { status: "deels", tekst: v };
    return { status: "nee", tekst: "Nee" };
  }

  /* ------------------------------------------------------------------
     URL-status: deelbare en voor te vullen links
     ------------------------------------------------------------------ */

  function leesUrl() {
    const p = new URLSearchParams(location.search);
    if (p.get("paneel")) state.paneel = p.get("paneel");
    if (p.get("omvormer")) state.omvormer = p.get("omvormer");
    const aantal = Number(p.get("aantal"));
    if (aantal >= 2 && aantal <= 60) state.aantal = aantal;
    if (["geen", "beetje", "veel"].includes(p.get("schaduw"))) state.schaduw = p.get("schaduw");
    if (["nee", "later", "ja"].includes(p.get("batterij"))) state.batterij = p.get("batterij");
    if (["geen", "home_assistant", "homey"].includes(p.get("smart"))) state.smart = p.get("smart");
  }

  function syncUrl() {
    const p = new URLSearchParams();
    p.set("paneel", state.paneel);
    p.set("omvormer", state.omvormer);
    p.set("aantal", String(state.aantal));
    if (state.schaduw !== "geen") p.set("schaduw", state.schaduw);
    if (state.batterij !== "nee") p.set("batterij", state.batterij);
    if (state.smart !== "geen") p.set("smart", state.smart);
    history.replaceState(null, "", `?${p.toString()}`);
  }

  /* ------------------------------------------------------------------
     Compatibiliteitschecks (regels met bron op de pagina zelf)
     ------------------------------------------------------------------ */

  function checks(p, o, s) {
    const lijst = [];
    const ok = (t) => lijst.push({ soort: "ok", tekst: t });
    const letOp = (t) => lijst.push({ soort: "let-op", tekst: t });
    const fout = (t) => lijst.push({ soort: "fout", tekst: t });
    const cfg = o.samensteller || {};
    const totWp = p.vermogen_wp * s.aantal;

    // 1. Maximaal paneelvermogen per micro/optimizer (datasheetgrens)
    if (cfg.max_wp_per_paneel) {
      if (p.vermogen_wp <= cfg.max_wp_per_paneel) {
        ok(`Paneelvermogen past: ${p.vermogen_wp} Wp per paneel, tot ${cfg.max_wp_per_paneel} Wp toegestaan.`);
      } else {
        fout(`Dit paneel (${p.vermogen_wp} Wp) is zwaarder dan de opgegeven grens van ${cfg.max_wp_per_paneel} Wp per ${cfg.soort === "centraal_optimizer" ? "optimizer" : "micro-omvormer"}; kies een lichter paneel of een ander omvormersysteem.`);
      }
    }

    // 2. DC/AC-verhouding voor centrale omvormers
    if ((cfg.soort === "centraal" || cfg.soort === "centraal_optimizer") && cfg.voorbeeld_ac_kw) {
      const bereik = cfg.ac_kw_bereik || [cfg.voorbeeld_ac_kw];
      const maxRatio = cfg.max_dc_ac || 1.35;
      // Aanbevolen variant: kleinste vermogen waarbij de verhouding ≤ 125% blijft
      const aanbevolen = bereik.find((kw) => totWp / (kw * 1000) <= 1.25) || bereik[bereik.length - 1];
      const ratioVoorbeeld = totWp / (cfg.voorbeeld_ac_kw * 1000);
      const ratioAanbevolen = totWp / (aanbevolen * 1000);
      const kwTekst = (kw) => String(kw).replace(".", ",");

      if (ratioAanbevolen > maxRatio) {
        fout(`${numFmt.format(totWp)} Wp is te veel voor de grootste variant in deze serie (${kwTekst(bereik[bereik.length - 1])} kW, verhouding ${Math.round(ratioAanbevolen * 100)}%); kies minder panelen of een zwaardere serie.`);
      } else if (aanbevolen !== cfg.voorbeeld_ac_kw) {
        letOp(`Kies binnen deze serie de variant van circa ${kwTekst(aanbevolen)} kW (verhouding ${Math.round(ratioAanbevolen * 100)}%). De getoonde prijs geldt voor de ${kwTekst(cfg.voorbeeld_ac_kw)} kW-variant en wijkt dus iets af.`);
      } else if (ratioVoorbeeld < 0.85) {
        letOp(`De omvormer (${kwTekst(cfg.voorbeeld_ac_kw)} kW, de kleinste met winkelprijs in deze serie) is ruim bemeten voor ${numFmt.format(totWp)} Wp (verhouding ${Math.round(ratioVoorbeeld * 100)}%). Dat werkt prima, maar je betaalt voor vermogen dat je zelden gebruikt; gangbaar is 110 tot 130% paneelvermogen.`);
      } else {
        ok(`DC/AC-verhouding past: ${numFmt.format(totWp)} Wp op ${kwTekst(cfg.voorbeeld_ac_kw)} kW is ${Math.round(ratioVoorbeeld * 100)}% (gangbaar is 110 tot 130%, tot circa ${Math.round(maxRatio * 100)}% toegestaan).`);
      }

      // 3. 1-fase of 3-fase
      const alleen1Fase = /1-fase/i.test(o.fase || "") && !/3-fase/i.test(o.fase || "");
      if (aanbevolen > 5 && alleen1Fase) {
        letOp(`Boven 5 kW omvormervermogen is verdeling over 3 fasen in Nederland de norm; deze serie is 1-fase. Overleg met je installateur of netbeheerder.`);
      } else if (aanbevolen > 5 && /3-fase/i.test(o.fase || "")) {
        ok(`Boven 5 kW is 3-fase de norm; deze serie heeft 3-fase varianten.`);
      }
    }

    if (cfg.soort === "per_paneel" || cfg.soort === "per_2_panelen") {
      ok("Micro-omvormers schalen automatisch mee met het aantal panelen; een aparte DC/AC-check is niet nodig.");
    }

    if (cfg.soort === "maatwerk") {
      letOp("Victron is een bouwdoos: panelen koppelen via aparte MPPT-laadregelaars (niet meegerekend). Laat het ontwerp door een specialist maken.");
    }

    // 4. Schaduw
    const schaduwStatus = driewaardig(o.schaduw).status;
    if (s.schaduw === "veel") {
      if (schaduwStatus === "ja") ok("Veel schaduw: dit systeem optimaliseert per paneel, precies wat je dan wilt.");
      else letOp("Veel schaduw: een centrale omvormer verliest dan relatief veel opbrengst. Overweeg micro-omvormers of optimizers.");
    } else if (s.schaduw === "beetje") {
      if (schaduwStatus === "ja") ok("Beetje schaduw: per paneel geoptimaliseerd, schaduw op één paneel kost alleen dat paneel opbrengst.");
      else ok("Beetje schaduw: met twee MPPT-trackers en een slimme legplanning meestal prima op te lossen.");
    }

    // 5. Thuisbatterij
    if (s.batterij !== "nee") {
      const b = driewaardig(o.batterij);
      if (b.status === "ja") ok(`Thuisbatterij: ${b.tekst}`);
      else if (b.status === "deels") letOp(`Thuisbatterij: ${b.tekst}`);
      else letOp(`Thuisbatterij: ${b.tekst} Een AC-gekoppelde of plug-in batterij (via de slimme meter) kan altijd.`);
    }

    // 6. Smart home
    if (s.smart === "home_assistant") {
      const d = driewaardig(o.home_assistant);
      (d.status === "ja" ? ok : d.status === "deels" ? letOp : fout)(`Home Assistant: ${d.tekst}`);
    } else if (s.smart === "homey") {
      const d = driewaardig(o.homey);
      (d.status === "ja" ? ok : letOp)(`Homey: ${d.tekst}`);
    }

    return lijst;
  }

  /* ------------------------------------------------------------------
     Prijsopbouw
     ------------------------------------------------------------------ */

  function prijsOpbouw(p, o, s) {
    const cfg = o.samensteller || {};
    const rijen = [];
    const pBest = bestePrijs(p);
    const oBest = bestePrijs(o);
    const paneelStuk = pBest ? pBest.prijs_eur : 0;
    const paneelTotaal = paneelStuk * s.aantal;
    rijen.push({
      label: `${Iconen.svg("zon")} <b>${s.aantal} ×</b> ${escapeHtml(naamVan(p))}`,
      sub: winkelFragment(pBest, ` (${eurFmt.format(paneelStuk)} per paneel)`),
      bedrag: paneelTotaal,
    });

    let omvormerTotaal = 0;
    const oStuk = oBest ? oBest.prijs_eur : 0;
    if (cfg.soort === "per_paneel" || cfg.soort === "per_2_panelen") {
      const units = cfg.soort === "per_2_panelen" ? Math.ceil(s.aantal / 2) : s.aantal;
      const unitsTotaal = units * oStuk;
      omvormerTotaal += unitsTotaal;
      rijen.push({
        label: `${Iconen.svg("stroom")} <b>${units} ×</b> ${escapeHtml(o.merk)} micro-omvormer${cfg.soort === "per_2_panelen" ? " (per 2 panelen)" : ""}`,
        sub: winkelFragment(oBest, ` (${eurFmt.format(oStuk)} per stuk)`),
        bedrag: unitsTotaal,
      });
      if (cfg.extra_per_systeem) {
        omvormerTotaal += cfg.extra_per_systeem.prijs_eur;
        rijen.push({ label: `${Iconen.svg("signaal")} ${escapeHtml(cfg.extra_per_systeem.label)} (1 per systeem)`, sub: "<small>richtprijs (indicatie)</small>", bedrag: cfg.extra_per_systeem.prijs_eur });
      }
    } else if (cfg.soort === "centraal_optimizer") {
      omvormerTotaal += oStuk;
      rijen.push({ label: `${Iconen.svg("stroom")} ${escapeHtml(o.merk)} ${escapeHtml(o.model)}`, sub: winkelFragment(oBest), bedrag: oStuk });
      if (cfg.optimizer) {
        const optTotaal = s.aantal * cfg.optimizer.prijs_eur;
        omvormerTotaal += optTotaal;
        rijen.push({ label: `${Iconen.svg("stekker")} <b>${s.aantal} ×</b> ${escapeHtml(cfg.optimizer.label)}`, sub: `<small>richtprijs circa ${eurFmt.format(cfg.optimizer.prijs_eur)} per stuk</small>`, bedrag: optTotaal });
      }
    } else {
      omvormerTotaal += oStuk;
      const kwTekst = cfg.voorbeeld_ac_kw ? ` (${String(cfg.voorbeeld_ac_kw).replace(".", ",")} kW-variant)` : "";
      rijen.push({ label: `${Iconen.svg("stroom")} ${escapeHtml(o.merk)} ${escapeHtml(o.model)}${kwTekst}`, sub: winkelFragment(oBest), bedrag: oStuk });
    }

    // Montage-indicatie: dezelfde rekensom als keuzehulp en rekenmodule
    // (montage + omvormer samen circa € 1.200 + € 130 per paneel)
    const montage = Math.max(800, 1200 + 130 * s.aantal - omvormerTotaal);
    rijen.push({ label: `${Iconen.svg("installatie")} Montage, bekabeling en meterkast (indicatie)`, sub: "", bedrag: montage });

    return { rijen, totaal: paneelTotaal + omvormerTotaal + montage };
  }

  /* ------------------------------------------------------------------
     Renderen
     ------------------------------------------------------------------ */

  function render() {
    const p = panelen.find((x) => x.id === state.paneel);
    const o = omvormers.find((x) => x.id === state.omvormer);
    if (!p || !o) return;
    syncUrl();

    el("paneelHint").textContent = `${p.vermogen_wp} Wp · ${p.uitvoering || ""} · rendement ${String(p.rendement_pct || "?").replace(".", ",")}%`;
    const TYPE_UITLEG = {
      micro: "Kleine omvormer per (twee) panelen: schaduwbestendig, geen kast aan de muur.",
      optimizer: "Centrale omvormer met een kastje per paneel: schaduwbestendig en per paneel te volgen.",
      hybride: "Eén centrale omvormer; op de hybride varianten kan een thuisbatterij rechtstreeks worden aangesloten.",
    };
    el("omvormerHint").textContent = `${TYPE_UITLEG[o.type] || ""} ${o.samensteller && o.samensteller.bron ? o.samensteller.bron : (o.vermogen_bereik || "")}`.trim();

    const s = state;
    const totWp = p.vermogen_wp * s.aantal;
    const alleChecks = checks(p, o, { aantal: s.aantal, schaduw: s.schaduw, batterij: s.batterij, smart: s.smart });
    const { rijen, totaal } = prijsOpbouw(p, o, s);
    const heeftFout = alleChecks.some((c) => c.soort === "fout");
    const icoon = { ok: Iconen.svg("ja"), "let-op": "~", fout: Iconen.svg("nee") };

    el("systeemInhoud").innerHTML = `
      <div class="advies-samenvatting">
        <div class="groot">${s.aantal} × ${escapeHtml(naamVan(p))} + ${escapeHtml(o.merk)}</div>
        <p style="margin:6px 0 0;">Totaal <b>${numFmt.format(totWp)} Wp</b> · systeemprijs circa <b>${eurFmt.format(totaal)}</b>${heeftFout ? " · " + Iconen.svg("let-op") + " let op: deze combinatie heeft een probleem, zie de checks" : ""}</p>
      </div>

      <h3 style="margin:16px 0 0;font-size:1rem;">Technische check</h3>
      <ul class="check-lijst">
        ${alleChecks.map((c) => `<li class="${c.soort}"><span class="icoon">${icoon[c.soort]}</span><span>${c.tekst}</span></li>`).join("")}
      </ul>

      <h3 style="margin:18px 0 0;font-size:1rem;">Prijsopbouw met goedkoopste winkels</h3>
      <div style="overflow-x:auto;"><table class="systeem-tabel">
        ${rijen.map((r) => `<tr><td>${r.label}${r.sub ? `<br>${r.sub}` : ""}</td><td>circa <b>${eurFmt.format(r.bedrag)}</b></td></tr>`).join("")}
        <tr class="totaal-rij"><td>Totaal zonnestroomsysteem</td><td>circa ${eurFmt.format(totaal)}</td></tr>
      </table></div>
      <p class="hint" style="margin:8px 0 0;">Prijzen zijn de goedkoopst gevonden winkelprijzen of richtprijzen (0% btw waar van toepassing, losse onderdelen soms exclusief btw). Klik op de winkel voor de actuele aanbieding en vraag altijd meerdere offertes aan.</p>

      <p style="margin:14px 0 0;display:flex;gap:8px;flex-wrap:wrap;">
        <a class="knop" href="rekenmodule.html?paneel=${encodeURIComponent(p.id)}&aantal=${s.aantal}">Bereken terugverdientijd ${Iconen.svg("pijl-rechts")}</a>
        <a class="knop knop-secundair" href="advies.html">Twijfel je? Doe de keuzehulp</a>
        <a class="knop knop-secundair" href="javascript:window.print()">${Iconen.svg("printen")} Afdrukken</a>
      </p>
      ${s.batterij !== "nee" ? `<p class="hint" style="margin:10px 0 0;">${Iconen.svg("batterij")} Batterijen vergelijken op prijs per kWh, noodstroom en slimme aansturing doe je op onze zustersite <a href="https://batterijmaatje.nl/" target="_blank" rel="noopener">Batterijmaatje.nl ${Iconen.svg("pijl-rechts")}</a> Verwarm je (straks) met een warmtepomp, dan benut die je zonnestroom extra goed; vergelijk warmtepompen op <a href="https://warmtepompmaatje.nl/" target="_blank" rel="noopener">Warmtepompmaatje ${Iconen.svg("pijl-rechts")}</a></p>` : ""}
    `;
  }

  /* ------------------------------------------------------------------
     Init
     ------------------------------------------------------------------ */

  async function init() {
    try {
      const [resP, resO] = await Promise.all([
        fetch("data/panelen.json", { cache: "no-cache" }),
        fetch("data/omvormers.json", { cache: "no-cache" }),
      ]);
      if (!resP.ok || !resO.ok) throw new Error("HTTP " + resP.status + "/" + resO.status);
      panelen = (await resP.json()).panelen || [];
      omvormers = (await resO.json()).omvormers || [];

      // Selects vullen (panelen op merk gesorteerd; omvormers op type gegroepeerd)
      const paneelSelect = el("kiesPaneel");
      paneelSelect.innerHTML = [...panelen]
        .sort((a, b) => naamVan(a).localeCompare(naamVan(b), "nl"))
        .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(naamVan(p))} (${p.vermogen_wp} Wp)</option>`).join("");

      const TYPE_LABEL = { micro: "Micro-omvormers", optimizer: "Optimizers", hybride: "Hybride en string" };
      const omvormerSelect = el("kiesOmvormer");
      omvormerSelect.innerHTML = ["micro", "optimizer", "hybride"].map((type) => {
        const groep = omvormers.filter((o) => o.type === type);
        if (!groep.length) return "";
        return `<optgroup label="${TYPE_LABEL[type]}">` +
          groep.map((o) => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.merk)} ${escapeHtml(o.model)}</option>`).join("") +
          `</optgroup>`;
      }).join("");

      // Standaard: goedkoopste paneel per Wp en een veelgekozen hybride
      const perWp = (p) => { const b = bestePrijs(p); return b && p.vermogen_wp ? b.prijs_eur / p.vermogen_wp : Infinity; };
      const goedkoopste = [...panelen].sort((a, b) => perWp(a) - perWp(b))[0];
      state.paneel = goedkoopste ? goedkoopste.id : null;
      const standaardOmvormer = omvormers.find((o) => o.id === "goodwe-et") || omvormers[0];
      state.omvormer = standaardOmvormer ? standaardOmvormer.id : null;
      leesUrl();
      if (!panelen.some((p) => p.id === state.paneel)) state.paneel = panelen[0].id;
      if (!omvormers.some((o) => o.id === state.omvormer)) state.omvormer = omvormers[0].id;

      paneelSelect.value = state.paneel;
      omvormerSelect.value = state.omvormer;
      el("kiesAantal").value = state.aantal;
      el("kiesSchaduw").value = state.schaduw;
      el("kiesBatterij").value = state.batterij;
      el("kiesSmart").value = state.smart;

      paneelSelect.addEventListener("change", (e) => { state.paneel = e.target.value; render(); });
      omvormerSelect.addEventListener("change", (e) => { state.omvormer = e.target.value; render(); });
      el("kiesAantal").addEventListener("input", (e) => {
        const n = Number(e.target.value);
        if (n >= 2 && n <= 60) { state.aantal = Math.round(n); render(); }
      });
      el("kiesSchaduw").addEventListener("change", (e) => { state.schaduw = e.target.value; render(); });
      el("kiesBatterij").addEventListener("change", (e) => { state.batterij = e.target.value; render(); });
      el("kiesSmart").addEventListener("change", (e) => { state.smart = e.target.value; render(); });

      render();
    } catch (err) {
      el("systeemInhoud").innerHTML = '<p class="hint">De gegevens konden niet worden geladen. Vernieuw de pagina of probeer het later opnieuw.</p>';
      console.error("Fout bij laden samensteller:", err);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
