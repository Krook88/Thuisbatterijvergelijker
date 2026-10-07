/* ==========================================================================
   Uitleg: deelbare links en de rekenhulp in de tekst.

   Deelbare links. Elk begrip in de woordenlijst, elke kop en elk cijfer in
   "in cijfers" heeft een id, en dus een eigen adres. Dat adres zag niemand.
   Wie op een forum wil zeggen "zie hier wat een P1-meter is", moest de
   pagina-url nemen en hopen dat de ander het juiste stuk vond. Nu staat er
   naast elk begrip een knopje dat precies dat adres kopieert.

   De rekenhulp. Een paar regels rekenwerk midden in de uitleg, met dezelfde
   rekensom als de rest van de site: de batterijmaat met assets/dagmaat.js,
   zodat de uitkomst hier en in de vergelijker dezelfde is.

   Zonder javascript blijft alles staan wat de generator al invulde: de
   uitkomst voor het standaardverbruik, en de begrippen met hun anker.
   ========================================================================== */
(function () {
  "use strict";

  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const eur = (n) => "€ " + Math.round(n).toLocaleString("nl-NL");
  const eenDecimaal = (n) => n.toFixed(1).replace(".", ",");

  /* ---- Deelbare links ---------------------------------------------- */

  function naamVan(el) {
    const kop = el.matches("h2") ? el : el.querySelector("dt, b, h2");
    return (kop ? kop.textContent : el.id).trim();
  }

  function kopieer(tekst) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(tekst);
    // Terugval voor browsers zonder klembord-API: een tijdelijk tekstveld.
    return new Promise((klaar, mis) => {
      const veld = document.createElement("textarea");
      veld.value = tekst;
      veld.setAttribute("readonly", "");
      veld.style.position = "absolute";
      veld.style.left = "-9999px";
      document.body.appendChild(veld);
      veld.select();
      try { document.execCommand("copy") ? klaar() : mis(); } catch (e) { mis(e); }
      veld.remove();
    });
  }

  function deellinks(wortel) {
    const melding = document.createElement("p");
    melding.className = "deellink-melding";
    melding.setAttribute("role", "status");
    melding.setAttribute("aria-live", "polite");
    wortel.appendChild(melding);

    const doelen = wortel.querySelectorAll(".woord[id], dt[id], .markt-cijfer[id], h2[id]:not(#markt-kop)");
    doelen.forEach((el) => {
      const knop = document.createElement("button");
      knop.type = "button";
      knop.className = "deellink";
      knop.textContent = "link";
      knop.setAttribute("aria-label", `Kopieer de link naar ${naamVan(el)}`);
      knop.addEventListener("click", () => {
        const adres = `${location.origin}${location.pathname}#${el.id}`;
        kopieer(adres).then(() => {
          knop.textContent = "gekopieerd";
          melding.textContent = `De link naar ${naamVan(el)} staat op je klembord.`;
          setTimeout(() => { knop.textContent = "link"; }, 2000);
        }, () => {
          // Kopiëren mag niet (oude browser, geen toestemming): dan in elk geval naar het adres.
          location.hash = el.id;
        });
      });
      const plek = el.matches(".woord") ? el.querySelector("dt, b") : el.matches(".markt-cijfer") ? el.querySelector("dt") : el;
      (plek || el).appendChild(knop);
    });
  }

  /* ---- Rekenhulp: batterijmaat ------------------------------------- */

  function batterijMaat(blok) {
    const D = window.Dagmaat;
    const bron = document.getElementById("rekenhulp-batterijen");
    const veld = blok.querySelector('[data-in="verbruik"]');
    if (!D || !bron || !veld) return;
    let lijst = [];
    try { lijst = JSON.parse(bron.textContent); } catch (e) { return; }
    const uit = (naam) => blok.querySelector(`[data-uit="${naam}"]`);

    function reken() {
      const jaar = D.verbruikVan(veld.value);
      const behoefte = D.dagbehoefteVan(jaar);
      uit("behoefte").textContent = eenDecimaal(behoefte);
      uit("bruto").textContent = eenDecimaal(behoefte / 0.9);
      const groot = lijst.filter((x) => D.bereken({ capaciteit: x.k, bevestigd: !!x.b }, jaar).deel >= 1);
      const aanbod = uit("aanbod");
      if (!groot.length) {
        aanbod.innerHTML = `Geen van de ${lijst.length} batterijen met een prijs is zo groot; met twee kom je er wel.`;
      } else {
        const g = groot.slice().sort((x, y) => x.p - y.p)[0];
        aanbod.innerHTML = `${groot.length} van de ${lijst.length} batterijen met een prijs zijn groot genoeg. De goedkoopste daarvan is de <a href="${esc(g.u)}">${esc(g.n)}</a> voor ${eur(g.p)}.`;
      }
    }

    // Hetzelfde onthouden verbruik als de vergelijker: wie het daar invulde, ziet het hier terug.
    const bewaard = D.lees();
    if (bewaard !== D.VERBRUIK_STANDAARD) veld.value = bewaard;
    veld.addEventListener("input", () => { reken(); });
    veld.addEventListener("change", () => { D.schrijf(veld.value); });
    reken();
  }

  const REKENHULPEN = { "batterij-maat": batterijMaat };

  function start() {
    const main = document.querySelector("main");
    if (main) deellinks(main);
    document.querySelectorAll("[data-rekenhulp]").forEach((blok) => {
      const f = REKENHULPEN[blok.getAttribute("data-rekenhulp")];
      if (f) f(blok);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
