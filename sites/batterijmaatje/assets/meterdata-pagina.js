/* ==========================================================================
   meterdata.html - het scherm rond assets/meterdata.js

   Leest het gekozen bestand met FileReader, in de browser. Er gaat niets
   naar een server: dit bestand doet geen enkele fetch behalve die naar de
   eigen batterijlijst.
   ========================================================================== */
(function () {
  "use strict";

  const M = window.Meterdata;
  const el = (id) => document.getElementById(id);
  const eurFmt = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const numFmt = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });
  const jaarFmt = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const datumFmt = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric" });
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Een bestand van honderden megabytes legt de browser stil. Een jaar per
  // kwartier is nog geen 4 MB; een volledige Home Assistant-geschiedenis met
  // alle sensoren kan veel groter zijn.
  const MAX_BYTES = 80 * 1024 * 1024;
  const AANTAL_EERST = 10;

  let batterijen = [];
  let csv = null, opzet = null, uren = null, bron = "";
  let alles = false;
  // Voor welke batterij de grafieken getekend worden. Leeg: de bovenste.
  let grafiekId = null;
  let laatsteRijen = [];
  // Vanaf een productpagina: deze batterij staat altijd in beeld, gemarkeerd.
  const gekozen = new URLSearchParams(location.search).get("batterij");

  function status(tekst, soort) {
    const s = el("mdStatus");
    s.textContent = tekst || "";
    if (soort) s.dataset.soort = soort; else delete s.dataset.soort;
  }

  function getal(id, standaard) {
    const v = parseFloat(String(el(id).value).replace(",", "."));
    return Number.isFinite(v) ? v : standaard;
  }

  function tarief() {
    return {
      stroomprijs: getal("mdStroomprijs", 0.30),
      terugleverVergoeding: getal("mdVergoeding", 0.01),
      terugleverKosten: getal("mdKosten", 0),
    };
  }

  // Dezelfde investering als in de rekenmodule: de gebruiksklare totaalprijs
  // als die er is, anders de beste winkelprijs incl. btw.
  function investeringVoor(b) {
    if (b.totaalprijs_van_eur) return b.totaalprijs_van_eur;
    return Prijs.vergelijkPrijs(Prijs.beste(b)) || null;
  }

  /* ------------------------------------------------------------------
     Inlezen
     ------------------------------------------------------------------ */
  function verwerk(tekst, naam) {
    bron = naam;
    csv = M.leesCsv(tekst);
    opzet = M.herken(csv);
    if (opzet.fout) { toonFout(opzet.fout); return; }
    toonKolommen();
    herreken();
  }

  function herreken() {
    const r = M.naarUren(csv, opzet);
    if (r.fout) { uren = null; toonFout(r.fout); return; }
    uren = r.uren;
    status(`${bron} ingelezen, met een meting per ${r.stapMinuten} minuten.`);
    toonResultaat();
  }

  function toonFout(tekst) {
    status(tekst, "fout");
    el("mdResultaat").innerHTML = '<p class="md-leeg">Zodra het bestand ingelezen is, staat hier de uitkomst per batterij.</p>';
  }

  // Een kolom die niet meetelt, heet ook niet "verbruik per periode".
  function hintVoor(k) {
    if (k.soort === "negeren") return "Telt niet mee.";
    return k.oplopend ? "Meterstanden, ik reken het verschil per uur uit." : "Verbruik per periode.";
  }

  function toonKolommen() {
    const lijst = el("mdKolomLijst");
    const opties = [["afname", "Afname"], ["teruglevering", "Teruglevering"], ["negeren", "Niet gebruiken"]];
    lijst.innerHTML = opzet.kolommen.map((k, i) => `
      <div class="veld">
        <label for="mdKolom${i}">${esc(k.naam)}</label>
        <select id="mdKolom${i}" data-kolom="${i}">
          ${opties.map(([w, t]) => `<option value="${w}"${k.soort === w ? " selected" : ""}>${t}</option>`).join("")}
        </select>
        <span class="hint" id="mdKolomHint${i}">${hintVoor(k)}</span>
      </div>`).join("");
    el("mdKolommen").hidden = false;
  }

  /* ------------------------------------------------------------------
     Uitkomst
     ------------------------------------------------------------------ */
  function toonResultaat() {
    if (!uren) return;
    const s = M.samenvatting(uren);
    const t = tarief();
    const delen = [];
    delen.push(`<p class="md-samenvatting">Gemeten van ${datumFmt.format(new Date(s.van))} tot en met ${datumFmt.format(new Date(s.tot - 1))}, ${numFmt.format(s.uren)} uur. ` +
      `Zonder batterij nam je in die tijd ${numFmt.format(s.afname)} kWh af en leverde je ${numFmt.format(s.terug)} kWh terug.</p>`);
    if (s.maandenVanHetJaar < 12) {
      delen.push(`<p class="waarschuwing-kader">Er ${s.maandenVanHetJaar === 1 ? "zit" : "zitten"} ${s.maandenVanHetJaar} van de 12 maanden in je bestand. De bedragen hieronder zijn omgerekend naar een jaar. Ontbreekt de winter, dan valt de opbrengst te hoog uit; ontbreekt de zomer, te laag.</p>`);
    }
    if (s.terug < Math.max(10, s.afname * 0.02)) {
      delen.push(`<p class="waarschuwing-kader">Je leverde in deze periode ${numFmt.format(s.terug)} kWh terug. Zonder zonneoverschot heeft een batterij hier niets op te slaan. Met een dynamisch contract kan laden op goedkope uren wel iets opleveren; dat rekent <a href="rekenmodule.html">de rekenmodule</a> uit.</p>`);
      el("mdResultaat").innerHTML = delen.join("");
      return;
    }

    let zonderPrijs = 0, hybride = 0;
    const rijen = [];
    for (const b of batterijen) {
      if (!(b.capaciteit_kwh > 0)) continue;
      // Een losse module voor een hybride omvormer zonder gebruiksklare
      // prijs: de omvormer van duizenden euro's hoort erbij en zit niet in
      // het bedrag. Dan klopt de terugverdientijd niet.
      if (b.type === "hybride" && !b.totaalprijs_van_eur) { hybride++; continue; }
      const investering = investeringVoor(b);
      if (!investering) { zonderPrijs++; continue; }
      const sim = M.simuleer(uren, M.batterijVoorSimulatie(b));
      const jaar = M.opbrengst(sim, t) * s.jaarFactor;
      rijen.push({
        b, investering, sim, jaar,
        opgeslagen: sim.ontladen * s.jaarFactor,
        volPct: sim.dagen ? sim.dagenVol / sim.dagen : 0,
        tvt: Rekenkern.terugverdientijd(jaar, investering, 0.02),
      });
    }
    // Een prijs die te oud is of nergens meer af te rekenen, achteraan (zie
    // Prijs.prijsAchteraan), net als in de vergelijker.
    const achteraan = (r) => (Prijs.prijsAchteraan && Prijs.prijsAchteraan(r.b) ? 1 : 0);
    rijen.sort((x, y) => achteraan(x) - achteraan(y) || (x.tvt ?? Infinity) - (y.tvt ?? Infinity) || y.jaar - x.jaar);

    let zichtbaar = alles ? rijen : rijen.slice(0, AANTAL_EERST);
    const plek = rijen.findIndex((r) => r.b.id === gekozen);
    if (plek >= AANTAL_EERST && !alles) zichtbaar = zichtbaar.concat(rijen[plek]);
    const tvtTekst = (r) => r.tvt === null ? "niet binnen 40 jaar" : `${jaarFmt.format(r.tvt)} jaar`;
    delen.push(`<div class="tabel-wrap"><table class="vergelijk-tabel compact">
      <thead><tr><th>Batterij</th><th class="getal">Terugverdiend in</th><th class="getal">Bespaart per jaar</th><th class="getal">Prijs</th><th class="getal">Uit de batterij per jaar</th><th class="getal">Vol op (dagen)</th></tr></thead>
      <tbody>${zichtbaar.map((r) => `<tr${r.b.id === gekozen ? ' class="md-gekozen"' : ""}>
        <td><a href="batterij/${encodeURIComponent(r.b.id)}.html">${esc(r.b.merk)} ${esc(r.b.model)}</a>${Prijs.nergensLeverbaar && Prijs.nergensLeverbaar(r.b) ? " <small>(nu nergens te koop)</small>" : ""}</td>
        <td class="getal"><b>${tvtTekst(r)}</b></td>
        <td class="getal">${eurFmt.format(r.jaar)}</td>
        <td class="getal">${eurFmt.format(r.investering)}</td>
        <td class="getal">${numFmt.format(r.opgeslagen)} kWh</td>
        <td class="getal">${numFmt.format(r.volPct * 100)}%</td>
      </tr>`).join("")}</tbody></table></div>`);
    if (rijen.length > AANTAL_EERST) {
      delen.push(`<p class="md-meer"><button type="button" class="knop knop-secundair" id="mdAlles">${alles ? `Toon de eerste ${AANTAL_EERST}` : `Toon alle ${rijen.length}`}</button></p>`);
    }
    const noten = [];
    if (hybride) noten.push(`${hybride} batterijen voor een hybride omvormer staan er niet in, omdat hun prijs zonder die omvormer is.`);
    if (zonderPrijs) noten.push(`${zonderPrijs} zonder bekende prijs ook niet.`);
    noten.push(`"Vol op" zegt op welk deel van de dagen de batterij helemaal volliep. Staat dat hoog, dan levert een grotere meer op; staat het laag, dan betaal je voor capaciteit die je niet vult.`);
    delen.push(`<p class="md-leeg">${noten.join(" ")}</p>`);
    laatsteRijen = rijen;
    if (!rijen.some((x) => x.b.id === grafiekId)) grafiekId = (rijen.find((x) => x.b.id === gekozen) || rijen[0] || {}).b?.id || null;
    if (grafiekId) {
      delen.push(`<div class="md-grafiek">
        <div class="veld"><label for="mdGrafiekKeuze">Wanneer levert hij het op?</label>
          <select id="mdGrafiekKeuze">${rijen.map((x) => `<option value="${esc(x.b.id)}"${x.b.id === grafiekId ? " selected" : ""}>${esc(x.b.merk)} ${esc(x.b.model)}</option>`).join("")}</select></div>
        <div id="mdGrafieken"></div>
      </div>`);
    }
    el("mdResultaat").innerHTML = delen.join("");
    const knop = el("mdAlles");
    if (knop) knop.addEventListener("click", () => { alles = !alles; toonResultaat(); });
    const keuze = el("mdGrafiekKeuze");
    if (keuze) {
      keuze.addEventListener("change", () => { grafiekId = keuze.value; toonGrafieken(t, s); });
      toonGrafieken(t, s);
    }
  }

  /* ------------------------------------------------------------------
     Grafieken voor één batterij: per maand, en de terugverdienlijn
     ------------------------------------------------------------------ */
  const MAAND = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const MAAND_LANG = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
  // Dezelfde teal als de terugverdiengrafiek (assets/terugverdiengrafiek.js),
  // daar gevalideerd op contrast en kleurenblindheid.
  const KLEUR = "#0d9488";

  /* Eén staaf per kalendermaand: wat de batterij die maand bespaarde. Een
     maand met minder dan een week metingen staat er niet in; die zegt niets. */
  function maandGrafiek(maanden, tarief) {
    const smal = window.matchMedia("(max-width: 520px)").matches;
    const W = smal ? 360 : 640, HGT = smal ? 220 : 260, mL = smal ? 40 : 56, mR = 8, mT = 22, mB = 34;
    const fs = smal ? 13 : 11;
    const pw = W - mL - mR, ph = HGT - mT - mB;
    const waarden = maanden.map((m) => M.opbrengst(m, tarief));
    const max = Math.max(1, ...waarden), min = Math.min(0, ...waarden);
    const stap = max > 60 ? 20 : max > 30 ? 10 : 5;
    const top = Math.ceil(max / stap) * stap;
    const y = (v) => mT + ((top - v) / (top - min)) * ph;
    const vak = pw / maanden.length;
    const breed = Math.max(6, Math.min(36, vak - 6));
    const jaren = new Set(maanden.map((m) => m.jaar)).size > 1;
    let raster = "";
    for (let v = 0; v <= top; v += stap) {
      raster += `<line x1="${mL}" x2="${W - mR}" y1="${y(v)}" y2="${y(v)}" stroke="#e5e7eb" stroke-width="1"/>` +
        `<text x="${mL - 6}" y="${y(v) + 4}" text-anchor="end" font-size="${fs}" fill="#5d6d6a">€ ${v}</text>`;
    }
    const iMax = waarden.indexOf(Math.max(...waarden));
    let staven = "", labels = "";
    maanden.forEach((m, i) => {
      const v = waarden[i];
      const x = mL + i * vak + (vak - breed) / 2;
      const y0 = y(0), y1 = y(v), h = Math.abs(y0 - y1), r = Math.min(4, h, breed / 2);
      // Afgerond aan de kant van de waarde, recht op de nullijn.
      const pad = v >= 0
        ? `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + breed - r} Q${x + breed},${y1} ${x + breed},${y1 + r} V${y0} Z`
        : `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + breed - r} Q${x + breed},${y1} ${x + breed},${y1 - r} V${y0} Z`;
      const titel = `${MAAND_LANG[m.maand]} ${m.jaar}: ${eurFmt.format(v)} bespaard, ${numFmt.format(m.ontladen)} kWh uit de batterij`;
      staven += `<path d="${pad}" fill="${KLEUR}"/><rect x="${mL + i * vak}" y="${mT}" width="${vak}" height="${ph}" fill="transparent"><title>${esc(titel)}</title></rect>`;
      const toon = !smal || maanden.length <= 12 || i % 2 === 0;
      if (toon) labels += `<text x="${x + breed / 2}" y="${HGT - 16}" text-anchor="middle" font-size="${fs}" fill="#5d6d6a">${MAAND[m.maand]}</text>`;
      if (jaren && (m.maand === 0 || i === 0)) labels += `<text x="${x + breed / 2}" y="${HGT - 2}" text-anchor="middle" font-size="${fs}" fill="#5d6d6a">${m.jaar}</text>`;
      if (i === iMax) labels += `<text x="${x + breed / 2}" y="${y1 - 6}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="#1f2937">${eurFmt.format(v)}</text>`;
    });
    const beste = maanden[iMax], slechtste = maanden[waarden.indexOf(Math.min(...waarden))];
    const omschrijving = `Besparing per maand. Het meest in ${MAAND_LANG[beste.maand]} ${beste.jaar} (${eurFmt.format(waarden[iMax])}), het minst in ${MAAND_LANG[slechtste.maand]} ${slechtste.jaar} (${eurFmt.format(Math.min(...waarden))}). De cijfers staan ook in de tabel eronder.`;
    return `<svg viewBox="0 0 ${W} ${HGT}" style="width:100%;height:auto;" role="img" aria-label="${esc(omschrijving)}">
      ${raster}<line x1="${mL}" x2="${W - mR}" y1="${y(0)}" y2="${y(0)}" stroke="#9ca3af" stroke-width="1"/>${staven}${labels}
    </svg>`;
  }

  function toonGrafieken(tarief, s) {
    const doel = el("mdGrafieken");
    const r = laatsteRijen.find((x) => x.b.id === grafiekId);
    if (!doel || !r) return;
    // Een maand met minder dan een week metingen laat ik weg: een staaf voor
    // de ene dag van 1 november zegt niets over november.
    const maanden = r.sim.perMaand.filter((m) => m.uren >= M.MIN_UREN);
    const naam = `${esc(r.b.merk)} ${esc(r.b.model)}`;
    const delen = [];
    if (maanden.length) {
      delen.push(`<h3>Besparing per maand met de ${naam}</h3>`, maandGrafiek(maanden, tarief));
    }
    if (r.tvt !== null && r.tvt <= 27) {
      delen.push(`<h3>Terugverdiend bij ${eurFmt.format(r.investering)}</h3>`,
        TerugverdienGrafiek.teken(r.investering, r.jaar, 0.02, r.tvt));
    } else {
      delen.push(`<p class="md-leeg">Bij ${eurFmt.format(r.jaar)} per jaar verdient de ${naam} zijn ${eurFmt.format(r.investering)} niet binnen 27 jaar terug, dus een terugverdienlijn zegt hier weinig.</p>`);
    }
    if (maanden.length) {
      delen.push(`<details class="md-cijfers"><summary>Cijfers per maand</summary>
        <div class="tabel-wrap"><table class="vergelijk-tabel compact">
          <thead><tr><th>Maand</th><th class="getal">Uit de batterij</th><th class="getal">Bespaard</th></tr></thead>
          <tbody>${maanden.map((m) => `<tr><td>${MAAND_LANG[m.maand]} ${m.jaar}</td><td class="getal">${numFmt.format(m.ontladen)} kWh</td><td class="getal">${eurFmt.format(M.opbrengst(m, tarief))}</td></tr>`).join("")}</tbody>
        </table></div></details>`);
    }
    doel.innerHTML = delen.join("");
  }

  /* ------------------------------------------------------------------
     Bediening
     ------------------------------------------------------------------ */
  function bestandGekozen(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.size > MAX_BYTES) {
      toonFout(`Dit bestand is ${numFmt.format(f.size / 1048576)} MB. Exporteer alleen de sensoren voor afname en teruglevering, dan wordt het veel kleiner.`);
      return;
    }
    status("Bezig met inlezen…");
    const lezer = new FileReader();
    lezer.onload = () => verwerk(String(lezer.result), f.name);
    lezer.onerror = () => toonFout("Het bestand kon niet gelezen worden.");
    lezer.readAsText(f);
  }

  function contractGewijzigd() {
    const standaard = Rekenkern.TERUGLEVERING[el("mdContract").value] || Rekenkern.TERUGLEVERING.vast;
    el("mdVergoeding").value = standaard.terugleverVergoeding;
    el("mdKosten").value = standaard.terugleverKosten;
    toonResultaat();
  }

  async function start() {
    el("mdBestand").addEventListener("change", bestandGekozen);
    el("mdVoorbeeld").addEventListener("click", () => verwerk(M.voorbeeldCsv(2025), "Het verzonnen jaar (tien panelen, 2.900 kWh verbruik)"));
    el("mdKolomLijst").addEventListener("change", (e) => {
      const i = e.target.dataset && e.target.dataset.kolom;
      if (i === undefined || !opzet) return;
      const k = opzet.kolommen[Number(i)];
      k.soort = e.target.value;
      el(`mdKolomHint${i}`).textContent = hintVoor(k);
      herreken();
    });
    el("mdContract").addEventListener("change", contractGewijzigd);
    for (const id of ["mdStroomprijs", "mdVergoeding", "mdKosten"]) el(id).addEventListener("input", toonResultaat);
    try {
      const res = await fetch("data/site/batterijen.json", { cache: "no-cache" });
      const data = await res.json();
      batterijen = data.batterijen || data;
    } catch (e) {
      status("De lijst met batterijen kon niet geladen worden. Probeer de pagina opnieuw te openen.", "fout");
    }
    if (uren) toonResultaat();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
