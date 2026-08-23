/* ==========================================================================
   De paneelkaart - één opmaak, gebruikt door de browser én de generator
   ==========================================================================

   Waarom dit bestand bestaat: de vergelijker op de homepage tekende zijn
   kaarten pas in de browser. In de HTML die een bezoeker (of een zoekmachine)
   binnenkrijgt stond geen enkele paneelnaam, geen prijs, en geen enkele link
   naar de veertien paneelpagina's - terwijl juist die links bepalen hoe goed
   die pagina's gevonden worden.

   De oplossing is niet om de opmaak in de generator na te bouwen: dan zijn er
   twee versies die vroeg of laat uit elkaar lopen. In plaats daarvan staat de
   opmaak hier, en gebruiken zowel assets/app.js als
   scripts/genereer-paneelpaginas.mjs deze functies. De generator zet de
   kaarten kant-en-klaar in index.html; de browser vervangt ze zodra iemand
   gaat filteren of sorteren, met exact dezelfde uitkomst.

   Zelfde opzet als op batterijmaatje. Wat per site verschilt is wat er op de
   kaart staat (wattpiek en Zeker-score in plaats van kWh en Koppel-score),
   niet hoe het werkt.

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

  // Prijs per wattpiek is een klein bedrag; twee decimalen nodig
  const eurWpFmt = new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const datumFmt = new Intl.DateTimeFormat("nl-NL", { dateStyle: "long" });

  const bestePrijs = (p) => Prijs.beste(p);
  const heeftKorting = (p) => Prijs.heeftKorting(p);
  const prijsPerWp = (p) => Prijs.prijsPerWp(p);

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

  // Een prijs die al weken stilstaat hoort dat te zeggen op de plek waar het
  // bedrag staat. De site belooft "prijzen dagelijks gecontroleerd"; klopt dat
  // voor dit model even niet, dan is dat een mededeling en geen voetnoot in de
  // uitklap. Prijs.prijsOuderdomLabel geeft null zolang het meevalt, dus staat
  // er niets bij de meeste kaarten.
  function ouderdomHtml(item) {
    const oud = Prijs.prijsOuderdomLabel(item);
    if (!oud) return "";
    return `<span class="prijs-ouderdom" title="Dit bedrag is ${oud.dagen} dagen niet bevestigd bij de winkel; controleer het daar voordat je bestelt">prijs van ${escapeHtml(datumNL(oud.datum))}</span>`;
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

  // Kooplink: de commissielink (affiliate) als die er is, anders de gewone
  // productlink. De prijscontrole gebruikt altijd de gewone url.
  function koopUrl(a) {
    return (a && (a.affiliate_url || a.url)) || "";
  }

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
    const klasse = score >= 5 ? "niveau-hoog" : score >= 3 ? "niveau-midden" : "niveau-laag";
    return `<span class="badge zeker-score ${klasse}" title="Zeker-score ${score} van 6: punten voor productgarantie, vermogensbehoud na 25 jaar en glas-glas uitvoering (2 punten per onderdeel). Tik voor de details.">${Iconen.svg("veiligheid")} Zeker-score ${score}/6</span>`;
  }

  // Sterren voor opbrengst per vierkante meter dak (vermogensdichtheid).
  // Het rendement bepaalt direct hoeveel Wp er op een m² dak past:
  // 22% rendement = 220 Wp per m² paneel.
  function dakSterren(p) {
    const r = p.rendement_pct || 0;
    return r >= 22.8 ? 5 : r >= 22.4 ? 4 : r >= 22.0 ? 3 : r >= 21.5 ? 2 : 1;
  }


  /* Eén vorm voor elk oordeel op een schaal, zie .waardering in de opmaak.
     Eerder stonden hier sterren; die lezen als een recensiecijfer van
     gebruikers, terwijl dit een rekensom is die op uitleg.html staat. */
  function waardering(score, max) {
    const n = Math.max(0, Math.min(max, Math.round(Number(score) || 0)));
    const deel = n / max;
    const niveau = deel >= 0.8 ? "hoog" : deel >= 0.5 ? "midden" : "laag";
    return `<span class="waardering niveau-${niveau}" role="img" aria-label="${n} van ${max}"><b>${n}</b><span class="van">/${max}</span></span>`;
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
    return `<span class="badge ${status}" data-uitleg="${escapeHtml(label)}" title="${escapeHtml(titel)}">${icoon} <span class="label">${escapeHtml(label)}</span></span>`;
  }

  // Merklogo: toont het officiële logo naast de merknaam zodra het bestand in
  // assets/logos/ staat en is geregistreerd in data/panelen.json (merk_logos).
  function merkHtml(p, merkLogos) {
    const logo = (merkLogos || {})[p.merk];
    return logo
      ? `<img class="merk-logo" src="${escapeHtml(logo)}" alt="" loading="lazy"> ${escapeHtml(p.merk)}`
      : escapeHtml(p.merk);
  }

  /* De resultaatregel: hetzelfde product, maar dan om kolommen te vergelijken
     in plaats van producten.

     Waarom deze naast de kaart bestaat: een kaart is honderden pixels hoog,
     dus op een scherm passen er drie. Wie twintig producten tegen elkaar houdt
     scrollt zich suf en moet onthouden wat er schermen hoger stond. In een
     regel staan de getallen onder elkaar uitgelijnd, met cijfers van gelijke
     breedte, en zie je er vijf tegelijk.

     Dezelfde volgorde als op de zustersites: plek, model, drie feiten, score,
     prijs. Alleen de kolomnamen verschillen. */
  function regelHtml(p, opties, plek) {
    const o = opties || {};
    const beste = bestePrijs(p);
    const vergelijk = Prijs.vergelijkPrijs(beste);
    const score = zekerScore(p);
    const geselecteerd = (o.selectie || []).includes(p.id);

    return `
    <article class="resultaat-regel" data-id="${escapeHtml(p.id)}">
      <span class="regel-plek cijfer">${plek}</span>
      <div class="regel-naam">
        <span class="regel-merk">${escapeHtml(p.merk)}</span>
        <h3><a class="kop-link" href="paneel/${encodeURIComponent(p.id)}.html">${escapeHtml(p.model)}</a></h3>
        <label class="badge regel-vergelijk" title="Selecteer om te vergelijken (max. 3)">
          <input type="checkbox" class="vergelijk-check" data-id="${escapeHtml(p.id)}" ${geselecteerd ? "checked" : ""}> vergelijk
        </label>
      </div>
      <div class="regel-waarde cijfer" data-naam="Vermogen"><span class="regel-label">Vermogen</span>${p.vermogen_wp ? p.vermogen_wp + " Wp" : "Onbekend"}</div>
      <div class="regel-waarde cijfer" data-naam="Rendement"><span class="regel-label">Rendement</span>${p.rendement_pct ? String(p.rendement_pct).replace(".", ",") + " %" : "Onbekend"}</div>
      <div class="regel-waarde cijfer" data-naam="Uitvoering"><span class="regel-label">Uitvoering</span>${escapeHtml(p.uitvoering || p.celtype || "Onbekend")}</div>
      <div class="regel-waarde cijfer" data-naam="Zeker-score">
        <span class="regel-label">Zeker-score</span>${score}<span class="regel-van">/6</span>
        <span class="regel-baan"><span class="regel-vul" style="width:${Math.round((score / 6) * 100)}%"></span></span>
      </div>
      <div class="regel-slot">
        <span class="regel-bedrag cijfer">${vergelijk !== null ? eurFmt.format(vergelijk) : "Op aanvraag"}</span>
        ${prijsPerWp(p) ? `<span class="regel-per cijfer">${new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(prijsPerWp(p))} per Wp</span>` : ""}
        ${ouderdomHtml(p)}
        ${beste && beste.url && beste.winkel ? `<span class="regel-winkel" title="Waar dit bedrag vandaan komt">${escapeHtml(beste.winkel)}</span>` : ""}
        ${beste && beste.url
          ? `<a class="knop" href="${escapeHtml(koopUrl(beste))}" target="_blank" rel="noopener${beste.affiliate_url ? " sponsored" : ""}" aria-label="Naar de aanbieding van het ${escapeHtml(naamVan(p))}${beste.winkel ? ` bij ${escapeHtml(beste.winkel)}` : ""}, opent in een nieuw tabblad">Naar de winkel <svg class="icoon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h10v10" /> <path d="M7 17 17 7" /></svg></a>`
          : `<a class="knop knop-secundair" href="paneel/${encodeURIComponent(p.id)}.html" aria-label="Alle details van het ${escapeHtml(naamVan(p))}">Bekijk details</a>`}
      </div>
    </article>`;
  }

  /* De kop boven de regels. Staat los van de regel zodat hij een keer in de
     lijst staat en niet bij elk product. */
  function lijstHtml(lijst, opties) {
    const koppen = ["Model", "Vermogen", "Rendement", "Uitvoering", "Zeker-score", "Prijs"];
    return `<div class="resultaat-lijst">
      <div class="resultaat-regel regel-kop" aria-hidden="true">
        <span></span>${koppen.map((k) => `<span>${k}</span>`).join("")}
      </div>
      ${lijst.map((x, i) => regelHtml(x, opties, i + 1)).join("")}
    </div>`;
  }

  function kaartHtml(p, opties) {
    const o = opties || {};
    const beste = bestePrijs(p);
    const korting = heeftKorting(p);
    const perWp = prijsPerWp(p);
    const geselecteerd = !!o.geselecteerd;
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
          <div class="merk">${merkHtml(p, o.merkLogos)}</div>
          <h3><a class="kop-link" href="paneel/${encodeURIComponent(p.id)}.html" title="Alle details van de ${escapeHtml(naamVan(p))}">${escapeHtml(p.model)}</a></h3>
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
        <span class="spec-label klein-kapitaal">Opbrengst per m² dak</span><br>
        ${waardering(dakSterren(p), 5)}
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
        ${(p.aanbiedingen || []).length ? `<dt>Verkrijgbaar bij</dt><dd><ul class="winkel-lijst">${p.aanbiedingen.map((a) => `<li><span>${escapeHtml(a.winkel)}</span><span><b>${eurFmt.format(a.prijs_eur)}</b>${Prijs.isOmgerekend(a) ? " <small>excl. btw</small>" : ""} &nbsp;<a href="${escapeHtml(koopUrl(a))}" target="_blank" rel="noopener${a.affiliate_url ? " sponsored" : ""}">bekijk</a></span></li>`).join("")}</ul></dd>` : ""}
        ${p.product_url ? `<dt>Fabrikant</dt><dd><a href="${escapeHtml(p.product_url)}" target="_blank" rel="noopener">officiële website van ${escapeHtml(p.merk)}</a></dd>` : ""}
        ${p.prijs_datum ? `<dd class="datum-stempel prijs-gecontroleerd">Richtprijs gecontroleerd: ${escapeHtml(datumNL(p.prijs_datum))}</dd>` : ""}
      </div>
      <div class="kaart-prijs">
        <div class="prijs-blok">
          ${korting ? `<div class="van-prijs">${eurFmt.format(p.richtprijs_eur)}</div>` : ""}
          <div class="prijs">${beste ? eurFmt.format(Prijs.vergelijkPrijs(beste)) : "Prijs op aanvraag"}</div>
          ${perWp ? `<div class="prijs-per-kwh">${eurWpFmt.format(perWp)} per Wp</div>` : ""}
          ${ouderdomHtml(p)}
          ${beste && beste.winkel ? `<div class="prijs-winkel">${beste.winkel.startsWith("richtprijs") ? beste.winkel : "bij " + escapeHtml(beste.winkel)}</div>` : ""}
          ${p.prijs_omvat ? `<div class="prijs-winkel">${escapeHtml(p.prijs_omvat)}</div>` : ""}
        </div>
      </div>
      <div class="kaart-acties">
        ${beste && beste.url ? `<a class="knop" href="${escapeHtml(koopUrl(beste))}" target="_blank" rel="noopener${beste.affiliate_url ? " sponsored" : ""}" aria-label="Bekijk de ${escapeHtml(naamVan(p))} bij ${escapeHtml(beste.winkel || "de aanbieder")}">${beste.winkel && !beste.winkel.startsWith("richtprijs") ? "Bekijk aanbieding " + Iconen.svg("pijl-rechts") + "" : "Naar fabrikant " + Iconen.svg("pijl-rechts") + ""}</a>` : ""}
        <a class="knop knop-secundair" href="systeem.html?paneel=${encodeURIComponent(p.id)}" title="Combineer dit paneel met een omvormer en zie de systeemprijs" aria-label="Stel een systeem samen met de ${escapeHtml(naamVan(p))}">In systeem ${Iconen.svg("pijl-rechts")}</a>
        <a class="knop knop-secundair" href="rekenmodule.html?paneel=${encodeURIComponent(p.id)}" title="Bereken de terugverdientijd van dit paneel voor jouw dak" aria-label="Bereken de terugverdientijd van de ${escapeHtml(naamVan(p))}">Terugverdientijd</a>
      </div>
      ${beste && beste.affiliate_url ? `<div class="datum-stempel commissie-melding">Dit is een commissielink: kost jou niets, beïnvloedt de vergelijking niet. <a href="over-ons.html">Uitleg</a></div>` : ""}
    </article>`;
  }


  // De volgorde waarin de vergelijker opent: goedkoopste per wattpiek eerst.
  // De generator gebruikt dezelfde functie, zodat de voorgerenderde kaarten in
  // dezelfde volgorde staan als wat de bezoeker te zien krijgt.
  function standaardVolgorde(lijst) {
    return [...lijst].sort((a, b) => (prijsPerWp(a) || Infinity) - (prijsPerWp(b) || Infinity));
  }

  return {
    eurFmt,
    eurWpFmt,
    escapeHtml,
    naamVan,
    nl,
    datumNL,
    celtypeLabel,
    koopUrl,
    merkHtml,
    zekerScore,
    zekerScoreBadge,
    dakSterren,
    sterren,
    waardering,
    jaNeeBadge,
    bestePrijs,
    heeftKorting,
    prijsPerWp,
    kaartHtml,
    regelHtml,
    lijstHtml,
    standaardVolgorde,
  };
});
