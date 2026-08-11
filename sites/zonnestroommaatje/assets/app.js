/* ==========================================================================
   Zonnestroommaatje - vergelijkingslogica
   Laadt data/panelen.json en rendert kaarten, tabel en vergelijk-modal.
   ========================================================================== */

(function () {
  "use strict";

  const state = {
    panelen: [],
    omvormers: [],
    meta: {},
    weergave: "kaarten", // of "tabel"
    sortering: "prijs-per-wp",
    tabelSortKolom: null,
    tabelSortRichting: 1,
    vergelijkSelectie: [],
    filters: {
      zoek: "",
      celtype: "alle",
      vermogen: "alle",
      uitvoering: "alle",
      merk: "alle",
      fullBlack: false,
      bifaciaal: false,
      langeGarantie: false,
      aanbieding: false,
    },
  };

  const el = (id) => document.getElementById(id);

  const eurFmt = new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });

  // Prijs per wattpiek is een klein bedrag; twee decimalen nodig
  const eurWpFmt = new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const datumFmt = new Intl.DateTimeFormat("nl-NL", { dateStyle: "long" });

  /* ------------------------------------------------------------------
     Data helpers
     ------------------------------------------------------------------ */

  // Kooplink: de commissielink (affiliate) als die er is, anders de gewone
  // productlink. De prijscontrole gebruikt altijd de gewone url.
  function koopUrl(a) {
    return (a && (a.affiliate_url || a.url)) || "";
  }

  function bestePrijs(p) {
    const aanbiedingen = (p.aanbiedingen || []).filter((a) => a && a.prijs_eur);
    if (aanbiedingen.length) {
      // Bij gelijke prijs wint de aanbieding met controledatum (geverifieerd)
      return aanbiedingen.reduce((min, a) => (a.prijs_eur < min.prijs_eur || (a.prijs_eur === min.prijs_eur && a.datum && !min.datum) ? a : min));
    }
    if (p.richtprijs_eur) {
      return { winkel: p.prijs_bron || "richtprijs (indicatie)", prijs_eur: p.richtprijs_eur, url: p.product_url };
    }
    return null;
  }

  function heeftKorting(p) {
    const beste = bestePrijs(p);
    return !!(beste && p.richtprijs_eur && beste.prijs_eur < p.richtprijs_eur * 0.97);
  }

  function prijsPerWp(p) {
    const beste = bestePrijs(p);
    if (!beste || !p.vermogen_wp) return null;
    return beste.prijs_eur / p.vermogen_wp;
  }

  const CELTYPE_LABEL = {
    "topcon": "TOPCon (N-type)",
    "hjt": "HJT (heterojunctie)",
    "back-contact": "Back-contact",
    "perc": "PERC",
  };

  function celtypeLabel(p) {
    return CELTYPE_LABEL[p.celtype] || p.celtype;
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  // "Denim" + model "Denim 440 Wp" zou anders "Denim Denim 440 Wp" opleveren
  const naamVan = (p) => p.model.toLowerCase().startsWith(p.merk.toLowerCase()) ? p.model : `${p.merk} ${p.model}`;

  const nl = (n) => String(n).replace(".", ",");

  // ISO-datum (2026-07-21) leesbaar maken als "21 juli 2026"
  function datumNL(iso) {
    const d = new Date(`${iso}T12:00:00`);
    return Number.isNaN(d.getTime()) ? iso : datumFmt.format(d);
  }

  /* ------------------------------------------------------------------
     Zeker-score en sterren
     ------------------------------------------------------------------ */

  // Zeker-score: unieke Zonnestroommaatje-score voor degelijkheid (0 tot 6).
  // Drie zaken tellen mee, elk 0-2 punten:
  //  - productgarantie: 25+ jaar = 2, 20-24 jaar = 1, korter = 0
  //  - vermogensbehoud na 25 jaar: 90%+ = 2, 88,5%+ = 1, minder = 0
  //  - uitvoering: glas-glas = 2, glas-folie = 0
  // De formule staat uitgelegd op uitleg.html#zeker-score en over-ons.html.
  function zekerScore(p) {
    let score = 0;
    const g = p.garantie_product_jaar || 0;
    score += g >= 25 ? 2 : g >= 20 ? 1 : 0;
    const b = p.vermogen_behoud_25j_pct || 0;
    score += b >= 90 ? 2 : b >= 88.5 ? 1 : 0;
    score += p.uitvoering === "glas-glas" ? 2 : 0;
    return score;
  }

  function zekerScoreBadge(p) {
    const score = zekerScore(p);
    const klasse = score >= 5 ? "zeker-hoog" : score >= 3 ? "zeker-midden" : "zeker-laag";
    return `<span class="badge zeker-score ${klasse}" title="Zeker-score ${score} van 6: punten voor productgarantie, vermogensbehoud na 25 jaar en glas-glas uitvoering (2 punten per onderdeel). Tik voor de details.">${Iconen.svg("veiligheid")} Zeker-score ${score}/6</span>`;
  }

  // Sterren voor opbrengst per vierkante meter dak (vermogensdichtheid).
  // Het rendement bepaalt direct hoeveel Wp er op een m² dak past:
  // 22% rendement = 220 Wp per m² paneel.
  function dakSterren(p) {
    const r = p.rendement_pct || 0;
    return r >= 22.8 ? 5 : r >= 22.4 ? 4 : r >= 22.0 ? 3 : r >= 21.5 ? 2 : 1;
  }

  function sterren(score) {
    const s = Math.max(0, Math.min(5, Math.round(score || 0)));
    // Gevulde en lege ster komen uit dezelfde icoonset, zodat ze precies
    // dezelfde vorm hebben in plaats van twee losse tekens.
    const ster = (gevuld) => Iconen.svg("ster", { gevuld });
    return `<span class="sterren-rij" role="img" aria-label="${s} van 5 sterren">${ster(true).repeat(s)}${ster(false).repeat(5 - s)}</span>`;
  }

  function jaNeeBadge(label, waarde, titelJa, titelNee) {
    const status = waarde ? "ja" : "nee";
    const icoon = Iconen.svg(waarde ? "ja" : "nee");
    const titel = waarde ? (titelJa || "Ja") : (titelNee || "Nee");
    return `<span class="badge ${status}" data-uitleg="${escapeHtml(label)}" title="${escapeHtml(titel)}">${icoon} ${escapeHtml(label)}</span>`;
  }

  /* ------------------------------------------------------------------
     Filteren en sorteren
     ------------------------------------------------------------------ */

  function vermogenInBereik(wp, bereik) {
    switch (bereik) {
      case "klein": return wp < 430;
      case "middel": return wp >= 430 && wp <= 449;
      case "groot": return wp >= 450;
      default: return true;
    }
  }

  /* Filter- en sorteerstatus in de URL: back-navigatie behoudt de context en
     een gefilterde lijst is deelbaar als link. */
  const FILTER_KEYS = ["celtype", "vermogen", "uitvoering", "merk"];
  const CHECK_KEYS = [["fullBlack", "fullblack"], ["bifaciaal", "bifaciaal"], ["langeGarantie", "garantie"], ["aanbieding", "aanbieding"]];

  function syncUrl() {
    const f = state.filters;
    const p = new URLSearchParams();
    FILTER_KEYS.forEach((k) => { if (f[k] !== "alle") p.set(k, f[k]); });
    if (f.zoek) p.set("zoek", f.zoek);
    CHECK_KEYS.forEach(([k, kort]) => { if (f[k]) p.set(kort, "1"); });
    if (state.sortering !== "prijs-per-wp") p.set("sorteer", state.sortering);
    const qs = p.toString();
    history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  }

  function leesUrl() {
    const p = new URLSearchParams(location.search);
    FILTER_KEYS.forEach((k) => { if (p.get(k)) state.filters[k] = p.get(k); });
    if (p.get("zoek")) { state.filters.zoek = p.get("zoek"); const zv = el("zoekVeld"); if (zv) zv.value = state.filters.zoek; }
    CHECK_KEYS.forEach(([k, kort]) => { if (p.get(kort) === "1") state.filters[k] = true; });
    if (p.get("sorteer")) state.sortering = p.get("sorteer");
    // Formulier gelijkzetten met de ingelezen status
    const zet = (id, w) => { const n = el(id); if (n) n.value = w; };
    zet("filterCeltype", state.filters.celtype); zet("filterVermogen", state.filters.vermogen);
    zet("filterUitvoering", state.filters.uitvoering); zet("filterMerk", state.filters.merk);
    zet("sorteer", state.sortering);
    const vink = (id, w) => { const n = el(id); if (n) n.checked = w; };
    vink("checkFullBlack", state.filters.fullBlack);
    vink("checkBifaciaal", state.filters.bifaciaal);
    vink("checkGarantie", state.filters.langeGarantie);
    vink("checkAanbieding", state.filters.aanbieding);
  }

  function zoekMatch(tekst, zoek) {
    return tekst.toLowerCase().includes(zoek.trim().toLowerCase());
  }

  function gefilterd() {
    const f = state.filters;
    return state.panelen.filter((p) => {
      if (f.zoek && !zoekMatch(`${p.merk} ${p.model}`, f.zoek)) return false;
      if (f.celtype !== "alle" && p.celtype !== f.celtype) return false;
      if (f.merk !== "alle" && p.merk !== f.merk) return false;
      if (f.uitvoering !== "alle" && p.uitvoering !== f.uitvoering) return false;
      if (!vermogenInBereik(p.vermogen_wp || 0, f.vermogen)) return false;
      if (f.fullBlack && !p.full_black) return false;
      if (f.bifaciaal && !p.bifaciaal) return false;
      if (f.langeGarantie && (p.garantie_product_jaar || 0) < 25) return false;
      if (f.aanbieding && !heeftKorting(p)) return false;
      return true;
    });
  }

  function gesorteerd(lijst) {
    const kopie = [...lijst];
    const prijsVan = (p) => { const b = bestePrijs(p); return b ? b.prijs_eur : Infinity; };
    switch (state.sortering) {
      case "prijs-oplopend": kopie.sort((a, b) => prijsVan(a) - prijsVan(b)); break;
      case "prijs-aflopend": kopie.sort((a, b) => prijsVan(b) - prijsVan(a)); break;
      case "prijs-per-wp": kopie.sort((a, b) => (prijsPerWp(a) || Infinity) - (prijsPerWp(b) || Infinity)); break;
      case "vermogen": kopie.sort((a, b) => (b.vermogen_wp || 0) - (a.vermogen_wp || 0)); break;
      case "rendement": kopie.sort((a, b) => (b.rendement_pct || 0) - (a.rendement_pct || 0)); break;
      case "garantie": kopie.sort((a, b) => (b.garantie_product_jaar || 0) - (a.garantie_product_jaar || 0)); break;
      case "zeker-score": kopie.sort((a, b) => zekerScore(b) - zekerScore(a) || (prijsPerWp(a) || Infinity) - (prijsPerWp(b) || Infinity)); break;
    }
    return kopie;
  }

  /* ------------------------------------------------------------------
     Rendering: kaarten
     ------------------------------------------------------------------ */

  // Merklogo: toont het officiële logo naast de merknaam zodra het bestand in
  // assets/logos/ staat en is geregistreerd in data/panelen.json (merk_logos).
  function merkHtml(p) {
    const logo = (state.meta.merk_logos || {})[p.merk];
    return logo
      ? `<img class="merk-logo" src="${escapeHtml(logo)}" alt="" loading="lazy"> ${escapeHtml(p.merk)}`
      : escapeHtml(p.merk);
  }

  function kaartHtml(p) {
    const beste = bestePrijs(p);
    const korting = heeftKorting(p);
    const perWp = prijsPerWp(p);
    const geselecteerd = state.vergelijkSelectie.includes(p.id);
    const wpPerM2 = p.rendement_pct ? Math.round(p.rendement_pct * 10) : null;

    return `
    <article class="paneel-kaart" data-id="${escapeHtml(p.id)}">
      <div class="vergelijk-checkbox-wrap">
        <label class="badge" title="Selecteer om te vergelijken (max. 3)">
          <input type="checkbox" class="vergelijk-check" data-id="${escapeHtml(p.id)}" ${geselecteerd ? "checked" : ""}> vergelijk
        </label>
      </div>
      <div class="kaart-kop">
        <div>
          <div class="merk">${merkHtml(p)}</div>
          <h3><a href="paneel/${encodeURIComponent(p.id)}.html" style="color:inherit;text-decoration:none;" title="Alle details van de ${escapeHtml(naamVan(p))}">${escapeHtml(p.model)}</a></h3>
          <a class="term-link" href="uitleg.html#${escapeHtml(p.celtype)}" title="Wat betekent dit celtype? Lees de uitleg in de woordenlijst"><span class="type-badge type-${escapeHtml(p.celtype)}">${escapeHtml(celtypeLabel(p))}</span></a>
        </div>
        ${korting ? '<span class="aanbieding-vlag">Aanbieding</span>' : ""}
      </div>
      <div class="kaart-specs">
        <div class="spec"><span class="spec-label"><a class="term-link" href="uitleg.html#wattpiek" title="Wat is wattpiek (Wp)? Lees de uitleg">Vermogen</a></span><span class="spec-waarde">${p.vermogen_wp ? p.vermogen_wp + " Wp" : "Onbekend"}</span></div>
        <div class="spec"><span class="spec-label"><a class="term-link" href="uitleg.html#rendement" title="Wat is rendement? Lees de uitleg">Rendement</a></span><span class="spec-waarde">${p.rendement_pct ? nl(p.rendement_pct) + "%" : "Onbekend"}</span></div>
        <div class="spec"><span class="spec-label"><a class="term-link" href="uitleg.html#glas-glas" title="Glas-glas of glas-folie? Lees de uitleg">Uitvoering</a></span><span class="spec-waarde">${escapeHtml(p.uitvoering || "Onbekend")}</span></div>
        <div class="spec"><span class="spec-label">Productgarantie</span><span class="spec-waarde">${p.garantie_product_jaar ? p.garantie_product_jaar + " jaar" : "Onbekend"}</span></div>
      </div>
      <div class="koppelgemak" title="Hoeveel vermogen past er per vierkante meter dak? 5 sterren = zeer hoog rendement, dus maximale opbrengst op een klein dak.">
        <span class="spec-label" style="font-size:0.75rem;color:var(--kleur-tekst-licht);font-weight:600;text-transform:uppercase;">Opbrengst per m² dak</span><br>
        <span class="sterren">${sterren(dakSterren(p))}</span>
        <div class="uitleg">${wpPerM2 ? `Circa ${wpPerM2} Wp per m² paneeloppervlak.` : ""} ${escapeHtml(p.opmerkingen ? "" : "")}</div>
      </div>
      <div class="kaart-badges">
        ${zekerScoreBadge(p)}
        ${jaNeeBadge("Glas-glas", p.uitvoering === "glas-glas", "Glas aan beide zijden: beter bestand tegen vocht en microscheurtjes", "Glas-folie: lichter en goedkoper, maar kwetsbaarder op lange termijn")}
        ${jaNeeBadge("Full black", p.full_black, "Volledig zwart paneel: cellen, folie en frame", "Niet volledig zwart uitgevoerd")}
        ${jaNeeBadge("Bifaciaal", p.bifaciaal, "Vangt ook licht via de achterkant, interessant bij plat dak", "Alleen de voorzijde vangt licht")}
      </div>
      <button class="details-toggle" data-id="${escapeHtml(p.id)}" aria-label="Meer details over de ${escapeHtml(naamVan(p))}">Meer details</button>
      <div class="kaart-details" data-details="${escapeHtml(p.id)}" hidden>
        <dt>Vermogensgarantie</dt><dd>${p.garantie_vermogen_jaar ? `${p.garantie_vermogen_jaar} jaar; minimaal ${nl(p.vermogen_behoud_eind_pct || "?")}% van het oorspronkelijke vermogen aan het einde` : "Onbekend"}</dd>
        <dt>Vermogensbehoud na 25 jaar</dt><dd>${p.vermogen_behoud_25j_pct ? `circa ${nl(p.vermogen_behoud_25j_pct)}% (volgens fabrieksgarantie)` : "Onbekend"}</dd>
        <dt>Temperatuurcoëfficiënt</dt><dd>${p.temp_coefficient ? `${nl(p.temp_coefficient)}% per °C (dichter bij nul is beter bij warmte)` : "Onbekend"}</dd>
        <dt>Afmetingen en gewicht</dt><dd>${escapeHtml(p.afmetingen_mm || "?")} mm${p.gewicht_kg ? `, circa ${nl(p.gewicht_kg)} kg` : ""}</dd>
        ${p.opmerkingen ? `<dt>Goed om te weten</dt><dd>${escapeHtml(p.opmerkingen)}</dd>` : ""}
        ${(p.aanbiedingen || []).length ? `<dt>Verkrijgbaar bij</dt><dd><ul class="winkel-lijst">${p.aanbiedingen.map((a) => `<li><span>${escapeHtml(a.winkel)}</span><span><b>${eurFmt.format(a.prijs_eur)}</b> &nbsp;<a href="${escapeHtml(koopUrl(a))}" target="_blank" rel="noopener${a.affiliate_url ? " sponsored" : ""}">bekijk</a></span></li>`).join("")}</ul></dd>` : ""}
        ${p.product_url ? `<dt>Fabrikant</dt><dd><a href="${escapeHtml(p.product_url)}" target="_blank" rel="noopener">officiële website van ${escapeHtml(p.merk)}</a></dd>` : ""}
        ${p.prijs_datum ? `<dd class="datum-stempel" style="margin-top:8px;">Richtprijs gecontroleerd: ${escapeHtml(datumNL(p.prijs_datum))}</dd>` : ""}
      </div>
      <div class="kaart-prijs">
        <div class="prijs-blok">
          ${korting ? `<div class="van-prijs">${eurFmt.format(p.richtprijs_eur)}</div>` : ""}
          <div class="prijs">${beste ? eurFmt.format(beste.prijs_eur) : "Prijs op aanvraag"}</div>
          ${perWp ? `<div class="prijs-per-kwh">${eurWpFmt.format(perWp)} per Wp</div>` : ""}
          ${beste && beste.winkel ? `<div class="prijs-winkel">${beste.winkel.startsWith("richtprijs") ? beste.winkel : "bij " + escapeHtml(beste.winkel)}</div>` : ""}
          ${p.prijs_omvat ? `<div class="prijs-winkel">${escapeHtml(p.prijs_omvat)}</div>` : ""}
        </div>
      </div>
      <div class="kaart-acties">
        ${beste && beste.url ? `<a class="knop" href="${escapeHtml(koopUrl(beste))}" target="_blank" rel="noopener${beste.affiliate_url ? " sponsored" : ""}" aria-label="Bekijk de ${escapeHtml(naamVan(p))} bij ${escapeHtml(beste.winkel || "de aanbieder")}">${beste.winkel && !beste.winkel.startsWith("richtprijs") ? "Bekijk aanbieding " + Iconen.svg("pijl-rechts") + "" : "Naar fabrikant " + Iconen.svg("pijl-rechts") + ""}</a>` : ""}
        <a class="knop knop-secundair" href="systeem.html?paneel=${encodeURIComponent(p.id)}" title="Combineer dit paneel met een omvormer en zie de systeemprijs" aria-label="Stel een systeem samen met de ${escapeHtml(naamVan(p))}">In systeem ${Iconen.svg("pijl-rechts")}</a>
        <a class="knop knop-secundair" href="rekenmodule.html?paneel=${encodeURIComponent(p.id)}" title="Bereken de terugverdientijd van dit paneel voor jouw dak" aria-label="Bereken de terugverdientijd van de ${escapeHtml(naamVan(p))}">Terugverdientijd</a>
      </div>
      ${beste && beste.affiliate_url ? `<div class="datum-stempel" style="padding:0 20px 12px;">Dit is een commissielink: kost jou niets, beïnvloedt de vergelijking niet. <a href="over-ons.html">Uitleg</a></div>` : ""}
    </article>`;
  }

  /* ------------------------------------------------------------------
     Rendering: tabel
     ------------------------------------------------------------------ */

  const tabelKolommen = [
    { key: "model", label: "Model", get: (p) => naamVan(p) },
    { key: "wp", label: "Wp", get: (p) => p.vermogen_wp || 0 },
    { key: "rendement", label: "Rendement", get: (p) => p.rendement_pct || 0 },
    { key: "celtype", label: "Celtype", get: (p) => p.celtype },
    { key: "prijs", label: "Prijs", get: (p) => { const b = bestePrijs(p); return b ? b.prijs_eur : Infinity; } },
    { key: "perwp", label: "€/Wp", get: (p) => prijsPerWp(p) || Infinity },
    { key: "uitvoering", label: "Glas-glas", get: (p) => (p.uitvoering === "glas-glas" ? 1 : 0) },
    { key: "garantie", label: "Garantie", get: (p) => p.garantie_product_jaar || 0 },
    { key: "zeker", label: "Zeker-score", get: (p) => zekerScore(p) },
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
    return `
    <table class="vergelijk-tabel">
      <thead><tr>${tabelKolommen.map((k) => `<th data-kolom="${k.key}">${k.label}${k.key !== "actie" ? ' <span class="sorteer-pijl">' + Iconen.svg("sorteren") + '</span>' : ""}</th>`).join("")}</tr></thead>
      <tbody>
        ${rijen.map((p) => {
          const beste = bestePrijs(p);
          const perWp = prijsPerWp(p);
          return `<tr>
            <td><b>${merkHtml(p)}</b><br><a href="paneel/${encodeURIComponent(p.id)}.html">${escapeHtml(p.model)}</a></td>
            <td>${p.vermogen_wp || "?"}</td>
            <td>${p.rendement_pct ? nl(p.rendement_pct) + "%" : "?"}</td>
            <td>${escapeHtml(celtypeLabel(p))}</td>
            <td class="tabel-prijs" title="${escapeHtml(p.prijs_omvat || "")}">${beste ? eurFmt.format(beste.prijs_eur) : "n.b."}${heeftKorting(p) ? ' <span class="aanbieding-vlag">deal</span>' : ""}</td>
            <td>${perWp ? eurWpFmt.format(perWp) : "n.b."}</td>
            <td>${p.uitvoering === "glas-glas" ? '<span class="check-ja">' + Iconen.svg("ja") + '</span>' : '<span class="check-nee">' + Iconen.svg("nee") + '</span>'}</td>
            <td>${p.garantie_product_jaar ? p.garantie_product_jaar + " jr" : "?"}</td>
            <td title="Punten voor productgarantie, vermogensbehoud en glas-glas"><b>${zekerScore(p)}/6</b></td>
            <td>${beste && beste.url ? `<a class="knop" style="padding:7px 12px;font-size:0.85rem;" href="${escapeHtml(koopUrl(beste))}" target="_blank" rel="noopener${beste.affiliate_url ? " sponsored" : ""}" aria-label="Bekijk de ${escapeHtml(naamVan(p))}">Bekijk ${Iconen.svg("pijl-rechts")}</a>` : ""}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;
  }

  /* ------------------------------------------------------------------
     Rendering: vergelijk-modal
     ------------------------------------------------------------------ */

  function vergelijkModalHtml(items) {
    // Eerste kolom sticky, zodat de labels leesbaar blijven bij horizontaal scrollen op een telefoon
    const rij = (label, fn) => `<tr><th style="text-align:left;padding:8px 10px;background:var(--kleur-achtergrond);white-space:nowrap;position:sticky;left:0;z-index:1;box-shadow:2px 0 0 var(--kleur-rand);">${label}</th>${items.map((p) => `<td style="padding:8px 10px;border-bottom:1px solid var(--kleur-rand);">${fn(p)}</td>`).join("")}</tr>`;
    const jaNee = (v) => (v ? `${Iconen.svg("ja")} Ja` : `${Iconen.svg("nee")} Nee`);
    return `
      <h2>Vergelijking</h2>
      <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:0.93rem;min-width:${220 * items.length + 160}px;">
        ${rij("Model", (p) => `<b>${escapeHtml(naamVan(p))}</b>`)}
        ${rij("Celtype", (p) => escapeHtml(celtypeLabel(p)))}
        ${rij("Vermogen", (p) => (p.vermogen_wp ? p.vermogen_wp + " Wp" : "?"))}
        ${rij("Rendement", (p) => (p.rendement_pct ? nl(p.rendement_pct) + "%" : "?"))}
        ${rij("Prijs", (p) => { const b = bestePrijs(p); return b ? `<b>${eurFmt.format(b.prijs_eur)}</b>` : "n.b."; })}
        ${rij("Prijs per Wp", (p) => { const w = prijsPerWp(p); return w ? eurWpFmt.format(w) : "n.b."; })}
        ${rij("Uitvoering", (p) => escapeHtml(p.uitvoering || "?"))}
        ${rij("Full black", (p) => jaNee(p.full_black))}
        ${rij("Bifaciaal", (p) => jaNee(p.bifaciaal))}
        ${rij("Zeker-score", (p) => `<b>${zekerScore(p)}/6</b>`)}
        ${rij("Productgarantie", (p) => (p.garantie_product_jaar ? p.garantie_product_jaar + " jaar" : "?"))}
        ${rij("Vermogensgarantie", (p) => (p.garantie_vermogen_jaar ? `${p.garantie_vermogen_jaar} jaar (${nl(p.vermogen_behoud_eind_pct || "?")}%)` : "?"))}
        ${rij("Behoud na 25 jaar", (p) => (p.vermogen_behoud_25j_pct ? `circa ${nl(p.vermogen_behoud_25j_pct)}%` : "?"))}
        ${rij("Temperatuurcoëfficiënt", (p) => (p.temp_coefficient ? `${nl(p.temp_coefficient)}%/°C` : "?"))}
        ${rij("Afmetingen (mm)", (p) => escapeHtml(p.afmetingen_mm || "?"))}
        ${rij("Gewicht", (p) => (p.gewicht_kg ? `circa ${nl(p.gewicht_kg)} kg` : "?"))}
        ${rij("", (p) => { const b = bestePrijs(p); return b && b.url ? `<a class="knop" href="${escapeHtml(koopUrl(b))}" target="_blank" rel="noopener${b.affiliate_url ? " sponsored" : ""}">Bekijk ${Iconen.svg("pijl-rechts")}</a>` : ""; })}
      </table>
      </div>`;
  }

  /* ------------------------------------------------------------------
     Hoofd-render
     ------------------------------------------------------------------ */

  // Dezelfde zoekterm ook door de omvormer-vergelijker halen, zodat zoeken
  // op bijvoorbeeld "SMA" of "Enphase" je naar de juiste pagina wijst.
  function kruisHint() {
    const doel = el("kruisHint");
    if (!doel) return;
    const zoek = state.filters.zoek.trim();
    if (!zoek || zoek.length < 2) { doel.hidden = true; return; }
    const matches = state.omvormers.filter((o) => zoekMatch(`${o.merk} ${o.model}`, zoek)).slice(0, 3);
    if (!matches.length) { doel.hidden = true; return; }
    doel.hidden = false;
    doel.innerHTML = `${Iconen.svg("stroom")} Ook gevonden in de <b>omvormer-vergelijker</b>: ` +
      matches.map((o) => `<a href="omvormers.html?zoek=${encodeURIComponent(zoek)}">${escapeHtml(o.merk)} ${escapeHtml(o.model)}</a>`).join(" · ");
  }

  function render() {
    syncUrl();
    kruisHint();
    const lijst = gesorteerd(gefilterd());
    el("resultatenTelling").textContent = `${lijst.length} van ${state.panelen.length} zonnepanelen`;

    const doel = el("resultaten");
    if (!lijst.length) {
      doel.innerHTML = '<div class="leeg-melding">Geen panelen gevonden met deze filters. Probeer een filter uit te zetten.</div>';
    } else if (state.weergave === "kaarten") {
      doel.innerHTML = `<div class="kaarten-grid">${lijst.map(kaartHtml).join("")}</div>`;
    } else {
      doel.innerHTML = `<div class="tabel-wrap">${tabelHtml(lijst)}</div>`;
    }

    // Vergelijk-balk (+ ruimte onderaan de pagina zodat de footer bereikbaar blijft)
    const balk = el("vergelijkBalk");
    if (state.vergelijkSelectie.length >= 2) {
      balk.classList.add("zichtbaar");
      document.body.classList.add("vergelijkbalk-actief");
      el("vergelijkBalkTekst").textContent = `${state.vergelijkSelectie.length} panelen geselecteerd`;
    } else {
      balk.classList.remove("zichtbaar");
      document.body.classList.remove("vergelijkbalk-actief");
    }
  }

  /* ------------------------------------------------------------------
     Events
     ------------------------------------------------------------------ */

  function koppelEvents() {
    ["filterCeltype", "filterVermogen", "filterUitvoering", "filterMerk"].forEach((id) => {
      el(id).addEventListener("change", (e) => {
        const map = { filterCeltype: "celtype", filterVermogen: "vermogen", filterUitvoering: "uitvoering", filterMerk: "merk" };
        state.filters[map[id]] = e.target.value;
        render();
      });
    });

    [["checkFullBlack", "fullBlack"], ["checkBifaciaal", "bifaciaal"], ["checkGarantie", "langeGarantie"], ["checkAanbieding", "aanbieding"]].forEach(([id, key]) => {
      el(id).addEventListener("change", (e) => { state.filters[key] = e.target.checked; render(); });
    });

    el("sorteer").addEventListener("change", (e) => { state.sortering = e.target.value; render(); });

    const zoekVeld = el("zoekVeld");
    if (zoekVeld) zoekVeld.addEventListener("input", (e) => { state.filters.zoek = e.target.value; render(); });

    // Mobiel: filters in- en uitklappen
    const filterToggle = el("filterToggle");
    if (filterToggle) {
      filterToggle.addEventListener("click", () => {
        const balk = el("filterbalk");
        const ingeklapt = balk.classList.toggle("ingeklapt");
        filterToggle.textContent = ingeklapt ? "" + Iconen.svg("zoeken") + " Filteren en sorteren " + Iconen.svg("chevron") + "" : "" + Iconen.svg("zoeken") + " Filteren en sorteren " + Iconen.svg("chevron") + "";
      });
    }

    el("resetFilters").addEventListener("click", () => {
      state.filters = { zoek: "", celtype: "alle", vermogen: "alle", uitvoering: "alle", merk: "alle", fullBlack: false, bifaciaal: false, langeGarantie: false, aanbieding: false };
      const zv = el("zoekVeld"); if (zv) zv.value = "";
      el("filterCeltype").value = "alle"; el("filterVermogen").value = "alle";
      el("filterUitvoering").value = "alle"; el("filterMerk").value = "alle";
      ["checkFullBlack", "checkBifaciaal", "checkGarantie", "checkAanbieding"].forEach((id) => { el(id).checked = false; });
      render();
    });

    el("knopKaarten").addEventListener("click", () => { state.weergave = "kaarten"; el("knopKaarten").classList.add("actief"); el("knopTabel").classList.remove("actief"); render(); });
    el("knopTabel").addEventListener("click", () => { state.weergave = "tabel"; el("knopTabel").classList.add("actief"); el("knopKaarten").classList.remove("actief"); render(); });

    // Gedelegeerde events voor dynamische content
    el("resultaten").addEventListener("click", (e) => {
      // Tik op een info-badge (zoals "✓ Glas-glas"): opent de details en
      // springt naar de bijbehorende uitleg, die even oplicht zodat er altijd
      // zichtbaar iets gebeurt (ook als de details al open stonden).
      const badge = e.target.closest(".kaart-badges .badge");
      if (badge) {
        const kaart = badge.closest(".paneel-kaart");
        const details = kaart && kaart.querySelector(".kaart-details");
        const knop = kaart && kaart.querySelector(".details-toggle");
        if (!details) return;
        if (details.hidden) {
          details.hidden = false;
          if (knop) knop.textContent = "Verberg details";
        }
        const label = badge.dataset.uitleg || "";
        let doel = null;
        details.querySelectorAll("dt").forEach((dt) => {
          if (!doel && label && dt.textContent.trim().startsWith(label)) doel = dt;
        });
        details.classList.remove("uitgelicht");
        details.querySelectorAll(".uitgelicht").forEach((el2) => el2.classList.remove("uitgelicht"));
        const uitgelicht = doel ? [doel, doel.nextElementSibling] : [details];
        uitgelicht.forEach((el2) => {
          if (!el2) return;
          void el2.offsetWidth; // herstart de animatie bij een tweede tik
          el2.classList.add("uitgelicht");
        });
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
          // Niet-blokkerende melding via de vergelijk-balk in plaats van alert()
          const tekst = el("vergelijkBalkTekst");
          const oud = tekst.textContent;
          tekst.textContent = "Maximaal 3 panelen tegelijk; haal er eerst één weg.";
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
      const items = state.panelen.filter((p) => state.vergelijkSelectie.includes(p.id));
      el("vergelijkModalInhoud").innerHTML = vergelijkModalHtml(items);
      el("vergelijkModal").classList.add("open");
    });

    el("wisVergelijk").addEventListener("click", () => { state.vergelijkSelectie = []; render(); });
    el("sluitModal").addEventListener("click", () => el("vergelijkModal").classList.remove("open"));
    el("vergelijkModal").addEventListener("click", (e) => { if (e.target === el("vergelijkModal")) el("vergelijkModal").classList.remove("open"); });
  }

  /* ------------------------------------------------------------------
     Init
     ------------------------------------------------------------------ */

  async function init() {
    try {
      const res = await fetch("data/panelen.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      state.panelen = data.panelen || [];
      state.meta = data;

      const teller = el("tellerPanelen");
      if (teller) teller.textContent = state.panelen.length;

      if (data.laatst_bijgewerkt) {
        const d = new Date(data.laatst_bijgewerkt + "T12:00:00");
        el("updateDatum").textContent = datumFmt.format(d);
      }

      // Merkenfilter vullen
      const merken = [...new Set(state.panelen.map((p) => p.merk))].sort((a, b) => a.localeCompare(b, "nl"));
      el("filterMerk").innerHTML = '<option value="alle">Alle merken</option>' + merken.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");

      // Omvormers meladen voor de gezamenlijke zoekfunctie (best effort)
      try {
        const resO = await fetch("data/omvormers.json", { cache: "no-cache" });
        if (resO.ok) state.omvormers = (await resO.json()).omvormers || [];
      } catch { /* zoekfunctie werkt dan alleen binnen panelen */ }

      koppelEvents();
      leesUrl(); // na het vullen van het merkenfilter, zodat ?merk=... aankomt
      render();
    } catch (err) {
      el("resultaten").innerHTML = '<div class="leeg-melding">De paneelgegevens konden niet worden geladen. Vernieuw de pagina of probeer het later opnieuw.</div>';
      console.error("Fout bij laden panelen.json:", err);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
