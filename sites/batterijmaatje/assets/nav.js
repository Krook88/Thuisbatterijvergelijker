/* Navigatie-helper.

   Twee dingen:

   1. Het "Meer ▾"-menu sluit zodra er buiten het menu wordt getikt of geklikt,
      zodat het paneel niet als onzichtbare overlay over de pagina blijft
      hangen.

   2. Op een telefoon zit de navigatie achter een menuknop. Zonder die knop
      wikkelde het menu over drie regels en begon de inhoud pas op 138 pixels.
      De knop staat standaard verborgen en wordt door de opmaak alleen op
      smalle schermen getoond. Het inklappen wordt hier aangezet en niet in de
      CSS: werkt JavaScript niet, dan blijft het menu gewoon openstaan zoals
      voorheen, in plaats van onbereikbaar achter een knop die niets doet. */
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

  kop.classList.add("menu-inklapbaar");

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
