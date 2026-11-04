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
     VergelijkTabel.koppel(container)        // na het plaatsen van de html
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
          ${gelijkAantal > 0 ? `<label class="vt-schakel"><input type="checkbox" class="vt-alleen-verschil"> Alleen verschillen <small>(${gelijkAantal} gelijk)</small></label>` : ""}
        </div>
        <table class="vt-tabel" aria-labelledby="${id}-kop">${kop}<tbody>${body}</tbody>${voet}</table>
      </div>`;
  }

  function koppel(container) {
    if (!container) return;
    const schakel = container.querySelector(".vt-alleen-verschil");
    const vt = container.querySelector(".vt");
    if (!schakel || !vt) return;
    schakel.addEventListener("change", () => vt.classList.toggle("vt-verschil", schakel.checked));
  }

  window.VergelijkTabel = { html, koppel };
})();
