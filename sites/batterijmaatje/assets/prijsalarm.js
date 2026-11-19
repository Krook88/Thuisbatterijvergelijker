/* ==========================================================================
   Prijsalarm op de batterijpagina: het formulier, en de knop die verschijnt
   als je via de link in een mail binnenkomt (?prijsalarm=bevestig of
   ?prijsalarm=afmelden). Waarom een knop en geen link die het meteen doet,
   staat in api/prijsalarm.js.
   ========================================================================== */
(function () {
  "use strict";

  var ADRES = "/api/prijsalarm";
  var geopend = Date.now();

  function stuur(gegevens) {
    return fetch(ADRES, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gegevens),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.fout || "Er ging iets mis. Probeer het later nog eens.");
        return j;
      });
    });
  }

  function formulier() {
    var f = document.getElementById("prijsalarmFormulier");
    if (!f) return;
    var status = f.querySelector(".formulier-status");
    var knop = f.querySelector("button[type=submit]");
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      status.className = "formulier-status";
      status.textContent = "Even geduld…";
      knop.disabled = true;
      stuur({
        actie: "aanmelden",
        batterij: f.dataset.batterij,
        email: f.email.value,
        drempel: f.drempel.value,
        website: f.website.value,
        geopend_op: geopend,
      }).then(function (j) {
        status.className = "formulier-status gelukt";
        status.textContent = j.bericht;
        f.reset();
      }).catch(function (fout) {
        status.className = "formulier-status mislukt";
        status.textContent = fout.message;
      }).then(function () { knop.disabled = false; });
    });
  }

  function uitMail() {
    var q = new URLSearchParams(location.search);
    var soort = q.get("prijsalarm");
    var token = q.get("t");
    var vak = document.getElementById("prijsalarmActie");
    if (!vak || !token || (soort !== "bevestig" && soort !== "afmelden")) return;
    vak.hidden = false;
    vak.innerHTML = "";
    var p = document.createElement("p");
    p.textContent = soort === "bevestig"
      ? "Je komt hier via de bevestigingsmail. Klik op de knop om het prijsalarm aan te zetten."
      : "Je komt hier via een prijsalarmmail. Klik op de knop om dit alarm te stoppen.";
    var knop = document.createElement("button");
    knop.type = "button";
    knop.className = "knop";
    knop.textContent = soort === "bevestig" ? "Bevestig het prijsalarm" : "Stop dit prijsalarm";
    var status = document.createElement("p");
    status.className = "formulier-status";
    status.setAttribute("role", "status");
    knop.addEventListener("click", function () {
      knop.disabled = true;
      stuur({ actie: soort, token: token }).then(function (j) {
        status.className = "formulier-status gelukt";
        status.textContent = j.bericht;
        knop.hidden = true;
        // De token hoort niet in de adresbalk te blijven staan.
        history.replaceState(null, "", location.pathname + "#prijsalarm");
      }).catch(function (fout) {
        status.className = "formulier-status mislukt";
        status.textContent = fout.message;
        knop.disabled = false;
      });
    });
    vak.appendChild(p);
    vak.appendChild(knop);
    vak.appendChild(status);
  }

  function start() { formulier(); uitMail(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
