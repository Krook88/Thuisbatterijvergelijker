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

  function toonKolommen() {
    const lijst = el("mdKolomLijst");
    const opties = [["afname", "Afname"], ["teruglevering", "Teruglevering"], ["negeren", "Niet gebruiken"]];
    lijst.innerHTML = opzet.kolommen.map((k, i) => `
      <div class="veld">
        <label for="mdKolom${i}">${esc(k.naam)}</label>
        <select id="mdKolom${i}" data-kolom="${i}">
          ${opties.map(([w, t]) => `<option value="${w}"${k.soort === w ? " selected" : ""}>${t}</option>`).join("")}
        </select>
        <span class="hint">${k.oplopend ? "Meterstanden, ik reken het verschil per uur uit." : "Verbruik per periode."}</span>
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
    delen.push(`<p class="md-samenvatting">Gemeten van ${datumFmt.format(new Date(s.van))} tot ${datumFmt.format(new Date(s.tot))}, ${numFmt.format(s.uren)} uur. ` +
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

    const zichtbaar = alles ? rijen : rijen.slice(0, AANTAL_EERST);
    const tvtTekst = (r) => r.tvt === null ? "niet binnen 40 jaar" : `${jaarFmt.format(r.tvt)} jaar`;
    delen.push(`<div class="tabel-wrap"><table class="vergelijk-tabel compact">
      <thead><tr><th>Batterij</th><th class="getal">Terugverdiend in</th><th class="getal">Bespaart per jaar</th><th class="getal">Prijs</th><th class="getal">Uit de batterij per jaar</th><th class="getal">Vol op (dagen)</th></tr></thead>
      <tbody>${zichtbaar.map((r) => `<tr>
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
    el("mdResultaat").innerHTML = delen.join("");
    const knop = el("mdAlles");
    if (knop) knop.addEventListener("click", () => { alles = !alles; toonResultaat(); });
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
      opzet.kolommen[Number(i)].soort = e.target.value;
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
