/* ==========================================================================
   Warmtepompmaatje - rekenmodule besparing en terugverdientijd
   Rekent per warmtepomp uit wat hij per jaar bespaart op gas, wat de extra
   stroom kost en in hoeveel jaar de investering is terugverdiend.
   Aannames staan uitgelegd op de pagina onder "Hoe rekenen wij?" en zijn
   gelijk aan de vuistregels van de keuzehulp.
   ========================================================================== */

(function () {
  "use strict";

  const el = (id) => document.getElementById(id);
  const eurFmt = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const numFmt = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });

  // De som zelf staat in assets/rekenkern.js, gedeeld met de keuzehulp en
  // getest door scripts/rekenkern.test.mjs. Dit bestand doet het scherm.
  const LEVENSDUUR_JAAR = Rekenkern.LEVENSDUUR_JAAR;
  const HYBRIDE_SCOP = Rekenkern.HYBRIDE_SCOP;
  const ALLEL_SCOP = Rekenkern.ALLEL_SCOP;
  const getal = (t) => t.toFixed(1).replace(".", ",");
  const jaren = (t) => t === null ? "meer dan 40 jaar" : `${getal(t)} jaar`;
  // Bewust een bereik en geen enkel getal: zie Rekenkern.bandbreedte.
  const bereik = (laag, hoog) => laag === null ? "meer dan 40 jaar"
    : hoog === null ? `vanaf ${getal(laag)} jaar`
    : getal(laag) === getal(hoog) ? `${getal(laag)} jaar`
    : `${getal(laag)} tot ${getal(hoog)} jaar`;

  let pompen = [];

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  // Prijslogica: zie assets/prijs.js. De terugverdientijd rekent met de
  // vergelijkprijs (altijd incl. btw): een bedrag zonder btw invullen zou de
  // terugverdientijd ruim een jaar te gunstig maken.
  const bestePrijs = (w) => Prijs.beste(w);
  const vergelijkPrijs = (a) => Prijs.vergelijkPrijs(a);

  function gekozenPomp() {
    const id = el("keuzePomp").value;
    return pompen.find((w) => w.id === id) || null;
  }

  function invoer() {
    const w = gekozenPomp();
    const beste = w ? bestePrijs(w) : null;
    const type = w ? w.type : "hybride";
    const eigenInstallatie = Number(el("installatiekosten").value) || 0;
    return {
      w, type, beste,
      gas: Math.max(300, Number(el("gasverbruik").value) || 1200),
      gasprijs: Number(el("gasprijs").value) || 1.45,
      stroomprijs: Number(el("stroomprijs").value) || 0.30,
      vastrecht: Number(el("vastrecht").value) || 0,
      afsluitkosten: Number(el("afsluitkosten").value) || 0,
      gasAf: type === "all-electric" && el("checkGasAf").checked,
      // null en niet 0: van een pomp zonder bekende prijs mag je geen
      // terugverdientijd uitrekenen. Met 0 zou het toestel als gratis worden
      // meegerekend en kwam er een veel te rooskleurig antwoord uit - juist bij
      // pompen waarvan wij de prijs nog niet hebben.
      toestelPrijs: vergelijkPrijs(beste),
      installatie: eigenInstallatie > 0 ? eigenInstallatie : null,
      isde: w ? (w.isde_indicatie_eur || 0) : 0,
      ketelVervangen: el("ketelStaat").value === "vervangen",
      ketelprijs: Number(el("ketelprijs").value) || Rekenkern.STANDAARD.ketelprijs,
    };
  }

  function bereken() {
    const s = invoer();
    if (!s.w) return;

    const band = Rekenkern.bandbreedte({ ...s, pomp: s.w });
    const r = band.verwacht;
    const { gasBespaard, stroomKwh, vastrechtBesparing, besparingJaar, netto, prijsOnbekend, tvt, besparingLevensduur } = r;
    s.installatie = r.installatie;
    s.installatieGeschat = r.installatieGeschat;
    const gebruikteScop = { hybride: r.scop, allel: r.scop, eigen: r.eigenScop };
    const tvtTekst = prijsOnbekend ? "niet te berekenen" : jaren(tvt);
    const co2 = Math.round(r.co2);
    const gasOver = Math.round(r.gasOver);
    const k = r.tegenoverKetel;

    // Staafdiagram voor en na: energiekosten voor verwarming, warm water en koken.
    // "Voor" is de huidige situatie met cv-ketel; "na" met de gekozen warmtepomp.
    // Voor − na is precies de besparing per jaar hierboven.
    // Kleuren met betekenis: gas is terracotta (vlam), stroom is blauw, vaste kosten grijs
    const voorDelen = [
      { label: "gas", kleur: "var(--kleur-primair)", bedrag: s.gas * s.gasprijs },
      { label: "vaste gaskosten", kleur: "#a8a29e", bedrag: s.vastrecht },
    ];
    const naDelen = [
      { label: "gas", kleur: "var(--kleur-primair)", bedrag: gasOver * s.gasprijs },
      { label: "vaste gaskosten", kleur: "#a8a29e", bedrag: s.gasAf ? 0 : s.vastrecht },
      { label: "stroom warmtepomp", kleur: "var(--kleur-blauw, #2563eb)", bedrag: stroomKwh * s.stroomprijs },
    ];
    const totaalVoor = voorDelen.reduce((t, d) => t + d.bedrag, 0);
    const totaalNa = naDelen.reduce((t, d) => t + d.bedrag, 0);
    const maxTotaal = Math.max(totaalVoor, totaalNa) || 1;
    const balk = (delen) => `<div class="vgl-balk">${delen.filter((d) => d.bedrag > 0.5).map((d) =>
      `<span title="${d.label}: ${eurFmt.format(d.bedrag)}" style="width:${(d.bedrag / maxTotaal) * 100}%;background:${d.kleur};"></span>`).join("")}</div>`;
    const legendaKleuren = [...new Map([...voorDelen, ...naDelen].filter((d) => d.bedrag > 0.5).map((d) => [d.label, d.kleur])).entries()];
    const voorNaDiagram = `
      <div class="vgl-blok" role="img" aria-label="Energiekosten per jaar: nu ${eurFmt.format(totaalVoor)}, met deze warmtepomp ${eurFmt.format(totaalNa)}.">
        <p class="vgl-titel">Je energiekosten voor warmte, per jaar</p>
        <div class="vgl-tabel">
          <div class="vgl-rij"><span class="vgl-label">Nu (cv-ketel)</span>${balk(voorDelen)}<b class="vgl-bedrag">${eurFmt.format(totaalVoor)}</b></div>
          <div class="vgl-rij"><span class="vgl-label">Met deze pomp</span>${balk(naDelen)}<b class="vgl-bedrag">${eurFmt.format(totaalNa)}</b></div>
        </div>
        <p class="vgl-legenda">${legendaKleuren.map(([label, kleur]) => `<span><i style="background:${kleur};"></i>${label}</span>`).join(" ")}</p>
        <p class="vgl-verschil">${besparingJaar >= 0 ? `${Iconen.svg("omlaag")} ${eurFmt.format(besparingJaar)} per jaar lager` : `${Iconen.svg("omhoog")} ${eurFmt.format(-besparingJaar)} per jaar hoger`}</p>
      </div>`;

    el("resultaatInhoud").innerHTML = `
      <div class="resultaat-groot"${prijsOnbekend ? "" : ` style="color:${Oordeel.KLEUR[Oordeel.van("warmtepomp", k ? k.tvt : tvt)]};"`}>${prijsOnbekend ? tvtTekst : k ? bereik(band.ketelLaag, band.ketelHoog) : bereik(band.laag, band.hoog)}</div>
      <p class="hint" style="margin: 0 0 var(--ruimte-14);">${prijsOnbekend
        ? `van deze warmtepomp heb ik nog geen winkelprijs, dus de investering is onbekend. De besparing per jaar hieronder klopt wel: die hangt alleen af van je verbruik en de tarieven.`
        : `${k ? "terugverdientijd van de meerprijs ten opzichte van een nieuwe cv-ketel" : "terugverdientijd"}, middenscenario ${jaren(k ? k.tvt : tvt)}. Het bereik komt van dezelfde som met een ongunstige en een gunstige set aannames: gas- en stroomprijs 15% hoger of lager, het rendement 10% lager of 8% hoger${s.installatieGeschat ? ", en de geschatte installatie 40% duurder of 10% goedkoper" : ""}.${s.installatieGeschat ? " Heb je een offerte? Vul het installatiebedrag in onder \"Aannames aanpassen\", dan wordt het bereik smaller." : ""}`}</p>
      ${k ? ketelBlok(k, s, netto, tvt, prijsOnbekend) : ""}
      <div class="resultaat-rij"><span>Warmtepomp</span><b>${escapeHtml(s.w.merk)} ${escapeHtml(s.w.model)} (${s.type === "hybride" ? "hybride" : "all-electric"})</b></div>
      <div class="resultaat-rij"><span>Toestel ${prijsOnbekend ? "" : (s.beste && !s.beste.is_richtprijs ? `<small>(laagste prijs, bij ${escapeHtml(s.beste.winkel)})</small>` : "<small>(richtprijs)</small>")}</span><b>${prijsOnbekend ? "prijs onbekend" : eurFmt.format(s.toestelPrijs)}</b></div>
      ${Prijs.prijsToelichting(s.beste) ? `<p class="hint" style="margin: 0 0 var(--ruimte-6);">${escapeHtml(Prijs.prijsToelichting(s.beste))}</p>` : ""}
      <div class="resultaat-rij"><span>Installatie ${s.installatieGeschat ? "<small>(schatting)</small>" : ""}${s.gasAf && s.afsluitkosten ? ` <small>+ gas afsluiten ${eurFmt.format(s.afsluitkosten)}</small>` : ""}</span><b>${eurFmt.format(s.installatie + (s.gasAf ? s.afsluitkosten : 0))}</b></div>
      <div class="resultaat-rij"><span>ISDE-subsidie <small>(indicatie)</small></span><b>− ${eurFmt.format(s.isde)}</b></div>
      <div class="resultaat-rij"><span>Netto investering</span><b>${prijsOnbekend ? "onbekend" : eurFmt.format(netto)}</b></div>
      <div class="resultaat-rij"><span>Gasbesparing per jaar</span><b>${numFmt.format(gasBespaard)} m³${s.type === "hybride" ? ` <small style="font-weight:400;color:var(--kleur-tekst-licht);">(${numFmt.format(gasOver)} m³ blijft voor piekkou en warm water)</small>` : ""}</b></div>
      <div class="resultaat-rij"><span>Extra stroomverbruik per jaar</span><b>${numFmt.format(stroomKwh)} kWh</b></div>
      <p class="hint" style="margin: 0 0 var(--ruimte-6);">${gebruikteScop.eigen
        ? `Gerekend met het rendement van deze pomp: SCOP ${String(s.w.scop).replace(".", ",")} volgens het label bij 35 graden aanvoer, hier op ${String(Math.round((s.type === "hybride" ? gebruikteScop.hybride : gebruikteScop.allel) * 10) / 10).replace(".", ",")} gezet omdat een woning geen testbank is.`
        : `Gerekend met een praktijkrendement van ${String(s.type === "hybride" ? HYBRIDE_SCOP : ALLEL_SCOP).replace(".", ",")} voor een gemiddelde pomp. Van deze pomp is niet vastgesteld bij welke aanvoertemperatuur zijn SCOP geldt, en bij 55 graden ligt die ruim een punt lager dan bij 35 - dan zou dit een te mooi getal worden.`}</p>
      ${vastrechtBesparing ? `<div class="resultaat-rij"><span>Vaste gaskosten vervallen</span><b>${eurFmt.format(vastrechtBesparing)} per jaar</b></div>` : ""}
      <div class="resultaat-rij"><span>Besparing per jaar</span><b>${eurFmt.format(besparingJaar)} <small style="font-weight:400;color:var(--kleur-tekst-licht);">(≈ ${eurFmt.format(besparingJaar / 12)} per maand)</small></b></div>
      <div class="resultaat-rij"><span>Besparing over ${LEVENSDUUR_JAAR} jaar <small>(gemiddelde levensduur)</small></span><b>${eurFmt.format(besparingLevensduur)}</b></div>
      <div class="resultaat-rij"><span>Netto voordeel over ${LEVENSDUUR_JAAR} jaar</span><b>${eurFmt.format(besparingLevensduur - netto)}</b></div>
      <div class="resultaat-rij"><span>Vermeden CO₂-uitstoot per jaar <small>(indicatie)</small></span><b>circa ${numFmt.format(co2)} kg</b></div>
      ${voorNaDiagram}
      ${!prijsOnbekend && Oordeel.van("warmtepomp", k ? k.tvt : tvt) === "slecht" ? `<p class="hint" style="margin-top: var(--ruimte-10);background:var(--kleur-accent-licht);border-radius:var(--radius-klein);padding: var(--ruimte-10) var(--ruimte-10);">${Iconen.svg("let-op")} Een terugverdientijd van meer dan ${Oordeel.GRENZEN.warmtepomp.matigTot} jaar komt dicht bij of voorbij de ${Oordeel.GRENZEN.warmtepomp.levensduur} dat een warmtepomp meegaat. Financieel is dit dan vooral een duurzame keuze. Check of een goedkopere pomp, een hybride of eerst isoleren beter uitpakt; de <a href="advies.html">keuzehulp</a> helpt daarbij.</p>` : ""}
      ${s.type === "all-electric" && !s.gasAf ? `<p class="hint" style="margin-top: var(--ruimte-10);">${Iconen.svg("tip")} Laat je de gasaansluiting aan (bijvoorbeeld om op gas te koken), dan blijf je circa ${eurFmt.format(s.vastrecht)} per jaar aan vaste gaskosten betalen. Die zijn hier niet als besparing meegerekend.</p>` : ""}
      <p style="margin-top: var(--ruimte-14);"><a href="pomp/${encodeURIComponent(s.w.id)}.html">Alle details van de ${escapeHtml(s.w.merk)} ${escapeHtml(s.w.model)} ${Iconen.svg("pijl-rechts")}</a></p>
      <p class="hint" style="margin-top: var(--ruimte-10);">Indicatie op basis van jouw invoer en mijn aannames; geen offerte of financieel advies.</p>
    `;
    if (window.Delen) {
      Delen.schrijfUrl(el("rekenformulier"));
      if (!prijsOnbekend) deelUitslag(s, k ? k.tvt : tvt, k ? bereik(band.ketelLaag, band.ketelHoog) : bereik(band.laag, band.hoog), besparingJaar, !!k);
    }
  }

  /* De uitslag doorsturen, ook als hij tegenvalt. Het oordeel komt uit
     assets/oordeel.js, net als de kleur hierboven. Zonder prijs is er geen
     terugverdientijd en dus niets om door te sturen. */
  function deelUitslag(s, t, bereikTekst, besparingJaar, tegenoverKetel) {
    const naam = `de ${s.w.merk} ${s.w.model}`;
    const o = Oordeel.van("warmtepomp", t);
    const sleutel = { goed: "reken-loont", matig: "reken-twijfel", slecht: "reken-niet" }[o];
    const levensduur = Oordeel.GRENZEN.warmtepomp.levensduur;
    const kern = `Terugverdientijd van ${naam} bij mij: ${bereikTekst}${tegenoverKetel ? " (de meerprijs boven een nieuwe cv-ketel)" : ""}, ${eurFmt.format(besparingJaar)} besparing per jaar` +
      (o === "slecht" ? `, dicht bij of voorbij de ${levensduur} dat een warmtepomp meegaat.`
        : o === "matig" ? `, met weinig marge op de ${levensduur} dat een warmtepomp meegaat.` : ".");
    Delen.uitslag(el("resultaatInhoud"), { sleutel, bericht: `Ik heb het nagerekend op Warmtepompmaatje. ${kern} Wat is het bij jou?`, formulier: el("rekenformulier") });
  }

  /* Je ketel moet toch vervangen worden: dan is de vraag niet "warmtepomp of
     niets", maar "warmtepomp of een nieuwe ketel". Dit blok zegt wat dat
     verschil kost, en bij een hybride dat de ketel er hoe dan ook bij komt. */
  function ketelBlok(k, s, netto, tvt, prijsOnbekend) {
    const eur = eurFmt.format;
    if (prijsOnbekend) {
      return `<div class="hint" style="margin: 0 0 var(--ruimte-14);background:var(--kleur-primair-licht);border-radius:var(--radius-klein);padding: var(--ruimte-10);"><b>Tegenover een nieuwe cv-ketel van ${eur(k.ketelprijs)}.</b> Zonder toestelprijs is de meerprijs niet te berekenen.</div>`;
    }
    const tekst = k.ketelBlijftNodig
      ? `Een hybride werkt naast een cv-ketel, dus die nieuwe ketel van ${eur(k.ketelprijs)} koop je in beide gevallen. Je totale uitgave wordt ${eur(k.totaleUitgave)}; de meerprijs ten opzichte van alleen een nieuwe ketel blijft de pomp zelf (${eur(k.meerprijs)}). Overweeg ook all-electric: dan vervalt die ketel.`
      : `Je ketel moet toch vervangen worden, dus deze pomp kost je ${eur(k.meerprijs)} meer dan een nieuwe cv-ketel van ${eur(k.ketelprijs)}. Die meerprijs verdien je terug in ${jaren(k.tvt)}, tegenover ${jaren(tvt)} als je de hele investering tegenover niets zet.`;
    return `<div class="hint" style="margin: 0 0 var(--ruimte-14);background:var(--kleur-primair-licht);border-radius:var(--radius-klein);padding: var(--ruimte-10);"><b>Tegenover een nieuwe cv-ketel.</b> ${tekst}</div>`;
  }

  function toonGasAfVeld() {
    const w = gekozenPomp();
    const allElectric = w && w.type === "all-electric";
    const veld = el("veldGasAf");
    // Van het gas af is bij all-electric het gangbare doel: standaard aangevinkt
    if (allElectric && veld.hidden) el("checkGasAf").checked = true;
    if (!allElectric) el("checkGasAf").checked = false;
    veld.hidden = !allElectric;
  }

  async function init() {
    try {
      const res = await fetch("data/site/warmtepompen.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      pompen = ((await res.json()).warmtepompen || []).slice()
        .sort((a, b) => (a.type === b.type ? 0 : a.type === "hybride" ? -1 : 1) || `${a.merk} ${a.model}`.localeCompare(`${b.merk} ${b.model}`, "nl"));

      const select = el("keuzePomp");
      select.innerHTML = pompen.map((w) => {
        const b = bestePrijs(w);
        return `<option value="${escapeHtml(w.id)}">${escapeHtml(w.merk)} ${escapeHtml(w.model)} (${w.type === "hybride" ? "hybride" : "all-electric"}, ${b ? eurFmt.format(vergelijkPrijs(b)) : "prijs onbekend"})</option>`;
      }).join("");

      // Voorselectie via ?pomp=<id> (vanuit de vergelijker en de keuzehulp)
      if (window.Delen) Delen.onthoud(el("rekenformulier"));
      const params = new URLSearchParams(location.search);
      const gevraagd = params.get("pomp");
      if (gevraagd && pompen.some((w) => w.id === gevraagd)) select.value = gevraagd;
      const gevraagdGas = Number(params.get("gas"));
      if (gevraagdGas >= 300 && gevraagdGas <= 6000) el("gasverbruik").value = gevraagdGas;
      if (params.get("ketel") === "vervangen") el("ketelStaat").value = "vervangen";

      ["keuzePomp", "gasverbruik", "gasprijs", "stroomprijs", "vastrecht", "afsluitkosten", "installatiekosten", "ketelStaat", "ketelprijs"].forEach((id) => {
        el(id).addEventListener("input", bereken);
        el(id).addEventListener("change", bereken);
      });
      el("keuzePomp").addEventListener("change", () => { toonGasAfVeld(); bereken(); });
      el("checkGasAf").addEventListener("change", bereken);

      if (window.Delen) Delen.herstel(el("rekenformulier"));
      toonGasAfVeld();
      bereken();
    } catch (err) {
      el("resultaatInhoud").innerHTML = '<p class="hint">De gegevens konden niet worden geladen. Vernieuw de pagina of probeer het later opnieuw.</p>';
      console.error("Fout bij laden warmtepompen.json:", err);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
