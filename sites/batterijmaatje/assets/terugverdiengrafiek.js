/* ==========================================================================
   Terugverdiengrafiek: de opgetelde besparing per jaar tegen de investering.
   Zelfstandige SVG, geen libraries. Gedeeld door de rekenmodule en de
   doorrekening op meterdata.html; stond eerst alleen in rekenmodule.js.

   Kleuren gevalideerd op contrast en kleurenblind-veiligheid:
   teal #0d9488 (opbrengst), amber #d97706 (investering)
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TerugverdienGrafiek = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";
  const eurFmt = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const jaarFmt = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 });

  function teken(investering, jaarOpbrengst, degradatie, terugverdientijd) {
    const H = Math.min(30, Math.max(15, Math.ceil(terugverdientijd) + 3)); // horizon in jaren
    // Op een telefoon smaller tekenen met grotere letters: de grafiek van 640
    // breed werd tot zo'n 290 pixels verkleind, en de getallen langs de assen
    // tot een letter van 5 pixels.
    const smal = window.matchMedia("(max-width: 520px)").matches;
    const W = smal ? 360 : 640, HGT = smal ? 240 : 300, mL = smal ? 44 : 78, mR = smal ? 12 : 24, mT = 18, mB = smal ? 36 : 40;
    const fs = smal ? 13 : 11;
    const pw = W - mL - mR, ph = HGT - mT - mB;
    const cum = (j) => Rekenkern.besparingNa(jaarOpbrengst, degradatie, j);
    const yMax = Math.max(investering, cum(H)) * 1.06;
    const x = (jaar) => mL + (jaar / H) * pw;
    const y = (eur) => mT + ph - (eur / yMax) * ph;

    // Rasterlijnen en y-labels (terughoudend: 4 stappen)
    let raster = "";
    for (let i = 0; i <= 4; i++) {
      const val = (yMax / 4) * i;
      raster += `<line x1="${mL}" x2="${W - mR}" y1="${y(val)}" y2="${y(val)}" stroke="#e5e7eb" stroke-width="1"/>` +
        `<text x="${mL - 8}" y="${y(val) + 4}" text-anchor="end" font-size="${fs}" fill="#5d6d6a">${Math.round(val / 100) / 10}k</text>`;
    }
    // X-labels per 5 jaar
    let xlabels = "";
    for (let j = 0; j <= H; j += 5) {
      xlabels += `<text x="${x(j)}" y="${HGT - 14}" text-anchor="middle" font-size="${fs}" fill="#5d6d6a">${j}</text>`;
    }

    // Opbrengstlijn met hoverpunten per jaar. De lijn buigt licht af: de
    // batterij levert in jaar tien minder dan in jaar één.
    let pad = `M ${x(0)} ${y(0)}`;
    let punten = "";
    for (let j = 1; j <= H; j++) {
      pad += ` L ${x(j)} ${y(cum(j))}`;
      punten += `<circle cx="${x(j)}" cy="${y(cum(j))}" r="9" fill="transparent"><title>Na ${j} jaar: ${eurFmt.format(cum(j))} bespaard (saldo ${eurFmt.format(cum(j) - investering)})</title></circle>`;
    }

    // Terugverdienpunt
    const bx = x(terugverdientijd), by = y(investering);
    const labelLinks = terugverdientijd > H * 0.55;

    return `
    <div style="display:flex;gap: var(--ruimte-14);flex-wrap:wrap;font-size:var(--tekst-15);color:var(--kleur-tekst-licht);margin: var(--ruimte-14) 0 var(--ruimte-4);">
      <span><span style="display:inline-block;width:14px;height:3px;background:#0d9488;border-radius:2px;vertical-align:middle;"></span> Opgetelde besparing</span>
      <span><span style="display:inline-block;width:14px;height:0;border-top:3px dashed #d97706;vertical-align:middle;"></span> Investering</span>
    </div>
    <svg viewBox="0 0 ${W} ${HGT}" style="width:100%;height:auto;" role="img" aria-label="Grafiek: de opgetelde besparing groeit elk jaar en kruist na ${jaarFmt.format(terugverdientijd)} jaar de investering van ${eurFmt.format(investering)}. De cijfers staan ook in de tabel hieronder.">
      ${raster}${xlabels}
      <text x="${W - mR}" y="${HGT - 2}" text-anchor="end" font-size="${fs}" fill="#5d6d6a">jaren</text>
      <line x1="${mL}" x2="${W - mR}" y1="${y(investering)}" y2="${y(investering)}" stroke="#d97706" stroke-width="2" stroke-dasharray="6 5"/>
      <path d="${pad}" fill="none" stroke="#0d9488" stroke-width="2"/>
      <circle cx="${bx}" cy="${by}" r="6" fill="#0d9488" stroke="#ffffff" stroke-width="2"/>
      <text x="${bx + (labelLinks ? -10 : 10)}" y="${by - 12}" text-anchor="${labelLinks ? "end" : "start"}" font-size="${fs + 1}" font-weight="700" fill="#1f2937">terugverdiend na ${jaarFmt.format(terugverdientijd)} jaar</text>
      ${punten}
    </svg>`;
  }

  return { teken };
});
