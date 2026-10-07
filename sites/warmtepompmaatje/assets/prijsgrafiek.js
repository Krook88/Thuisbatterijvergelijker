/* ==========================================================================
   Prijsgrafiek: het verloop van de laagste winkelprijs.

   Twee vormen uit dezelfde gegevens (data/prijsverloop.json):
   - lijntje(id): een klein lijntje van 30 dagen naast de prijs in de lijst;
   - grafiekHtml(id): een grote grafiek op de productpagina, met de laagste
     en hoogste prijs, wanneer die golden, en een tabel met de wijzigingen.

   Het lijntje is een trapje en geen vloeiende lijn. Een prijs springt: hij
   staat drie weken op 1.199 en dan ineens op 1.099. Een lijn die daartussen
   schuin loopt, toont prijzen die nooit bestonden.

   Een gat (geen winkel met een prijs die dag) is een onderbreking in de lijn,
   niet een val naar nul en ook niet doortrekken van de vorige prijs.

   Werkt in de browser (window.PrijsGrafiek) en in Node (require), zodat de
   generator dezelfde grafiek in de statische pagina zet.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PrijsGrafiek = factory();
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const DAG = 86400000;
  const dagNr = (d) => Math.floor(Date.parse(`${d}T12:00:00Z`) / DAG);
  const datumVan = (n) => new Date(n * DAG).toISOString().slice(0, 10);
  const eur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const datumKort = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "short", timeZone: "UTC" });
  const datumLang = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  let verloop = {};
  let tot = null;

  /** De inhoud van data/prijsverloop.json. Zonder dat bestand tonen alle functies niets. */
  function laad(data) {
    verloop = (data && data.producten) || {};
    tot = (data && data.bijgewerkt) || null;
  }

  /**
   * De reeks als dagwaarden: [datum, prijs] voor elke dag van het venster.
   * prijs is een getal, null (die dag geen winkelprijs) of undefined (nog
   * niet gemeten). Het venster begint niet vóór de eerste meting.
   */
  function dagen(id, aantal) {
    const reeks = verloop[id];
    if (!reeks || !reeks.length || !tot) return [];
    const eind = dagNr(tot);
    const begin = Math.max(eind - aantal + 1, dagNr(reeks[0][0]));
    const uit = [];
    let j = 0;
    let huidig;
    for (let n = dagNr(reeks[0][0]); n <= eind; n++) {
      const d = datumVan(n);
      while (j < reeks.length && reeks[j][0] <= d) huidig = reeks[j++][1];
      if (n >= begin) uit.push([d, huidig]);
    }
    return uit;
  }

  /** Nu, laagste en hoogste in het venster, met de eerste datum waarop ze golden. */
  function samenvatting(lijst) {
    const met = lijst.filter(([, p]) => typeof p === "number");
    if (!met.length) return null;
    let laag = met[0], hoog = met[0];
    for (const p of met) {
      if (p[1] < laag[1]) laag = p;
      if (p[1] > hoog[1]) hoog = p;
    }
    const laatste = lijst[lijst.length - 1];
    return {
      nu: typeof laatste[1] === "number" ? laatste[1] : null,
      laagste: laag[1], laagsteDatum: laag[0],
      hoogste: hoog[1], hoogsteDatum: hoog[0],
      begin: lijst[0][0], eind: laatste[0],
      metingen: met.length,
    };
  }

  /* Een trap door de dagwaarden. Elke getekende dag krijgt een breedte van
     één stap; een gat verbreekt het pad. */
  function trapPad(lijst, x, y) {
    let d = "", vorige = null;
    const sluit = (i) => { if (vorige !== null) d += `H${x(i).toFixed(1)}`; };
    lijst.forEach(([, p], i) => {
      if (typeof p !== "number") { sluit(i); vorige = null; return; }
      if (vorige === null) d += `M${x(i).toFixed(1)} ${y(p).toFixed(1)}`;
      else if (vorige !== p) d += `H${x(i).toFixed(1)}V${y(p).toFixed(1)}`;
      vorige = p;
    });
    sluit(lijst.length);
    return d;
  }

  /** Klein lijntje voor in de lijst: 30 dagen, zonder assen. */
  function lijntje(id, opties) {
    const o = Object.assign({ dagen: 30, breedte: 64, hoogte: 18 }, opties);
    const lijst = dagen(id, o.dagen);
    const s = samenvatting(lijst);
    // Onder een week aan metingen zegt een lijntje niets; dan liever niets.
    if (!s || s.metingen < 7) return "";
    const pad = 2;
    const n = lijst.length;
    const bereik = s.hoogste - s.laagste || s.hoogste * 0.1 || 1;
    const midden = (s.hoogste + s.laagste) / 2;
    const onder = s.hoogste === s.laagste ? midden - bereik / 2 : s.laagste;
    const x = (i) => (i / n) * o.breedte;
    const y = (p) => pad + (1 - (p - onder) / bereik) * (o.hoogte - 2 * pad);
    const laatsteI = lijst.map(([, p]) => typeof p === "number").lastIndexOf(true);
    const eindP = lijst[laatsteI][1];
    const beginP = lijst.find(([, p]) => typeof p === "number")[1];
    const tekst = (s.hoogste === s.laagste
      ? `Prijsverloop ${o.dagen} dagen: gelijk gebleven op ${eur.format(s.laagste)}`
      : `Prijsverloop ${o.dagen} dagen: van ${eur.format(beginP)} naar ${eur.format(eindP)}, laagste ${eur.format(s.laagste)}`) +
      (s.nu === null ? ", nu bij geen winkel te koop" : "");
    return `<svg class="prijs-lijntje" viewBox="0 0 ${o.breedte} ${o.hoogte}" width="${o.breedte}" height="${o.hoogte}" role="img" aria-label="${esc(tekst)}"><title>${esc(tekst)}</title>` +
      `<path d="${trapPad(lijst, x, y)}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>` +
      (s.nu !== null ? `<circle class="prijs-lijntje-nu" cx="${x(laatsteI + 1).toFixed(1)}" cy="${y(eindP).toFixed(1)}" r="2.5"/>` : "") + "</svg>";
  }

  /* Ronde stappen voor de prijsas: 1, 2 of 5 maal een macht van tien. */
  function mooieStap(ruw) {
    const macht = Math.pow(10, Math.floor(Math.log10(ruw)));
    const f = ruw / macht;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * macht;
  }

  /** De grote grafiek voor de productpagina, of "" als er niets te tonen is.

      De lijnen staan in een SVG die met de breedte meerekt; de tekst en de
      punten staan er als gewone HTML overheen. Een SVG met tekst erin schaalt
      die tekst mee, en dan is een label dat op een laptop goed leest op een
      telefoon zes pixels hoog. */
  function grafiekHtml(id, opties) {
    const o = Object.assign({ dagen: 90, naam: "dit model" }, opties);
    const lijst = dagen(id, o.dagen);
    const s = samenvatting(lijst);
    if (!s) return "";

    let laag = s.laagste, hoog = s.hoogste;
    if (laag === hoog) { laag *= 0.95; hoog *= 1.05; }
    // Ruimte onder de laagste prijs, want daar komt het label "laagste" te staan.
    laag -= (hoog - laag) * 0.25;
    const stap = mooieStap((hoog - laag) / 3);
    const yMin = Math.max(0, Math.floor(laag / stap) * stap), yMax = Math.ceil(hoog / stap) * stap;
    const n = lijst.length;
    // Plotcoördinaten: x van 0 tot 1000, y van 0 (boven) tot 100 (onder).
    const x = (i) => (i / n) * 1000;
    const y = (p) => (1 - (p - yMin) / (yMax - yMin)) * 100;
    const pct = (v, max) => `${((v / max) * 100).toFixed(2)}%`;

    const rasters = [], yLabels = [];
    for (let v = yMin; v <= yMax + 1e-9; v += stap) {
      rasters.push(`<line x1="0" x2="1000" y1="${y(v).toFixed(2)}" y2="${y(v).toFixed(2)}"/>`);
      yLabels.push(`<span class="pg-y" style="top:${pct(y(v), 100)}">${esc(eur.format(v))}</span>`);
    }
    const midden = Math.floor((n - 1) / 2);
    const xLabels = [[0, "begin"], [midden, "midden"], [n - 1, "eind"]]
      .filter(([i], k, a) => k === 0 || i !== a[k - 1][0])
      .map(([i, soort]) => `<span class="pg-x pg-x-${soort}" style="left:${pct(soort === "eind" ? 1000 : x(i) + (soort === "midden" ? 500 / n : 0), 1000)}">${esc(i === n - 1 ? "vandaag" : datumKort(lijst[i][0]))}</span>`);

    const laatsteI = lijst.map(([, p]) => typeof p === "number").lastIndexOf(true);
    const laagI = lijst.findIndex(([, p]) => p === s.laagste);
    const laagX = x(laagI) + 500 / n;
    const laagKant = laagX > 820 ? "rechts" : laagX < 180 ? "links" : "midden";
    const punt = (px, py, klasse) => `<span class="pg-punt${klasse ? ` ${klasse}` : ""}" style="left:${pct(px, 1000)};top:${pct(py, 100)}"></span>`;
    const markers = (s.laagste !== s.hoogste
      ? punt(laagX, y(s.laagste)) + `<span class="pg-label pg-label-${laagKant}" style="left:${pct(laagX, 1000)};top:${pct(y(s.laagste), 100)}">laagste ${esc(eur.format(s.laagste))}</span>`
      : "") + (laatsteI >= 0 ? punt(x(laatsteI + 1), y(lijst[laatsteI][1]), "pg-nu") : "");

    const titel = `Prijsverloop van de ${o.naam} sinds ${datumLang(s.begin)}`;
    const beschrijving = s.laagste === s.hoogste
      ? `De laagste winkelprijs bleef ${eur.format(s.laagste)}.`
      : `Laagste ${eur.format(s.laagste)} op ${datumLang(s.laagsteDatum)}, hoogste ${eur.format(s.hoogste)} op ${datumLang(s.hoogsteDatum)}${s.nu !== null ? `, nu ${eur.format(s.nu)}` : ", nu bij geen winkel te koop"}.`;
    const dagdata = JSON.stringify(lijst.map(([d, p]) => [d, typeof p === "number" ? p : null]));

    // De wijzigingen als tabel: wie de lijn niet ziet of de bedragen wil
    // nalopen, leest hier hetzelfde.
    const wijzigingen = [];
    let vorige;
    for (const [d, p] of lijst) {
      if (p === undefined || p === vorige) continue;
      wijzigingen.push([d, p, typeof p === "number" && typeof vorige === "number" ? p - vorige : null]);
      vorige = p;
    }
    const tabel = wijzigingen.map(([d, p, delta]) => `<tr><td>${esc(datumLang(d))}</td><td class="cijfer">${typeof p === "number" ? esc(eur.format(p)) : "geen winkel met een prijs"}</td><td class="cijfer">${delta ? (delta > 0 ? "+" : "−") + esc(eur.format(Math.abs(delta))) : ""}</td></tr>`).join("");

    const stat = (label, waarde, extra) => `<div><dt>${label}</dt><dd><span class="cijfer">${waarde}</span>${extra ? ` <small>${extra}</small>` : ""}</dd></div>`;
    return `<figure class="prijsgrafiek" data-dagen='${esc(dagdata)}' aria-label="${esc(titel)}">
    <dl class="pg-cijfers">
      ${stat("Nu", s.nu !== null ? esc(eur.format(s.nu)) : "niet te koop")}
      ${stat("Laagste", esc(eur.format(s.laagste)), esc(datumKort(s.laagsteDatum)))}
      ${stat("Hoogste", esc(eur.format(s.hoogste)), esc(datumKort(s.hoogsteDatum)))}
    </dl>
    <div class="pg-vlak">
      <div class="pg-plot">
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
          <g class="pg-raster">${rasters.join("")}</g>
          <path class="pg-lijn" d="${trapPad(lijst, x, y)}"/>
        </svg>
        ${yLabels.join("")}
        ${markers}
        <span class="pg-kruis" hidden></span>
        <div class="pg-tip" hidden></div>
      </div>
      <div class="pg-xas">${xLabels.join("")}</div>
    </div>
    <figcaption>Laagste winkelprijs incl. btw per dag, sinds ${esc(datumLang(s.begin))}. ${esc(beschrijving)}</figcaption>
    <details class="pg-tabel"><summary>Alle prijswijzigingen</summary>
      <div class="tabel-blok"><table class="data-tabel"><thead><tr><th>Datum</th><th>Laagste prijs</th><th>Verschil</th></tr></thead><tbody>${tabel}</tbody></table></div>
    </details>
  </figure>`;
  }

  /* Het kruis en het kaartje onder de muis of vinger. Het kruis zoekt de dag,
     niet de lijn: niemand mikt op een streep van twee pixels. */
  function koppel(wortel) {
    if (typeof document === "undefined") return;
    (wortel || document).querySelectorAll(".prijsgrafiek[data-dagen]").forEach((fig) => {
      if (fig.dataset.gekoppeld) return;
      fig.dataset.gekoppeld = "1";
      let lijst;
      try { lijst = JSON.parse(fig.dataset.dagen); } catch { return; }
      const plot = fig.querySelector(".pg-plot");
      const kruis = plot.querySelector(".pg-kruis");
      const tip = plot.querySelector(".pg-tip");
      const n = lijst.length;
      const toon = (clientX) => {
        const r = plot.getBoundingClientRect();
        const i = Math.max(0, Math.min(n - 1, Math.floor(((clientX - r.left) / r.width) * n)));
        const px = ((i + 0.5) / n) * r.width;
        kruis.style.left = `${px}px`;
        kruis.hidden = false;
        const [d, p] = lijst[i];
        tip.innerHTML = `<b>${esc(typeof p === "number" ? eur.format(p) : "geen prijs")}</b><span>${esc(datumLang(d))}</span>`;
        tip.hidden = false;
        tip.style.left = `${Math.max(0, Math.min(r.width - tip.offsetWidth, px - tip.offsetWidth / 2))}px`;
      };
      const weg = () => { kruis.hidden = true; tip.hidden = true; };
      plot.addEventListener("pointermove", (e) => toon(e.clientX));
      plot.addEventListener("pointerdown", (e) => toon(e.clientX));
      plot.addEventListener("pointerleave", weg);
    });
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => koppel());
    else koppel();
  }

  return { laad, dagen, samenvatting, lijntje, grafiekHtml, koppel };
});
