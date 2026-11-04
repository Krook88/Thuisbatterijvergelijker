/* ==========================================================================
   De vergelijktabel in het venster "Vergelijk nu". Gedeeld door de drie
   sites; welke regels erin staan bepaalt elke site zelf in app.js.

   Wat er was
   ----------
   Een tabel met een vaste labelkolom links en een minimumbreedte van
   220 px per product. Op een telefoon van 375 px nam die labelkolom drie
   kwart van het scherm in: je zag het woord "Capaciteit" en de eerste vier
   tekens van één product. Vergelijken betekende opzij schuiven en
   onthouden wat er links stond.

   Wat het is geworden
   -------------------
   - Op een smal scherm staat het label boven de regel, over de volle breedte,
     en de waarden staan eronder naast elkaar. Drie producten passen zo zonder
     schuiven, de namen blijven bovenaan in beeld.
   - Per regel met een richting (meer is beter, of minder) krijgt de beste
     waarde een groene markering. Pas als er echt iets te kiezen valt: zijn
     alle waarden gelijk, of is er maar één bekend, dan wint niemand.
   - Eén schakelaar verbergt de regels waarin de producten niet verschillen.
   - Een knop deelt de vergelijking. De link opent hetzelfde venster met
     dezelfde producten.

   Gebruik
   -------
     VergelijkTabel.html(items, {
       kop: (p) => "<b>naam</b>",          // inhoud van de kolomkop
       rijen: [
         { label: "Prijs", toon: (p) => "...", waarde: (p) => 1234, beter: "laag" },
         ...
       ],
       voet: (p) => "<a class='knop'>..</a>", // optioneel, onder de tabel
     })
     VergelijkTabel.koppel(container, { titel, tekst, url })  // na het plaatsen
   ========================================================================== */
(function () {
  "use strict";

  const tekstVan = (html) => String(html == null ? "" : html)
    .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

  function besten(waarden, beter) {
    const bekend = waarden.filter((w) => typeof w === "number" && isFinite(w));
    if (bekend.length < 2) return new Set();
    const top = beter === "laag" ? Math.min(...bekend) : Math.max(...bekend);
    if (bekend.every((w) => w === top)) return new Set();
    return new Set(waarden.map((w, i) => (w === top ? i : -1)).filter((i) => i >= 0));
  }

  let teller = 0;

  function html(items, opties) {
    const n = items.length;
    const id = "vt" + (++teller);
    const rijen = (opties.rijen || []).filter(Boolean);

    const kop = `<thead><tr><td class="vt-hoek"></td>${items.map((p) =>
      `<th scope="col" class="vt-product">${opties.kop(p)}</th>`).join("")}</tr></thead>`;

    let verschillen = 0;
    const body = rijen.map((r) => {
      const cellen = items.map((p) => r.toon(p));
      const waarden = r.waarde ? items.map((p) => { const w = r.waarde(p); return w == null ? null : Number(w); }) : [];
      const winnaars = r.beter ? besten(waarden, r.beter) : new Set();
      const teksten = cellen.map(tekstVan);
      const gelijk = n > 1 && teksten.every((t) => t === teksten[0]);
      if (!gelijk) verschillen++;
      return `<tr${gelijk ? " data-gelijk" : ""}><th scope="row" class="vt-label">${r.label}</th>${cellen.map((c, i) =>
        winnaars.has(i)
          ? `<td class="vt-beste"><span class="vt-vlag" aria-hidden="true">beste</span><span class="vt-sr">Beste waarde: </span>${c}</td>`
          : `<td>${c}</td>`).join("")}</tr>`;
    }).join("");

    const voet = opties.voet
      ? `<tfoot><tr><td class="vt-hoek"></td>${items.map((p) => `<td class="vt-voet">${opties.voet(p)}</td>`).join("")}</tr></tfoot>`
      : "";

    const gelijkAantal = rijen.length - verschillen;
    return `
      <div class="vt" style="--vt-n:${n}">
        <div class="vt-boven">
          <h2 id="${id}-kop">Vergelijking</h2>
          <div class="vt-acties">
            ${gelijkAantal > 0 ? `<label class="vt-schakel"><input type="checkbox" class="vt-alleen-verschil"> Alleen verschillen <small>(${gelijkAantal} gelijk)</small></label>` : ""}
            <button type="button" class="vt-deel">Deel deze vergelijking</button>
            <span class="vt-sr vt-deel-melding" role="status"></span>
          </div>
        </div>
        <table class="vt-tabel" aria-labelledby="${id}-kop">${kop}<tbody>${body}</tbody>${voet}</table>
      </div>`;
  }

  /* De link is de adresregel zelf: app.js zet de gekozen producten daar al
     in (?vergelijk=a~b~c). Op een aanraakscherm met deelmenu kiest de
     bezoeker zelf de app; elders gaat de link naar het klembord. */
  function kopieer(tekst) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(tekst);
    return Promise.reject(new Error("geen klembord"));
  }

  function deel(knop, melding, gegevens) {
    // De korte link /v/a~b~c geeft de vergelijking een eigen titel en
    // plaatje als hij in een chat wordt geplakt (api/v.js). Zonder opgave
    // valt het terug op de adresregel, die dezelfde keuze bevat.
    const url = gegevens.url || location.href.split("#")[0];
    const aanraak = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    const bevestig = (tekst) => {
      const oud = knop.textContent;
      knop.textContent = tekst;
      if (melding) melding.textContent = tekst;
      setTimeout(() => { knop.textContent = oud; if (melding) melding.textContent = ""; }, 2200);
    };
    if (navigator.share && aanraak) {
      navigator.share({ title: gegevens.titel || document.title, text: gegevens.tekst || "", url }).catch(() => {});
      return;
    }
    kopieer(url).then(() => bevestig("Link gekopieerd"), () => { window.prompt("Kopieer deze link:", url); });
  }

  function koppel(container, gegevens) {
    if (!container) return;
    const vt = container.querySelector(".vt");
    if (!vt) return;
    const schakel = container.querySelector(".vt-alleen-verschil");
    if (schakel) schakel.addEventListener("change", () => vt.classList.toggle("vt-verschil", schakel.checked));
    const knop = container.querySelector(".vt-deel");
    if (knop) knop.addEventListener("click", () => deel(knop, container.querySelector(".vt-deel-melding"), gegevens || {}));
  }

  /* Het venster zelf. Een div met role="dialog" in plaats van <dialog>, omdat
     de drie sites hun opmaak op .modal-achtergrond hebben staan. Wat
     <dialog> gratis geeft, doen we hier: Escape sluit, Tab blijft binnen het
     venster, de pagina erachter scrollt niet mee, en na het sluiten staat de
     focus weer op de knop waarmee je het opende. */
  const FOCUSBAAR = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
  let terug = null;

  function opToets(e) {
    const venster = document.querySelector(".modal-achtergrond.open");
    if (!venster) return;
    if (e.key === "Escape") { e.preventDefault(); sluit(venster); return; }
    if (e.key !== "Tab") return;
    const lijst = [...venster.querySelectorAll(FOCUSBAAR)].filter((n) => n.offsetParent !== null);
    if (!lijst.length) return;
    const eerste = lijst[0], laatste = lijst[lijst.length - 1];
    if (e.shiftKey && document.activeElement === eerste) { e.preventDefault(); laatste.focus(); }
    else if (!e.shiftKey && document.activeElement === laatste) { e.preventDefault(); eerste.focus(); }
    else if (!venster.contains(document.activeElement)) { e.preventDefault(); eerste.focus(); }
  }

  /* Voorbereiden: zodra er twee of meer producten gekozen zijn, staat het
     venster al gevuld en opgemaakt klaar, onzichtbaar. Een klik op
     "Vergelijk nu" hoeft het dan alleen nog te tonen. Openen kostte op een
     trage telefoon 100 tot 140 ms, bijna alles voor het opmaken van de tabel. */
  let wacht = null;
  const ooitRustig = window.requestIdleCallback || ((f) => setTimeout(f, 200));
  const annuleer = window.cancelIdleCallback || clearTimeout;

  function voorbereid(venster, sleutel, vul) {
    if (!venster || venster.classList.contains("open")) return;
    if (wacht !== null) { annuleer(wacht); wacht = null; }
    if (!sleutel) { venster.classList.remove("voorbereid"); delete venster.dataset.klaar; return; }
    if (venster.dataset.klaar === sleutel) return;
    wacht = ooitRustig(() => {
      wacht = null;
      if (venster.classList.contains("open")) return;
      vul();
      venster.dataset.klaar = sleutel;
      venster.classList.add("voorbereid");
    });
  }

  function open(venster, sleutel, vul) {
    if (!venster) return;
    if (wacht !== null) { annuleer(wacht); wacht = null; }
    if (vul && venster.dataset.klaar !== sleutel) { vul(); venster.dataset.klaar = sleutel || ""; }
    terug = document.activeElement;
    venster.classList.add("open");
    venster.scrollTop = 0;
    document.documentElement.classList.add("venster-open");
    const kop = venster.querySelector(".vt-boven h2");
    const dialoog = venster.querySelector('[role="dialog"]');
    if (kop && dialoog) { dialoog.setAttribute("aria-labelledby", kop.id); dialoog.removeAttribute("aria-label"); }
    const sluitKnop = venster.querySelector(".sluit");
    if (sluitKnop) sluitKnop.focus({ preventScroll: true });
    document.addEventListener("keydown", opToets);
  }

  function sluit(venster) {
    if (!venster) return;
    venster.classList.remove("open");
    document.documentElement.classList.remove("venster-open");
    document.removeEventListener("keydown", opToets);
    if (terug && document.contains(terug)) terug.focus({ preventScroll: true });
    terug = null;
  }

  window.VergelijkTabel = { html, koppel, open, sluit, voorbereid };
})();
