/* Meelopende adviesbalk op de keuzehulp.

   Waarom die er is: op een breed scherm staat het advies naast het formulier,
   dus wie een antwoord verandert ziet het meteen meebewegen. Op een telefoon
   staat het eronder - bij batterijmaatje op 2.548 pixels, bij de zustersites
   rond de 1.500. Je vult daar iets in en er gebeurt, voor zover je kunt zien,
   niets. Het advies wordt wel bijgewerkt, maar drie schermen lager.

   Deze balk laat op zo'n smal scherm zien wat er op dit moment uitkomt, en is
   tegelijk de weg ernaartoe. Hij komt pas in beeld als er een advies is en het
   adviespaneel zelf niet te zien is, en verdwijnt zodra dat wel zo is - anders
   dekt hij precies af waar je net naartoe bent gesprongen.

   Twee dingen bewust niet gedaan:

   - Geen melding bij elke toetsaanslag. De balk verandert gewoon mee; wie er
     niet naar kijkt wordt niet gestoord.
   - Geen tweede rekenknop. De knop die er was ("Geef mij advies") suggereerde
     dat er iets te starten viel. Dit is alleen een sprong naar beneden.

   Gedeeld tussen de drie sites via kern/. De balk leest zelf uit het
   adviespaneel wat er bovenaan staat, in plaats van dat elke keuzehulp het
   moet doorgeven: die drie zijn onderling verschillend genoeg dat een gedeelde
   afspraak er op drie plekken anders uit was gaan zien, en dan loopt hij een
   keer stil zonder dat iemand het merkt.

   De opmaak staat in het <style>-blok van advies.html, waar de rest van de
   keuzehulp-opmaak ook staat. */
(function (global) {
  "use strict";

  var BREEDTE = "(max-width: 900px)"; // zelfde grens als waarop de twee kolommen één worden
  var balk = null;
  var label = null;
  var paneel = null;
  var laatsteTekst = "";
  var inBeeld = false;
  /* Heeft de bezoeker al iets ingevuld?

     Zonder deze grens stond er bij het openen van de keuzehulp al "Jouw advies:
     Venus E 3.0" in beeld, terwijl er nog geen enkele vraag beantwoord was. Dat
     is een aanname in de vorm van een antwoord: het ziet eruit alsof het over
     jou gaat, terwijl elke bezoeker hetzelfde te zien kreeg. Precies waar
     dagmaat.js al voor waarschuwt.

     Het past ook niet bij waar deze balk voor is. Hij bestaat omdat je op een
     telefoon niet ziet dat het advies drie schermen lager meebeweegt als je
     iets verandert. Zolang je nog niets veranderd hebt, valt er ook niets te
     missen. */
  var aangeraakt = false;

  /* De keuzehulpen heten niet overal hetzelfde (adviesFormulier op
     batterijmaatje, adviesformulier op de zustersites), dus koppelen we niet
     aan een id maar luisteren we mee op het document. Dat is dezelfde keuze als
     bij het uitlezen van het paneel: de balk zoekt het zelf uit in plaats van
     dat drie keuzehulpen een afspraak moeten nakomen die er ooit eentje vergeet. */
  function volgEersteInvoer() {
    function raak(e) {
      var t = e.target;
      if (!t || !t.tagName) return;
      var soort = t.tagName.toLowerCase();
      if (soort !== "input" && soort !== "select" && soort !== "textarea") return;
      aangeraakt = true;
      document.removeEventListener("input", raak, true);
      document.removeEventListener("change", raak, true);
      toon();
    }
    document.addEventListener("input", raak, true);
    document.addEventListener("change", raak, true);
  }

  function smal() {
    return global.matchMedia && global.matchMedia(BREEDTE).matches;
  }

  function maak() {
    if (balk) return balk;
    paneel = document.getElementById("advies") || document.querySelector(".advies-paneel:not(form)");
    if (!paneel) return null;

    balk = document.createElement("button");
    balk.type = "button";
    balk.className = "advies-balk";
    balk.hidden = true;
    // Een knop die naar beneden springt is navigatie, geen bediening van het
    // advies zelf; daarom staat wat hij oplevert in de tekst en niet alleen
    // "bekijk".
    balk.innerHTML =
      '<span class="advies-balk-tekst"><span class="advies-balk-kop">Jouw advies</span>' +
      '<span class="advies-balk-naam"></span></span>' +
      '<span class="advies-balk-actie" aria-hidden="true">Bekijken &darr;</span>';
    label = balk.querySelector(".advies-balk-naam");

    balk.addEventListener("click", function () {
      var zacht = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
      paneel.scrollIntoView({ behavior: zacht ? "auto" : "smooth", block: "start" });
    });

    document.body.appendChild(balk);

    // De balk ligt over de pagina heen; zonder deze ruimte valt het laatste
    // veld van het formulier eronder.
    if ("IntersectionObserver" in global) {
      new IntersectionObserver(function (waarnemingen) {
        inBeeld = waarnemingen[0].isIntersecting;
        toon();
      }, { threshold: 0.12 }).observe(paneel);
    }

    return balk;
  }

  function toon() {
    if (!balk) return;
    var nodig = aangeraakt && !!laatsteTekst && smal() && !inBeeld;
    balk.hidden = !nodig;
    document.body.classList.toggle("heeft-advies-balk", nodig);
  }

  /* Zet de naam van wat er nu uitkomt. Een lege tekst verbergt de balk: dan is
     er nog geen advies om naartoe te springen. */
  function zet(tekst) {
    laatsteTekst = tekst ? String(tekst).replace(/\s+/g, " ").trim() : "";
    if (!maak()) return;
    if (label.textContent !== laatsteTekst) label.textContent = laatsteTekst;
    toon();
  }

  /* Wat staat er nu bovenaan het advies? De eerste kop in het paneel is op alle
     drie de sites de naam van wat er wordt aangeraden. */
  function lees() {
    if (!paneel) return "";
    var kop = paneel.querySelector("h3");
    return kop ? kop.textContent : "";
  }

  function start() {
    if (!maak()) return;
    volgEersteInvoer();
    zet(lees());
    if ("MutationObserver" in global) {
      new MutationObserver(function () { zet(lees()); })
        .observe(paneel, { childList: true, subtree: true, characterData: true });
    }
  }

  if (global.matchMedia) {
    var mq = global.matchMedia(BREEDTE);
    (mq.addEventListener ? mq.addEventListener.bind(mq, "change") : mq.addListener.bind(mq))(toon);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  global.AdviesBalk = { zet: zet };
})(window);
