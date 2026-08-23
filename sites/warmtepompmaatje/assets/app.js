/* ==========================================================================
   Warmtepompmaatje - vergelijkingslogica
   Laadt data/warmtepompen.json en rendert kaarten, tabel en vergelijk-modal,
   met dezelfde opzet als de zustersites (Batterijmaatje, Zonnestroommaatje).
   ========================================================================== */

(function () {
  "use strict";

  const state = {
    pompen: [],
    weergave: "lijst", // of "kaarten" of "tabel"
    sortering: "koppel-score",
    tabelSortKolom: null,
    tabelSortRichting: 1,
    vergelijkSelectie: [],
    filters: { zoek: "", type: "alle", merk: "alle", r290: false, stil: false, officieelHa: false },
  };

  const el = (id) => document.getElementById(id);

  const eurFmt = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const datumFmt = new Intl.DateTimeFormat("nl-NL", { dateStyle: "long" });

  /* ------------------------------------------------------------------
     De kaartopmaak en de helpers eromheen staan in assets/kaart.js, zodat de
     generator exact dezelfde HTML kan wegschrijven als wat de browser tekent.
     Hier alleen de namen, zodat de rest van dit bestand ongewijzigd blijft.
     ------------------------------------------------------------------ */

  const {
    escapeHtml, datumNL, driewaardig, koopUrl, badgeHtml, koppelScore, koppelMeter,
    geluidStrook, variantenRegel, prijsLetOp, bedragOfWacht, bestePrijs,
    vergelijkPrijs, geluidBekend, TYPE_LABEL, TYPE_KORT,
  } = Kaart;

  const kaartHtml = (w) => Kaart.kaartHtml(w, {
    geselecteerd: state.vergelijkSelectie.includes(w.id),
    pompen: state.pompen,
  });



  /**
   * Geluid als los getal zegt een bezoeker niets: is 55 dB(A) stil of luid?
   * Dat blijkt pas uit vergelijking, en vergelijken is nu net waar deze site
   * voor is. Deze strook zet de pomp op zijn plaats binnen het bereik van alle
   * pompen hier, met het aantal stillere modellen erbij - dat laatste is de
   * uitspraak waar iemand echt iets aan heeft, en die staat er in woorden,
   * zodat kleur en positie nooit de enige drager zijn.
   */

  /**
   * De reeks waarin dit model leverbaar is, met het subsidiebedrag per maat.
   *
   * Het vermogen komt hier van de ISDE-lijst en die rekent met het opgegeven
   * vermogen volgens EU 811/2013 - dat ligt vaak een stap lager dan de
   * marketingnaam op de kaart hierboven. Daarom staat er expliciet bij waar
   * het getal vandaan komt, en is het subsidiebedrag de hoofdzaak: dat is de
   * vraag waar een bezoeker mee zit als hij een andere maat nodig heeft.
   */


  /**
   * Van een deel van de pompen hebben wij het geluidsvermogen niet vastgesteld.
   * "Niet vastgesteld" is iets anders dan "luid", en dat verschil is hier
   * weggevallen: met (w.geluid_db || 99) gold een onbekende waarde als 99 dB(A),
   * ruim boven de luidste pomp die we wél hebben gemeten. Sorteren op "stilste
   * eerst" zette die pompen daardoor onderaan alsof was vastgesteld dat ze de
   * luidste van de site zijn.
   *
   * De keuzehulp ging al wel van het gemiddelde uit. Dat twee pagina's van
   * dezelfde site een tegengesteld oordeel gaven over dezelfde ontbrekende
   * waarde was de eigenlijke fout; vandaar deze ene functie.
   */
  const isStil = (w) => geluidBekend(w) && w.geluid_db <= 55;
  const isR290 = (w) => /R290/i.test(w.koudemiddel || "");

  /* ------------------------------------------------------------------
     Filteren, sorteren en URL-status (deelbare links)
     ------------------------------------------------------------------ */

  const FILTER_KEYS = ["type", "merk"];
  const CHECK_KEYS = [["r290", "r290"], ["stil", "stil"], ["officieelHa", "ha"]];

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
    zet("filterType", state.filters.type); zet("filterMerk", state.filters.merk); zet("sorteer", state.sortering);
    const vink = (id, w) => { const n = el(id); if (n) n.checked = w; };
    vink("checkR290", state.filters.r290); vink("checkStil", state.filters.stil); vink("checkHa", state.filters.officieelHa);
  }

  function gefilterd(opties) {
    const f = state.filters;
    const negeerStil = !!(opties && opties.negeerStil);
    return state.pompen.filter((w) => {
      if (f.zoek && !`${w.merk} ${w.model}`.toLowerCase().includes(f.zoek.trim().toLowerCase())) return false;
      if (f.type !== "alle" && w.type !== f.type) return false;
      if (f.merk !== "alle" && w.merk !== f.merk) return false;
      if (f.r290 && !isR290(w)) return false;
      if (f.stil && !negeerStil && !isStil(w)) return false;
      if (f.officieelHa && driewaardig(w.home_assistant).status !== "ja") return false;
      return true;
    });
  }

  /**
   * Hoeveel pompen het "stil"-filter buiten beeld houdt puur omdat wij hun
   * geluid niet hebben vastgesteld. Het filter mag ze niet meerekenen - stil
   * beloven kunnen we niet - maar ze zonder een woord weglaten wekt de indruk
   * dat de lijst compleet is. Bij dit filter verdwijnt een derde van de site.
   */
  function verborgenDoorOnbekendGeluid() {
    if (!state.filters.stil) return 0;
    return gefilterd({ negeerStil: true }).filter((w) => !geluidBekend(w)).length;
  }

  function gesorteerd(lijst) {
    const kopie = [...lijst];
    const prijsVan = (w) => { const b = vergelijkPrijs(bestePrijs(w)); return b == null ? Infinity : b; };
    switch (state.sortering) {
      case "prijs-oplopend": kopie.sort((a, b) => prijsVan(a) - prijsVan(b)); break;
      case "subsidie": kopie.sort((a, b) => (b.isde_indicatie_eur || 0) - (a.isde_indicatie_eur || 0)); break;
      // Onbekend onderaan, maar als onbekend en niet als "luid".
      case "geluid": kopie.sort((a, b) => (geluidBekend(a) && geluidBekend(b) ? a.geluid_db - b.geluid_db : geluidBekend(a) ? -1 : geluidBekend(b) ? 1 : 0)); break;
      case "rendement": kopie.sort((a, b) => (b.scop || 0) - (a.scop || 0)); break;
      case "koppel-score": kopie.sort((a, b) => koppelScore(b) - koppelScore(a) || prijsVan(a) - prijsVan(b)); break;
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
    { key: "model", label: "Model", get: (w) => `${w.merk} ${w.model}` },
    { key: "type", label: "Type", get: (w) => w.type },
    { key: "vermogen", getal: true, label: "kW", get: (w) => w.vermogen_kw || 0 },
    // null en niet een groot getal: een ontbrekende waarde hoort onderaan omdat
    // hij ontbreekt, niet omdat hij hoog zou zijn. Zie de sorteervergelijking.
    { key: "prijs", getal: true, label: "Prijs", get: (w) => vergelijkPrijs(bestePrijs(w)) },
    { key: "subsidie", getal: true, label: "ISDE", get: (w) => w.isde_indicatie_eur || 0 },
    { key: "geluid", getal: true, label: "Geluid", get: (w) => (geluidBekend(w) ? w.geluid_db : null) },
    { key: "koppel", label: "Koppel-score", get: (w) => koppelScore(w) },
    { key: "ha", label: "Home Assistant", get: (w) => driewaardig(w.home_assistant).status },
    { key: "homey", label: "Homey", get: (w) => driewaardig(w.homey).status },
    { key: "actie", label: "", get: () => "" },
  ];

  function tabelHtml(lijst) {
    let rijen = [...lijst];
    if (state.tabelSortKolom) {
      const kol = tabelKolommen.find((k) => k.key === state.tabelSortKolom);
      rijen.sort((a, b) => {
        const va = kol.get(a), vb = kol.get(b);
        // Wat wij niet weten, staat onderaan - ook als je de kolom omklapt.
        // Anders komt "prijs onbekend" bij aflopend sorteren bovenaan te staan
        // als duurste, en "geluid onbekend" als luidste.
        if (va == null || vb == null) return va == null ? (vb == null ? 0 : 1) : -1;
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * state.tabelSortRichting;
        return String(va).localeCompare(String(vb), "nl") * state.tabelSortRichting;
      });
    }
    const checkCel = (v) => {
      const d = driewaardig(v);
      if (d.status === "ja") return `<span class="check-ja">${Iconen.svg("ja")}</span>`;
      if (d.status === "deels") return `<span class="check-deels" title="${escapeHtml(d.tekst)}">${Iconen.svg("deels")}</span>`;
      if (d.status === "onbekend") return `<span class="check-onbekend" title="${escapeHtml(d.tekst)}">${Iconen.svg("onbekend")}</span>`;
      return `<span class="check-nee">${Iconen.svg("nee")}</span>`;
    };
    return `
    <table class="vergelijk-tabel">
      <thead><tr>${tabelKolommen.map((k) => `<th data-kolom="${k.key}"${k.getal ? ' class="getal"' : ""}>${k.label}${k.key !== "actie" ? ` <span class="sorteer-pijl">${Iconen.svg("sorteren")}</span>` : ""}</th>`).join("")}</tr></thead>
      <tbody>
        ${rijen.map((w) => {
          const beste = bestePrijs(w);
          return `<tr>
            <td><b>${escapeHtml(w.merk)}</b><br>${escapeHtml(w.model)}</td>
            <td>${escapeHtml(TYPE_KORT[w.type] || w.type)}</td>
            <td class="getal"${Condities.vermogenToelichting(w) ? ` title="${escapeHtml(Condities.vermogenToelichting(w))}"` : ""}>${String(w.vermogen_kw).replace(".", ",")}</td>
            <td class="tabel-prijs getal" title="${escapeHtml([w.prijs_toelichting, Prijs.prijsToelichting(beste)].filter(Boolean).join(" · "))}">${beste ? eurFmt.format(vergelijkPrijs(beste)) : "n.b."}</td>
            <td class="getal" title="Indicatie ISDE-subsidie; het bedrag per meldcode bij RVO is leidend">${w.isde_indicatie_eur ? "± " + eurFmt.format(w.isde_indicatie_eur) : "?"}</td>
            <td class="getal">${w.geluid_db ? w.geluid_db + " dB" : "?"}</td>
            <td title="Punten voor slimme aansturing, Home Assistant en Homey"><b>${koppelScore(w)}/6</b></td>
            <td>${checkCel(w.home_assistant)}</td>
            <td>${checkCel(w.homey)}</td>
            <td>${beste && beste.url ? `<a class="knop" style="padding: var(--ruimte-6) var(--ruimte-10);font-size:var(--tekst-15);" href="${escapeHtml(koopUrl(beste))}" target="_blank" rel="noopener">Bekijk ${Iconen.svg("pijl-rechts")}</a>` : ""}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;
  }

  /* ------------------------------------------------------------------
     Rendering: vergelijk-modal (max. 3 zij aan zij)
     ------------------------------------------------------------------ */

  function vergelijkModalHtml(items) {
    const rij = (label, fn) => `<tr><th style="text-align:left;padding: var(--ruimte-6) var(--ruimte-10);background:var(--kleur-achtergrond);white-space:nowrap;position:sticky;left:0;z-index:1;box-shadow:2px 0 0 var(--kleur-rand);">${label}</th>${items.map((w) => `<td style="padding: var(--ruimte-6) var(--ruimte-10);border-bottom:1px solid var(--kleur-rand);">${fn(w)}</td>`).join("")}</tr>`;
    const d3 = (v) => { const d = driewaardig(v); return d.status === "nee" ? `${Iconen.svg("nee")} ${escapeHtml(d.tekst)}` : d.status === "deels" ? `${Iconen.svg("deels")} ${escapeHtml(d.tekst)}` : `${Iconen.svg("ja")} ${escapeHtml(d.tekst)}`; };
    return `
      <h2>Vergelijking</h2>
      <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:var(--tekst-15);min-width:${220 * items.length + 160}px;">
        ${rij("Model", (w) => `<b>${escapeHtml(w.merk)} ${escapeHtml(w.model)}</b>`)}
        ${rij("Type", (w) => escapeHtml(TYPE_LABEL[w.type] || w.type))}
        ${rij("Vermogen", (w) => `${String(w.vermogen_kw).replace(".", ",")} kW${Condities.labelHtml("vermogen", w)}`)}
        ${rij("Prijs", (w) => { const b = bestePrijs(w); return `${b ? `<b>${eurFmt.format(vergelijkPrijs(b))}</b>` : "n.b."}<br><small>${escapeHtml([w.prijs_toelichting, Prijs.prijsToelichting(b)].filter(Boolean).join(" · "))}</small>`; })}
        ${rij("Subsidie (ISDE, indicatie)", (w) => (w.isde_indicatie_eur ? `circa ${eurFmt.format(w.isde_indicatie_eur)}` : "?"))}
        ${rij("Geluid buitenunit", (w) => (w.geluid_db ? `${w.geluid_db} dB(A)` : "?"))}
        ${rij("Koudemiddel", (w) => escapeHtml(w.koudemiddel || "?"))}
        ${rij("Max. aanvoertemperatuur", (w) => (w.max_aanvoer_c ? `${w.max_aanvoer_c} °C` : "?"))}
        ${rij("Warm tapwater", (w) => escapeHtml(w.tapwater || "?"))}
        ${rij("Koppel-score", (w) => `<b>${koppelScore(w)}/6</b>`)}
        ${rij("Slimme aansturing", (w) => d3(w.sturing))}
        ${rij("Home Assistant", (w) => d3(w.home_assistant))}
        ${rij("Homey", (w) => d3(w.homey))}
        ${rij("App", (w) => escapeHtml(w.app || "?"))}
        ${rij("Garantie", (w) => (w.garantie_jaar ? w.garantie_jaar + " jaar" : "?"))}
        ${rij("", (w) => { const b = bestePrijs(w); return b && b.url ? `<a class="knop" href="${escapeHtml(koopUrl(b))}" target="_blank" rel="noopener">Naar fabrikant ${Iconen.svg("pijl-rechts")}</a>` : ""; })}
      </table>
      </div>`;
  }

  /* ------------------------------------------------------------------
     Hoofd-render en events
     ------------------------------------------------------------------ */


  /* Waarop staat deze lijst gesorteerd?

     De standaardvolgorde is prijs per eenheid, maar het bedrag dat groot en
     vet op de regel staat is de winkelprijs. De kolom Prijs leest daardoor
     1.869 - 1.948 - 1.250 - 1.950, onder een nummering die bij 1 begint: dat
     ziet eruit als een kapotte sortering totdat je doorhebt dat er op het
     kleine grijze getal eronder geordend wordt. Eén zin lost dat op, en hij
     blijft vanzelf kloppen omdat hij het gekozen menu-item overneemt. */
  function sorteerNoot() {
    const keuze = el("sorteer");
    const tekst = keuze && keuze.options[keuze.selectedIndex] && keuze.options[keuze.selectedIndex].text;
    if (!tekst) return "";
    return `, gesorteerd op ${tekst.charAt(0).toLowerCase()}${tekst.slice(1)}`;
  }

  function render() {
    syncUrl();
    const lijst = gesorteerd(gefilterd());
    const verborgen = verborgenDoorOnbekendGeluid();
    el("resultatenTelling").innerHTML = `${lijst.length} van ${state.pompen.length} warmtepompen` + escapeHtml(sorteerNoot())
      + (verborgen ? `<small class="telling-noot">${verborgen} niet getoond: geluid nog niet vastgesteld</small>` : "");

    const doel = el("resultaten");
    if (!lijst.length) {
      doel.innerHTML = '<div class="leeg-melding">Geen warmtepompen gevonden met deze filters. Probeer een filter uit te zetten.</div>';
    } else if (state.weergave === "lijst") {
      doel.innerHTML = Kaart.lijstHtml(lijst, { selectie: state.vergelijkSelectie });
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
        el("vergelijkBalkTekst").textContent = `${state.vergelijkSelectie.length} warmtepompen geselecteerd`;
      } else {
        balk.classList.remove("zichtbaar");
        document.body.classList.remove("vergelijkbalk-actief");
      }
    }
  }

  function koppelEvents() {
    [["filterType", "type"], ["filterMerk", "merk"]].forEach(([id, key]) => {
      el(id).addEventListener("change", (e) => { state.filters[key] = e.target.value; render(); });
    });
    [["checkR290", "r290"], ["checkStil", "stil"], ["checkHa", "officieelHa"]].forEach(([id, key]) => {
      el(id).addEventListener("change", (e) => { state.filters[key] = e.target.checked; render(); });
    });
    el("sorteer").addEventListener("change", (e) => { state.sortering = e.target.value; render(); });

    const zoekVeld = el("zoekVeld");
    if (zoekVeld) zoekVeld.addEventListener("input", (e) => { state.filters.zoek = e.target.value; render(); });

    const reset = el("resetFilters");
    if (reset) reset.addEventListener("click", () => {
      state.filters = { zoek: "", type: "alle", merk: "alle", r290: false, stil: false, officieelHa: false };
      ["filterType", "filterMerk"].forEach((id) => { el(id).value = "alle"; });
      ["checkR290", "checkStil", "checkHa"].forEach((id) => { el(id).checked = false; });
      if (zoekVeld) zoekVeld.value = "";
      render();
    });

    for (const [id, naam] of [["knopLijst", "lijst"], ["knopKaarten", "kaarten"], ["knopTabel", "tabel"]]) {
      const knop = el(id);
      if (!knop) continue;
      knop.addEventListener("click", () => {
        state.weergave = naam;
        for (const ander of ["knopLijst", "knopKaarten", "knopTabel"]) {
          if (el(ander)) el(ander).classList.toggle("actief", ander === id);
        }
        render();
      });
    }

    el("resultaten").addEventListener("click", (e) => {
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
          tekst.textContent = "Maximaal 3 warmtepompen tegelijk; haal er eerst één weg.";
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
      const items = state.pompen.filter((w) => state.vergelijkSelectie.includes(w.id));
      el("vergelijkModalInhoud").innerHTML = vergelijkModalHtml(items);
      el("vergelijkModal").classList.add("open");
    });
    el("wisVergelijk").addEventListener("click", () => { state.vergelijkSelectie = []; render(); });
    el("sluitModal").addEventListener("click", () => el("vergelijkModal").classList.remove("open"));
    el("vergelijkModal").addEventListener("click", (e) => { if (e.target === el("vergelijkModal")) el("vergelijkModal").classList.remove("open"); });

    const filterToggle = el("filterToggle");
    if (filterToggle) {
      filterToggle.addEventListener("click", () => {
        const balk = el("filterbalk");
        const ingeklapt = balk.classList.toggle("ingeklapt");
        filterToggle.innerHTML = `${Iconen.svg("zoeken")} Filteren en sorteren ${Iconen.svg("chevron", { klasse: ingeklapt ? "" : "gedraaid" })}`;
      });
    }
  }

  /* ------------------------------------------------------------------
     Init
     ------------------------------------------------------------------ */

  async function init() {
    try {
      const res = await fetch("data/warmtepompen.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      state.pompen = data.warmtepompen || [];

      const teller = el("tellerPompen");
      if (teller) teller.textContent = state.pompen.length;

      if (data.laatst_bijgewerkt) {
        const d = new Date(data.laatst_bijgewerkt + "T12:00:00");
        const doel = el("updateDatum");
        if (doel) doel.textContent = datumFmt.format(d);
      }

      const merken = [...new Set(state.pompen.map((w) => w.merk))].sort((a, b) => a.localeCompare(b, "nl"));
      el("filterMerk").innerHTML = '<option value="alle">Alle merken</option>' + merken.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");

      koppelEvents();
      leesUrl();
      render();
    } catch (err) {
      el("resultaten").innerHTML = '<div class="leeg-melding">De warmtepompgegevens konden niet worden geladen. Vernieuw de pagina of probeer het later opnieuw.</div>';
      console.error("Fout bij laden warmtepompen.json:", err);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
