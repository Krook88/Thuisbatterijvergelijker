/* ==========================================================================
   Thuisbatterijvergelijker - vergelijkingslogica
   Laadt data/batterijen.json en rendert kaarten, tabel en vergelijk-modal.
   ========================================================================== */

(function () {
  "use strict";

  const state = {
    batterijen: [],
    meta: {},
    weergave: "kaarten", // of "tabel"
    sortering: "prijs-per-kwh",
    tabelSortKolom: null,
    tabelSortRichting: 1,
    vergelijkSelectie: [],
    filters: {
      zoek: "",
      type: "alle",
      capaciteit: "alle",
      installatie: "alle",
      merk: "alle",
      homey: false,
      homeAssistant: false,
      dynamisch: false,
      officieel: false,
      noodstroom: false,
      aanbieding: false,
    },
  };

  const el = (id) => document.getElementById(id);

  /* ------------------------------------------------------------------
     Data helpers

     De opmaak van een batterijkaart staat in assets/kaart.js, omdat de
     generator diezelfde kaarten kant-en-klaar in index.html zet. Zo tonen de
     HTML en de browser gegarandeerd hetzelfde.
     ------------------------------------------------------------------ */

  const {
    eurFmt, escapeHtml, naamVan, datumNL, driewaardig, vierwaardig,
    koopUrl, totaalprijsTekst, koppelScore, koppelScoreBadge, badgeHtml,
    noodstroomBadge, sterren,
  } = Kaart;

  const merkHtml = (b) => Kaart.merkHtml(b, state.meta.merk_logos);
  const kaartHtml = (b) => Kaart.kaartHtml(b, {
    merkLogos: state.meta.merk_logos,
    geselecteerd: state.vergelijkSelectie.includes(b.id),
  });

  // Alle prijsvergelijking loopt via assets/prijs.js, zodat de vergelijker, de
  // keuzehulp, de rekenmodule en de batterijpagina's dezelfde bedragen tonen.
  const bestePrijs = Prijs.beste;
  const heeftKorting = Prijs.heeftKorting;
  const prijsPerKwh = Prijs.prijsPerKwh;

  // Het bedrag waarop gesorteerd en gefilterd wordt: altijd incl. btw.
  function vergelijkPrijs(b) {
    const prijs = Prijs.vergelijkPrijs(bestePrijs(b));
    return prijs === null ? Infinity : prijs;
  }

  /* ------------------------------------------------------------------
     Filteren en sorteren
     ------------------------------------------------------------------ */

  function capaciteitInBereik(kwh, bereik) {
    switch (bereik) {
      case "klein": return kwh < 4;
      case "middel": return kwh >= 4 && kwh <= 10;
      case "groot": return kwh > 10;
      default: return true;
    }
  }

  /* Filter- en sorteerstatus in de URL: back-navigatie behoudt de context en
     een gefilterde lijst is deelbaar als link. */
  const FILTER_KEYS = ["type", "capaciteit", "installatie", "merk"];
  const CHECK_KEYS = [["homey", "homey"], ["homeAssistant", "ha"], ["dynamisch", "dynamisch"], ["officieel", "officieel"], ["noodstroom", "noodstroom"], ["aanbieding", "aanbieding"]];

  function syncUrl() {
    const f = state.filters;
    const p = new URLSearchParams();
    if (f.zoek.trim()) p.set("zoek", f.zoek.trim());
    FILTER_KEYS.forEach((k) => { if (f[k] !== "alle") p.set(k, f[k]); });
    CHECK_KEYS.forEach(([k, kort]) => { if (f[k]) p.set(kort, "1"); });
    if (state.sortering !== "prijs-per-kwh") p.set("sorteer", state.sortering);
    const qs = p.toString();
    history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  }

  function leesUrl() {
    const p = new URLSearchParams(location.search);
    if (p.get("zoek")) state.filters.zoek = p.get("zoek");
    FILTER_KEYS.forEach((k) => { if (p.get(k)) state.filters[k] = p.get(k); });
    CHECK_KEYS.forEach(([k, kort]) => { if (p.get(kort) === "1") state.filters[k] = true; });
    if (p.get("sorteer")) state.sortering = p.get("sorteer");
    // Formulier gelijkzetten met de ingelezen status
    const zet = (id, w) => { const n = el(id); if (n) n.value = w; };
    zet("zoekVeld", state.filters.zoek);
    zet("filterType", state.filters.type); zet("filterCapaciteit", state.filters.capaciteit);
    zet("filterInstallatie", state.filters.installatie); zet("filterMerk", state.filters.merk);
    zet("sorteer", state.sortering);
    const vink = (id, w) => { const n = el(id); if (n) n.checked = w; };
    vink("checkHomey", state.filters.homey); vink("checkHA", state.filters.homeAssistant);
    vink("checkDynamisch", state.filters.dynamisch); vink("checkOfficieel", state.filters.officieel);
    vink("checkNoodstroom", state.filters.noodstroom);
    vink("checkAanbieding", state.filters.aanbieding);
  }

  // Zoeken gaat over merk en model samen, zodat zowel "marstek" als
  // "venus e 4" en "marstek venus" iets opleveren. Losse woorden mogen in
  // willekeurige volgorde staan: iemand die zijn offerte overtypt, doet dat
  // zelden precies zoals wij het noteren.
  function komtOvereen(b, zoekterm) {
    const woorden = zoekterm.toLowerCase().split(/\s+/).filter(Boolean);
    if (!woorden.length) return true;
    const hooiberg = `${b.merk} ${b.model}`.toLowerCase();
    return woorden.every((w) => hooiberg.includes(w));
  }

  function gefilterd() {
    const f = state.filters;
    return state.batterijen.filter((b) => {
      if (!komtOvereen(b, f.zoek)) return false;
      if (f.type !== "alle" && b.type !== f.type) return false;
      if (f.merk !== "alle" && b.merk !== f.merk) return false;
      if (!capaciteitInBereik(b.capaciteit_kwh || 0, f.capaciteit)) return false;
      if (f.installatie === "zelf" && b.installatie !== "zelf") return false;
      if (f.installatie === "installateur" && b.installatie !== "installateur") return false;
      const eis = f.officieel ? ["ja"] : ["ja", "deels"];
      if (f.homey && !eis.includes(driewaardig(b.homey).status)) return false;
      if (f.homeAssistant && !eis.includes(driewaardig(b.home_assistant).status)) return false;
      if (f.dynamisch && !eis.includes(driewaardig(b.dynamisch_contract).status)) return false;
      if (f.noodstroom && !["ja", "deels"].includes(vierwaardig(b.noodstroom).status)) return false;
      if (f.aanbieding && !heeftKorting(b)) return false;
      return true;
    });
  }

  function gesorteerd(lijst) {
    const kopie = [...lijst];
    const prijsVan = vergelijkPrijs;
    switch (state.sortering) {
      case "prijs-oplopend": kopie.sort((a, b) => prijsVan(a) - prijsVan(b)); break;
      case "totaalprijs": kopie.sort((a, b) => (a.totaalprijs_van_eur || Infinity) - (b.totaalprijs_van_eur || Infinity)); break;
      case "prijs-aflopend": kopie.sort((a, b) => prijsVan(b) - prijsVan(a)); break;
      case "prijs-per-kwh": kopie.sort((a, b) => (prijsPerKwh(a) || Infinity) - (prijsPerKwh(b) || Infinity)); break;
      case "capaciteit": kopie.sort((a, b) => (b.capaciteit_kwh || 0) - (a.capaciteit_kwh || 0)); break;
      case "koppelgemak": kopie.sort((a, b) => (b.koppeling_gemak || 0) - (a.koppeling_gemak || 0)); break;
      case "koppel-score": kopie.sort((a, b) => koppelScore(b) - koppelScore(a) || (prijsPerKwh(a) || Infinity) - (prijsPerKwh(b) || Infinity)); break;
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
    { key: "model", label: "Model", get: (b) => naamVan(b) },
    { key: "capaciteit", label: "kWh", get: (b) => b.capaciteit_kwh || 0 },
    { key: "vermogen", label: "kW", get: (b) => b.vermogen_kw || 0 },
    { key: "type", label: "Type", get: (b) => b.type },
    { key: "prijs", label: "Prijs incl. btw", get: vergelijkPrijs },
    { key: "totaal", label: "Totaal (indicatie)", get: (b) => b.totaalprijs_van_eur || Infinity },
    { key: "perkwh", label: "€/kWh", get: (b) => prijsPerKwh(b) || Infinity },
    { key: "koppeling", label: "PV-koppeling", get: (b) => b.koppeling_gemak || 0 },
    { key: "slim", label: "Koppel-score", get: (b) => koppelScore(b) },
    { key: "homey", label: "Homey", get: (b) => driewaardig(b.homey).status },
    { key: "ha", label: "Home Assistant", get: (b) => driewaardig(b.home_assistant).status },
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
      if (d.status === "ja") return `<span class="check-ja">${Iconen.svg("ja")}</span>`;
      if (d.status === "deels") return `<span class="check-deels" title="${escapeHtml(d.tekst)}">~</span>`;
      return `<span class="check-nee">${Iconen.svg("nee")}</span>`;
    };
    return `
    <table class="vergelijk-tabel">
      <thead><tr>${tabelKolommen.map((k) => `<th data-kolom="${k.key}">${k.label}${k.key !== "actie" ? ' <span class="sorteer-pijl">${Iconen.svg("chevron")}</span>' : ""}</th>`).join("")}</tr></thead>
      <tbody>
        ${rijen.map((b) => {
          const beste = bestePrijs(b);
          const perKwh = prijsPerKwh(b);
          return `<tr>
            <td><b>${merkHtml(b)}</b><br><a href="batterij/${encodeURIComponent(b.id)}.html">${escapeHtml(b.model)}</a></td>
            <td${Prijs.capaciteitToelichting(b) ? ` title="${escapeHtml(Prijs.capaciteitToelichting(b))}"` : ""}>${b.capaciteit_kwh ? String(b.capaciteit_kwh).replace(".", ",") : "?"}</td>
            <td>${b.vermogen_kw ? String(b.vermogen_kw).replace(".", ",") : "?"}</td>
            <td>${escapeHtml(b.type)}</td>
            <td class="tabel-prijs" title="${escapeHtml([b.prijs_omvat, Prijs.prijsToelichting(beste)].filter(Boolean).join(" | "))}">${Prijs.vergelijkPrijs(beste) !== null ? eurFmt.format(Prijs.vergelijkPrijs(beste)) : "n.b."}${heeftKorting(b) ? ' <span class="aanbieding-vlag">deal</span>' : ""}</td>
            <td title="${escapeHtml(b.totaalprijs_toelichting || "")}">${totaalprijsTekst(b) || "op aanvraag"}</td>
            <td${Prijs.capaciteitToelichting(b) ? ` title="Per kWh: ${escapeHtml(Prijs.capaciteitToelichting(b))}"` : ""}>${perKwh ? eurFmt.format(perKwh) : "n.b."}</td>
            <td title="${escapeHtml(b.zonnepanelen_koppeling || "")}"><span class="sterren" style="color:var(--kleur-accent)">${sterren(b.koppeling_gemak)}</span></td>
            <td title="Punten voor Homey, Home Assistant en dynamisch contract"><b>${koppelScore(b)}/6</b></td>
            <td>${checkCel(b.homey)}</td>
            <td>${checkCel(b.home_assistant)}</td>
            <td>${beste && beste.url ? `<a class="knop" style="padding:7px 12px;font-size:0.85rem;" href="${escapeHtml(koopUrl(beste))}" target="_blank" rel="noopener${beste.affiliate_url ? " sponsored" : ""}" aria-label="Bekijk de aanbieding van de ${escapeHtml(naamVan(b))}">Bekijk ${Iconen.svg("pijl-rechts")}</a>` : ""}</td>
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
    const rij = (label, fn) => `<tr><th style="text-align:left;padding:8px 10px;background:var(--kleur-achtergrond);white-space:nowrap;position:sticky;left:0;z-index:1;box-shadow:2px 0 0 var(--kleur-rand);">${label}</th>${items.map((b) => `<td style="padding:8px 10px;border-bottom:1px solid var(--kleur-rand);">${fn(b)}</td>`).join("")}</tr>`;
    const d3 = (v) => { const d = driewaardig(v); return d.status === "nee" ? `${Iconen.svg("nee")} Nee` : d.status === "deels" ? `${Iconen.svg("deels")} ${escapeHtml(d.tekst)}` : `${Iconen.svg("ja")} ${escapeHtml(d.tekst)}`; };
    return `
      <h2>Vergelijking</h2>
      <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:0.93rem;min-width:${220 * items.length + 160}px;">
        ${rij("Model", (b) => `<b>${escapeHtml(naamVan(b))}</b>`)}
        ${rij("Type", (b) => escapeHtml(b.type))}
        ${rij("Capaciteit", (b) => (b.capaciteit_kwh ? String(b.capaciteit_kwh).replace(".", ",") + " kWh" : "?") + Prijs.capaciteitLabelHtml(b) + (b.uitbreidbaar_tot_kwh ? ` (uitbreidbaar tot ${String(b.uitbreidbaar_tot_kwh).replace(".", ",")} kWh)` : ""))}
        ${rij("Vermogen", (b) => (b.vermogen_kw ? String(b.vermogen_kw).replace(".", ",") + " kW" : "?"))}
        ${rij("Beste prijs incl. btw", (b) => {
          const p = bestePrijs(b);
          if (!p) return "n.b.";
          const toelichting = Prijs.prijsToelichting(p);
          return `<b>${eurFmt.format(Prijs.vergelijkPrijs(p))}</b> bij ${escapeHtml(p.winkel || "")}${toelichting ? `<br><small>${escapeHtml(toelichting)}</small>` : ""}`;
        })}
        ${rij("Compleet gebruiksklaar (indicatie)", (b) => `${totaalprijsTekst(b) || "op aanvraag"}<br><small>${escapeHtml(b.totaalprijs_toelichting || "")}</small>`)}
        ${rij("Prijs per kWh", (b) => { const p = prijsPerKwh(b); const t = Prijs.capaciteitToelichting(b); return (p ? eurFmt.format(p) : "n.b.") + (t ? `<br><small>${escapeHtml(t)}</small>` : ""); })}
        ${rij("Prijs dekt", (b) => `<small>${escapeHtml(b.prijs_omvat || "")}</small>`)}
        ${rij("Installatie", (b) => (b.installatie === "zelf" ? "Zelf (stopcontact)" : "Installateur vereist"))}
        ${rij("Koppeling zonnepanelen", (b) => `<span class="sterren" style="color:var(--kleur-accent)">${sterren(b.koppeling_gemak)}</span><br><small>${escapeHtml(b.zonnepanelen_koppeling || "")}</small>`)}
        ${rij("Koppel-score", (b) => `<b>${koppelScore(b)}/6</b>`)}
        ${rij("Homey", (b) => d3(b.homey))}
        ${rij("Home Assistant", (b) => d3(b.home_assistant))}
        ${rij("Dynamisch contract", (b) => d3(b.dynamisch_contract))}
        ${rij("Beschermingsgraad (IP)", (b) => b.ip_klasse ? `${escapeHtml(b.ip_klasse)}${b.buiten_toelichting ? `<br><small>${escapeHtml(b.buiten_toelichting)}</small>` : ""}` : "?")}
        ${rij("Garantie", (b) => (b.garantie_jaar ? b.garantie_jaar + " jaar" : "?"))}
        ${rij("", (b) => { const p = bestePrijs(b); return p && p.url ? `<a class="knop" href="${escapeHtml(koopUrl(p))}" target="_blank" rel="noopener${p.affiliate_url ? " sponsored" : ""}">Bekijk aanbieding ${Iconen.svg("pijl-rechts")}</a>` : ""; })}
      </table>
      </div>`;
  }

  /* ------------------------------------------------------------------
     Hoofd-render
     ------------------------------------------------------------------ */

  function render() {
    syncUrl();
    const lijst = gesorteerd(gefilterd());
    el("resultatenTelling").textContent = `${lijst.length} van ${state.batterijen.length} thuisbatterijen`;

    const doel = el("resultaten");
    if (!lijst.length) {
      doel.innerHTML = '<div class="leeg-melding">Geen batterijen gevonden met deze filters. Probeer een filter uit te zetten.</div>';
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
      el("vergelijkBalkTekst").textContent = `${state.vergelijkSelectie.length} batterijen geselecteerd`;
    } else {
      balk.classList.remove("zichtbaar");
      document.body.classList.remove("vergelijkbalk-actief");
    }
  }

  /* ------------------------------------------------------------------
     Events
     ------------------------------------------------------------------ */

  function koppelEvents() {
    ["filterType", "filterCapaciteit", "filterInstallatie", "filterMerk"].forEach((id) => {
      el(id).addEventListener("change", (e) => {
        const map = { filterType: "type", filterCapaciteit: "capaciteit", filterInstallatie: "installatie", filterMerk: "merk" };
        state.filters[map[id]] = e.target.value;
        render();
      });
    });

    [["checkHomey", "homey"], ["checkHA", "homeAssistant"], ["checkDynamisch", "dynamisch"], ["checkOfficieel", "officieel"], ["checkNoodstroom", "noodstroom"], ["checkAanbieding", "aanbieding"]].forEach(([id, key]) => {
      el(id).addEventListener("change", (e) => { state.filters[key] = e.target.checked; render(); });
    });

    el("sorteer").addEventListener("change", (e) => { state.sortering = e.target.value; render(); });

    const zoekVeld = el("zoekVeld");
    if (zoekVeld) {
      zoekVeld.addEventListener("input", (e) => { state.filters.zoek = e.target.value; render(); });
      // Enter mag de pagina niet herladen; er is niets te versturen
      zoekVeld.addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
    }

    // Mobiel: filters in- en uitklappen
    const filterToggle = el("filterToggle");
    if (filterToggle) {
      filterToggle.addEventListener("click", () => {
        const balk = el("filterbalk");
        const ingeklapt = balk.classList.toggle("ingeklapt");
        filterToggle.innerHTML = `${Iconen.svg("filter")} Filteren en sorteren ${Iconen.svg("chevron", { klasse: ingeklapt ? "" : "gedraaid" })}`;
      });
    }

    el("resetFilters").addEventListener("click", () => {
      state.filters = { zoek: "", type: "alle", capaciteit: "alle", installatie: "alle", merk: "alle", homey: false, homeAssistant: false, dynamisch: false, officieel: false, noodstroom: false, aanbieding: false };
      el("zoekVeld").value = "";
      el("filterType").value = "alle"; el("filterCapaciteit").value = "alle";
      el("filterInstallatie").value = "alle"; el("filterMerk").value = "alle";
      ["checkHomey", "checkHA", "checkDynamisch", "checkOfficieel", "checkNoodstroom", "checkAanbieding"].forEach((id) => { el(id).checked = false; });
      render();
    });

    el("knopKaarten").addEventListener("click", () => { state.weergave = "kaarten"; el("knopKaarten").classList.add("actief"); el("knopTabel").classList.remove("actief"); render(); });
    el("knopTabel").addEventListener("click", () => { state.weergave = "tabel"; el("knopTabel").classList.add("actief"); el("knopKaarten").classList.remove("actief"); render(); });

    // Gedelegeerde events voor dynamische content
    el("resultaten").addEventListener("click", (e) => {
      // Tik op een info-badge (zoals "~ Home Assistant"): opent de details en
      // springt naar de bijbehorende uitleg, die even oplicht zodat er altijd
      // zichtbaar iets gebeurt (ook als de details al open stonden).
      const badge = e.target.closest(".kaart-badges .badge");
      if (badge) {
        const kaart = badge.closest(".batterij-kaart");
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
          tekst.textContent = "Maximaal 3 batterijen tegelijk; haal er eerst één weg.";
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
      const items = state.batterijen.filter((b) => state.vergelijkSelectie.includes(b.id));
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
      const res = await fetch("data/batterijen.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      state.batterijen = data.batterijen || [];
      state.meta = data;

      if (data.laatst_bijgewerkt) {
        el("updateDatum").textContent = datumNL(data.laatst_bijgewerkt);
      }
      const teller = el("tellerBatterijen");
      if (teller) teller.textContent = state.batterijen.length;

      // Merkenfilter vullen
      const merken = [...new Set(state.batterijen.map((b) => b.merk))].sort((a, b) => a.localeCompare(b, "nl"));
      el("filterMerk").innerHTML = '<option value="alle">Alle merken</option>' + merken.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");

      koppelEvents();
      leesUrl(); // na het vullen van het merkenfilter, zodat ?merk=... aankomt
      render();
    } catch (err) {
      el("resultaten").innerHTML = '<div class="leeg-melding">De batterijgegevens konden niet worden geladen. Vernieuw de pagina of probeer het later opnieuw.</div>';
      console.error("Fout bij laden batterijen.json:", err);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
