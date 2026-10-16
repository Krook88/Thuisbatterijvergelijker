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
   - als je de pagina verlaat of wegklikt: hoeveel seconden hij zichtbaar was.
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

  function pagina() {
    return (location.pathname || "/").slice(0, 120);
  }

  function product(el) {
    var kaart = el.closest && el.closest("[data-id]");
    if (kaart) return kaart.getAttribute("data-id") || "";
    var m = location.pathname.match(/^\/(?:batterij|pomp|paneel)\/([a-z0-9-]+)\.html$/);
    return m ? m[1] : "";
  }

  function klik(e) {
    var a = e.target && e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var doel;
    try { doel = new URL(a.href, location.href); } catch (x) { return; }
    if (doel.protocol !== "https:" && doel.protocol !== "http:") return;
    var domein = doel.hostname.replace(/^www\./, "");
    if (domein === host) return;
    stuur({ t: "klik", w: domein, p: product(a), b: pagina() });
  }
  document.addEventListener("click", klik, true);
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
