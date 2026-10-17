/* ==========================================================================
   Deelknoppen op een productpagina. Gedeeld door de drie sites
   (kern/assets/delen.js).

   Deze sites groeien vooral doordat iemand een link doorstuurt aan de buurman
   of in de familie-app. De markup staat al in de HTML: een WhatsApp-link die
   zonder JavaScript werkt, en een knop "Kopieer link" die verborgen blijft
   tot dit script draait. Op een telefoon met het deelmenu van het systeem
   (navigator.share) wordt de WhatsApp-link vervangen door één knop "Delen",
   want daar kiest de bezoeker zelf de app.

   De link die gedeeld wordt is de canonieke URL, zonder parameters. Een klik
   op wa.me is een klik naar een andere site, dus die telt teller.js al mee.
   ========================================================================== */
(function () {
  "use strict";

  function canoniek() {
    var l = document.querySelector('link[rel="canonical"]');
    return l ? l.href : location.href.split("#")[0];
  }

  function kopieer(tekst) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(tekst);
    }
    return new Promise(function (ok, fout) {
      var veld = document.createElement("textarea");
      veld.value = tekst;
      veld.setAttribute("readonly", "");
      veld.style.position = "fixed";
      veld.style.opacity = "0";
      document.body.appendChild(veld);
      veld.select();
      var gelukt = false;
      try { gelukt = document.execCommand("copy"); } catch (e) { /* oude browser */ }
      document.body.removeChild(veld);
      gelukt ? ok() : fout();
    });
  }

  function bevestig(knop, tekst) {
    var oud = knop.getAttribute("data-label") || knop.textContent;
    knop.setAttribute("data-label", oud);
    knop.textContent = tekst;
    setTimeout(function () { knop.textContent = oud; }, 2200);
  }

  function zetOp(blok) {
    var url = canoniek();
    var tekst = blok.getAttribute("data-tekst") || document.title;
    var whatsapp = blok.querySelector(".delen-whatsapp");
    var kopieerKnop = blok.querySelector(".delen-kopieer");
    var systeemKnop = blok.querySelector(".delen-systeem");

    if (kopieerKnop) {
      kopieerKnop.hidden = false;
      kopieerKnop.addEventListener("click", function () {
        kopieer(url).then(
          function () { bevestig(kopieerKnop, "Link gekopieerd"); },
          function () { prompt("Kopieer deze link:", url); }
        );
      });
    }

    // Het systeemmenu alleen op een aanraakscherm: op een laptop opent
    // navigator.share in sommige browsers een karig venster zonder WhatsApp.
    var aanraak = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    if (systeemKnop && navigator.share && aanraak) {
      systeemKnop.hidden = false;
      if (whatsapp) whatsapp.hidden = true;
      systeemKnop.addEventListener("click", function () {
        navigator.share({ title: document.title, text: tekst, url: url }).catch(function () {
          /* geannuleerd: niets aan de hand */
        });
      });
    }
  }

  function start() {
    var blokken = document.querySelectorAll("[data-delen]");
    for (var i = 0; i < blokken.length; i++) zetOp(blokken[i]);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
