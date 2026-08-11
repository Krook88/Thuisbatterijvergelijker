/* ==========================================================================
   Zonnestroommaatje - omvormer-vergelijker
   Laadt data/omvormers.json en rendert kaarten, tabel en vergelijk-modal,
   met dezelfde logica als de panelen-vergelijker (assets/app.js).
   ========================================================================== */

(function () {
  "use strict";

  const state = {
    omvormers: [],
    panelen: [],
    weergave: "kaarten", // of "tabel"
    sortering: "koppel-score",
    tabelSortKolom: null,
    tabelSortRichting: 1,
    vergelijkSelectie: [],
    filters: { zoek: "", type: "alle", fase: "alle", merk: "alle", batterij: false, officieelHa: false },
  };

  const el = (id) => document.getElementById(id);

  const eurFmt = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const datumFmt = new Intl.DateTimeFormat("nl-NL", { dateStyle: "long" });

  // ISO-datum (2026-07-21) leesbaar maken als "21 juli 2026"
  function datumNL(iso) {
    const d = new Date(`${iso}T12:00:00`);
    return Number.isNaN(d.getTime()) ? iso : datumFmt.format(d);
  }

  const TYPE_LABEL = {
    "micro": "Micro-omvormers",
    "optimizer": "Optimizers",
    "hybride": "Hybride",
    "string": "String",
  };

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  // {status, tekst} => genormaliseerd; status is "ja", "deels" of "nee"
  function driewaardig(v) {
    if (v && typeof v === "object") return { status: v.status || "deels", tekst: v.tekst || "" };
    if (v === true) return { status: "ja", tekst: "Ja" };
    if (typeof v === "string" && v.trim()) return { status: "deels", tekst: v };
    return { status: "nee", tekst: "Nee" };
  }

  function koopUrl(a) {
    return (a && (a.affiliate_url || a.url)) || "";
  }

  function bestePrijs(o) {
    const aanbiedingen = (o.aanbiedingen || []).filter((a) => a && a.prijs_eur);
    if (aanbiedingen.length) {
      // Bij gelijke prijs wint de aanbieding met controledatum (geverifieerd)
      return aanbiedingen.reduce((min, a) => (a.prijs_eur < min.prijs_eur || (a.prijs_eur === min.prijs_eur && a.datum && !min.datum) ? a : min));
    }
    if (o.richtprijs_eur) {
      return { winkel: "richtprijs (indicatie)", prijs_eur: o.richtprijs_eur, url: o.product_url };
    }
    return null;
  }

  // Koppel-score: unieke Zonnestroommaatje-score (0 tot 6) voor hoe goed een
  // omvormer te koppelen is. Drie zaken tellen mee, elk 0-2 punten:
  //  - thuisbatterij: direct aan te sluiten (hybride/eigen lijn) = 2, via omweg = 1
  //  - slim uitlezen/aansturen: officiële integratie of open lokale API = 2,
  //    community-integratie of cloud-omweg = 1
  //  - schaduwaanpak: elektronica per paneel = 2, meerdere MPPT's = 1
  function koppelScore(o) {
    const punt = (v) => { const s = driewaardig(v).status; return s === "ja" ? 2 : s === "deels" ? 1 : 0; };
    return punt(o.batterij) + punt(o.home_assistant) + punt(o.schaduw);
  }

  function koppelScoreBadge(o) {
    const score = koppelScore(o);
    const klasse = score >= 5 ? "zeker-hoog" : score >= 3 ? "zeker-midden" : "zeker-laag";
    return `<span class="badge zeker-score ${klasse}" title="Koppel-score ${score} van 6: punten voor batterij-klaar, slim uitlezen (Home Assistant/Modbus) en schaduwaanpak (2 punten per onderdeel). Tik voor de details.">${Iconen.svg("koppeling")} Koppel-score ${score}/6</span>`;
  }

  function badgeHtml(label, waarde) {
    const d = driewaardig(waarde);
    const icoon = d.status === "ja" ? Iconen.svg("ja") : d.status === "deels" ? "~" : Iconen.svg("nee");
    return `<span class="badge ${d.status}" data-uitleg="${escapeHtml(label)}" title="${escapeHtml(d.tekst)}">${icoon} ${escapeHtml(label)}</span>`;
  }

  function zoekMatch(tekst, zoek) {
    return tekst.toLowerCase().includes(zoek.trim().toLowerCase());
  }

  /* ------------------------------------------------------------------
     Filteren, sorteren en URL-status (deelbare links, net als app.js)
     ------------------------------------------------------------------ */

  const FILTER_KEYS = ["type", "fase", "merk"];
  const CHECK_KEYS = [["batterij", "batterij"], ["officieelHa", "ha"]];

  function syncUrl() {
    const f = state.filters;
    const p = new URLSearchParams();
    FILTER_KEYS.forEach((k) => { if (f[k] !== "alle") p.set(k, f[k]); });
    if (f.zoek) p.set("zoek", f.zoek);
    CHECK_KEYS.forEach(([k, kort]) => { if (f[k]) p.set(kort, "1"); });
    if (state.sortering !== "koppel-score") p.set("sorteer", state.sortering);
    const qs = p.toString();
    history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  }

  function leesUrl() {
    const p = new URLSearchParams(location.search);
    FILTER_KEYS.forEach((k) => { if (p.get(k)) state.filters[k] = p.get(k); });
    if (p.get("zoek")) { state.filters.zoek = p.get("zoek"); const zv = el("zoekVeld"); if (zv) zv.value = state.filters.zoek; }
    CHECK_KEYS.forEach(([k, kort]) => { if (p.get(kort) === "1") state.filters[k] = true; });
    if (p.get("sorteer")) state.sortering = p.get("sorteer");
    const zet = (id, w) => { const n = el(id); if (n) n.value = w; };
    zet("filterType", state.filters.type); zet("filterFase", state.filters.fase);
    zet("filterMerk", state.filters.merk); zet("sorteer", state.sortering);
    const vink = (id, w) => { const n = el(id); if (n) n.checked = w; };
    vink("checkBatterij", state.filters.batterij); vink("checkHa", state.filters.officieelHa);
  }

  function gefilterd() {
    const f = state.filters;
    return state.omvormers.filter((o) => {
      if (f.zoek && !zoekMatch(`${o.merk} ${o.model}`, f.zoek)) return false;
      if (f.type !== "alle" && o.type !== f.type) return false;
      if (f.merk !== "alle" && o.merk !== f.merk) return false;
      if (f.fase === "1" && !/1-fase/i.test(o.fase || "")) return false;
      if (f.fase === "3" && !/3-fase/i.test(o.fase || "")) return false;
      if (f.batterij && driewaardig(o.batterij).status !== "ja") return false;
      if (f.officieelHa && driewaardig(o.home_assistant).status !== "ja") return false;
      return true;
    });
  }

  function gesorteerd(lijst) {
    const kopie = [...lijst];
    const prijsVan = (o) => { const b = bestePrijs(o); return b ? b.prijs_eur : Infinity; };
    switch (state.sortering) {
      case "prijs-oplopend": kopie.sort((a, b) => prijsVan(a) - prijsVan(b)); break;
      case "prijs-aflopend": kopie.sort((a, b) => (prijsVan(b) === Infinity ? 0 : prijsVan(b)) - (prijsVan(a) === Infinity ? 0 : prijsVan(a))); break;
      case "garantie": kopie.sort((a, b) => (b.garantie_jaar || 0) - (a.garantie_jaar || 0)); break;
      case "koppel-score": kopie.sort((a, b) => koppelScore(b) - koppelScore(a) || prijsVan(a) - prijsVan(b)); break;
    }
    return kopie;
  }

  /* ------------------------------------------------------------------
     Rendering: kaarten
     ------------------------------------------------------------------ */

  function kaartHtml(o) {
    const batterij = driewaardig(o.batterij);
    const ha = driewaardig(o.home_assistant);
    const homey = driewaardig(o.homey);
    const schaduw = driewaardig(o.schaduw);
    const geselecteerd = state.vergelijkSelectie.includes(o.id);
    const beste = bestePrijs(o);
    const uitWinkel = !!(beste && beste.winkel && !beste.winkel.startsWith("richtprijs"));
    return `
    <article class="paneel-kaart" data-id="${escapeHtml(o.id)}">
      <div class="vergelijk-checkbox-wrap">
        <label class="badge" title="Selecteer om te vergelijken (max. 3)">
          <input type="checkbox" class="vergelijk-check" data-id="${escapeHtml(o.id)}" ${geselecteerd ? "checked" : ""}> vergelijk
        </label>
      </div>
      <div class="kaart-kop">
        <div>
          <div class="merk">${escapeHtml(o.merk)}</div>
          <h3>${escapeHtml(o.model)}</h3>
          <span class="type-badge type-omv-${escapeHtml(o.type)}">${escapeHtml(TYPE_LABEL[o.type] || o.type)}</span>
        </div>
      </div>
      <div class="kaart-specs">
        <div class="spec"><span class="spec-label">Vermogen</span><span class="spec-waarde">${escapeHtml(o.vermogen_bereik || "?")}</span></div>
        <div class="spec"><span class="spec-label">Aansluiting</span><span class="spec-waarde">${escapeHtml(o.fase || "?")}</span></div>
        <div class="spec"><span class="spec-label">Garantie</span><span class="spec-waarde">${o.garantie_jaar ? o.garantie_jaar + " jaar" : "Onbekend"}</span></div>
        <div class="spec"><span class="spec-label">App</span><span class="spec-waarde">${escapeHtml(o.app || "?")}</span></div>
      </div>
      <div class="kaart-badges">
        ${koppelScoreBadge(o)}
        ${badgeHtml("Thuisbatterij", o.batterij)}
        ${badgeHtml("Home Assistant", o.home_assistant)}
        ${badgeHtml("Homey", o.homey)}
        ${badgeHtml("Schaduwaanpak", o.schaduw)}
      </div>
      <button class="details-toggle" data-id="${escapeHtml(o.id)}">Meer details</button>
      <div class="kaart-details" data-details="${escapeHtml(o.id)}" hidden>
        <dt>Thuisbatterij</dt><dd>${escapeHtml(batterij.tekst)}</dd>
        <dt>Home Assistant / slim uitlezen</dt><dd>${escapeHtml(ha.tekst)}</dd>
        <dt>Homey</dt><dd>${escapeHtml(homey.tekst)}</dd>
        <dt>Schaduwaanpak</dt><dd>${escapeHtml(schaduw.tekst)}</dd>
        ${o.opmerkingen ? `<dt>Goed om te weten</dt><dd>${escapeHtml(o.opmerkingen)}</dd>` : ""}
        ${(o.aanbiedingen || []).length ? `<dt>Verkrijgbaar bij</dt><dd><ul class="winkel-lijst">${o.aanbiedingen.map((a) => `<li><span>${escapeHtml(a.winkel)}</span><span><b>${eurFmt.format(a.prijs_eur)}</b> &nbsp;<a href="${escapeHtml(koopUrl(a))}" target="_blank" rel="noopener${a.affiliate_url ? " sponsored" : ""}">bekijk</a></span></li>`).join("")}</ul>${o.prijs_datum ? `<span class="datum-stempel" style="display:block;margin-top:8px;">Prijzen gecontroleerd: ${escapeHtml(datumNL(o.prijs_datum))}. Zonder controledatum is de prijs een indicatie.</span>` : ""}</dd>` : ""}
        ${o.product_url ? `<dt>Fabrikant</dt><dd><a href="${escapeHtml(o.product_url)}" target="_blank" rel="noopener">officiële website van ${escapeHtml(o.merk)}</a></dd>` : ""}
      </div>
      <div class="kaart-prijs">
        <div class="prijs-blok">
          <div class="prijs">${beste ? eurFmt.format(beste.prijs_eur) : "Prijs op aanvraag"}</div>
          ${beste ? `<div class="prijs-winkel">${uitWinkel ? "bij " + escapeHtml(beste.winkel) : beste.winkel}</div>` : ""}
          ${o.voorbeeld_variant ? `<div class="prijs-per-kwh">prijs voor: ${escapeHtml(o.voorbeeld_variant)}</div>` : ""}
          ${o.prijs_toelichting ? `<div class="prijs-winkel">${escapeHtml(o.prijs_toelichting)}</div>` : ""}
        </div>
      </div>
      <div class="kaart-acties">
        ${beste && beste.url ? `<a class="knop" href="${escapeHtml(koopUrl(beste))}" target="_blank" rel="noopener${beste.affiliate_url ? " sponsored" : ""}" aria-label="Bekijk de ${escapeHtml(o.merk)} ${escapeHtml(o.model)} bij ${escapeHtml(uitWinkel ? beste.winkel : "de fabrikant")}">${uitWinkel ? `Bekijk aanbieding ${Iconen.svg("pijl-rechts")}` : `Naar fabrikant ${Iconen.svg("pijl-rechts")}`}</a>` : ""}
        <a class="knop knop-secundair" href="systeem.html?omvormer=${encodeURIComponent(o.id)}" title="Combineer deze omvormer met panelen en zie de systeemprijs" aria-label="Stel een systeem samen met de ${escapeHtml(o.merk)} ${escapeHtml(o.model)}">In systeem ${Iconen.svg("pijl-rechts")}</a>
        <a class="knop knop-secundair" href="advies.html" title="Welke omvormer past bij jouw systeem? Doe de keuzehulp">Keuzehulp</a>
      </div>
    </article>`;
  }

  /* ------------------------------------------------------------------
     Rendering: tabel (zelfde opzet als de panelen-vergelijker)
     ------------------------------------------------------------------ */

  const tabelKolommen = [
    { key: "model", label: "Model", get: (o) => `${o.merk} ${o.model}` },
    { key: "type", label: "Type", get: (o) => o.type },
    { key: "vermogen", label: "Vermogen", get: (o) => o.vermogen_bereik || "" },
    { key: "prijs", label: "Prijs", get: (o) => { const b = bestePrijs(o); return b ? b.prijs_eur : Infinity; } },
    { key: "garantie", label: "Garantie", get: (o) => o.garantie_jaar || 0 },
    { key: "koppel", label: "Koppel-score", get: (o) => koppelScore(o) },
    { key: "batterij", label: "Batterij", get: (o) => driewaardig(o.batterij).status },
    { key: "ha", label: "Home Assistant", get: (o) => driewaardig(o.home_assistant).status },
    { key: "homey", label: "Homey", get: (o) => driewaardig(o.homey).status },
    { key: "actie", label: "", get: () => "" },
  ];

  function tabelHtml(lijst) {
    let rijen = [...lijst];
    if (state.tabelSortKolom) {
      const kol = tabelKolommen.find((k) => k.key === state.tabelSortKolom);
      rijen.sort((a, b) => {
        const va = kol.get(a), vb = kol.get(b);
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * state.tabelSortRichting;
        return String(va).localeCompare(String(vb), "nl") * state.tabelSortRichting;
      });
    }
    const checkCel = (v) => {
      const d = driewaardig(v);
      if (d.status === "ja") return '<span class="check-ja">' + Iconen.svg("ja") + '</span>';
      if (d.status === "deels") return `<span class="check-deels" title="${escapeHtml(d.tekst)}">~</span>`;
      return '<span class="check-nee">' + Iconen.svg("nee") + '</span>';
    };
    return `
    <table class="vergelijk-tabel">
      <thead><tr>${tabelKolommen.map((k) => `<th data-kolom="${k.key}">${k.label}${k.key !== "actie" ? ' <span class="sorteer-pijl">' + Iconen.svg("sorteren") + '</span>' : ""}</th>`).join("")}</tr></thead>
      <tbody>
        ${rijen.map((o) => {
          const beste = bestePrijs(o);
          return `<tr>
            <td><b>${escapeHtml(o.merk)}</b><br>${escapeHtml(o.model)}</td>
            <td>${escapeHtml(TYPE_LABEL[o.type] || o.type)}</td>
            <td>${escapeHtml(o.vermogen_bereik || "?")}</td>
            <td class="tabel-prijs" title="${escapeHtml(o.prijs_toelichting || "")}">${beste ? eurFmt.format(beste.prijs_eur) : "n.b."}</td>
            <td>${o.garantie_jaar ? o.garantie_jaar + " jr" : "?"}</td>
            <td title="Punten voor batterij-klaar, slim uitlezen en schaduwaanpak"><b>${koppelScore(o)}/6</b></td>
            <td>${checkCel(o.batterij)}</td>
            <td>${checkCel(o.home_assistant)}</td>
            <td>${checkCel(o.homey)}</td>
            <td>${beste && beste.url ? `<a class="knop" style="padding:7px 12px;font-size:0.85rem;" href="${escapeHtml(koopUrl(beste))}" target="_blank" rel="noopener${beste.affiliate_url ? " sponsored" : ""}">Bekijk ${Iconen.svg("pijl-rechts")}</a>` : ""}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;
  }

  /* ------------------------------------------------------------------
     Rendering: vergelijk-modal (max. 3 omvormers zij aan zij)
     ------------------------------------------------------------------ */

  function vergelijkModalHtml(items) {
    const rij = (label, fn) => `<tr><th style="text-align:left;padding:8px 10px;background:var(--kleur-achtergrond);white-space:nowrap;position:sticky;left:0;z-index:1;box-shadow:2px 0 0 var(--kleur-rand);">${label}</th>${items.map((o) => `<td style="padding:8px 10px;border-bottom:1px solid var(--kleur-rand);">${fn(o)}</td>`).join("")}</tr>`;
    const d3 = (v) => { const d = driewaardig(v); return d.status === "nee" ? `${Iconen.svg("nee")} ${escapeHtml(d.tekst === "Nee" ? "Nee" : d.tekst)}` : d.status === "deels" ? `~ ${escapeHtml(d.tekst)}` : `${Iconen.svg("ja")} ${escapeHtml(d.tekst)}`; };
    return `
      <h2>Vergelijking</h2>
      <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:0.93rem;min-width:${220 * items.length + 160}px;">
        ${rij("Model", (o) => `<b>${escapeHtml(o.merk)} ${escapeHtml(o.model)}</b>`)}
        ${rij("Type", (o) => escapeHtml(TYPE_LABEL[o.type] || o.type))}
        ${rij("Vermogen", (o) => escapeHtml(o.vermogen_bereik || "?"))}
        ${rij("Aansluiting", (o) => escapeHtml(o.fase || "?"))}
        ${rij("Prijs", (o) => { const b = bestePrijs(o); const w = b && b.winkel && !b.winkel.startsWith("richtprijs"); return `${b ? `<b>${eurFmt.format(b.prijs_eur)}</b>${w ? `<br><small>bij ${escapeHtml(b.winkel)}</small>` : "<br><small>richtprijs (indicatie)</small>"}` : "n.b."}<br><small>${escapeHtml(o.prijs_toelichting || "")}</small>`; })}
        ${rij("Koppel-score", (o) => `<b>${koppelScore(o)}/6</b>`)}
        ${rij("Thuisbatterij", (o) => d3(o.batterij))}
        ${rij("Home Assistant", (o) => d3(o.home_assistant))}
        ${rij("Homey", (o) => d3(o.homey))}
        ${rij("Schaduwaanpak", (o) => d3(o.schaduw))}
        ${rij("App", (o) => escapeHtml(o.app || "?"))}
        ${rij("Garantie", (o) => (o.garantie_jaar ? o.garantie_jaar + " jaar" : "?"))}
        ${rij("", (o) => { const b = bestePrijs(o); const w = b && b.winkel && !b.winkel.startsWith("richtprijs"); return b && b.url ? `<a class="knop" href="${escapeHtml(koopUrl(b))}" target="_blank" rel="noopener${b.affiliate_url ? " sponsored" : ""}">${w ? `Bekijk aanbieding ${Iconen.svg("pijl-rechts")}` : `Naar fabrikant ${Iconen.svg("pijl-rechts")}`}</a>` : ""; })}
      </table>
      </div>`;
  }

  /* ------------------------------------------------------------------
     Hoofd-render
     ------------------------------------------------------------------ */

  // Zelfde zoekterm ook door de panelen-vergelijker halen
  function kruisHint() {
    const doel = el("kruisHint");
    if (!doel) return;
    const zoek = state.filters.zoek.trim();
    if (!zoek || zoek.length < 2) { doel.hidden = true; return; }
    const matches = state.panelen.filter((p) => zoekMatch(`${p.merk} ${p.model}`, zoek)).slice(0, 3);
    if (!matches.length) { doel.hidden = true; return; }
    doel.hidden = false;
    doel.innerHTML = `${Iconen.svg("zon")} Ook gevonden in de <b>panelen-vergelijker</b>: ` +
      matches.map((p) => `<a href="index.html?zoek=${encodeURIComponent(zoek)}">${escapeHtml(p.merk)} ${escapeHtml(p.model)}</a>`).join(" · ");
  }

  function render() {
    syncUrl();
    kruisHint();
    const lijst = gesorteerd(gefilterd());
    el("resultatenTelling").textContent = `${lijst.length} van ${state.omvormers.length} omvormersystemen`;

    const doel = el("resultaten");
    if (!lijst.length) {
      doel.innerHTML = '<div class="leeg-melding">Geen omvormers gevonden met deze filters. Probeer een filter uit te zetten.</div>';
    } else if (state.weergave === "kaarten") {
      doel.innerHTML = `<div class="kaarten-grid">${lijst.map(kaartHtml).join("")}</div>`;
    } else {
      doel.innerHTML = `<div class="tabel-wrap">${tabelHtml(lijst)}</div>`;
    }

    const balk = el("vergelijkBalk");
    if (balk) {
      if (state.vergelijkSelectie.length >= 2) {
        balk.classList.add("zichtbaar");
        document.body.classList.add("vergelijkbalk-actief");
        el("vergelijkBalkTekst").textContent = `${state.vergelijkSelectie.length} omvormers geselecteerd`;
      } else {
        balk.classList.remove("zichtbaar");
        document.body.classList.remove("vergelijkbalk-actief");
      }
    }
  }

  /* ------------------------------------------------------------------
     Events (zelfde patroon als app.js)
     ------------------------------------------------------------------ */

  function koppelEvents() {
    [["filterType", "type"], ["filterFase", "fase"], ["filterMerk", "merk"]].forEach(([id, key]) => {
      el(id).addEventListener("change", (e) => { state.filters[key] = e.target.value; render(); });
    });
    [["checkBatterij", "batterij"], ["checkHa", "officieelHa"]].forEach(([id, key]) => {
      el(id).addEventListener("change", (e) => { state.filters[key] = e.target.checked; render(); });
    });
    el("sorteer").addEventListener("change", (e) => { state.sortering = e.target.value; render(); });

    const zoekVeld = el("zoekVeld");
    if (zoekVeld) zoekVeld.addEventListener("input", (e) => { state.filters.zoek = e.target.value; render(); });

    const reset = el("resetFilters");
    if (reset) reset.addEventListener("click", () => {
      state.filters = { zoek: "", type: "alle", fase: "alle", merk: "alle", batterij: false, officieelHa: false };
      ["filterType", "filterFase", "filterMerk"].forEach((id) => { el(id).value = "alle"; });
      ["checkBatterij", "checkHa"].forEach((id) => { el(id).checked = false; });
      if (zoekVeld) zoekVeld.value = "";
      render();
    });

    el("knopKaarten").addEventListener("click", () => { state.weergave = "kaarten"; el("knopKaarten").classList.add("actief"); el("knopTabel").classList.remove("actief"); render(); });
    el("knopTabel").addEventListener("click", () => { state.weergave = "tabel"; el("knopTabel").classList.add("actief"); el("knopKaarten").classList.remove("actief"); render(); });

    el("resultaten").addEventListener("click", (e) => {
      // Tik op een info-badge: opent de details en licht de uitleg op
      const badge = e.target.closest(".kaart-badges .badge");
      if (badge) {
        const kaart = badge.closest(".paneel-kaart");
        const details = kaart && kaart.querySelector(".kaart-details");
        const knop = kaart && kaart.querySelector(".details-toggle");
        if (!details) return;
        if (details.hidden) { details.hidden = false; if (knop) knop.textContent = "Verberg details"; }
        const label = badge.dataset.uitleg || "";
        let doel = null;
        details.querySelectorAll("dt").forEach((dt) => {
          if (!doel && label && dt.textContent.trim().startsWith(label)) doel = dt;
        });
        details.querySelectorAll(".uitgelicht").forEach((n) => n.classList.remove("uitgelicht"));
        const uitgelicht = doel ? [doel, doel.nextElementSibling] : [details];
        uitgelicht.forEach((n) => { if (n) { void n.offsetWidth; n.classList.add("uitgelicht"); } });
        (doel || details).scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      const toggle = e.target.closest(".details-toggle");
      if (toggle) {
        const details = document.querySelector(`[data-details="${toggle.dataset.id}"]`);
        if (details) {
          details.hidden = !details.hidden;
          toggle.textContent = details.hidden ? "Meer details" : "Verberg details";
        }
        return;
      }
      const th = e.target.closest("th[data-kolom]");
      if (th && th.dataset.kolom !== "actie") {
        if (state.tabelSortKolom === th.dataset.kolom) state.tabelSortRichting *= -1;
        else { state.tabelSortKolom = th.dataset.kolom; state.tabelSortRichting = 1; }
        render();
      }
    });

    el("resultaten").addEventListener("change", (e) => {
      const check = e.target.closest(".vergelijk-check");
      if (!check) return;
      const id = check.dataset.id;
      if (check.checked) {
        if (state.vergelijkSelectie.length >= 3) {
          check.checked = false;
          const tekst = el("vergelijkBalkTekst");
          const oud = tekst.textContent;
          tekst.textContent = "Maximaal 3 omvormers tegelijk; haal er eerst één weg.";
          setTimeout(() => { tekst.textContent = oud; }, 2500);
          return;
        }
        state.vergelijkSelectie.push(id);
      } else {
        state.vergelijkSelectie = state.vergelijkSelectie.filter((x) => x !== id);
      }
      render();
    });

    el("openVergelijk").addEventListener("click", () => {
      const items = state.omvormers.filter((o) => state.vergelijkSelectie.includes(o.id));
      el("vergelijkModalInhoud").innerHTML = vergelijkModalHtml(items);
      el("vergelijkModal").classList.add("open");
    });
    el("wisVergelijk").addEventListener("click", () => { state.vergelijkSelectie = []; render(); });
    el("sluitModal").addEventListener("click", () => el("vergelijkModal").classList.remove("open"));
    el("vergelijkModal").addEventListener("click", (e) => { if (e.target === el("vergelijkModal")) el("vergelijkModal").classList.remove("open"); });

    // Mobiel: filters in- en uitklappen
    const filterToggle = el("filterToggle");
    if (filterToggle) {
      filterToggle.addEventListener("click", () => {
        const balk = el("filterbalk");
        const ingeklapt = balk.classList.toggle("ingeklapt");
        filterToggle.textContent = ingeklapt ? `${Iconen.svg("zoeken")} Filteren en sorteren ` + Iconen.svg("chevron") + "" : `${Iconen.svg("zoeken")} Filteren en sorteren ` + Iconen.svg("chevron") + "";
      });
    }
  }

  /* ------------------------------------------------------------------
     Init
     ------------------------------------------------------------------ */

  async function init() {
    try {
      const res = await fetch("data/omvormers.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      state.omvormers = data.omvormers || [];

      const teller = el("tellerOmvormers");
      if (teller) teller.textContent = state.omvormers.length;

      if (data.laatst_bijgewerkt) {
        const d = new Date(data.laatst_bijgewerkt + "T12:00:00");
        const doel = el("updateDatum");
        if (doel) doel.textContent = datumFmt.format(d);
      }

      // Panelen meladen voor de gezamenlijke zoekfunctie (best effort)
      try {
        const resP = await fetch("data/panelen.json", { cache: "no-cache" });
        if (resP.ok) state.panelen = (await resP.json()).panelen || [];
      } catch { /* zoekfunctie werkt dan alleen binnen omvormers */ }

      const merken = [...new Set(state.omvormers.map((o) => o.merk))].sort((a, b) => a.localeCompare(b, "nl"));
      el("filterMerk").innerHTML = '<option value="alle">Alle merken</option>' + merken.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");

      koppelEvents();
      leesUrl(); // na het vullen van het merkenfilter, zodat ?merk=... aankomt
      render();
    } catch (err) {
      el("resultaten").innerHTML = '<div class="leeg-melding">De omvormergegevens konden niet worden geladen. Vernieuw de pagina of probeer het later opnieuw.</div>';
      console.error("Fout bij laden omvormers.json:", err);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
