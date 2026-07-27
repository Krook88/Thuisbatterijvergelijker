/* ==========================================================================
   Keuzehulp: adviseert een accugrootte (kWh) en de best passende batterijen.

   Maatadvies (vuistregels, bewust als bandbreedte gepresenteerd):
   - Met zonnepanelen: je slaat het dagelijkse zomeroverschot op, maar meer
     opslaan dan je 's avonds en 's nachts verbruikt is zinloos.
       dagoverschot_zomer  = (opwek x (1 - direct eigen verbruik)) / 365 x 1,5
       avondnachtverbruik  = jaarverbruik / 365 x 0,6
       advies              = min(dagoverschot_zomer, avondnachtverbruik), bandbreedte +/- 25%
   - Zonder zonnepanelen, met dynamisch contract: je verschuift het deel van
     je dagverbruik dat flexibel is naar goedkope uren.
       advies = jaarverbruik / 365 x 0,6, bandbreedte +/- 25%
   - Zonder zonnepanelen en zonder dynamisch contract: een batterij kan dan
     vrijwel niets verdienen; dat zeggen we eerlijk.

   Matching: filtert data/batterijen.json op fase, installatievoorkeur,
   smart home-eisen, dynamisch contract en budget, en rangschikt op
   (1) hoe goed de capaciteit past, (2) prijs per kWh, (3) koppelgemak.
   ========================================================================== */

(function () {
  "use strict";

  const el = (id) => document.getElementById(id);
  const eurFmt = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const kwhFmt = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 });

  let batterijen = [];
  let merkLogos = {};
  let gestart = false; // pas advies tonen nadat de bezoeker er zelf om vraagt

  /* ------------------------------------------------------------------ */

  // Zelfde prijslogica als de vergelijker: budget en ranking gaan over de
  // vergelijkprijs incl. btw, anders wint een groothandelsprijs excl. btw
  // altijd van een eerlijke consumentenprijs.
  const bestePrijs = Prijs.beste;

  function vergelijkPrijs(b) {
    const prijs = Prijs.vergelijkPrijs(bestePrijs(b));
    return prijs === null ? Infinity : prijs;
  }

  function driewaardig(v) {
    if (v && typeof v === "object") return v.status || "deels";
    if (v === true) return "ja";
    if (typeof v === "string" && v.trim()) return "deels";
    return "nee";
  }

  function vierwaardig(v) {
    if (v === undefined || v === null) return "onbekend";
    return driewaardig(v);
  }

  // Koppel-score: zelfde formule als de vergelijker (assets/app.js) en uitleg.html#koppel-score
  function koppelScore(b) {
    const punt = (v) => { const s = driewaardig(v); return s === "ja" ? 2 : s === "deels" ? 1 : 0; };
    return punt(b.homey) + punt(b.home_assistant) + punt(b.dynamisch_contract);
  }

  function koppelScoreBadge(b) {
    const score = koppelScore(b);
    const klasse = score >= 5 ? "koppel-hoog" : score >= 3 ? "koppel-midden" : "koppel-laag";
    return `<span class="badge koppel-score ${klasse}" title="Punten voor Homey, Home Assistant en dynamisch contract (2 per volledige, 1 per gedeeltelijke ondersteuning)">\u{1F517} Koppel-score ${score}/6</span>`;
  }

  function getal(id, fallback) {
    const v = parseFloat(String(el(id).value).replace(",", "."));
    return Number.isFinite(v) ? v : fallback;
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  /* ------------------------------------------------------------------
     Maatadvies
     ------------------------------------------------------------------ */

  // Geschatte avondpiek in kW: basislast van 0,4 kW voor sluimerverbruik
  // (koelkast, vriezer, modem/internetkastjes, verlichting, tv)
  // plus de apparaten die de bezoeker aanvinkt als "vaak tegelijk aan".
  // Indicatieve vermogens; bedoeld als vuistregel, geen installatieadvies.
  function avondPiekKw() {
    let kw = 0.4;
    document.querySelectorAll(".avond-apparaat:checked").forEach((n) => { kw += parseFloat(n.dataset.kw) || 0; });
    return Math.round(kw * 10) / 10;
  }

  function berekenMaat() {
    const jaarverbruik = getal("advVerbruik", 2900);
    const heeftPv = el("advPv").value === "ja";
    const opwek = heeftPv ? getal("advOpwek", 3500) : 0;
    const dynamisch = el("advContract").value === "dynamisch";

    const avondNacht = (jaarverbruik / 365) * 0.6;
    const piekKw = avondPiekKw();

    if (heeftPv) {
      const dagOverschotZomer = ((opwek * 0.7) / 365) * 1.5;
      const kern = Math.min(dagOverschotZomer, Math.max(avondNacht, 1));
      return { laag: kern * 0.75, hoog: kern * 1.25, kern, basis: "pv", dynamisch, avondNacht, dagOverschotZomer, piekKw };
    }
    if (dynamisch) {
      return { laag: avondNacht * 0.75, hoog: avondNacht * 1.25, kern: avondNacht, basis: "dynamisch", dynamisch, avondNacht, piekKw };
    }
    return { laag: 0, hoog: 0, kern: 0, basis: "geen", dynamisch, avondNacht, piekKw };
  }

  /* ------------------------------------------------------------------
     Batterijen matchen
     ------------------------------------------------------------------ */

  function match(maat) {
    const fase = el("advFase").value;           // "1" | "3" | "weet-niet"
    const installatie = el("advInstallatie").value; // "zelf" | "installateur" | "beide"
    const homey = el("advHomey").checked;
    const ha = el("advHA").checked;
    const noodstroom = el("advNoodstroom").checked;
    const budget = getal("advBudget", 0);

    const redenenAfgevallen = [];

    const kandidaten = batterijen.filter((b) => {
      const prijs = bestePrijs(b);
      if (!b.capaciteit_kwh) return false;

      // Fase: bij een 1-fase aansluiting vallen 3-fase-only systemen af
      if (fase === "1" && b.fase === "3-fase") return false;

      // Installatievoorkeur
      if (installatie === "zelf" && b.installatie !== "zelf") return false;
      if (installatie === "installateur" && b.installatie !== "installateur") return false;

      // Smart home-eisen
      if (homey && driewaardig(b.homey) === "nee") return false;
      if (ha && driewaardig(b.home_assistant) === "nee") return false;

      // Noodstroom: alleen batterijen waarvan bevestigd is dat het kan
      if (noodstroom && !["ja", "deels"].includes(vierwaardig(b.noodstroom))) return false;

      // Dynamisch contract als dat het (enige) verdienmodel is
      if (maat.basis === "dynamisch" && driewaardig(b.dynamisch_contract) === "nee") return false;

      // Budget (alleen als ingevuld)
      if (budget > 0 && prijs && Prijs.vergelijkPrijs(prijs) > budget) return false;

      // Capaciteit: past binnen ruime marge rond het advies,
      // of is modulair uitbreidbaar tot binnen de bandbreedte
      const past = b.capaciteit_kwh >= maat.laag * 0.6 && b.capaciteit_kwh <= maat.hoog * 1.8;
      const uitbreidbaar = b.uitbreidbaar_tot_kwh && b.capaciteit_kwh <= maat.hoog && b.uitbreidbaar_tot_kwh >= maat.laag;
      if (!past && !uitbreidbaar) return false;

      return true;
    });

    // Score: capaciteitspassing (belangrijkst), dan prijs per kWh, dan koppelgemak
    const scored = kandidaten.map((b) => {
      const prijs = bestePrijs(b);
      const perKwh = prijs ? Prijs.vergelijkPrijs(prijs) / b.capaciteit_kwh : 9999;
      const afwijking = Math.abs(b.capaciteit_kwh - maat.kern) / Math.max(maat.kern, 1);
      const capScore = Math.max(0, 1 - afwijking);                    // 0..1
      const prijsScore = Math.max(0, 1 - (perKwh - 150) / 850);       // ~150 euro/kWh = top
      const koppelScore = (b.koppeling_gemak || 0) / 5;
      const score = capScore * 0.5 + prijsScore * 0.3 + koppelScore * 0.2;
      return { b, prijs, perKwh, score };
    });

    scored.sort((a, z) => z.score - a.score);
    return { top: scored.slice(0, 3), totaal: kandidaten.length, redenenAfgevallen };
  }

  /* ------------------------------------------------------------------
     Rendering
     ------------------------------------------------------------------ */

  function waaromTekst(b, maat) {
    const redenen = [];
    if (Math.abs(b.capaciteit_kwh - maat.kern) / Math.max(maat.kern, 1) <= 0.3) {
      redenen.push("de capaciteit sluit goed aan op je geadviseerde maat");
    } else if (b.uitbreidbaar_tot_kwh && b.capaciteit_kwh < maat.laag) {
      redenen.push("modulair uitbreidbaar tot je geadviseerde maat");
    } else if (b.capaciteit_kwh > maat.hoog) {
      redenen.push("let op: ruimer dan je geadviseerde maat; alleen zinvol als je verbruik echt gaat groeien (warmtepomp, elektrische auto), anders betaal je voor capaciteit die je niet opmaakt");
    } else {
      redenen.push("de capaciteit valt binnen je bandbreedte");
    }
    if (maat.piekKw > 0.4 && b.vermogen_kw) {
      if (b.vermogen_kw >= maat.piekKw) {
        redenen.push(`het vermogen (${String(b.vermogen_kw).replace(".", ",")} kW) dekt jouw avondgebruik (ca. ${String(maat.piekKw).replace(".", ",")} kW)`);
      } else {
        redenen.push(`let op: het vermogen (${String(b.vermogen_kw).replace(".", ",")} kW) ligt onder jouw geschatte avondpiek (ca. ${String(maat.piekKw).replace(".", ",")} kW); het net vult automatisch aan, maar dat deel bespaart dan niet`);
      }
    }
    if (b.installatie === "zelf") redenen.push("zelf aan te sluiten zonder installateur");
    if ((b.koppeling_gemak || 0) >= 4) redenen.push("koppelt makkelijk aan bestaande zonnepanelen");
    if (driewaardig(b.dynamisch_contract) !== "nee" && maat.dynamisch) redenen.push("geschikt voor je dynamische contract");
    return redenen.slice(0, 4).join(", ");
  }

  function render() {
    const doel = el("adviesResultaat");

    if (!gestart) {
      doel.innerHTML = `
        <p class="datum-stempel">Nog geen advies: dat komt er pas als jij erom vraagt.</p>
        <p>Vul je gegevens in en klik op <b>"Geef mij advies"</b>. De vooringevulde getallen zijn gemiddelden om je op weg te helpen; pas ze gerust aan naar je eigen situatie (je jaarnota is de beste bron).</p>`;
      return;
    }

    const maat = berekenMaat();
    const heeftPv = el("advPv").value === "ja";

    if (maat.basis === "geen") {
      doel.innerHTML = `
        <div class="waarschuwing-kader"><b>Eerlijk advies: wacht nog even met een batterij.</b>
        Zonder zonnepanelen en zonder dynamisch energiecontract valt er niets op te slaan en geen prijsverschil te benutten; een thuisbatterij verdient zich dan vrijwel zeker niet terug.
        Overweeg eerst een dynamisch contract of zonnepanelen, en kom daarna terug. Lees ook <a href="regelgeving.html">wat de regels betekenen</a>.</div>`;
      return;
    }

    const { top, totaal } = match(maat);

    const maatUitleg = maat.basis === "pv"
      ? `Gebaseerd op je zomerse zonnestroom-overschot (ca. ${kwhFmt.format(maat.dagOverschotZomer)} kWh per dag) en je avond- en nachtverbruik (ca. ${kwhFmt.format(maat.avondNacht)} kWh per dag): meer opslaan dan je 's avonds gebruikt heeft geen zin.`
      : `Gebaseerd op het deel van je dagverbruik dat je naar goedkope uren kunt verschuiven (ca. ${kwhFmt.format(maat.avondNacht)} kWh per dag).`;

    let kaarten = "";
    if (!top.length) {
      kaarten = '<div class="leeg-melding">Geen batterijen gevonden die aan al je eisen voldoen. Verruim je budget of laat een smart home-eis los; of bekijk <a href="index.html">de volledige vergelijker</a>.</div>';
    } else {
      kaarten = `<div class="kaarten-grid" style="margin-top:18px;">` + top.map(({ b, prijs, perKwh }, i) => `
        <article class="batterij-kaart">
          <div class="kaart-kop">
            <div>
              <div class="merk">${i === 0 ? "🏆 Beste match · " : ""}${merkLogos[b.merk] ? `<img class="merk-logo" src="${escapeHtml(merkLogos[b.merk])}" alt="" loading="lazy"> ` : ""}${escapeHtml(b.merk)}</div>
              <h3><a href="batterij/${encodeURIComponent(b.id)}.html" style="color:inherit;text-decoration:none;" title="Alle details van de ${escapeHtml(b.merk)} ${escapeHtml(b.model)}">${escapeHtml(b.model)}</a></h3>
              <span class="type-badge type-${escapeHtml(b.type)}">${escapeHtml({ "plug-in": "Plug-in (stopcontact)", "ac-gekoppeld": "AC-gekoppeld", "hybride": "Hybride omvormer" }[b.type] || b.type)}</span>
              <div style="margin-top:6px;">${koppelScoreBadge(b)}</div>
            </div>
          </div>
          <div class="kaart-specs">
            <div class="spec"><span class="spec-label">Capaciteit</span><span class="spec-waarde">${String(b.capaciteit_kwh).replace(".", ",")} kWh${b.uitbreidbaar_tot_kwh ? ` <small>(tot ${String(b.uitbreidbaar_tot_kwh).replace(".", ",")})</small>` : ""}</span></div>
            <div class="spec"><span class="spec-label">Prijs incl. btw</span><span class="spec-waarde" title="${escapeHtml(Prijs.prijsToelichting(prijs))}">${prijs ? eurFmt.format(Prijs.vergelijkPrijs(prijs)) : "op aanvraag"}</span></div>
            <div class="spec"><span class="spec-label">Per kWh</span><span class="spec-waarde">${prijs ? eurFmt.format(perKwh) : "n.b."}</span></div>
            <div class="spec"><span class="spec-label">Installatie</span><span class="spec-waarde">${b.installatie === "zelf" ? "Zelf" : "Installateur"}</span></div>
          </div>
          <div class="koppelgemak"><span class="uitleg"><b>Waarom deze past:</b> ${escapeHtml(waaromTekst(b, maat))}.</span></div>
          <div class="koppelgemak"><span class="uitleg">Compleet gebruiksklaar (indicatie): <b>${b.totaalprijs_van_eur ? eurFmt.format(b.totaalprijs_van_eur) + (b.totaalprijs_tot_eur ? " tot " + eurFmt.format(b.totaalprijs_tot_eur) : "") : "op aanvraag"}</b></span></div>
          ${b.prijs_omvat ? `<div class="koppelgemak"><span class="uitleg">Winkelprijs dekt: ${escapeHtml(b.prijs_omvat)}</span></div>` : ""}
          <div class="kaart-acties" style="margin-top:auto;">
            ${prijs && prijs.url ? `<a class="knop" href="${escapeHtml(prijs.affiliate_url || prijs.url)}" target="_blank" rel="noopener${prijs.affiliate_url ? " sponsored" : ""}" aria-label="Bekijk de aanbieding van de ${escapeHtml(b.merk)} ${escapeHtml(b.model)}">Bekijk aanbieding →</a>` : ""}
            <a class="knop knop-secundair" href="rekenmodule.html?batterij=${encodeURIComponent(b.id)}" aria-label="Bereken de terugverdientijd van de ${escapeHtml(b.merk)} ${escapeHtml(b.model)}">Terugverdientijd</a>
          </div>
        </article>`).join("") + "</div>";
    }

    doel.innerHTML = `
      <div class="info-kader" style="text-align:center;">
        <span style="font-size:0.85rem;font-weight:700;text-transform:uppercase;color:var(--kleur-tekst-licht);">Geadviseerde accugrootte</span>
        <div style="font-size:2rem;font-weight:800;color:var(--kleur-primair-donker);">${kwhFmt.format(maat.laag)} tot ${kwhFmt.format(maat.hoog)} kWh</div>
        <div style="font-size:0.9rem;color:var(--kleur-tekst-licht);">${maatUitleg}</div>
      </div>
      ${maat.piekKw > 0.4 ? `<div class="info-kader" style="text-align:center;margin-top:10px;">
        <span style="font-size:0.85rem;font-weight:700;text-transform:uppercase;color:var(--kleur-tekst-licht);">Handig ontlaadvermogen voor jouw avondgebruik</span>
        <div style="font-size:1.5rem;font-weight:800;color:var(--kleur-primair-donker);">ca. ${String(maat.piekKw).replace(".", ",")} kW of meer</div>
        <div style="font-size:0.9rem;color:var(--kleur-tekst-licht);">Schatting op basis van de apparaten die je aanvinkte, plus ca. 0,4 kW basislast voor sluimerverbruik (koelkast, vriezer, modem, verlichting, tv). Levert een batterij minder, dan is dat geen probleem: het stroomnet vult automatisch aan, maar over dat deel bespaar je op dat moment niet. Wil je <b>noodstroom</b>, dan is voldoende vermogen wél belangrijk: bij een storing is er geen net om bij te springen.</div>
      </div>` : ""}
      ${heeftPv ? '<div class="waarschuwing-kader">Let op: tot en met 31 december 2026 geldt de salderingsregeling nog, waardoor opslaan van eigen zonnestroom financieel weinig oplevert. Dit advies kijkt naar de situatie vanaf 2027.</div>' : ""}
      <h2 style="margin-top:26px;">Beste matches (${top.length} van ${totaal} passende batterijen)</h2>
      ${kaarten}
      <p style="margin-top:14px;"><a href="index.html">Bekijk alle batterijen in de vergelijker →</a></p>
    `;
  }

  /* ------------------------------------------------------------------
     Events en init
     ------------------------------------------------------------------ */

  function koppelPresets() {
    el("advPersonen").addEventListener("change", (e) => {
      const presets = { "1": 1800, "2": 2700, "3": 3300, "4": 3900, "5": 4400 };
      if (presets[e.target.value]) { el("advVerbruik").value = presets[e.target.value]; }
      render();
    });
    el("advPanelen").addEventListener("input", (e) => {
      const n = parseInt(e.target.value, 10);
      if (Number.isFinite(n) && n > 0) { el("advOpwek").value = n * 350; }
      render();
    });
    el("advPv").addEventListener("change", () => {
      el("pvVragen").style.display = el("advPv").value === "ja" ? "" : "none";
      render();
    });
  }

  async function init() {
    try {
      const res = await fetch("data/batterijen.json", { cache: "no-cache" });
      const data = await res.json();
      batterijen = data.batterijen || [];
      merkLogos = data.merk_logos || {};
    } catch (err) {
      console.error("Batterijen konden niet geladen worden:", err);
    }
    koppelPresets();
    document.querySelectorAll("#adviesFormulier input, #adviesFormulier select").forEach((inp) => {
      inp.addEventListener("input", render);
      inp.addEventListener("change", render);
    });

    el("advStart").addEventListener("click", () => {
      gestart = true;
      render();
      // Op smalle schermen staat het resultaat onder het formulier: scroll ernaartoe
      if (window.innerWidth < 900) {
        el("adviesResultaat").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
