/* ==========================================================================
   Eigen teller: waar bezoekers naartoe klikken en hoe lang een pagina open
   staat. Gedeeld door de drie sites (kern/assets/teller.js).

   Waarom eigen: Vercel Web Analytics telt op het gratis abonnement alleen
   paginaweergaven. Klikken naar een winkel en de tijd op een pagina zijn daar
   "custom events", en die zitten pas in Pro.

   Wat er verstuurd wordt, en niets meer:
   - bij een klik op een link naar een andere site: welk domein, welk product
     (het data-id van de kaart, of de productpagina waar je op staat) en op
     welke pagina je klikte;
   - als je de pagina verlaat of wegklikt: hoeveel seconden hij zichtbaar was;
   - een paar stappen, elk hooguit één keer per paginabezoek: dat je een
     rekenhulp of keuzehulp gaat invullen ("gestart"), dat de uitslag daarna in
     beeld komt ("uitslag"), en vanaf welke plek je naar de steunpagina klikt
     ("steun-open": menu, voettekst, blok of tekst).
   Geen cookies, niets op je apparaat, geen kenmerk dat jou herkent. De
   ontvanger (batterijmaatje.nl/api/teller) telt alleen totalen per dag op.
   Zie privacy.html.

   Staat het tellen uit voor deze browser (#niet-tellen, zie UITZET_TAG in
   scripts/statistiek.mjs), dan stuurt hij niets.
   ========================================================================== */
(function () {
  "use strict";
  if (navigator.webdriver) return;

  var ADRES = "https://batterijmaatje.nl/api/teller";
  var host = location.hostname.replace(/^www\./, "");
  var SITES = { "batterijmaatje.nl": "bat", "warmtepompmaatje.nl": "pomp", "zonnestroommaatje.nl": "zon" };
  var site = SITES[host];
  // Alleen de live sites tellen; een preview of een lokale kopie niet.
  if (!site) return;

  function uitgezet() {
    if (typeof window.maatjeTeltNiet === "function") return window.maatjeTeltNiet();
    try { return !!localStorage.getItem("va-disable"); } catch (e) { return false; }
  }

  function stuur(gegevens) {
    if (uitgezet()) return;
    gegevens.s = site;
    var tekst = JSON.stringify(gegevens);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(ADRES, tekst)) return;
    } catch (e) { /* valt terug op fetch */ }
    try {
      fetch(ADRES, { method: "POST", body: tekst, keepalive: true, mode: "no-cors" });
    } catch (e) { /* dan telt deze niet mee */ }
  }

  // "/index.html" en "/" zijn dezelfde pagina; tel ze als "/".
  function pagina() {
    return (location.pathname || "/").replace(/\/index\.html$/, "/").slice(0, 120);
  }

  function product(el) {
    var kaart = el.closest && el.closest("[data-id]");
    if (kaart) return kaart.getAttribute("data-id") || "";
    var m = location.pathname.match(/^\/(?:batterij|pomp|paneel)\/([a-z0-9-]+)\.html$/);
    return m ? m[1] : "";
  }

  // Een stap telt één keer per paginabezoek, hoe vaak je ook typt of klikt.
  var gemeld = {};
  function stap(naam, plek) {
    var sleutel = naam + "|" + plek;
    if (gemeld[sleutel]) return;
    gemeld[sleutel] = true;
    stuur({ t: "stap", w: naam, p: plek, b: pagina() });
  }

  // Waar op de pagina stond de link naar de steunpagina?
  function plekVan(a) {
    if (a.closest(".steun-blok")) return "blok";
    if (a.closest("footer")) return "voettekst";
    if (a.closest("header, nav, .nav-meer")) return "menu";
    return "tekst";
  }

  function klik(e) {
    var a = e.target && e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var doel;
    try { doel = new URL(a.href, location.href); } catch (x) { return; }
    if (doel.protocol !== "https:" && doel.protocol !== "http:") return;
    var domein = doel.hostname.replace(/^www\./, "");
    if (domein === host && /\/steun\.html$/.test(doel.pathname)) stap("steun-open", plekVan(a));
    // De drie eigen sites zijn geen winkel; dat verkeer staat al bij
    // "Komt vandaan" in Vercel.
    if (domein === host || SITES[domein]) return;
    stuur({ t: "klik", w: domein, p: product(a), b: pagina() });
  }
  document.addEventListener("click", klik, true);

  /* Wordt een rekenhulp gebruikt, of alleen bekeken? Verblijfstijd zegt dat
     niet: een minuut op de rekenmodule kan lezen zijn of rekenen. "gestart" is
     de eerste keer dat je iets verandert in het formulier, "uitslag" dat het
     resultaat daarna in beeld komt. Dezelfde ids op alle drie de sites. */
  var formulier = document.querySelector("#rekenformulier, #adviesFormulier, #adviesformulier, #planFormulier");
  if (formulier) {
    var begonnen = false;
    var begin = function () {
      if (begonnen) return;
      begonnen = true;
      stap("gestart", formulier.id);
      var uitslag = document.querySelector("#resultaat, #advies, #plan");
      if (!uitslag || !("IntersectionObserver" in window)) return;
      new IntersectionObserver(function (w, kijker) {
        if (!w[0].isIntersecting) return;
        stap("uitslag", uitslag.id);
        kijker.disconnect();
      }, { threshold: 0.3 }).observe(uitslag);
    };
    formulier.addEventListener("input", begin, true);
    formulier.addEventListener("change", begin, true);
  }
  // Middelste muisknop: opent in een nieuw tabblad zonder "click".
  document.addEventListener("auxclick", function (e) { if (e.button === 1) klik(e); }, true);

  // Tijd die de pagina echt zichtbaar was, dus zonder de minuten dat hij op
  // de achtergrond in een tabblad lag.
  var zichtbaarSinds = document.visibilityState === "visible" ? Date.now() : null;
  var totaal = 0;
  var verstuurd = false;
  function bijtellen() {
    if (zichtbaarSinds) { totaal += Date.now() - zichtbaarSinds; zichtbaarSinds = null; }
  }
  function verstuurTijd() {
    if (verstuurd) return;
    bijtellen();
    verstuurd = true;
    stuur({ t: "tijd", b: pagina(), d: Math.round(totaal / 1000) });
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      if (!zichtbaarSinds) zichtbaarSinds = Date.now();
    } else {
      // Op een telefoon komt "pagehide" vaak niet meer als een tabblad op de
      // achtergrond wordt opgeruimd; daarom telt het eerste wegklikken.
      verstuurTijd();
    }
  });
  window.addEventListener("pagehide", verstuurTijd);
})();
