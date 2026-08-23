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


  /* Waar dat cijfer vandaan komt.

     De Koppel-score is het enige getal op deze site dat wij zelf bedenken, en
     sinds de vergelijker er standaard op sorteert bepaalt hij ook de volgorde.
     Een cijfer dat de volgorde bepaalt en dat niemand kan narekenen, is
     precies waar een vergelijker zijn geloofwaardigheid verliest: dan is het
     niet te onderscheiden van een cijfer dat zo gewogen is dat er uitkomt wat
     lekker klikt.

     Dus staat de optelsom er nu bij. Dezelfde drie onderdelen die de score
     berekenen, met hun punten - één bron, geen tweede lijst die kan gaan
     afwijken van de rekensom eronder. */
  const KOPPEL_DELEN = [
    { sleutel: "home_assistant", naam: "Home Assistant" },
    { sleutel: "homey", naam: "Homey" },
    { sleutel: "dynamisch_contract", naam: "Dynamisch contract" },
  ];

  function koppelDelen(b) {
    return KOPPEL_DELEN.map((d) => {
      const oordeel = driewaardig(b[d.sleutel]);
      return {
        naam: d.naam,
        status: oordeel.status,
        tekst: oordeel.tekst,
        punten: oordeel.status === "ja" ? 2 : oordeel.status === "deels" ? 1 : 0,
      };
    });
  }

  // Voor het title-attribuut op de regel: de hele som op één regel tekst.
  function koppelSamenvatting(b) {
    return koppelDelen(b).map((d) => `${d.naam} ${d.punten}/2`).join(", ");
  }

  /* De uitsplitsing zoals hij op de productpagina staat, waar de ruimte er is
     en het cijfer het onderwerp is. In de lijst staat de korte vorm: drie
     vakjes die de vorm van de score laten zien, met dezelfde som in de titel. */
  function koppelUitsplitsingHtml(b) {
    const delen = koppelDelen(b);
    const totaal = delen.reduce((n, d) => n + d.punten, 0);
    const regels = delen.map((d) => `<li class="uitsplitsing-regel status-${d.status}">
        <span class="uitsplitsing-naam">${escapeHtml(d.naam)}</span>
        <span class="uitsplitsing-punten"><b>${d.punten}</b><span class="van">/2</span></span>
        <span class="uitsplitsing-uitleg">${escapeHtml(d.tekst)}</span>
      </li>`).join("\n      ");
    return `<div class="koppel-uitsplitsing">
      <b class="uitsplitsing-kop">Zo komt de Koppel-score op ${totaal} van 6</b>
      <ul class="uitsplitsing-lijst">
      ${regels}
      </ul>
      <p class="uitsplitsing-voet">Twee punten per volledige ondersteuning, één per gedeeltelijke, nul als het niet kan. Meer over de weging staat bij <a href="/uitleg.html#koppel-score">de uitleg</a>.</p>
    </div>`;
  }

  function koppelScoreBadge(b) {
    const score = koppelScore(b);
    const klasse = score >= 5 ? "niveau-hoog" : score >= 3 ? "niveau-midden" : "niveau-laag";
    return `<span class="badge koppel-score ${klasse}" title="Koppel-score ${score} van 6: punten voor samenwerking met Homey, Home Assistant en een dynamisch energiecontract (2 punten per volledige, 1 per gedeeltelijke ondersteuning). Tik voor de details.">${Iconen.svg("koppeling")} Koppel-score ${score}/6</span>`;
  }

  function badgeHtml(label, waarde, titelJa) {
    const d = driewaardig(waarde);
    const icoon = Iconen.svg(d.status === "ja" ? "ja" : d.status === "deels" ? "deels" : "nee");
    const titel = d.status === "deels" ? d.tekst : d.status === "ja" ? (titelJa || "Ondersteund") : "Niet ondersteund";
    return `<span class="badge ${d.status}" data-uitleg="${escapeHtml(label)}" title="${escapeHtml(titel)}">${icoon} <span class="label">${escapeHtml(label)}</span></span>`;
  }

  function noodstroomBadge(b) {
    const d = vierwaardig(b.noodstroom);
    const icoon = Iconen.svg({ ja: "ja", deels: "deels", nee: "nee", onbekend: "onbekend" }[d.status]);
    return `<span class="badge ${d.status}" data-uitleg="Noodstroom" title="${escapeHtml(b.noodstroom_uitleg || d.tekst)}">${icoon} <span class="label">Noodstroom</span></span>`;
  }


  /* ---- De dagmaat -------------------------------------------------------

     Een capaciteit in kWh zegt niemand iets. 4,32 of 9,73: allebei "een
     batterij", en groter lijkt beter. Dat laatste is precies het misverstand
     dat een verkoper laat bestaan, want een batterij die groter is dan wat je
     huishouden op een dag buiten de zonuren opmaakt, raakt zijn stroom niet
     kwijt. Die extra kWh betaal je wel.

     De rekenmodule zegt dat al, in een waarschuwing, nadat je een formulier
     hebt ingevuld. Hier staat het bij het getal zelf, op elke regel en op elke
     productpagina, in dezelfde vorm als de Koppel-score: vakjes die vollopen.

     De maatstaf komt uit dezelfde twee aannames als de rekenmodule, zodat er
     geen tweede getal ontstaat dat ervan kan gaan afwijken:
       - een gemiddeld huishouden gebruikt 2.900 kWh per jaar;
       - daarvan valt ongeveer 70% buiten de zonuren (avond, nacht, ochtend).
     Samen: (2900 / 365) x 0,7 = 5,6 kWh per dag. Dat is de volle baan.

     Wat een batterij daarboven heeft, krijgt een grijs staartje. Niet rood en
     niet weggelaten: voor wie een warmtepomp heeft of een auto laadt is die
     ruimte wél zinvol, en dat weet deze pagina niet. Wat de site wél weet is
     dat het bij een gemiddeld verbruik niets doet, en dat staat er dan ook. */
  const JAARVERBRUIK_KWH = 2900;   // gelijk aan de standaard in de rekenmodule
  const BUITEN_ZONUREN = 0.7;      // idem
  const BRUIKBAAR_DEEL = 0.9;      // idem: 90% van bruto is werkelijk bruikbaar
  const DAGBEHOEFTE = (JAARVERBRUIK_KWH / 365) * BUITEN_ZONUREN;  // 5,56 kWh
  const DAGVAKJES = 6;             // vakjes over de volle baan, ~0,93 kWh elk
  const STAARTJES_MAX = 3;         // meer dan dit wordt een streepje te veel

  const eenDecimaal = (n) => n.toFixed(1).replace(".", ",");

  function dagmaat(b) {
    if (!b || typeof b.capaciteit_kwh !== "number") return null;
    const bevestigd = Prijs.capaciteitBevestigd(b);
    const bruikbaar = bevestigd ? b.capaciteit_kwh : b.capaciteit_kwh * BRUIKBAAR_DEEL;
    const stap = DAGBEHOEFTE / DAGVAKJES;
    const vakjes = [];
    for (let i = 0; i < DAGVAKJES; i++) {
      const vol = bruikbaar >= (i + 1) * stap;
      vakjes.push(vol ? 2 : bruikbaar >= (i + 0.5) * stap ? 1 : 0);
    }
    const over = Math.max(0, bruikbaar - DAGBEHOEFTE);
    return {
      bruikbaar,
      bevestigd,
      vakjes,
      over,
      staartjes: Math.min(STAARTJES_MAX, Math.round(over / stap)),
      deel: Math.min(1, bruikbaar / DAGBEHOEFTE),
    };
  }

  // De hele som op één regel tekst, voor het title-attribuut.
  function dagmaatSamenvatting(b) {
    const d = dagmaat(b);
    if (!d) return "";
    const bron = d.bevestigd
      ? "bruikbare capaciteit volgens de fabrikant"
      : `geschat op ${Math.round(BRUIKBAAR_DEEL * 100)}% van de opgegeven ${eenDecimaal(b.capaciteit_kwh)} kWh`;
    const dekking = d.over > 0
      ? `Dat is de hele dagbehoefte, met ${eenDecimaal(d.over)} kWh over die een gemiddeld huishouden op een dag niet opmaakt.`
      : `Dat dekt ${Math.round(d.deel * 100)}% van die ${eenDecimaal(DAGBEHOEFTE)} kWh.`;
    return `Een huishouden van ${JAARVERBRUIK_KWH.toLocaleString("nl-NL")} kWh per jaar gebruikt zo'n ${eenDecimaal(DAGBEHOEFTE)} kWh buiten de zonuren. Deze batterij levert ${eenDecimaal(d.bruikbaar)} kWh (${bron}). ${dekking}`;
  }

  // De korte vorm: dezelfde vakjes als de Koppel-score, met een grijs staartje
  // voor wat er op een gemiddelde dag overblijft.
  function dagmaatHtml(b) {
    const d = dagmaat(b);
    if (!d) return "";
    const vakjes = d.vakjes.map((v) => `<span class="dagmaat-vak vak-${v}"></span>`).join("");
    const staart = Array.from({ length: d.staartjes }, () => '<span class="dagmaat-over"></span>').join("");
    return `<span class="dagmaat" title="${escapeHtml(dagmaatSamenvatting(b))}"><span class="dagmaat-baan">${vakjes}</span>${staart}</span>`;
  }

  // De uitgeschreven vorm op de productpagina, waar de ruimte er is.
  function dagmaatUitlegHtml(b) {
    const d = dagmaat(b);
    if (!d) return "";
    const oordeel = d.over > 0
      ? `Deze batterij is daar ruim voor. De ${eenDecimaal(d.over)} kWh die overblijft, raakt hij op zo'n dag niet kwijt: die telt pas mee als je meer buiten de zonuren gebruikt, bijvoorbeeld met een warmtepomp of een auto aan de laadpaal.`
      : d.deel >= 0.95
        ? "Deze batterij dekt die dag vrijwel precies, zonder dat je betaalt voor ruimte die je niet gebruikt."
        : `Deze batterij dekt daar ${Math.round(d.deel * 100)}% van. De rest koop je die avond gewoon in.`;
    const herkomst = d.bevestigd
      ? `De fabrikant geeft ${eenDecimaal(b.capaciteit_kwh)} kWh op als bruikbare capaciteit.`
      : `De fabrikant geeft ${eenDecimaal(b.capaciteit_kwh)} kWh op zonder erbij te zeggen hoeveel daarvan bruikbaar is; hier staat ${Math.round(BRUIKBAAR_DEEL * 100)}% daarvan, ${eenDecimaal(d.bruikbaar)} kWh.`;
    return `<div class="dagmaat-uitleg">
      <b class="dagmaat-kop">${eenDecimaal(d.bruikbaar)} kWh tegenover een dagbehoefte van ${eenDecimaal(DAGBEHOEFTE)} kWh</b>
      ${dagmaatHtml(b)}
      <p>Een huishouden met ${JAARVERBRUIK_KWH.toLocaleString("nl-NL")} kWh per jaar gebruikt ongeveer ${eenDecimaal(DAGBEHOEFTE)} kWh buiten de zonuren, dus in de avond, de nacht en de vroege ochtend. Dat is wat een thuisbatterij op een gemiddelde dag kan opvangen. ${oordeel}</p>
      <p class="dagmaat-voet">${herkomst} Andere aannames? Vul je eigen verbruik in bij de <a href="/rekenmodule.html?batterij=${encodeURIComponent(b.id)}">terugverdientijd-berekening</a>.</p>
    </div>`;
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
  //
  // Ook zonder foto komt het kader er. Veertien van de 41 batterijen hebben er
  // geen, en die kaarten waren daardoor 279 px korter dan hun buren. In een rij
  // van drie rekt elke kaart mee met de langste, dus dat verschil werd geen
  // kortere kaart maar een gat onderin. Een leeg kader is eerlijker: je ziet
  // dat er geen foto is in plaats van dat de rij scheef staat.
  function fotoHtml(b) {
    const foto = b.afbeelding;
    if (!foto) {
      return `<div class="kaart-foto leeg" aria-hidden="true">
          ${Iconen.svg("batterij")}
          <span>Geen foto beschikbaar</span>
        </div>`;
    }
    const bron = b.afbeelding_bron ? `<span class="foto-bron">${escapeHtml(b.afbeelding_bron)}</span>` : "";
    return `<div class="kaart-foto">
          <img src="${escapeHtml(foto)}" alt="${escapeHtml(naamVan(b))}" loading="lazy" decoding="async" width="600" height="450">
          ${bron}
        </div>`;
  }

  // De volgorde waarin de vergelijker begint: beste prijs per kWh bovenaan.
  // De generator gebruikt dezelfde volgorde, zodat de voorgerenderde kaarten
  // gelijk staan aan wat de bezoeker ziet voordat hij iets aanraakt.
  /* Dezelfde volgorde als app.js bij de standaardsortering, en dat moet ook:
     wijkt de voorgerenderde lijst af, dan klapt hij om zodra javascript
     binnen is en ziet een zoekmachine iets anders dan een mens.

     Koppel-score eerst en prijs per kWh als het gelijkspel is. Op prijs per
     kWh sorteren gaf een nummer 1 met score 2/6 onder een kop die belooft te
     laten zien wat een batterij slim maakt; die twee spraken elkaar tegen. */
  function standaardVolgorde(lijst) {
    return [...lijst].sort((a, b) =>
      koppelScore(b) - koppelScore(a) ||
      (Prijs.prijsPerKwh(a) || Infinity) - (Prijs.prijsPerKwh(b) || Infinity));
  }

  /* De resultaatregel: dezelfde batterij, maar dan om kolommen te vergelijken
     in plaats van producten.

     Waarom deze naast de kaart bestaat: een kaart is ruim 1.100 px hoog, dus
     op een scherm passen er drie. Wie twintig batterijen tegen elkaar houdt
     scrollt zich suf en moet onthouden wat er drie schermen hoger stond. In
     een regel staan de vier getallen onder elkaar uitgelijnd, met cijfers van
     gelijke breedte, en zie je er vijf tegelijk.

     Dezelfde volgorde als op de zustersites: plek, model, drie feiten, score,
     prijs. Alleen de kolomnamen verschillen per site. */
  function regelHtml(b, opties, plek) {
    const o = opties || {};
    const beste = Prijs.beste(b);
    // vergelijkPrijs neemt de aanbieding, niet de batterij - dezelfde aanroep
    // als in kaartHtml. Met het verkeerde argument komt er null uit en stond er
    // bij elke regel "Op aanvraag".
    const vergelijk = Prijs.vergelijkPrijs(beste);
    const perKwh = Prijs.prijsPerKwh(b);
    const capaciteit = b.capaciteit_kwh ? `${String(b.capaciteit_kwh).replace(".", ",")} kWh` : "Onbekend";
    const score = koppelScore(b);
    const geselecteerd = (o.selectie || []).includes(b.id);

    return `
    <article class="resultaat-regel" data-id="${escapeHtml(b.id)}">
      <span class="regel-plek cijfer">${plek}</span>
      <div class="regel-naam">
        <span class="regel-merk">${escapeHtml(b.merk)}</span>
        <h3><a class="kop-link" href="batterij/${encodeURIComponent(b.id)}.html">${escapeHtml(b.model)}</a></h3>
        <label class="badge regel-vergelijk" title="Selecteer om te vergelijken (max. 3)">
          <input type="checkbox" class="vergelijk-check" data-id="${escapeHtml(b.id)}" ${geselecteerd ? "checked" : ""}> vergelijk
        </label>
      </div>
      <div class="regel-waarde cijfer" data-naam="Capaciteit"><span class="regel-label">Capaciteit</span>${capaciteit}${dagmaatHtml(b)}</div>
      <div class="regel-waarde cijfer" data-naam="Vermogen"><span class="regel-label">Vermogen</span>${b.vermogen_kw ? String(b.vermogen_kw).replace(".", ",") + " kW" : "Onbekend"}</div>
      <div class="regel-waarde cijfer" data-naam="Installatie"><span class="regel-label">Installatie</span>${b.installatie === "zelf" ? "Zelf" : "Installateur"}</div>
      <div class="regel-waarde cijfer" data-naam="Koppel-score">
        <span class="regel-label">Koppel-score</span>${score}<span class="regel-van">/6</span>
        <span class="regel-baan regel-baan-delen" title="Koppel-score ${score} van 6: ${escapeHtml(koppelSamenvatting(b))}">${koppelDelen(b).map((d) => `<span class="regel-deel deel-${d.punten}"></span>`).join("")}</span>
      </div>
      <div class="regel-slot">
        <span class="regel-bedrag cijfer">${vergelijk !== null ? eurFmt.format(vergelijk) : "Op aanvraag"}</span>
        ${perKwh ? `<span class="regel-per cijfer">${eurFmt.format(perKwh)} per kWh opslag</span>` : ""}
        ${ouderdomHtml(b)}
        ${beste && beste.url && beste.winkel ? `<span class="regel-winkel" title="Waar dit bedrag vandaan komt">${escapeHtml(beste.winkel)}</span>` : ""}
        ${beste && beste.url
          ? `<a class="knop" href="${escapeHtml(koopUrl(beste))}" target="_blank" rel="noopener${beste.affiliate_url ? " sponsored" : ""}" aria-label="Naar de aanbieding van de ${escapeHtml(naamVan(b))}${beste.winkel ? ` bij ${escapeHtml(beste.winkel)}` : ""}, opent in een nieuw tabblad">Naar de winkel <svg class="icoon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h10v10" /> <path d="M7 17 17 7" /></svg></a>`
          : `<a class="knop knop-secundair" href="batterij/${encodeURIComponent(b.id)}.html" aria-label="Alle details van de ${escapeHtml(naamVan(b))}">Bekijk details</a>`}
      </div>
    </article>`;
  }

  /* De kop boven de regels. Staat los van de regel zelf zodat hij een keer in
     de lijst staat en niet 41 keer. */
  function lijstHtml(lijst, opties) {
    const koppen = ["Model", "Capaciteit", "Vermogen", "Installatie", "Koppel-score", "Prijs"];
    return `<div class="resultaat-lijst">
      <div class="resultaat-regel regel-kop" aria-hidden="true">
        <span></span>${koppen.map((k) => `<span>${k}</span>`).join("")}
      </div>
      ${lijst.map((b, i) => regelHtml(b, opties, i + 1)).join("")}
    </div>`;
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
        <div class="spec"><span class="spec-label"><a class="term-link" href="uitleg.html#capaciteit" title="Wat is capaciteit (kWh)? Lees de uitleg">Capaciteit</a></span><span class="spec-waarde">${capaciteit}${dagmaatHtml(b)}</span></div>
        <div class="spec"><span class="spec-label"><a class="term-link" href="uitleg.html#kw" title="Wat is vermogen (kW)? Lees de uitleg">Vermogen</a></span><span class="spec-waarde">${b.vermogen_kw ? String(b.vermogen_kw).replace(".", ",") + " kW" + Prijs.vermogenLabelHtml(b) : "Onbekend"}</span></div>
        <div class="spec"><span class="spec-label">Installatie</span><span class="spec-waarde">${b.installatie === "zelf" ? "Zelf (stopcontact)" : "Installateur"}</span></div>
        <div class="spec"><span class="spec-label">Garantie</span><span class="spec-waarde">${b.garantie_jaar ? b.garantie_jaar + " jaar" : "Onbekend"}</span></div>
      </div>
      <div class="koppelgemak" title="Aansluitgemak: hoe makkelijk sluit je deze batterij aan op je bestaande zonnepanelensysteem? 5 sterren = plug &amp; play.">
        <span class="spec-label">Aansluitgemak op je zonnepanelen</span><br>
        ${waardering(b.koppeling_gemak, 5)}
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
          ${ouderdomHtml(b)}
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
    koppelDelen,
    koppelSamenvatting,
    koppelUitsplitsingHtml,
    dagmaat,
    dagmaatHtml,
    dagmaatSamenvatting,
    dagmaatUitlegHtml,
    badgeHtml,
    noodstroomBadge,
    sterren,
    waardering,
    standaardVolgorde,
    fotoHtml,
    kaartHtml,
    regelHtml,
    lijstHtml,
  };
});
