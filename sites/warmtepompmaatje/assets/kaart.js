/* ==========================================================================
   De warmtepompkaart - één opmaak, gebruikt door de browser én de generator
   ==========================================================================

   Waarom dit bestand bestaat: de vergelijker op de homepage tekende zijn
   kaarten pas in de browser. In de HTML die een bezoeker of een zoekmachine
   binnenkrijgt stond alleen "Warmtepompen laden...". Geen merknamen, geen
   prijzen, en geen enkele link naar de dertig pomppagina's - terwijl juist
   die links bepalen hoe goed die pagina's gevonden worden.

   De oplossing is niet om de opmaak in de generator na te bouwen: dan zijn er
   twee versies die vroeg of laat uit elkaar lopen. In plaats daarvan staat de
   opmaak hier, en gebruiken zowel assets/app.js als
   scripts/genereer-warmtepomppaginas.mjs deze functies.

   Zelfde opzet als op de zustersites. Wat per site verschilt is wat er op de
   kaart staat, niet hoe het werkt.

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

  const eurFmt = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const datumFmt = new Intl.DateTimeFormat("nl-NL", { dateStyle: "long" });

  const bestePrijs = (w) => Prijs.beste(w);
  const vergelijkPrijs = (a) => Prijs.vergelijkPrijs(a);

  // ISO-datum (2026-07-22) leesbaar maken als "22 juli 2026"
  function datumNL(iso) {
    const d = new Date(`${iso}T12:00:00`);
    return Number.isNaN(d.getTime()) ? iso : datumFmt.format(d);
  }

  const TYPE_LABEL = { "hybride": "Hybride (naast de cv-ketel)", "all-electric": "All-electric (van het gas af)" };
  const TYPE_KORT = { "hybride": "Hybride", "all-electric": "All-electric" };

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  function driewaardig(v) {
    if (v && typeof v === "object") return { status: v.status || "deels", tekst: v.tekst || "" };
    if (v === true) return { status: "ja", tekst: "Ja" };
    if (typeof v === "string" && v.trim()) return { status: "deels", tekst: v };
    return { status: "nee", tekst: "Nee" };
  }

  function koopUrl(a) {
    return (a && (a.affiliate_url || a.url)) || "";
  }

  /**
   * Toelichting onder de prijs: waarom wijkt dit bedrag af van wat de winkel
   * toont (btw eruit gerekend) en dekt deze aanbieding wel het hele toestel?
   */
  function prijsLetOp(a) {
    const tekst = Prijs.prijsToelichting(a);
    return tekst ? `<div class="prijs-let-op">${escapeHtml(tekst)}</div>` : "";
  }

  /**
   * Een winkel-URL kan alvast in het databestand staan voordat de dagelijkse
   * prijscontrole er een bedrag bij heeft gevonden. Zonder deze functie zou
   * daar "€ NaN" komen te staan.
   */
  function bedragOfWacht(aanbieding) {
    const bedrag = vergelijkPrijs(aanbieding);
    return typeof bedrag === "number" ? eurFmt.format(bedrag) : "prijs volgt";
  }

  // Koppel-score: dezelfde transparante 0-6 rekensom als op de zustersites.
  // Drie zaken tellen mee, elk 0-2 punten:
  //  - slimme aansturing: Modbus/EEBUS/eBUS of rijke open koppeling = 2,
  //    alleen SG-ready of via de thermostaat = 1
  //  - Home Assistant: officiële integratie = 2, community-integratie = 1
  //  - Homey: eigen app = 2, community-app of omweg = 1
  function koppelScore(w) {
    const punt = (v) => { const s = driewaardig(v).status; return s === "ja" ? 2 : s === "deels" ? 1 : 0; };
    return punt(w.sturing) + punt(w.home_assistant) + punt(w.homey);
  }

  /**
   * De Koppel-score is het enige cijfer dat alleen wij geven, dus die verdient
   * beeld in plaats van een badge tussen de badges. Zes segmenten, want de
   * score is opgebouwd uit drie onderdelen van elk twee punten; dat maakt de
   * vorm zelf al informatief.
   *
   * Eén kleurtoon, gevuld donker en leeg licht uit dezelfde reeks: dit is een
   * hoeveelheid, geen status. De vorige versie kleurde hoog blauw en laag
   * grijs, wat een oordeel suggereert dat de score niet velt - en blauw hoort
   * bovendien niet bij deze site.
   *
   * Het getal staat er altijd naast: kleur mag nooit de enige drager zijn.
   */
  function koppelMeter(w, opties) {
    const score = koppelScore(w);
    const groot = opties && opties.groot;
    const segmenten = Array.from({ length: 6 }, (_, i) =>
      `<span class="meter-vak${i < score ? " vol" : ""}"></span>`).join("");
    return `<div class="koppel-meter${groot ? " koppel-meter-groot" : ""}" data-uitleg="Koppel-score">
      <div class="koppel-meter-kop">
        <span class="koppel-meter-label">${Iconen.svg("koppeling")} Koppel-score</span>
        <span class="koppel-meter-cijfer"><b>${score}</b><span class="van">/6</span></span>
      </div>
      <div class="meter-spoor" role="img" aria-label="Koppel-score ${score} van 6"
           title="Punten voor slimme aansturing, Home Assistant en Homey: 2 per volledige ondersteuning, 1 per gedeeltelijke. Tik voor de details.">${segmenten}</div>
    </div>`;
  }

  // De strook plaatst deze pomp op de schaal van alle pompen, dus die lijst
  // moet mee. In de browser is dat state.pompen, in de generator het hele
  // databestand; beide leveren dezelfde uitkomst.
  function geluidStrook(w, pompen) {
    const alle = (pompen || []).map((p) => p.geluid_db).filter((n) => typeof n === "number");
    if (!w.geluid_db || alle.length < 3) {
      return `<div class="geluid-strook leeg"><span class="spec-label">Geluid buitenunit</span><span class="geluid-onbekend">nog niet vastgesteld</span></div>`;
    }
    const laag = Math.min(...alle), hoog = Math.max(...alle);
    const deel = hoog === laag ? 0 : (w.geluid_db - laag) / (hoog - laag);
    const stiller = alle.filter((n) => n < w.geluid_db).length;
    const zin = stiller === 0
      ? "de stilste van deze vergelijking"
      : `stiller dan ${alle.length - stiller - 1} van de ${alle.length - 1} andere`;
    return `<div class="geluid-strook">
      <div class="geluid-kop">
        <span class="spec-label">Geluid buitenunit</span>
        <span class="geluid-waarde">${w.geluid_db} dB(A)</span>
      </div>
      <div class="geluid-spoor" role="img" aria-label="${w.geluid_db} decibel, ${zin}"
           title="Geluidsvermogen volgens het energielabel. De strook loopt van ${laag} dB(A) (stilst hier) tot ${hoog} dB(A) (luidst hier).">
        <span class="geluid-punt" style="left:${(deel * 100).toFixed(1)}%"></span>
      </div>
      <span class="geluid-duiding">${zin}</span>
    </div>`;
  }

  function variantenRegel(w) {
    const v = w.varianten || [];
    if (v.length < 2) return "";
    const bedragen = v.map((x) => x.isde_eur).filter((n) => typeof n === "number");
    const reeks = v.map((x) => x.vermogen_kw).join(", ");
    const isde = bedragen.length
      ? ` De ISDE loopt daarbij van ${eurFmt.format(Math.min(...bedragen))} tot ${eurFmt.format(Math.max(...bedragen))}.`
      : "";
    return `<div class="varianten-regel" title="Vermogens zoals ze op de ISDE-meldcodelijst van RVO staan (opgegeven vermogen volgens EU 811/2013). Dat getal ligt vaak een stap lager dan de maat in de modelnaam.">
      <b>Ook in andere maten:</b> deze reeks staat op de ISDE-lijst in ${reeks} kW.${isde}</div>`;
  }

  function badgeHtml(label, waarde) {
    const d = driewaardig(waarde);
    const icoon = Iconen.svg({ ja: "ja", deels: "deels", onbekend: "onbekend" }[d.status] || "nee");
    return `<span class="badge ${d.status}" data-uitleg="${escapeHtml(label)}" title="${escapeHtml(d.tekst)}">${icoon} ${escapeHtml(label)}</span>`;
  }

  const geluidBekend = (w) => typeof w.geluid_db === "number";

  function kaartHtml(w, opties) {
    const o = opties || {};
    const sturing = driewaardig(w.sturing);
    const ha = driewaardig(w.home_assistant);
    const homey = driewaardig(w.homey);
    const geselecteerd = !!o.geselecteerd;
    const beste = bestePrijs(w);
    const uitWinkel = !!(beste && beste.winkel && !beste.is_richtprijs);
    return `
    <article class="paneel-kaart" data-id="${escapeHtml(w.id)}">
      <div class="vergelijk-checkbox-wrap">
        <label class="badge" title="Selecteer om te vergelijken (max. 3)">
          <input type="checkbox" class="vergelijk-check" data-id="${escapeHtml(w.id)}" ${geselecteerd ? "checked" : ""}> vergelijk
        </label>
      </div>
      <div class="kaart-kop">
        <div>
          <div class="merk">${escapeHtml(w.merk)}</div>
          <h3>${escapeHtml(w.model)}</h3>
          <span class="type-badge type-${escapeHtml(w.type)}">${escapeHtml(TYPE_KORT[w.type] || w.type)}</span>
        </div>
      </div>
      ${koppelMeter(w)}
      <div class="kaart-specs">
        <div class="spec"><span class="spec-label">Vermogen</span><span class="spec-waarde">${String(w.vermogen_kw).replace(".", ",")} kW</span></div>
        <div class="spec"><span class="spec-label">Koudemiddel</span><span class="spec-waarde">${escapeHtml(w.koudemiddel || "?")}</span></div>
        <div class="spec"><span class="spec-label">Subsidie (ISDE)</span><span class="spec-waarde">circa ${w.isde_indicatie_eur ? eurFmt.format(w.isde_indicatie_eur) : "?"}</span></div>
        <div class="spec"><span class="spec-label">Max. aanvoer</span><span class="spec-waarde">${w.max_aanvoer_c ? w.max_aanvoer_c + " &deg;C" : "?"}</span></div>
      </div>
      ${geluidStrook(w, o.pompen)}
      ${variantenRegel(w)}
      <div class="kaart-badges">
        ${badgeHtml("Slimme aansturing", w.sturing)}
        ${badgeHtml("Home Assistant", w.home_assistant)}
        ${badgeHtml("Homey", w.homey)}
      </div>
      <button class="details-toggle" data-id="${escapeHtml(w.id)}">Meer details</button>
      <div class="kaart-details" data-details="${escapeHtml(w.id)}" hidden>
        <dt>Slimme aansturing</dt><dd>${escapeHtml(sturing.tekst)}</dd>
        <dt>Home Assistant</dt><dd>${escapeHtml(ha.tekst)}</dd>
        <dt>Homey</dt><dd>${escapeHtml(homey.tekst)}</dd>
        <dt>Rendement</dt><dd>${w.scop ? `SCOP circa ${String(w.scop).replace(".", ",")} · ` : ""}${escapeHtml(w.scop_toelichting || "")}</dd>
        <dt>Geluid</dt><dd>${escapeHtml(w.geluid_toelichting || "")}</dd>
        <dt>Warm tapwater</dt><dd>${escapeHtml(w.tapwater || "?")}</dd>
        <dt>Maximale aanvoertemperatuur</dt><dd>${w.max_aanvoer_c ? w.max_aanvoer_c + " °C" : "?"} (hoe hoger, hoe geschikter voor bestaande radiatoren)</dd>
        ${w.opmerkingen ? `<dt>Goed om te weten</dt><dd>${escapeHtml(w.opmerkingen)}</dd>` : ""}
        ${(w.aanbiedingen || []).length ? `<dt>Verkrijgbaar bij</dt><dd><ul class="winkel-lijst">${w.aanbiedingen.map((a) => `<li><span>${escapeHtml(a.winkel)}${Prijs.prijsToelichting(a) ? `<br><small>${escapeHtml(Prijs.prijsToelichting(a))}</small>` : ""}</span><span><b>${bedragOfWacht(a)}</b> &nbsp;<a href="${escapeHtml(koopUrl(a))}" target="_blank" rel="noopener${a.affiliate_url ? " sponsored" : ""}">bekijk</a></span></li>`).join("")}</ul>${w.prijs_datum ? `<span class="datum-stempel" style="display:block;margin-top:8px;">Prijzen gecontroleerd: ${escapeHtml(datumNL(w.prijs_datum))}. Zonder controledatum is de prijs een indicatie.</span>` : ""}</dd>` : ""}
        ${w.product_url ? `<dt>Fabrikant</dt><dd><a href="${escapeHtml(w.product_url)}" target="_blank" rel="noopener">officiële website van ${escapeHtml(w.merk)}</a></dd>` : ""}
      </div>
      <div class="kaart-prijs">
        <div class="prijs-blok">
          <div class="prijs">${beste ? eurFmt.format(vergelijkPrijs(beste)) : "Prijs op aanvraag"}</div>
          ${beste ? `<div class="prijs-winkel">${uitWinkel ? "bij " + escapeHtml(beste.winkel) : beste.winkel}</div>` : ""}
          ${w.voorbeeld_variant ? `<div class="prijs-per-kwh">prijs voor: ${escapeHtml(w.voorbeeld_variant)}</div>` : ""}
          ${w.prijs_toelichting ? `<div class="prijs-winkel">${escapeHtml(w.prijs_toelichting)}</div>` : ""}
          ${beste ? prijsLetOp(beste) : ""}
        </div>
      </div>
      <div class="kaart-acties">
        ${beste && beste.url ? `<a class="knop" href="${escapeHtml(koopUrl(beste))}" target="_blank" rel="noopener" aria-label="Bekijk de ${escapeHtml(w.merk)} ${escapeHtml(w.model)}">${uitWinkel ? `Bekijk aanbieding ${Iconen.svg("pijl-rechts")}` : `Naar fabrikant ${Iconen.svg("pijl-rechts")}`}</a>` : ""}
        <a class="knop knop-secundair" href="pomp/${encodeURIComponent(w.id)}.html" title="Alle specificaties, prijzen en koppelingsdetails van de ${escapeHtml(w.merk)} ${escapeHtml(w.model)}">Alle details</a>
      </div>
      <a class="kaart-naar-reken" href="rekenmodule.html?pomp=${encodeURIComponent(w.id)}" title="Bereken de besparing en terugverdientijd van de ${escapeHtml(w.merk)} ${escapeHtml(w.model)}">Bereken de terugverdientijd van deze pomp ${Iconen.svg("pijl-rechts")}</a>
    </article>`;
  }

  // De volgorde waarin de vergelijker opent: beste Koppel-score eerst, bij een
  // gelijke stand de goedkoopste. De generator gebruikt dezelfde functie, zodat
  // de voorgerenderde kaarten in dezelfde volgorde staan als wat de bezoeker
  // te zien krijgt.
  function standaardVolgorde(lijst) {
    const prijsVan = (w) => { const b = vergelijkPrijs(bestePrijs(w)); return b == null ? Infinity : b; };
    return [...lijst].sort((a, b) => koppelScore(b) - koppelScore(a) || prijsVan(a) - prijsVan(b));
  }

  return {
    eurFmt,
    escapeHtml,
    datumNL,
    driewaardig,
    koopUrl,
    badgeHtml,
    koppelScore,
    koppelMeter,
    geluidStrook,
    variantenRegel,
    prijsLetOp,
    bedragOfWacht,
    bestePrijs,
    vergelijkPrijs,
    geluidBekend,
    TYPE_LABEL,
    TYPE_KORT,
    kaartHtml,
    standaardVolgorde,
  };
});
