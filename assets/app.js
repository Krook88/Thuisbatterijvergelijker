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

  const eurFmt = new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });

  const datumFmt = new Intl.DateTimeFormat("nl-NL", { dateStyle: "long" });

  /* ------------------------------------------------------------------
     Data helpers
     ------------------------------------------------------------------ */

  // Kooplink: de commissielink (affiliate) als die er is, anders de gewone
  // productlink. De dagelijkse prijscontrole gebruikt altijd de gewone url.
  function koopUrl(a) {
    return (a && (a.affiliate_url || a.url)) || "";
  }

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

  function totaalprijsTekst(b) {
    if (!b.totaalprijs_van_eur) return null;
    return eurFmt.format(b.totaalprijs_van_eur) + (b.totaalprijs_tot_eur ? " tot " + eurFmt.format(b.totaalprijs_tot_eur) : "");
  }

  // true / "tekst" => ondersteund (evt. met kanttekening); false/null => niet
  function driewaardig(v) {
    // Objectvorm {status, tekst}: officiële ondersteuning ("ja") mét uitlegtekst
    if (v && typeof v === "object") return { status: v.status || "deels", tekst: v.tekst || "" };
    if (v === true) return { status: "ja", tekst: "Ja" };
    if (typeof v === "string" && v.trim()) return { status: "deels", tekst: v };
    return { status: "nee", tekst: "Nee" };
  }

  // Zoals driewaardig, maar met expliciet "onbekend" voor ontbrekende data
  function vierwaardig(v) {
    if (v === undefined || v === null) return { status: "onbekend", tekst: "Onbekend" };
    return driewaardig(v);
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
    FILTER_KEYS.forEach((k) => { if (f[k] !== "alle") p.set(k, f[k]); });
    CHECK_KEYS.forEach(([k, kort]) => { if (f[k]) p.set(kort, "1"); });
    if (state.sortering !== "prijs-per-kwh") p.set("sorteer", state.sortering);
    const qs = p.toString();
    history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  }

  function leesUrl() {
    const p = new URLSearchParams(location.search);
    FILTER_KEYS.forEach((k) => { if (p.get(k)) state.filters[k] = p.get(k); });
    CHECK_KEYS.forEach(([k, kort]) => { if (p.get(kort) === "1") state.filters[k] = true; });
    if (p.get("sorteer")) state.sortering = p.get("sorteer");
    // Formulier gelijkzetten met de ingelezen status
    const zet = (id, w) => { const n = el(id); if (n) n.value = w; };
    zet("filterType", state.filters.type); zet("filterCapaciteit", state.filters.capaciteit);
    zet("filterInstallatie", state.filters.installatie); zet("filterMerk", state.filters.merk);
    zet("sorteer", state.sortering);
    const vink = (id, w) => { const n = el(id); if (n) n.checked = w; };
    vink("checkHomey", state.filters.homey); vink("checkHA", state.filters.homeAssistant);
    vink("checkDynamisch", state.filters.dynamisch); vink("checkOfficieel", state.filters.officieel);
    vink("checkNoodstroom", state.filters.noodstroom);
    vink("checkAanbieding", state.filters.aanbieding);
  }

  function gefilterd() {
    const f = state.filters;
    return state.batterijen.filter((b) => {
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

  // Merklogo: toont het officiële logo naast de merknaam zodra het bestand in
  // assets/logos/ staat en is geregistreerd in data/batterijen.json (merk_logos).
  function merkHtml(b) {
    const logo = (state.meta.merk_logos || {})[b.merk];
    return logo
      ? `<img class="merk-logo" src="${escapeHtml(logo)}" alt="" loading="lazy"> ${escapeHtml(b.merk)}`
      : escapeHtml(b.merk);
  }

  // Koppel-score: unieke Batterijmaatje-score voor slim aansturen (0 tot 6 punten).
  // Homey, Home Assistant en dynamisch contract tellen elk: ja = 2, deels = 1, nee = 0.
  // De formule staat uitgelegd op uitleg.html#koppel-score en over-ons.html.
  function koppelScore(b) {
    const punt = (v) => { const s = driewaardig(v).status; return s === "ja" ? 2 : s === "deels" ? 1 : 0; };
    return punt(b.homey) + punt(b.home_assistant) + punt(b.dynamisch_contract);
  }

  function koppelScoreBadge(b) {
    const score = koppelScore(b);
    const klasse = score >= 5 ? "koppel-hoog" : score >= 3 ? "koppel-midden" : "koppel-laag";
    return `<span class="badge koppel-score ${klasse}" title="Koppel-score ${score} van 6: punten voor samenwerking met Homey, Home Assistant en een dynamisch energiecontract (2 punten per volledige, 1 per gedeeltelijke ondersteuning). Tik voor de details.">${Iconen.svg("koppeling")} Koppel-score ${score}/6</span>`;
  }

  function badgeHtml(label, waarde, titelJa, titelDeels) {
    const d = driewaardig(waarde);
    const icoon = Iconen.svg(d.status === "ja" ? "ja" : d.status === "deels" ? "deels" : "nee");
    const titel = d.status === "deels" ? d.tekst : d.status === "ja" ? (titelJa || "Ondersteund") : "Niet ondersteund";
    return `<span class="badge ${d.status}" data-uitleg="${escapeHtml(label)}" title="${escapeHtml(titel)}">${icoon} ${escapeHtml(label)}</span>`;
  }

  function noodstroomBadge(b) {
    const d = vierwaardig(b.noodstroom);
    const icoon = Iconen.svg({ ja: "ja", deels: "deels", nee: "nee", onbekend: "onbekend" }[d.status]);
    return `<span class="badge ${d.status}" data-uitleg="Noodstroom" title="${escapeHtml(b.noodstroom_uitleg || d.tekst)}">${icoon} Noodstroom</span>`;
  }

  function sterren(score) {
    const s = Math.max(0, Math.min(5, Math.round(score || 0)));
    const ster = (gevuld) => Iconen.svg("ster", { gevuld });
    return `<span class="sterren-rij" role="img" aria-label="${s} van 5 sterren">${ster(true).repeat(s)}${ster(false).repeat(5 - s)}</span>`;
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  // "Sessy" + model "Sessy 5 kWh" zou anders "Sessy Sessy 5 kWh" opleveren
  const naamVan = (b) => b.model.toLowerCase().startsWith(b.merk.toLowerCase()) ? b.model : `${b.merk} ${b.model}`;

  // ISO-datum (2026-07-13) leesbaar maken als "13 juli 2026"
  function datumNL(iso) {
    const d = new Date(`${iso}T12:00:00`);
    return Number.isNaN(d.getTime()) ? iso : datumFmt.format(d);
  }

  function kaartHtml(b) {
    const beste = bestePrijs(b);
    const korting = heeftKorting(b);
    const perKwh = prijsPerKwh(b);
    // De prijs die groot in beeld komt is de vergelijkprijs incl. btw. Wijkt die
    // af van wat de winkel toont, dan staat de winkelprijs er zichtbaar bij.
    const vergelijk = Prijs.vergelijkPrijs(beste);
    const omgerekend = Prijs.isOmgerekend(beste);
    const vanPrijs = Prijs.vanPrijs(b);
    // Prijzen excl. btw/installatie krijgen een nadrukkelijker waarschuwing,
    // zodat de kale winkelprijs geen verkeerd prijsbeeld geeft
    const exclPrijs = /excl/i.test(b.prijs_omvat || "");
    const typeLabel = { "plug-in": "Plug-in (stopcontact)", "ac-gekoppeld": "AC-gekoppeld", "hybride": "Hybride omvormer" }[b.type] || b.type;
    const geselecteerd = state.vergelijkSelectie.includes(b.id);

    const capaciteit = b.capaciteit_kwh
      ? `${String(b.capaciteit_kwh).replace(".", ",")} kWh${b.uitbreidbaar_tot_kwh ? ` <small>(tot ${String(b.uitbreidbaar_tot_kwh).replace(".", ",")})</small>` : ""}`
      : "Onbekend";

    return `
    <article class="batterij-kaart" data-id="${escapeHtml(b.id)}">
      <div class="vergelijk-checkbox-wrap">
        <label class="badge" title="Selecteer om te vergelijken (max. 3)">
          <input type="checkbox" class="vergelijk-check" data-id="${escapeHtml(b.id)}" ${geselecteerd ? "checked" : ""}> vergelijk
        </label>
      </div>
      <div class="kaart-kop">
        <div>
          <div class="merk">${merkHtml(b)}</div>
          <h3><a href="batterij/${encodeURIComponent(b.id)}.html" style="color:inherit;text-decoration:none;" title="Alle details van de ${escapeHtml(naamVan(b))}">${escapeHtml(b.model)}</a></h3>
          <a class="term-link" href="uitleg.html#${escapeHtml(b.type)}" title="Wat betekent dit? Lees de uitleg in de woordenlijst"><span class="type-badge type-${escapeHtml(b.type)}">${escapeHtml(typeLabel)}</span></a>
        </div>
        ${korting ? '<span class="aanbieding-vlag">Aanbieding</span>' : ""}
      </div>
      <div class="kaart-specs">
        <div class="spec"><span class="spec-label"><a class="term-link" href="uitleg.html#capaciteit" title="Wat is capaciteit (kWh)? Lees de uitleg">Capaciteit</a></span><span class="spec-waarde">${capaciteit}</span></div>
        <div class="spec"><span class="spec-label"><a class="term-link" href="uitleg.html#kw" title="Wat is vermogen (kW)? Lees de uitleg">Vermogen</a></span><span class="spec-waarde">${b.vermogen_kw ? String(b.vermogen_kw).replace(".", ",") + " kW" : "Onbekend"}</span></div>
        <div class="spec"><span class="spec-label">Installatie</span><span class="spec-waarde">${b.installatie === "zelf" ? "Zelf (stopcontact)" : "Installateur"}</span></div>
        <div class="spec"><span class="spec-label">Garantie</span><span class="spec-waarde">${b.garantie_jaar ? b.garantie_jaar + " jaar" : "Onbekend"}</span></div>
      </div>
      <div class="koppelgemak" title="Aansluitgemak: hoe makkelijk sluit je deze batterij aan op je bestaande zonnepanelensysteem? 5 sterren = plug &amp; play.">
        <span class="spec-label">Aansluitgemak op je zonnepanelen</span><br>
        <span class="sterren">${sterren(b.koppeling_gemak)}</span>
        <div class="uitleg">${escapeHtml(b.zonnepanelen_koppeling || "")}</div>
      </div>
      <div class="kaart-badges">
        ${koppelScoreBadge(b)}
        ${badgeHtml("Homey", b.homey)}
        ${badgeHtml("Home Assistant", b.home_assistant)}
        ${badgeHtml("Dynamisch contract", b.dynamisch_contract)}
        ${noodstroomBadge(b)}
      </div>
      <button class="details-toggle" data-id="${escapeHtml(b.id)}" aria-label="Meer details over de ${escapeHtml(naamVan(b))}">Meer details</button>
      <div class="kaart-details" data-details="${escapeHtml(b.id)}" hidden>
        <dt>Homey</dt><dd>${escapeHtml(driewaardig(b.homey).tekst)}</dd>
        <dt>Home Assistant</dt><dd>${escapeHtml(driewaardig(b.home_assistant).tekst)}</dd>
        <dt>Dynamisch contract</dt><dd>${escapeHtml(driewaardig(b.dynamisch_contract).tekst)}</dd>
        <dt>Noodstroom bij stroomuitval</dt><dd>${escapeHtml(b.noodstroom_uitleg || vierwaardig(b.noodstroom).tekst)}</dd>
        ${b.opmerkingen ? `<dt>Goed om te weten</dt><dd>${escapeHtml(b.opmerkingen)}</dd>` : ""}
        ${b.cycli ? `<dt>Laadcycli (garantie)</dt><dd>${escapeHtml(String(b.cycli))}</dd>` : ""}
        ${b.fase ? `<dt>Aansluiting</dt><dd>${escapeHtml(b.fase)}</dd>` : ""}
        ${b.app ? `<dt>App</dt><dd>${escapeHtml(b.app)}</dd>` : ""}
        ${(b.aanbiedingen || []).length ? `<dt>Verkrijgbaar bij</dt><dd><ul class="winkel-lijst">${b.aanbiedingen.map((a) => `<li><span>${escapeHtml(a.winkel)}</span><span><b>${eurFmt.format(a.prijs_eur)}</b>${Prijs.isOmgerekend(a) ? " <small>excl. btw</small>" : ""}${a.omvat ? ` <small>${escapeHtml(a.omvat)}</small>` : ""} &nbsp;<a href="${escapeHtml(koopUrl(a))}" target="_blank" rel="noopener${a.affiliate_url ? " sponsored" : ""}">bekijk</a></span></li>`).join("")}</ul></dd>` : ""}
        ${b.product_url ? `<dt>Fabrikant</dt><dd><a href="${escapeHtml(b.product_url)}" target="_blank" rel="noopener">officiële productpagina</a></dd>` : ""}
        ${b.prijs_datum ? `<dd class="datum-stempel" style="margin-top:8px;">Prijs gecontroleerd: ${escapeHtml(datumNL(b.prijs_datum))}</dd>` : ""}
      </div>
      <div class="kaart-prijs">
        <div class="prijs-blok">
          ${vanPrijs ? `<div class="van-prijs">${eurFmt.format(vanPrijs)}</div>` : ""}
          <div class="prijs">${vergelijk !== null ? eurFmt.format(vergelijk) : "Prijs op aanvraag"}</div>
          ${perKwh ? `<div class="prijs-per-kwh">${eurFmt.format(perKwh)} per kWh opslag</div>` : ""}
          ${beste && beste.is_richtprijs ? `<div class="prijs-winkel">richtprijs; op dit moment geen winkel met deze batterij</div>` : beste && beste.winkel ? `<div class="prijs-winkel">bij ${escapeHtml(beste.winkel)}</div>` : ""}
          ${omgerekend ? `<div class="prijs-let-op">De winkel toont ${eurFmt.format(beste.prijs_eur)} <b>excl. btw</b>. Hierboven staat het bedrag incl. btw, zodat het te vergelijken is met de andere batterijen.</div>` : ""}
          ${beste && beste.omvat && b.richtprijs_eur ? `<div class="prijs-let-op">Deze winkelprijs is <b>${escapeHtml(beste.omvat)}</b>; de richtprijs van ${eurFmt.format(b.richtprijs_eur)} dekt meer. Het verschil is dus geen korting.</div>` : ""}
          ${b.prijs_omvat ? `<div class="prijs-winkel prijs-dekt">${escapeHtml(b.prijs_omvat)}</div>` : ""}
          <div class="prijs-winkel" style="margin-top:6px;border-top:1px dashed var(--kleur-rand);padding-top:6px;${exclPrijs ? "font-size:0.95rem;color:var(--kleur-tekst);" : ""}" title="${escapeHtml(b.totaalprijs_toelichting || "")}">
            ${beste && b.totaalprijs_van_eur === beste.prijs_eur && !b.totaalprijs_tot_eur
              ? `${Iconen.svg("ja")} Dit is de complete prijs, gebruiksklaar`
              : `Compleet gebruiksklaar (indicatie): <b>${totaalprijsTekst(b) || "op aanvraag"}</b>`}
          </div>
        </div>
      </div>
      <div class="kaart-acties">
        ${beste && beste.url ? `<a class="knop" href="${escapeHtml(koopUrl(beste))}" target="_blank" rel="noopener${beste.affiliate_url ? " sponsored" : ""}" aria-label="Bekijk de aanbieding van de ${escapeHtml(naamVan(b))} bij ${escapeHtml(beste.winkel || "de winkel")}">Bekijk aanbieding ${Iconen.svg("pijl-rechts")}</a>` : (b.product_url ? `<a class="knop" href="${escapeHtml(b.product_url)}" target="_blank" rel="noopener" aria-label="Naar de aanbieder van de ${escapeHtml(naamVan(b))}">Naar aanbieder ${Iconen.svg("pijl-rechts")}</a>` : "")}
        <a class="knop knop-secundair" href="rekenmodule.html?batterij=${encodeURIComponent(b.id)}" title="Bereken de terugverdientijd van deze batterij voor jouw situatie" aria-label="Bereken de terugverdientijd van de ${escapeHtml(naamVan(b))}">Terugverdientijd</a>
      </div>
      ${beste && beste.affiliate_url ? `<div class="datum-stempel" style="padding:0 20px 12px;">Dit is een commissielink: kost jou niets, beïnvloedt de vergelijking niet. <a href="over-ons.html">Uitleg</a></div>` : ""}
    </article>`;
  }

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
            <td>${b.capaciteit_kwh ? String(b.capaciteit_kwh).replace(".", ",") : "?"}</td>
            <td>${b.vermogen_kw ? String(b.vermogen_kw).replace(".", ",") : "?"}</td>
            <td>${escapeHtml(b.type)}</td>
            <td class="tabel-prijs" title="${escapeHtml([b.prijs_omvat, Prijs.prijsToelichting(beste)].filter(Boolean).join(" | "))}">${Prijs.vergelijkPrijs(beste) !== null ? eurFmt.format(Prijs.vergelijkPrijs(beste)) : "n.b."}${heeftKorting(b) ? ' <span class="aanbieding-vlag">deal</span>' : ""}</td>
            <td title="${escapeHtml(b.totaalprijs_toelichting || "")}">${totaalprijsTekst(b) || "op aanvraag"}</td>
            <td>${perKwh ? eurFmt.format(perKwh) : "n.b."}</td>
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
        ${rij("Capaciteit", (b) => (b.capaciteit_kwh ? String(b.capaciteit_kwh).replace(".", ",") + " kWh" : "?") + (b.uitbreidbaar_tot_kwh ? ` (uitbreidbaar tot ${String(b.uitbreidbaar_tot_kwh).replace(".", ",")} kWh)` : ""))}
        ${rij("Vermogen", (b) => (b.vermogen_kw ? String(b.vermogen_kw).replace(".", ",") + " kW" : "?"))}
        ${rij("Beste prijs incl. btw", (b) => {
          const p = bestePrijs(b);
          if (!p) return "n.b.";
          const toelichting = Prijs.prijsToelichting(p);
          return `<b>${eurFmt.format(Prijs.vergelijkPrijs(p))}</b> bij ${escapeHtml(p.winkel || "")}${toelichting ? `<br><small>${escapeHtml(toelichting)}</small>` : ""}`;
        })}
        ${rij("Compleet gebruiksklaar (indicatie)", (b) => `${totaalprijsTekst(b) || "op aanvraag"}<br><small>${escapeHtml(b.totaalprijs_toelichting || "")}</small>`)}
        ${rij("Prijs per kWh", (b) => { const p = prijsPerKwh(b); return p ? eurFmt.format(p) : "n.b."; })}
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
      state.filters = { type: "alle", capaciteit: "alle", installatie: "alle", merk: "alle", homey: false, homeAssistant: false, dynamisch: false, officieel: false, noodstroom: false, aanbieding: false };
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
        const d = new Date(data.laatst_bijgewerkt + "T12:00:00");
        el("updateDatum").textContent = datumFmt.format(d);
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
