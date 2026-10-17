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

   Daarnaast de uitslag van de rekenhulp en de keuzehulp (window.Delen):
   - schrijfUrl en herstel zetten de invoer van een formulier in de link en
     halen hem er weer uit, zodat wie de link opent dezelfde uitslag ziet;
   - uitslag zet onder een uitslag een deelblok. De link wijst naar
     /uitslag/<sleutel>.html: een pagina met een voorbeeldplaatje dat bij de
     soort uitslag past (loont, twijfelgeval, loont niet), die de bezoeker
     meteen doorstuurt naar de hulp zelf. Zie scripts/deelkaarten.mjs.
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
    if (!blok || blok.__klaar) return;
    blok.__klaar = true;
    var url = blok.getAttribute("data-url") || canoniek();
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

  /* ------------------------------------------------------------------
     Invoer van een formulier in de link
     ------------------------------------------------------------------ */

  // Elk veld krijgt als sleutel zijn id. Een vinkje zonder id (de apparaten
  // op de keuzehulp van batterijmaatje) krijgt zijn volgnummer.
  function velden(root) {
    var lijst = [];
    var naamloos = 0;
    var alle = root.querySelectorAll("input, select, textarea");
    for (var i = 0; i < alle.length; i++) {
      var v = alle[i];
      if (v.type === "button" || v.type === "submit" || v.type === "hidden") continue;
      lijst.push([v.id || "v" + naamloos++, v]);
    }
    return lijst;
  }

  function waardeVan(v) {
    return v.type === "checkbox" || v.type === "radio" ? (v.checked ? "1" : "0") : v.value;
  }

  // Wat er stond voordat de bezoeker iets deed. Alleen wat daarvan afwijkt
  // komt in de link, dan blijft hij kort.
  function onthoud(root) {
    var uit = {};
    velden(root).forEach(function (paar) { uit[paar[0]] = waardeVan(paar[1]); });
    root.__standaard = uit;
  }

  // behoud: parameters die geen veld zijn maar wel meetellen (de omvormer die
  // de keuzehulp van zonnestroommaatje meegeeft aan de rekenhulp).
  function schrijfUrl(root, behoud) {
    var standaard = root.__standaard || {};
    var oud = new URLSearchParams(location.search);
    var params = new URLSearchParams();
    (behoud || []).forEach(function (k) { if (oud.has(k)) params.set(k, oud.get(k)); });
    velden(root).forEach(function (paar) {
      var w = waardeVan(paar[1]);
      if (w !== "" && w !== standaard[paar[0]]) params.set(paar[0], w);
    });
    var vraag = params.toString();
    try {
      history.replaceState(null, "", vraag ? "?" + vraag : location.pathname);
    } catch (e) { /* vanaf file:// mag de URL niet herschreven worden */ }
  }

  /* Zet de velden uit de link terug. Geeft terug of er iets gezet is.
     De change-events gaan af zodat de pagina velden toont of verbergt die
     ervan afhangen; daarna nog een keer zetten, omdat zo'n event soms een
     ander veld invult (het aantal personen zet het jaarverbruik). De aanroeper
     rekent daarna zelf opnieuw. */
  function herstel(root) {
    var params = leesCompact(root, new URLSearchParams(location.search));
    var lijst = velden(root).filter(function (paar) { return params.has(paar[0]); });
    if (!lijst.length) return false;
    function zet() {
      lijst.forEach(function (paar) {
        var v = paar[1];
        var w = params.get(paar[0]);
        if (v.type === "checkbox" || v.type === "radio") { v.checked = w === "1"; return; }
        if (v.tagName === "SELECT" && !Array.prototype.some.call(v.options, function (o) { return o.value === w; })) return;
        v.value = w;
      });
    }
    zet();
    lijst.forEach(function (paar) { paar[1].dispatchEvent(new Event("change", { bubbles: true })); });
    zet();
    return true;
  }

  /* ------------------------------------------------------------------
     Korte deellink

     Met de veldnamen erin werd een gedeeld energieplan een link van bijna
     200 tekens. Voor de deellink krijgt elk veld daarom zijn volgnummer (één
     teken, base 36) in plaats van zijn naam, een keuzelijst het nummer van
     de optie, en een vinkje alleen zijn nummer (omgezet ten opzichte van de
     standaard). Bijvoorbeeld c=k7_0900_12200_51 in plaats van
     gasverbruik=900&stroomverbruik=2200&woning=hoek.

     Het eerste stuk is een vingerafdruk van de veldenlijst. Verandert het
     formulier later, dan klopt die niet meer en negeert de pagina de oude
     link, in plaats van waarden in de verkeerde velden te zetten.
     ------------------------------------------------------------------ */

  function vingerafdruk(lijst) {
    var h = 0;
    var tekst = lijst.map(function (paar) { return paar[0]; }).join(",");
    for (var i = 0; i < tekst.length; i++) h = (h * 31 + tekst.charCodeAt(i)) % 1296;
    return ("0" + h.toString(36)).slice(-2);
  }

  function compact(root) {
    var lijst = velden(root);
    if (lijst.length > 36) return null;
    var standaard = root.__standaard || {};
    var stukken = [vingerafdruk(lijst)];
    lijst.forEach(function (paar, i) {
      var v = paar[1];
      var w = waardeVan(v);
      if (w === "" || w === standaard[paar[0]]) return;
      var nr = i.toString(36);
      if (v.type === "checkbox" || v.type === "radio") stukken.push(nr);
      else if (v.tagName === "SELECT") stukken.push(nr + v.selectedIndex.toString(36));
      else stukken.push(nr + encodeURIComponent(w).replace(/_/g, "%5F"));
    });
    return stukken.length > 1 ? stukken.join("_") : "";
  }

  // Zet een c=-parameter om in gewone veldparameters; zonder c, of met een
  // c van een ander formulier, blijven de parameters zoals ze zijn.
  function leesCompact(root, params) {
    var c = params.get("c");
    if (!c) return params;
    var lijst = velden(root);
    var stukken = c.split("_");
    if (stukken.shift() !== vingerafdruk(lijst)) return params;
    var standaard = root.__standaard || {};
    var uit = new URLSearchParams();
    stukken.forEach(function (stuk) {
      var paar = lijst[parseInt(stuk.charAt(0), 36)];
      if (!paar) return;
      var v = paar[1], rest = stuk.slice(1);
      if (v.type === "checkbox" || v.type === "radio") uit.set(paar[0], standaard[paar[0]] === "1" ? "0" : "1");
      else if (v.tagName === "SELECT") { var o = v.options[parseInt(rest, 36)]; if (o) uit.set(paar[0], o.value); }
      else uit.set(paar[0], decodeURIComponent(rest));
    });
    return uit;
  }

  /* ------------------------------------------------------------------
     Deelblok onder een uitslag
     ------------------------------------------------------------------ */

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* doel: het element waar de uitslag in staat; het blok komt eronder.
     sleutel: welke /uitslag/-pagina (bepaalt het voorbeeldplaatje).
     bericht: de zin met de uitkomst die in het WhatsApp-bericht komt.
     formulier: het formulier met de invoer, voor de korte link; zonder gaat
     de adresbalk mee zoals hij is (de rekenhulp van batterijmaatje houdt die
     zelf bij).
     /u/<sleutel> is een herschrijving naar /uitslag/<sleutel>.html (vercel.json). */
  function uitslag(doel, opties) {
    if (!doel) return;
    var oud = doel.querySelector(".delen-uitslag");
    if (oud) oud.parentNode.removeChild(oud);
    var c = opties.formulier ? compact(opties.formulier) : null;
    var vraag = c === null ? location.search : c ? "?c=" + c : "";
    // Parameters die geen veld zijn maar wel meetellen (opties.behoud).
    if (c !== null) {
      var nu = new URLSearchParams(location.search);
      (opties.behoud || []).forEach(function (k) {
        if (nu.has(k)) vraag += (vraag ? "&" : "?") + k + "=" + encodeURIComponent(nu.get(k));
      });
    }
    var url = location.protocol === "file:" ? location.href
      : location.origin + "/u/" + opties.sleutel + vraag;
    var wa = "https://wa.me/?text=" + encodeURIComponent(opties.bericht + " " + url);
    doel.insertAdjacentHTML("beforeend",
      '<div class="delen delen-uitslag" data-delen data-url="' + esc(url) + '" data-tekst="' + esc(opties.bericht) + '">' +
      '<span class="delen-vraag">' + esc(opties.vraag || "Benieuwd wat het bij een ander is? Stuur je uitslag door.") + "</span>" +
      '<span class="delen-knoppen">' +
      '<a class="knop knop-secundair delen-whatsapp" href="' + esc(wa) + '" target="_blank" rel="noopener">Stuur via WhatsApp</a>' +
      '<button type="button" class="knop knop-secundair delen-systeem" hidden>Delen</button>' +
      '<button type="button" class="knop knop-secundair delen-kopieer" hidden>Kopieer link</button>' +
      "</span></div>");
    zetOp(doel.querySelector(".delen-uitslag"));
  }

  window.Delen = { onthoud: onthoud, schrijfUrl: schrijfUrl, herstel: herstel, uitslag: uitslag };

  function start() {
    var blokken = document.querySelectorAll("[data-delen]");
    for (var i = 0; i < blokken.length; i++) zetOp(blokken[i]);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
