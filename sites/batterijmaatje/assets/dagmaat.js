/* ==========================================================================
   De dagmaat - de capaciteit afgezet tegen jouw dag
   ==========================================================================

   Een capaciteit in kWh zegt niemand iets. 4,32 of 9,73: allebei "een
   batterij", en groter lijkt beter. Dat laatste is het misverstand waar een
   verkoper van leeft, want een batterij die groter is dan wat je huishouden op
   een dag buiten de zonuren opmaakt, raakt zijn stroom niet kwijt. Die extra
   kWh betaal je wel.

   De baan is jouw dag, niet die van een gemiddelde
   -----------------------------------------------
   De eerste versie rekende voor iedereen met 2.900 kWh per jaar. Dat is een
   aanname in de vorm van een antwoord: het ziet eruit alsof het over jou gaat,
   terwijl elke bezoeker hetzelfde balkje zag. Wie een warmtepomp heeft zit op
   6.000 tot 9.000 kWh, en dan klopt er niets van.

   Daarom is het jaarverbruik invoer. Je vult het één keer in, boven de lijst
   of op een productpagina, het blijft in localStorage staan, en alles rekent
   mee: de balkjes in de lijst, de kaarten, de uitleg op de 41 productpagina's
   en de link naar de rekenmodule. Zonder invoer blijft 2.900 kWh de standaard,
   want dat is wat de generator vooruit rendert en wat een zoekmachine ziet.

   Waarom dit een eigen bestand is en niet in kaart.js staat
   --------------------------------------------------------
   kaart.js heeft prijs.js en iconen.js nodig. Een productpagina laadt alleen
   nav.js en heeft die twee nergens voor nodig; daar drie bestanden bijhangen
   voor één blok is te duur. Dit bestand heeft geen enkele afhankelijkheid en
   werkt op één paar getallen (capaciteit en of die bruikbaar of bruto is), dus
   kaart.js roept het aan voor de lijst en een productpagina laadt het los.
   Eén implementatie, twee plekken.

   Werkt in de browser (window.Dagmaat) en in Node (require).
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Dagmaat = factory();
  }
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const VERBRUIK_STANDAARD = 2900; // gelijk aan de standaard in de rekenmodule
  const VERBRUIK_MIN = 500;        // onder een eenpersoonsappartement
  const VERBRUIK_MAX = 25000;      // boven een woning met warmtepomp en twee auto's
  const BUITEN_ZONUREN = 0.7;      // idem rekenmodule: avond, nacht, vroege ochtend
  const BRUIKBAAR_DEEL = 0.9;      // idem: 90% van een brutomaat is werkelijk bruikbaar
  const DAGVAKJES = 6;             // vakjes over de volle baan
  const STAARTJES_MAX = 3;         // meer dan dit wordt een streepje te veel
  const SLEUTEL = "batterijmaatje:verbruik";

  const eenDecimaal = (n) => n.toFixed(1).replace(".", ",");
  const duizend = (n) => Math.round(n).toLocaleString("nl-NL");

  const escapeHtml = (s) => String(s == null ? "" : s)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");

  /* Eén plek waar een ingevoerd verbruik een bruikbaar getal wordt. Alles wat
     geen getal is of buiten de grenzen valt, valt terug op de standaard; een
     lege invoer of een typefout hoort de hele lijst niet te laten kantelen. */
  function verbruikVan(waarde) {
    const n = Number(String(waarde == null ? "" : waarde).replace(/[^\d]/g, ""));
    if (!Number.isFinite(n) || n < VERBRUIK_MIN || n > VERBRUIK_MAX) return VERBRUIK_STANDAARD;
    return n;
  }

  const dagbehoefteVan = (verbruik) => (verbruikVan(verbruik) / 365) * BUITEN_ZONUREN;

  /* Onthouden mag mislukken. In een privévenster gooit localStorage, en dan
     hoort de site gewoon met de standaard te werken in plaats van te breken. */
  function lees() {
    try {
      const uitUrl = new URLSearchParams(location.search).get("verbruik");
      if (uitUrl) return verbruikVan(uitUrl);
    } catch (e) { /* geen location, of een rare query */ }
    try {
      const v = localStorage.getItem(SLEUTEL);
      return v == null ? VERBRUIK_STANDAARD : verbruikVan(v);
    } catch (e) {
      return VERBRUIK_STANDAARD;
    }
  }

  function schrijf(waarde) {
    const v = verbruikVan(waarde);
    try {
      if (v === VERBRUIK_STANDAARD) localStorage.removeItem(SLEUTEL);
      else localStorage.setItem(SLEUTEL, String(v));
    } catch (e) { /* niet kunnen onthouden is geen reden om niets te tonen */ }
    return v;
  }

  /* De rekensom. `maat` is {capaciteit, bevestigd}: het getal dat de fabrikant
     opgeeft, en of vaststaat dat dat de bruikbare capaciteit is. */
  function bereken(maat, verbruik) {
    if (!maat || typeof maat.capaciteit !== "number") return null;
    const jaar = verbruikVan(verbruik);
    const behoefte = dagbehoefteVan(jaar);
    const bruikbaar = maat.bevestigd ? maat.capaciteit : maat.capaciteit * BRUIKBAAR_DEEL;
    const stap = behoefte / DAGVAKJES;
    const vakjes = [];
    for (let i = 0; i < DAGVAKJES; i++) {
      const vol = bruikbaar >= (i + 1) * stap;
      vakjes.push(vol ? 2 : bruikbaar >= (i + 0.5) * stap ? 1 : 0);
    }
    const over = Math.max(0, bruikbaar - behoefte);
    return {
      jaar,
      behoefte,
      eigen: jaar !== VERBRUIK_STANDAARD,
      opgegeven: maat.capaciteit,
      bevestigd: !!maat.bevestigd,
      bruikbaar,
      vakjes,
      over,
      staartjes: Math.min(STAARTJES_MAX, Math.round(over / stap)),
      deel: Math.min(1, bruikbaar / behoefte),
    };
  }

  // De hele som op één regel tekst, voor het title-attribuut.
  function samenvatting(maat, verbruik) {
    const d = bereken(maat, verbruik);
    if (!d) return "";
    const bron = d.bevestigd
      ? "bruikbare capaciteit volgens de fabrikant"
      : `geschat op ${Math.round(BRUIKBAAR_DEEL * 100)}% van de opgegeven ${eenDecimaal(d.opgegeven)} kWh`;
    const wie = d.eigen
      ? `Met jouw ${duizend(d.jaar)} kWh per jaar gebruik je`
      : `Een huishouden van ${duizend(d.jaar)} kWh per jaar gebruikt`;
    const dekking = d.over > 0
      ? `Dat is die hele dag, met ${eenDecimaal(d.over)} kWh over die er op zo'n dag niet uit gaat.`
      : `Dat dekt ${Math.round(d.deel * 100)}% van die ${eenDecimaal(d.behoefte)} kWh.`;
    return `${wie} zo'n ${eenDecimaal(d.behoefte)} kWh buiten de zonuren. Deze batterij levert ${eenDecimaal(d.bruikbaar)} kWh (${bron}). ${dekking}`;
  }

  /* De korte vorm: een doorlopende meter met een omlijning, en grijze blokjes
     erachter voor wat er op zo'n dag niet uit gaat. Bewust anders dan de
     Koppel-score-baan ernaast, die uit drie losse vakjes bestaat omdat het om
     drie losse onderdelen gaat. */
  function baanHtml(maat, verbruik) {
    const d = bereken(maat, verbruik);
    if (!d) return "";
    const vakjes = d.vakjes.map((v) => `<span class="dagmaat-vak vak-${v}"></span>`).join("");
    const staart = Array.from({ length: d.staartjes }, () => '<span class="dagmaat-over"></span>').join("");
    return `<span class="dagmaat" title="${escapeHtml(samenvatting(maat, verbruik))}"><span class="dagmaat-baan">${vakjes}</span>${staart}</span>`;
  }

  /* De uitgeschreven vorm op de productpagina, waar de ruimte er is.

     De capaciteit staat als data-attribuut op het blok. Productpagina's zijn
     vooruit gerenderd en draaien geen app.js, dus koppel() heeft die twee
     getallen nodig om na het laden opnieuw te kunnen rekenen. */
  function uitlegHtml(maat, verbruik) {
    const d = bereken(maat, verbruik);
    if (!d) return "";
    const oordeel = d.over > 0
      ? `Deze batterij is daar ruim voor. De ${eenDecimaal(d.over)} kWh die overblijft, raakt hij op zo'n dag niet kwijt; die telt pas mee als je meer buiten de zonuren gebruikt, bijvoorbeeld met een warmtepomp of een auto aan de laadpaal.`
      : d.deel >= 0.95
        ? "Deze batterij dekt die dag vrijwel precies, zonder dat je betaalt voor ruimte die je niet gebruikt."
        : `Deze batterij dekt daar ${Math.round(d.deel * 100)}% van. De rest koop je die avond gewoon in.`;
    const herkomst = d.bevestigd
      ? `De fabrikant geeft ${eenDecimaal(d.opgegeven)} kWh op als bruikbare capaciteit.`
      : `De fabrikant geeft ${eenDecimaal(d.opgegeven)} kWh op zonder erbij te zeggen hoeveel daarvan bruikbaar is, dus hier staat ${Math.round(BRUIKBAAR_DEEL * 100)}% daarvan, ${eenDecimaal(d.bruikbaar)} kWh.`;
    const wie = d.eigen
      ? `Met jouw ${duizend(d.jaar)} kWh per jaar gebruik je ongeveer ${eenDecimaal(d.behoefte)} kWh buiten de zonuren`
      : `Een huishouden met ${duizend(d.jaar)} kWh per jaar gebruikt ongeveer ${eenDecimaal(d.behoefte)} kWh buiten de zonuren`;
    const naar = maat.id
      ? `<a href="/rekenmodule.html?batterij=${encodeURIComponent(maat.id)}&verbruik=${d.jaar}">terugverdientijd-berekening</a>`
      : `<a href="/rekenmodule.html?verbruik=${d.jaar}">terugverdientijd-berekening</a>`;
    return `<b class="dagmaat-kop">${eenDecimaal(d.bruikbaar)} kWh tegenover een dagbehoefte van ${eenDecimaal(d.behoefte)} kWh</b>
      ${baanHtml(maat, verbruik)}
      <p>${wie}, dus in de avond, de nacht en de vroege ochtend. Dat is wat een thuisbatterij op een gemiddelde dag kan opvangen. ${oordeel}</p>
      <p class="dagmaat-voet">${herkomst} <label class="dagmaat-invoer">Ander verbruik? <input type="number" inputmode="numeric" min="${VERBRUIK_MIN}" max="${VERBRUIK_MAX}" step="100" value="${d.jaar}" aria-label="Mijn stroomverbruik in kWh per jaar"> kWh per jaar</label>. Of reken alles door in de ${naar}.</p>`;
  }

  /* Op een productpagina: het blok opnieuw tekenen met wat de bezoeker eerder
     invulde, en het invoerveld erin laten werken. Doet niets als het blok er
     niet is, dus dit bestand mag overal mee. */
  function koppel(doc) {
    const d = doc || (typeof document !== "undefined" ? document : null);
    if (!d) return;
    const blok = d.querySelector(".dagmaat-uitleg[data-capaciteit]");
    if (!blok) return;
    const maat = {
      capaciteit: Number(blok.dataset.capaciteit),
      bevestigd: blok.dataset.bevestigd === "1",
      id: blok.dataset.batterij || "",
    };
    const teken = (verbruik) => {
      blok.innerHTML = uitlegHtml(maat, verbruik);
      const veld = blok.querySelector(".dagmaat-invoer input");
      if (!veld) return;
      veld.addEventListener("change", () => teken(schrijf(veld.value)));
      veld.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); veld.blur(); } });
    };
    const nu = lees();
    // Alleen hertekenen als er iets te veranderen valt; anders blijft de
    // vooruit gerenderde HTML gewoon staan en flikkert er niets.
    if (nu !== VERBRUIK_STANDAARD) teken(nu);
    else teken(VERBRUIK_STANDAARD);
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => koppel());
    else koppel();
  }

  return {
    VERBRUIK_STANDAARD, VERBRUIK_MIN, VERBRUIK_MAX,
    verbruikVan, dagbehoefteVan, lees, schrijf,
    bereken, samenvatting, baanHtml, uitlegHtml, koppel,
  };
});
