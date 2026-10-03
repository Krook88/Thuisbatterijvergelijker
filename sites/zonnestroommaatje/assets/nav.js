/* Navigatie-helper.

   Twee dingen:

   1. Het "Meer ▾"-menu sluit zodra er buiten het menu wordt getikt of geklikt,
      zodat het paneel niet als onzichtbare overlay over de pagina blijft
      hangen.

   2. Op een telefoon zit de navigatie achter een menuknop. Zonder die knop
      wikkelde het menu over meerdere regels en begon de inhoud pas ver onder
      de bovenkant van het scherm. Dit bestand opent en sluit dat menu.

      Of het menu überhaupt inklapt, bepaalt de klasse html.js, en die wordt
      één regel in de <head> gezet. Dat stond hier, en dat was precies één
      regel te laat: dit bestand laadt onderaan de pagina, dus de kop werd
      eerst met het volledige menu getekend, wikkelde over meerdere regels en
      klapte daarna in. Elke bezoeker zag de inhoud één keer 56 pixels
      verspringen. Werkt JavaScript niet, dan komt die klasse er niet en blijft
      het menu uitgeklapt staan - hetzelfde vangnet als voorheen.

   Gedeeld tussen de drie sites via kern/. Het gedrag is overal hetzelfde; wat
   per site verschilt (de kleuren, de menu-items) zit in de opmaak en de HTML,
   niet hier. */
(function () {
  "use strict";

  document.addEventListener("click", function (e) {
    document.querySelectorAll("details.nav-meer[open]").forEach(function (d) {
      if (!d.contains(e.target)) d.removeAttribute("open");
    });
  });

  var knop = document.querySelector(".menu-knop");
  var kop = document.querySelector(".site-header");
  if (!knop || !kop) return;

  function zet(open) {
    kop.classList.toggle("menu-open", open);
    knop.setAttribute("aria-expanded", open ? "true" : "false");
    knop.setAttribute("aria-label", open ? "Menu sluiten" : "Menu openen");
  }

  knop.addEventListener("click", function () {
    zet(!kop.classList.contains("menu-open"));
  });

  // Na het kiezen van een bestemming hoort het menu dicht te gaan, anders staat
  // het bij terugkomen op de volgende pagina in de weg.
  kop.querySelectorAll(".hoofdnav a").forEach(function (a) {
    a.addEventListener("click", function () { zet(false); });
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && kop.classList.contains("menu-open")) {
      zet(false);
      knop.focus();
    }
  });
})();
