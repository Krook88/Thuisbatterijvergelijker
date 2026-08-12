/* ==========================================================================
   De batterijkaart - één opmaak, gebruikt door de browser én de generator
   ==========================================================================

   Waarom dit bestand bestaat: de vergelijker op de homepage tekende zijn
   kaarten pas in de browser. In de HTML die een bezoeker (of een zoekmachine)
   binnenkrijgt stond alleen "Batterijen laden...". Geen prijzen, geen
   modelnamen, en geen enkele link naar de 41 batterijpagina's - terwijl juist
   die links bepalen hoe goed die pagina's gevonden worden.

   De oplossing is niet om de opmaak in de generator na te bouwen: dan zijn er
   twee versies die vroeg of laat uit elkaar lopen. In plaats daarvan staat de
   opmaak hier, en gebruiken zowel assets/app.js als
   scripts/genereer-batterijpaginas.mjs deze functies. De generator zet de
   kaarten kant-en-klaar in index.html; de browser vervangt ze zodra iemand
   gaat filteren of sorteren, met exact dezelfde uitkomst.

   Werkt zowel in de browser (window.Kaart) als in Node (require).
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./prijs.js"), require("./iconen.js"));
  } else {
    root.Kaart = factory(root.Prijs, root.Iconen);
  }
})(typeof self !== "undefined" ? self : globalThis, function (Prijs, Iconen) {
  "use strict";

  const eurFmt = new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });

  const datumFmt = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric" });

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  // "Sessy" + model "Sessy 5 kWh" zou anders "Sessy Sessy 5 kWh" opleveren
  const naamVan = (b) => (b.model.toLowerCase().startsWith(b.merk.toLowerCase()) ? b.model : `${b.merk} ${b.model}`);

  // ISO-datum (2026-07-13) leesbaar maken als "13 juli 2026"
  function datumNL(iso) {
    const d = new Date(`${iso}T12:00:00`);
    return Number.isNaN(d.getTime()) ? iso : datumFmt.format(d);
  }

  // true / "tekst" => ondersteund (evt. met kanttekening); false/null => niet
  function driewaardig(v) {
    // Objectvorm {status, tekst}: officiële ondersteuning ("ja") mét uitlegtekst
    if (v && typeof v === "object") return { status: v.status || "deels", tekst: v.tekst || "" };
    if (v === true) return { status: "ja", tekst: "Ja" };
    if (typeof v === "string" && v.trim()) return { status: "deels", tekst: v };
    return { status: "nee", tekst: "Nee" };
  }

  function vierwaardig(v) {
    if (v === undefined || v === null) return { status: "onbekend", tekst: "Onbekend; controleer dit bij de leverancier" };
    return driewaardig(v);
  }

  // Kooplink: de commissielink (affiliate) als die er is, anders de gewone
  // productlink. De dagelijkse prijscontrole gebruikt altijd de gewone url.
  function koopUrl(a) {
    return (a && (a.affiliate_url || a.url)) || "";
  }

  function totaalprijsTekst(b) {
    if (b.totaalprijs_van_eur) {
      return eurFmt.format(b.totaalprijs_van_eur) + (b.totaalprijs_tot_eur ? " tot " + eurFmt.format(b.totaalprijs_tot_eur) : "");
    }
    // Geen bedrag uit een bron, wel een schatting: het toestel plus een
    // marktbreed installatiebedrag. Die staat er met "geschat" bij, want de
    // vergelijking op prijs per kWh doet er niet mee - anders zou een geschat
    // getal meetellen alsof het vaststaat.
    if (b.totaalprijs_geschat_van_eur) {
      return `${eurFmt.format(b.totaalprijs_geschat_van_eur)} tot ${eurFmt.format(b.totaalprijs_geschat_tot_eur)} <small>geschat</small>`;
    }
    return null;
  }

  // Merklogo: toont het officiële logo naast de merknaam zodra het bestand in
  // assets/logos/ staat en is geregistreerd in data/batterijen.json (merk_logos).
  function merkHtml(b, merkLogos) {
    const logo = (merkLogos || {})[b.merk];
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

  function badgeHtml(label, waarde, titelJa) {
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

  // Productfoto van een batterij, als die er is. Twee vormen zijn toegestaan:
  // een bestand in de repository ("assets/producten/sessy-5kwh.webp") of een
  // volledige URL naar een externe bron. Zonder foto blijft de kaart zoals hij
  // was; er komt geen leeg vak.
  //
  // De afmetingen staan vast in de opmaak, zodat de kaart niet verspringt zodra
  // de afbeelding binnenkomt. Alle foto's laden lui: op de vergelijker staan er
  // tientallen onder de vouw.
  function fotoHtml(b) {
    const foto = b.afbeelding;
    if (!foto) return "";
    const bron = b.afbeelding_bron ? `<span class="foto-bron">${escapeHtml(b.afbeelding_bron)}</span>` : "";
    return `<div class="kaart-foto">
          <img src="${escapeHtml(foto)}" alt="${escapeHtml(naamVan(b))}" loading="lazy" decoding="async" width="600" height="450">
          ${bron}
        </div>`;
  }

  // De volgorde waarin de vergelijker begint: beste prijs per kWh bovenaan.
  // De generator gebruikt dezelfde volgorde, zodat de voorgerenderde kaarten
  // gelijk staan aan wat de bezoeker ziet voordat hij iets aanraakt.
  function standaardVolgorde(lijst) {
    return [...lijst].sort((a, b) => (Prijs.prijsPerKwh(a) || Infinity) - (Prijs.prijsPerKwh(b) || Infinity));
  }

  function kaartHtml(b, opties) {
    const o = opties || {};
    const beste = Prijs.beste(b);
    const korting = Prijs.heeftKorting(b);
    const perKwh = Prijs.prijsPerKwh(b);
    // De prijs die groot in beeld komt is de vergelijkprijs incl. btw. Wijkt die
    // af van wat de winkel toont, dan staat de winkelprijs er zichtbaar bij.
    const vergelijk = Prijs.vergelijkPrijs(beste);
    const omgerekend = Prijs.isOmgerekend(beste);
    const vanPrijs = Prijs.vanPrijs(b);
    // Prijzen excl. btw/installatie krijgen een nadrukkelijker waarschuwing,
    // zodat de kale winkelprijs geen verkeerd prijsbeeld geeft
    const exclPrijs = /excl/i.test(b.prijs_omvat || "");
    const typeLabel = { "plug-in": "Plug-in (stopcontact)", "ac-gekoppeld": "AC-gekoppeld", "hybride": "Hybride omvormer" }[b.type] || b.type;
    const geselecteerd = !!o.geselecteerd;

    const capaciteit = b.capaciteit_kwh
      ? `${String(b.capaciteit_kwh).replace(".", ",")} kWh${Prijs.capaciteitLabelHtml(b)}${b.uitbreidbaar_tot_kwh ? ` <small>(tot ${String(b.uitbreidbaar_tot_kwh).replace(".", ",")})</small>` : ""}`
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
          <div class="merk">${merkHtml(b, o.merkLogos)}</div>
          <h3><a class="kop-link" href="batterij/${encodeURIComponent(b.id)}.html" title="Alle details van de ${escapeHtml(naamVan(b))}">${escapeHtml(b.model)}</a></h3>
          <a class="term-link" href="uitleg.html#${escapeHtml(b.type)}" title="Wat betekent dit? Lees de uitleg in de woordenlijst"><span class="type-badge type-${escapeHtml(b.type)}">${escapeHtml(typeLabel)}</span></a>
        </div>
        ${korting ? '<span class="aanbieding-vlag">Aanbieding</span>' : ""}
      </div>
      ${fotoHtml(b)}
      <div class="kaart-specs">
        <div class="spec"><span class="spec-label"><a class="term-link" href="uitleg.html#capaciteit" title="Wat is capaciteit (kWh)? Lees de uitleg">Capaciteit</a></span><span class="spec-waarde">${capaciteit}</span></div>
        <div class="spec"><span class="spec-label"><a class="term-link" href="uitleg.html#kw" title="Wat is vermogen (kW)? Lees de uitleg">Vermogen</a></span><span class="spec-waarde">${b.vermogen_kw ? String(b.vermogen_kw).replace(".", ",") + " kW" + Prijs.vermogenLabelHtml(b) : "Onbekend"}</span></div>
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
        ${b.prijs_datum ? `<dd class="datum-stempel prijs-gecontroleerd">Prijs gecontroleerd: ${escapeHtml(datumNL(b.prijs_datum))}</dd>` : ""}
      </div>
      <div class="kaart-prijs">
        <div class="prijs-blok">
          ${vanPrijs ? `<div class="van-prijs">${eurFmt.format(vanPrijs)}</div>` : ""}
          <div class="prijs">${vergelijk !== null ? eurFmt.format(vergelijk) : "Prijs op aanvraag"}</div>
          ${perKwh ? `<div class="prijs-per-kwh"${Prijs.capaciteitToelichting(b) ? ` title="Per kWh: ${Prijs.capaciteitToelichting(b)}"` : ""}>${eurFmt.format(perKwh)} per kWh opslag</div>` : ""}
          ${beste && beste.is_richtprijs ? `<div class="prijs-winkel">richtprijs; op dit moment geen winkel met deze batterij</div>` : beste && beste.winkel ? `<div class="prijs-winkel">bij ${escapeHtml(beste.winkel)}</div>` : ""}
          ${omgerekend ? `<div class="prijs-let-op">De winkel toont ${eurFmt.format(beste.prijs_eur)} <b>excl. btw</b>. Hierboven staat het bedrag incl. btw, zodat het te vergelijken is met de andere batterijen.</div>` : ""}
          ${beste && beste.omvat && b.richtprijs_eur ? `<div class="prijs-let-op">Deze winkelprijs is <b>${escapeHtml(beste.omvat)}</b>; de richtprijs van ${eurFmt.format(b.richtprijs_eur)} dekt meer. Het verschil is dus geen korting.</div>` : ""}
          ${b.prijs_omvat ? `<div class="prijs-winkel prijs-dekt">${escapeHtml(b.prijs_omvat)}</div>` : ""}
          <div class="prijs-winkel prijs-totaal${exclPrijs ? " nadruk" : ""}" title="${escapeHtml(b.totaalprijs_toelichting || "")}">
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
      ${beste && beste.affiliate_url ? `<div class="datum-stempel commissie-melding">Dit is een commissielink: kost jou niets, beïnvloedt de vergelijking niet. <a href="over-ons.html">Uitleg</a></div>` : ""}
    </article>`;
  }

  return {
    eurFmt,
    escapeHtml,
    naamVan,
    datumNL,
    driewaardig,
    vierwaardig,
    koopUrl,
    totaalprijsTekst,
    merkHtml,
    koppelScore,
    koppelScoreBadge,
    badgeHtml,
    noodstroomBadge,
    sterren,
    standaardVolgorde,
    fotoHtml,
    kaartHtml,
  };
});
