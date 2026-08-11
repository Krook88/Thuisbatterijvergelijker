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
     De kaartopmaak en de helpers eromheen staan in assets/kaart.js, zodat de
     generator exact dezelfde HTML kan wegschrijven als wat de browser tekent.
     Hier alleen de namen, zodat de rest van dit bestand ongewijzigd blijft.
     ------------------------------------------------------------------ */

  const {
    escapeHtml, naamVan, nl, datumNL, celtypeLabel, koopUrl, merkHtml: merkHtmlVan,
    zekerScore, zekerScoreBadge, dakSterren, sterren, jaNeeBadge,
  } = Kaart;

  const merkHtml = (p) => merkHtmlVan(p, state.meta.merk_logos);
  const kaartHtml = (p) => Kaart.kaartHtml(p, {
    merkLogos: state.meta.merk_logos,
    geselecteerd: state.vergelijkSelectie.includes(p.id),
  });


  /* ------------------------------------------------------------------
     Data helpers
     ------------------------------------------------------------------ */


  // Prijslogica staat in assets/prijs.js: één bron voor de hele site, zodat
  // een prijs excl. btw niet van een eerlijke prijs incl. btw kan winnen.
  const bestePrijs = (p) => Prijs.beste(p);

  const heeftKorting = (p) => Prijs.heeftKorting(p);

  const prijsPerWp = (p) => Prijs.prijsPerWp(p);


  /* ------------------------------------------------------------------
     Zeker-score en sterren
     ------------------------------------------------------------------ */


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
    const prijsVan = (p) => { const b = bestePrijs(p); return b ? Prijs.vergelijkPrijs(b) : Infinity; };
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


  /* ------------------------------------------------------------------
     Rendering: tabel
     ------------------------------------------------------------------ */

  const tabelKolommen = [
    { key: "model", label: "Model", get: (p) => naamVan(p) },
    { key: "wp", label: "Wp", get: (p) => p.vermogen_wp || 0 },
    { key: "rendement", label: "Rendement", get: (p) => p.rendement_pct || 0 },
    { key: "celtype", label: "Celtype", get: (p) => p.celtype },
    { key: "prijs", label: "Prijs", get: (p) => { const b = bestePrijs(p); return b ? Prijs.vergelijkPrijs(b) : Infinity; } },
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
            <td class="tabel-prijs" title="${escapeHtml(p.prijs_omvat || "")}">${beste ? eurFmt.format(Prijs.vergelijkPrijs(beste)) : "n.b."}${heeftKorting(p) ? ' <span class="aanbieding-vlag">deal</span>' : ""}</td>
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
        ${rij("Prijs", (p) => { const b = bestePrijs(p); return b ? `<b>${eurFmt.format(Prijs.vergelijkPrijs(b))}</b>` : "n.b."; })}
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
