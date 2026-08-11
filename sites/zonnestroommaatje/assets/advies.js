/* ==========================================================================
   Zonnestroommaatje - keuzehulp
   Adviseert op basis van verbruik, dak en wensen het aantal wattpiek en de
   drie best passende panelen uit data/panelen.json.
   ========================================================================== */

(function () {
  "use strict";

  const el = (id) => document.getElementById(id);

  const eurFmt = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const eurWpFmt = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const numFmt = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });

  let panelen = [];
  let omvormers = [];

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  const naamVan = (p) => p.model.toLowerCase().startsWith(p.merk.toLowerCase()) ? p.model : `${p.merk} ${p.model}`;

  // Goedkoopste winkelaanbieding; zonder winkels valt hij terug op de richtprijs
  // (winkel is dan null). Zelfde patroon als assets/app.js en assets/omvormers.js.
  function koopUrl(a) {
    return (a && (a.affiliate_url || a.url)) || "";
  }

  function bestePrijs(x) {
    const aanbiedingen = (x.aanbiedingen || []).filter((a) => a && a.prijs_eur);
    if (aanbiedingen.length) {
      // Bij gelijke prijs wint de aanbieding met controledatum (geverifieerd)
      return aanbiedingen.reduce((min, a) => (a.prijs_eur < min.prijs_eur || (a.prijs_eur === min.prijs_eur && a.datum && !min.datum) ? a : min));
    }
    if (x.richtprijs_eur) return { winkel: null, prijs_eur: x.richtprijs_eur, url: x.product_url };
    return null;
  }

  // Kort "goedkoopst bij ..."-fragment met link naar de winkel
  function winkelLink(beste) {
    if (!beste || !beste.winkel) return "";
    const url = koopUrl(beste);
    const naam = escapeHtml(beste.winkel);
    return url
      ? `goedkoopst bij <a href="${escapeHtml(url)}" target="_blank" rel="noopener${beste.affiliate_url ? " sponsored" : ""}">${naam}</a>`
      : `goedkoopst bij ${naam}`;
  }

  function prijsPerWp(p) {
    const beste = bestePrijs(p);
    return beste && p.vermogen_wp ? beste.prijs_eur / p.vermogen_wp : null;
  }

  // Zelfde formule als assets/app.js en uitleg.html#zeker-score
  function zekerScore(p) {
    let score = 0;
    const g = p.garantie_product_jaar || 0;
    score += g >= 25 ? 2 : g >= 20 ? 1 : 0;
    const b = p.vermogen_behoud_25j_pct || 0;
    score += b >= 90 ? 2 : b >= 88.5 ? 1 : 0;
    score += p.uitvoering === "glas-glas" ? 2 : 0;
    return score;
  }

  function invoer() {
    const liggingRaw = el("dakligging").value;
    const platDak = liggingRaw.includes("plat");
    return {
      verbruik: Math.max(500, Number(el("verbruik").value) || 2900),
      factor: parseFloat(liggingRaw) || 0.9,
      platDak,
      maxPanelen: Math.max(2, Number(el("maxPanelen").value) || 12),
      auto: el("checkAuto").checked,
      warmtepomp: el("checkWarmtepomp").checked,
      batterijPlan: el("batterijPlan") ? el("batterijPlan").value : "nee",
      smartHome: el("smartHome") ? el("smartHome").value : "geen",
      voorkeur: el("voorkeur").value,
      fullBlack: el("checkFullBlack").checked,
      schaduw: el("schaduw") ? el("schaduw").value : "geen",
    };
  }

  /* ------------------------------------------------------------------
     Advies: benodigd vermogen
     ------------------------------------------------------------------ */

  function vermogenAdvies(s) {
    let doelVerbruik = s.verbruik;
    const extras = [];
    if (s.auto) { doelVerbruik += 2000; extras.push("elektrische auto (+2.000 kWh)"); }
    if (s.warmtepomp) { doelVerbruik += 2000; extras.push("warmtepomp (+2.000 kWh)"); }

    // Zonder batterij mikken we op ~100% van het (verwachte) verbruik; met
    // (geplande) batterij loont iets ruimer, omdat het overschot dan zelf te
    // gebruiken is.
    const dekkingsFactor = s.batterijPlan === "ja" ? 1.15 : s.batterijPlan === "later" ? 1.05 : 1.0;
    const benodigdWp = Math.round((doelVerbruik * dekkingsFactor) / s.factor);
    return { doelVerbruik, benodigdWp, extras };
  }

  /* ------------------------------------------------------------------
     Advies: top 3 panelen
     ------------------------------------------------------------------ */

  function scorePanelen(s, dakTeKlein) {
    // Normaliseren per criterium over de hele dataset (0 = slechtst, 1 = best)
    const prijzen = panelen.map(prijsPerWp).filter(Boolean);
    const minPrijs = Math.min(...prijzen), maxPrijs = Math.max(...prijzen);
    const rendementen = panelen.map((p) => p.rendement_pct || 0);
    const minRend = Math.min(...rendementen), maxRend = Math.max(...rendementen);

    // Weging op basis van voorkeur; bij een te klein dak telt rendement zwaarder
    let w = { prijs: 0.45, rendement: 0.2, zeker: 0.35 };
    if (s.voorkeur === "rendement") w = { prijs: 0.2, rendement: 0.55, zeker: 0.25 };
    if (s.voorkeur === "zekerheid") w = { prijs: 0.2, rendement: 0.15, zeker: 0.65 };
    if (dakTeKlein && s.voorkeur !== "rendement") { w.rendement += 0.2; w.prijs = Math.max(0.1, w.prijs - 0.2); }

    const kandidaten = panelen.filter((p) => !s.fullBlack || p.full_black);
    return kandidaten.map((p) => {
      const per = prijsPerWp(p);
      const prijsScore = per ? (maxPrijs - per) / (maxPrijs - minPrijs || 1) : 0;
      const rendScore = ((p.rendement_pct || minRend) - minRend) / (maxRend - minRend || 1);
      const zekerNorm = zekerScore(p) / 6;
      let score = w.prijs * prijsScore + w.rendement * rendScore + w.zeker * zekerNorm;
      if (s.platDak && p.bifaciaal) score += 0.05; // bifaciaal vangt bij een plat dak ook licht via de achterkant
      return { p, score, per };
    }).sort((a, b) => b.score - a.score).slice(0, 3);
  }

  function redenVoor(p, s, dakTeKlein) {
    const redenen = [];
    const per = prijsPerWp(p);
    if (per) redenen.push(`${eurWpFmt.format(per)} per Wp`);
    if ((p.rendement_pct || 0) >= 22.4) redenen.push(`hoog rendement (${String(p.rendement_pct).replace(".", ",")}%), veel opbrengst per m²`);
    if (zekerScore(p) >= 5) redenen.push(`Zeker-score ${zekerScore(p)}/6`);
    if (p.uitvoering === "glas-glas") redenen.push("glas-glas uitvoering");
    if ((p.garantie_product_jaar || 0) >= 25) redenen.push(`${p.garantie_product_jaar} jaar productgarantie`);
    if (s.platDak && p.bifaciaal) redenen.push("bifaciaal: extra opbrengst bij een plat dak");
    if (s.fullBlack && p.full_black) redenen.push("full black");
    return redenen.slice(0, 4).join(" · ");
  }

  /* ------------------------------------------------------------------
     Omvormeradvies: zelfde Koppel-score als assets/omvormers.js
     ------------------------------------------------------------------ */

  function driewaardig(v) {
    if (v && typeof v === "object") return { status: v.status || "deels", tekst: v.tekst || "" };
    if (v === true) return { status: "ja", tekst: "Ja" };
    if (typeof v === "string" && v.trim()) return { status: "deels", tekst: v };
    return { status: "nee", tekst: "Nee" };
  }

  function koppelScore(o) {
    const punt = (v) => { const st = driewaardig(v).status; return st === "ja" ? 2 : st === "deels" ? 1 : 0; };
    return punt(o.batterij) + punt(o.home_assistant) + punt(o.schaduw);
  }

  // Kies de twee best passende omvormers bij deze situatie
  function omvormerAdvies(s) {
    if (!omvormers.length) return null;
    const punt = (v) => { const st = driewaardig(v).status; return st === "ja" ? 2 : st === "deels" ? 1 : 0; };
    const prijsVan = (o) => { const b = bestePrijs(o); return b ? b.prijs_eur : null; };
    const prijzen = omvormers.map(prijsVan).filter(Boolean);
    const minP = Math.min(...prijzen), maxP = Math.max(...prijzen);

    const gescoord = omvormers.map((o) => {
      let score = 0;
      // Schaduw: bij veel schaduw is elektronica per paneel vrijwel een vereiste
      score += punt(o.schaduw) * (s.schaduw === "veel" ? 3 : s.schaduw === "beetje" ? 1.5 : 0.5);
      // Batterijplannen: direct koppelbaar weegt zwaarder naarmate het plan concreter is
      score += punt(o.batterij) * (s.batterijPlan === "ja" ? 3 : s.batterijPlan === "later" ? 2 : 0.75);
      // Smart home: weeg de koppeling met het gekozen platform
      if (s.smartHome === "home_assistant") score += punt(o.home_assistant) * 3;
      else if (s.smartHome === "homey") score += punt(o.homey) * 3;
      else if (s.smartHome === "anders") score += Math.max(punt(o.home_assistant), punt(o.homey)) * 2;
      else score += punt(o.home_assistant) * 0.75;
      // Prijs telt altijd een beetje mee (goedkoper = beter), op basis van de
      // goedkoopst gevonden winkelprijs
      const prijs = prijsVan(o);
      if (prijs) score += 2 * (maxP - prijs) / (maxP - minP || 1);
      return { o, score };
    }).sort((a, b) => b.score - a.score);
    return gescoord.slice(0, 2);
  }

  function omvormerReden(o, s) {
    const redenen = [];
    if (s.schaduw === "veel" && driewaardig(o.schaduw).status === "ja") redenen.push("elektronica per paneel: ideaal bij jouw schaduw");
    if (s.batterijPlan !== "nee" && driewaardig(o.batterij).status === "ja") redenen.push("thuisbatterij direct aan te sluiten");
    if (s.smartHome === "home_assistant" && driewaardig(o.home_assistant).status === "ja") redenen.push("officiële Home Assistant-koppeling");
    if (s.smartHome === "homey" && driewaardig(o.homey).status !== "nee") redenen.push(driewaardig(o.homey).status === "ja" ? "Homey-app beschikbaar" : "Homey-koppeling via community-app");
    redenen.push(`Koppel-score ${koppelScore(o)}/6`);
    if (o.garantie_jaar >= 20) redenen.push(`${o.garantie_jaar} jaar garantie`);
    return redenen.slice(0, 3).join(" · ");
  }

  /* ------------------------------------------------------------------
     Batterij-advies: route en richtgrootte in kWh
     Vuistregel (zelfde als Batterijmaatje): de batterij hoeft niet groter
     dan het kleinste van je gemiddelde zomerse dagoverschot en je
     avond-/nachtverbruik.
     ------------------------------------------------------------------ */

  function batterijAdvies(s, opwek, doelVerbruik, topOmvormer) {
    if (s.batterijPlan === "nee") return null;
    // Zomers dagoverschot: zomerhalfjaar levert ~65% van de jaaropbrengst;
    // circa 65% van de opwek gebruik je overdag niet direct
    const zomerDag = (opwek * 0.65) / 182;
    const overschotDag = zomerDag * 0.65;
    // Avond- en nachtverbruik: circa 40% van het dagelijkse verbruik
    const avond = (doelVerbruik / 365) * 0.4;
    const kwh = Math.min(overschotDag, avond);
    const onder = Math.max(3, Math.round(kwh) - 1);
    const boven = Math.max(onder + 2, Math.round(kwh) + 1);
    const hybride = topOmvormer && driewaardig(topOmvormer.batterij).status === "ja" && topOmvormer.type === "hybride";
    return { onder, boven, hybride, topOmvormer };
  }

  /* ------------------------------------------------------------------
     Renderen
     ------------------------------------------------------------------ */

  function adviseer() {
    const s = invoer();
    const { doelVerbruik, benodigdWp, extras } = vermogenAdvies(s);

    // Vertaal naar panelen op basis van een gangbaar paneel van ~440 Wp
    const refWp = 440;
    let aantal = Math.max(2, Math.round(benodigdWp / refWp));
    const dakTeKlein = aantal > s.maxPanelen;
    const aantalGeadviseerd = Math.min(aantal, s.maxPanelen);
    const wpGeadviseerd = aantalGeadviseerd * refWp;
    const opbrengst = Math.round(wpGeadviseerd * s.factor);
    const dekking = Math.round((opbrengst / doelVerbruik) * 100);

    const top3 = scorePanelen(s, dakTeKlein);
    const medaille = Iconen.svg("medaille");
    const plekken = [`${medaille} Beste match`, `${medaille} Tweede keus`, `${medaille} Derde keus`];
    const topOmvormers = omvormerAdvies(s);
    // Vuistregel omvormergrootte: circa 90% van het paneelvermogen, afgerond op halve kW
    const omvormerKw = String(Math.max(1.5, Math.round((wpGeadviseerd * 0.9) / 500) / 2)).replace(".", ",");

    // Systeemoverzicht: beste paneel + beste omvormer + montage, in lijn met
    // de schatting van de rekenmodule (die € 1.200 + € 130 per paneel rekent
    // voor montage én omvormer samen)
    const topPaneel = top3.length ? top3[0].p : null;
    const topOmvormer = topOmvormers && topOmvormers.length ? topOmvormers[0].o : null;
    const batterij = batterijAdvies(s, opbrengst, doelVerbruik, topOmvormer);
    const paneelBeste = topPaneel ? bestePrijs(topPaneel) : null;
    const panelenPrijs = paneelBeste ? paneelBeste.prijs_eur * aantalGeadviseerd : 0;
    const perPaneelOmvormer = topOmvormer && (topOmvormer.type === "micro" || topOmvormer.type === "optimizer");
    const omvormerBeste = topOmvormer ? bestePrijs(topOmvormer) : null;
    const omvormerUnit = omvormerBeste ? omvormerBeste.prijs_eur : 0;
    const omvormerPrijs = topOmvormer
      ? (topOmvormer.type === "micro" ? Math.ceil(aantalGeadviseerd / (topOmvormer.id === "apsystems-ds3" ? 2 : 1)) * omvormerUnit + 250
        // Optimizer-systeem (SolarEdge): losse omvormer + circa € 60 per paneel aan optimizers
        : topOmvormer.type === "optimizer" ? (omvormerBeste && omvormerBeste.winkel ? omvormerUnit : 1100) + 60 * aantalGeadviseerd
        : omvormerUnit)
      : 0;
    const montagePrijs = Math.max(800, 1200 + 130 * aantalGeadviseerd - omvormerPrijs);
    const totaal = panelenPrijs + omvormerPrijs + montagePrijs;

    const smartRegel = (() => {
      if (!topOmvormer) return "";
      if (s.smartHome === "home_assistant") {
        const d = driewaardig(topOmvormer.home_assistant);
        return `Home Assistant: ${d.status === "ja" ? "" + Iconen.svg("ja") + " officiële integratie" : d.status === "deels" ? "~ via community-integratie" : "" + Iconen.svg("nee") + " geen bekende integratie"}`;
      }
      if (s.smartHome === "homey") {
        const d = driewaardig(topOmvormer.homey);
        return `Homey: ${d.status === "ja" ? "" + Iconen.svg("ja") + " app beschikbaar" : d.status === "deels" ? "~ via community-app" : "" + Iconen.svg("nee") + " geen app; opwek wel zichtbaar via de Homey Energy Dongle (P1)"}`;
      }
      if (s.smartHome === "anders") return "Slim aan te sturen via de eigen app; Home Assistant en Homey blijven mogelijk";
      return "";
    })();

    el("adviesInhoud").innerHTML = `
      <div class="advies-samenvatting">
        <div class="groot">${aantalGeadviseerd} panelen (circa ${numFmt.format(wpGeadviseerd)} Wp)</div>
        <p style="margin:6px 0 0;">Verwachte opbrengst: <b>${numFmt.format(opbrengst)} kWh per jaar</b>, circa ${dekking}% van je ${extras.length ? "verwachte " : ""}verbruik van ${numFmt.format(doelVerbruik)} kWh.</p>
        ${extras.length ? `<p class="hint" style="margin:6px 0 0;">Meegerekend: ${extras.join(", ")}.${s.warmtepomp ? ' Nog geen warmtepomp? Vergelijk ze op onze zustersite <a href="https://warmtepompmaatje.nl/" target="_blank" rel="noopener">Warmtepompmaatje</a>.' : ""}</p>` : ""}
        ${s.batterijPlan !== "nee" ? '<p class="hint" style="margin:6px 0 0;">Omdat je een thuisbatterij (verwacht) hebt, adviseren wij iets ruimer: het overschot gebruik je dan zelf.</p>' : ""}
        ${s.factor <= 0.65 ? '<p class="hint" style="margin:6px 0 0;">Let op: een noorddak levert circa een derde minder op dan een zuiddak. Vraag een installateur of het bij jouw dak uit kan; vaak is een oost-westdak of een kleiner systeem verstandiger.</p>' : ""}
        ${dakTeKlein ? `<p style="margin:8px 0 0;background:var(--kleur-accent-licht);border-radius:8px;padding:8px 12px;font-size:0.92rem;">${Iconen.svg("let-op")} Voor je volledige verbruik zouden circa ${aantal} panelen nodig zijn, meer dan er op je dak passen. Kies daarom een paneel met een hoog rendement; die wegen hieronder automatisch zwaarder.</p>` : ""}
      </div>

      ${topPaneel && topOmvormer ? `
      <div class="advies-kaart" style="border-width:2px;border-color:var(--kleur-primair);">
        <span class="plek">${Iconen.svg("lijst")} Jouw complete systeem in het kort</span>
        <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.95rem;margin-top:8px;">
          <tr><td style="padding:6px 8px 6px 0;">${Iconen.svg("zon")} <b>${aantalGeadviseerd} ×</b> ${escapeHtml(naamVan(topPaneel))}${paneelBeste && paneelBeste.winkel ? `<br><small>${winkelLink(paneelBeste)} (${eurFmt.format(paneelBeste.prijs_eur)} per paneel)</small>` : ""}</td><td style="text-align:right;white-space:nowrap;">circa <b>${eurFmt.format(panelenPrijs)}</b></td></tr>
          <tr style="border-top:1px dotted var(--kleur-rand);"><td style="padding:6px 8px 6px 0;">${Iconen.svg("stroom")} ${escapeHtml(topOmvormer.merk)} ${escapeHtml(topOmvormer.model)}${perPaneelOmvormer ? "" : ` (kies circa ${omvormerKw} kW)`}${omvormerBeste && omvormerBeste.winkel ? `<br><small>${winkelLink(omvormerBeste)} (${eurFmt.format(omvormerBeste.prijs_eur)}${topOmvormer.type === "micro" ? " per stuk" : topOmvormer.type === "optimizer" ? " voor de losse omvormer" : ""})</small>` : ""}</td><td style="text-align:right;white-space:nowrap;">circa <b>${eurFmt.format(omvormerPrijs)}</b></td></tr>
          <tr style="border-top:1px dotted var(--kleur-rand);"><td style="padding:6px 8px 6px 0;">${Iconen.svg("installatie")} Montage, bekabeling en meterkast (indicatie)</td><td style="text-align:right;white-space:nowrap;">circa <b>${eurFmt.format(montagePrijs)}</b></td></tr>
          ${batterij ? `<tr style="border-top:1px dotted var(--kleur-rand);"><td style="padding:6px 8px 6px 0;">${Iconen.svg("batterij")} Thuisbatterij ${s.batterijPlan === "ja" ? `van circa ${batterij.onder} tot ${batterij.boven} kWh` : "(later bij te plaatsen)"}</td><td style="text-align:right;white-space:nowrap;">${s.batterijPlan === "ja" ? "apart budget" : "later"}</td></tr>` : ""}
          <tr style="border-top:2px solid var(--kleur-rand);font-weight:700;"><td style="padding:8px 8px 6px 0;">Totaal zonnestroomsysteem${batterij && s.batterijPlan === "ja" ? " (excl. batterij)" : ""}</td><td style="text-align:right;white-space:nowrap;">circa ${eurFmt.format(totaal)}</td></tr>
        </table></div>
        ${smartRegel ? `<p style="margin:8px 0 0;font-size:0.92rem;">${Iconen.svg("huis")} ${smartRegel}</p>` : ""}
        <p style="margin:10px 0 0;"><a class="knop" style="padding:8px 14px;font-size:0.88rem;" href="systeem.html?paneel=${encodeURIComponent(topPaneel.id)}&omvormer=${encodeURIComponent(topOmvormer.id)}&aantal=${aantalGeadviseerd}&schaduw=${encodeURIComponent(s.schaduw)}&batterij=${encodeURIComponent(s.batterijPlan)}&smart=${encodeURIComponent(s.smartHome === "anders" ? "geen" : s.smartHome)}">${Iconen.svg("installatie")} Pas dit systeem aan in de samensteller ${Iconen.svg("pijl-rechts")}</a></p>
        <p class="hint" style="margin:8px 0 0;">Paneel- en omvormerprijzen zijn de goedkoopst gevonden winkelprijzen; klik op de winkel voor de actuele aanbieding. Alle bedragen zijn indicaties (0% btw waar van toepassing, losse onderdelen soms exclusief btw); vraag altijd meerdere offertes aan. <a href="javascript:window.print()">${Iconen.svg("printen")} Advies afdrukken of bewaren als pdf</a></p>
      </div>` : ""}

      <h2 style="margin-top:20px;">De drie best passende panelen</h2>
      ${top3.map(({ p, per }, i) => {
        const beste = bestePrijs(p);
        const stuk = beste ? beste.prijs_eur : (p.richtprijs_eur || 0);
        return `
        <div class="advies-kaart">
          <span class="plek">${plekken[i]}</span>
          <h3><a href="paneel/${encodeURIComponent(p.id)}.html">${escapeHtml(naamVan(p))}</a></h3>
          <div class="reden">${redenVoor(p, s, dakTeKlein)}</div>
          <p style="margin:8px 0 0;font-size:0.95rem;">${p.vermogen_wp} Wp · <b>${eurFmt.format(stuk)}</b> per paneel${beste && beste.winkel ? ` (${winkelLink(beste)})` : " (richtprijs)"} · ${aantalGeadviseerd} stuks: circa <b>${eurFmt.format(stuk * aantalGeadviseerd)}</b> (excl. montage en omvormer)</p>
          <p style="margin:8px 0 0;">${beste && beste.winkel && koopUrl(beste) ? `<a class="knop" style="padding:8px 14px;font-size:0.88rem;" href="${escapeHtml(koopUrl(beste))}" target="_blank" rel="noopener${beste.affiliate_url ? " sponsored" : ""}">Bekijk aanbieding ${Iconen.svg("pijl-rechts")}</a> ` : ""}<a class="knop knop-secundair" style="padding:8px 14px;font-size:0.88rem;" href="rekenmodule.html?paneel=${encodeURIComponent(p.id)}">Bereken terugverdientijd Iconen.svg("pijl-rechts")</a></p>
        </div>`;
      }).join("")}
      ${!top3.length ? '<p class="hint">Geen panelen gevonden met deze wensen; zet bijvoorbeeld het full black-filter uit.</p>' : ""}

      ${topOmvormers ? `
      <h2 style="margin-top:24px;">En welke omvormer past daarbij?</h2>
      <p class="hint" style="margin-top:0;">Op basis van je schaduw${s.batterijPlan !== "nee" ? ", batterijplannen" : ""}${s.smartHome !== "geen" ? " en wens om slim aan te sturen" : ""}. Richt je op een omvormer van circa ${omvormerKw} kW bij ${aantalGeadviseerd} panelen.</p>
      ${topOmvormers.map(({ o }, i) => {
        const beste = bestePrijs(o);
        const uitWinkel = !!(beste && beste.winkel);
        return `
        <div class="advies-kaart">
          <span class="plek">${["" + Iconen.svg("stroom") + " Beste match", "" + Iconen.svg("stroom") + " Ook geschikt"][i]}</span>
          <h3>${escapeHtml(o.merk)} ${escapeHtml(o.model)}</h3>
          <div class="reden">${omvormerReden(o, s)}</div>
          <p style="margin:8px 0 0;font-size:0.95rem;">${uitWinkel ? `laagste prijs <b>${eurFmt.format(beste.prijs_eur)}</b>, ${winkelLink(beste)}` : `richtprijs <b>${eurFmt.format(o.richtprijs_eur || 0)}</b>`} (${escapeHtml(o.prijs_toelichting || "indicatie")})</p>
          ${uitWinkel && koopUrl(beste) ? `<p style="margin:8px 0 0;"><a class="knop" style="padding:8px 14px;font-size:0.88rem;" href="${escapeHtml(koopUrl(beste))}" target="_blank" rel="noopener${beste.affiliate_url ? " sponsored" : ""}">Bekijk aanbieding ${Iconen.svg("pijl-rechts")}</a></p>` : ""}
        </div>`;
      }).join("")}
      <p class="hint" style="margin-top:10px;">Alle ${omvormers.length} omvormersystemen vergelijken op batterij, Home Assistant, Homey en schaduw? <a href="omvormers.html">Naar de omvormer-vergelijker Iconen.svg("pijl-rechts")</a></p>` : ""}

      ${batterij ? `
      <h2 style="margin-top:24px;">En de thuisbatterij?</h2>
      <div class="advies-kaart">
        <span class="plek">${Iconen.svg("batterij")} ${s.batterijPlan === "ja" ? "Ons batterij-advies" : "Optie openhouden: zo doe je dat"}</span>
        ${s.batterijPlan === "ja" ? `
        <p style="margin:8px 0 0;font-size:0.95rem;">Richtgrootte voor jouw situatie: <b>circa ${batterij.onder} tot ${batterij.boven} kWh</b>. Vuistregel: de batterij hoeft niet groter dan het kleinste van je gemiddelde zomerse dagoverschot en je avond- en nachtverbruik.</p>
        <p style="margin:8px 0 0;font-size:0.95rem;">${batterij.hybride
          ? `De geadviseerde ${escapeHtml(batterij.topOmvormer.merk)}-omvormer is hybride: de batterij sluit er rechtstreeks op aan (let op de merkkeuze die daarbij hoort, zie de omvormerdetails).`
          : `Bij dit omvormeradvies past een <b>AC-gekoppelde of plug-in batterij</b>: die meet via de slimme meter (P1) je overschot en werkt met elk merk panelen en omvormers.`}</p>` : `
        <p style="margin:8px 0 0;font-size:0.95rem;">Verstandig: na 2027 (einde saldering) wordt een batterij interessanter. ${batterij.hybride
          ? `De geadviseerde ${escapeHtml(batterij.topOmvormer.merk)}-omvormer is al hybride, dus een batterij is later zó bijgeplaatst.`
          : `Een AC-gekoppelde of plug-in batterij is later altijd toe te voegen via de slimme meter (P1), ongeacht je omvormerkeuze.`} Grootte bepaal je dan op basis van je werkelijke overschot.</p>`}
        <p style="margin:8px 0 0;font-size:0.95rem;">Batterijen vergelijken op prijs per kWh, noodstroom en slimme aansturing doe je op onze zustersite: <a href="https://batterijmaatje.nl/" target="_blank" rel="noopener">Batterijmaatje.nl ${Iconen.svg("pijl-rechts")}</a> Verwarm je (straks) met een warmtepomp, dan benut die je zonnestroom extra goed; vergelijk warmtepompen op <a href="https://warmtepompmaatje.nl/" target="_blank" rel="noopener">Warmtepompmaatje ${Iconen.svg("pijl-rechts")}</a></p>
      </div>` : ""}

      <p class="hint" style="margin-top:14px;">Alle ${panelen.length} panelen zelf vergelijken? <a href="index.html">Naar de vergelijker ${Iconen.svg("pijl-rechts")}</a></p>
    `;
  }

  async function init() {
    try {
      const res = await fetch("data/panelen.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      panelen = data.panelen || [];

      // Omvormers meladen voor het omvormeradvies (best effort)
      try {
        const resO = await fetch("data/omvormers.json", { cache: "no-cache" });
        if (resO.ok) omvormers = (await resO.json()).omvormers || [];
      } catch { /* zonder omvormerdata blijft het paneeladvies gewoon werken */ }

      ["verbruik", "dakligging", "maxPanelen", "voorkeur", "schaduw", "batterijPlan", "smartHome"].forEach((id) => {
        el(id).addEventListener("input", adviseer);
        el(id).addEventListener("change", adviseer);
      });
      ["checkAuto", "checkWarmtepomp", "checkFullBlack"].forEach((id) => {
        el(id).addEventListener("change", adviseer);
      });

      adviseer();
    } catch (err) {
      el("adviesInhoud").innerHTML = '<p class="hint">De paneelgegevens konden niet worden geladen. Vernieuw de pagina of probeer het later opnieuw.</p>';
      console.error("Fout bij laden panelen.json:", err);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
