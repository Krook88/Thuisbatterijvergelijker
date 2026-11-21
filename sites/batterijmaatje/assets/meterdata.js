/* ==========================================================================
   Meterdata - rekenen met je eigen verbruik per uur
   ==========================================================================

   De rekenmodule schat wat een batterij opvangt uit een paar getallen van de
   jaarnota, met een aangenomen spreiding over de dagen (zie rekenkern.js,
   opgevangenPerDag). Wie een export van zijn P1-meter heeft, hoeft niet te
   schatten: die weet per uur wat hij afnam en wat hij terugleverde. Dit
   bestand leest zo'n export in en laat een batterij uur voor uur meedraaien.

   Alles hier is een pure functie, zodat scripts/meterdata.test.mjs het kan
   vastleggen, en alles draait in de browser van de bezoeker. Het bestand gaat
   nergens heen.

   Drie stappen:

   1. leesCsv       tekst naar kop en rijen; puntkomma, komma of tab, met of
                    zonder aanhalingstekens, decimale komma of punt
   2. herken        welke kolom de tijd is en welke kolommen afname en
                    teruglevering; meterstanden (oplopend) of verbruik per
                    kwartier of uur; ook de lange vorm van een Home
                    Assistant-export (entity_id, state, last_changed)
   3. naarUren      alles naar kWh per klokuur, zodat een kwartierexport, een
                    uurexport en losse meterstanden op hetzelfde uitkomen

   Daarna simuleer(): een batterij die zonneoverschot opslaat en het terug-
   geeft zodra je weer afneemt. Handel op uurprijzen zit er bewust niet in:
   daarvoor zijn ook de uurprijzen van dezelfde periode nodig, en die staan
   niet in een meterexport. De rekenmodule rekent dat deel apart uit.
   ========================================================================== */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Meterdata = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const UUR = 3600000;
  // Een gat tussen twee meterstanden van meer dan zes uur verdelen we niet
  // over de tussenliggende uren: wanneer daarin de zon scheen weet niemand.
  const MAX_GAT = 6 * UUR;
  // Onder een week aan uren is de uitkomst vooral toeval.
  const MIN_UREN = 7 * 24;

  /* ------------------------------------------------------------------
     1. CSV
     ------------------------------------------------------------------ */

  function splitsRegel(regel, sep) {
    const uit = [];
    let veld = "", inAanhaling = false;
    for (let i = 0; i < regel.length; i++) {
      const c = regel[i];
      if (inAanhaling) {
        if (c === '"' && regel[i + 1] === '"') { veld += '"'; i++; }
        else if (c === '"') inAanhaling = false;
        else veld += c;
      } else if (c === '"') inAanhaling = true;
      else if (c === sep) { uit.push(veld.trim()); veld = ""; }
      else veld += c;
    }
    uit.push(veld.trim());
    return uit;
  }

  function scheidingsteken(regels) {
    const kandidaten = [";", "\t", ","];
    let beste = ",", meeste = 0;
    for (const sep of kandidaten) {
      // Het teken dat op de eerste regels even vaak voorkomt en het vaakst.
      const tellingen = regels.slice(0, 5).map((r) => splitsRegel(r, sep).length);
      const min = Math.min(...tellingen);
      if (min > meeste) { meeste = min; beste = sep; }
    }
    return beste;
  }

  function leesCsv(tekst) {
    const regels = String(tekst || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((r) => r.trim() !== "");
    if (regels.length < 2) return { kop: [], rijen: [], sep: "," };
    const sep = scheidingsteken(regels);
    const kop = splitsRegel(regels[0], sep);
    const rijen = regels.slice(1).map((r) => splitsRegel(r, sep));
    return { kop, rijen, sep };
  }

  /* "1.234,5", "1,234.5", "1234,5", "0.25 kWh" en "-0,3" worden allemaal een
     getal. Bij twee scheidingstekens is de laatste de decimale. */
  function getal(s) {
    if (typeof s === "number") return s;
    let t = String(s == null ? "" : s).trim().replace(/\s*(kwh|wh)$/i, "").replace(/\s/g, "");
    if (!/^[-+]?[\d.,]+$/.test(t)) return NaN;
    const punt = t.lastIndexOf("."), komma = t.lastIndexOf(",");
    if (punt >= 0 && komma >= 0) {
      t = punt > komma ? t.replace(/,/g, "") : t.replace(/\./g, "").replace(",", ".");
    } else if (komma >= 0) {
      // Eén komma is een decimale komma; meer komma's zijn duizendtallen.
      t = (t.match(/,/g).length === 1) ? t.replace(",", ".") : t.replace(/,/g, "");
    }
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
  }

  /* Een tijdstip in milliseconden, of NaN. Zonder tijdzone geldt de lokale
     tijd van de browser, net als in de app waar het bestand vandaan komt. */
  function tijdstip(s) {
    const t = String(s == null ? "" : s).trim();
    if (!t) return NaN;
    if (/^\d{10}$/.test(t)) return Number(t) * 1000;
    if (/^\d{13}$/.test(t)) return Number(t);
    let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(t);
    if (m) {
      const [, j, mnd, d, u = "0", mi = "0", se = "0", zone] = m;
      if (zone) {
        const iso = `${j}-${mnd.padStart(2, "0")}-${d.padStart(2, "0")}T${u.padStart(2, "0")}:${mi}:${se.padStart(2, "0")}${zone.toUpperCase() === "Z" ? "Z" : zone.length === 5 ? zone.slice(0, 3) + ":" + zone.slice(3) : zone}`;
        return Date.parse(iso);
      }
      return new Date(+j, +mnd - 1, +d, +u, +mi, +se).getTime();
    }
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
    if (m) {
      const [, d, mnd, j, u = "0", mi = "0", se = "0"] = m;
      return new Date(+j, +mnd - 1, +d, +u, +mi, +se).getTime();
    }
    // "2026-03-01 00:00 - 2026-03-01 00:15": het begin van de periode telt.
    const deel = t.split(/\s+(?:-|tot|t\/m)\s+/i)[0];
    return deel !== t ? tijdstip(deel) : NaN;
  }

  const ALLEEN_TIJD = /^\d{1,2}:\d{2}(:\d{2})?$/;

  /* ------------------------------------------------------------------
     2. Kolommen herkennen

     De namen verschillen per app en per taal. Wat geen energie is (vermogen
     in watt, gas, water, prijzen) valt eerst af, daarna gaat teruglevering
     vóór afname, omdat "teruglevering" ook "levering" bevat.
     ------------------------------------------------------------------ */
  const GEEN_ENERGIE = /vermogen|power|\(w\)|\bwatt\b|\bgas\b|\bm3\b|m³|water|spanning|volt|ampère|ampere|current|prijs|price|kosten|cost|eur\b|€|temperat/i;
  const TERUG = /terug|export|injectie|returned|retour|produc|opwek|\bback\b|to[ _-]?grid/i;
  const AFNAME = /afname|import|verbruik|consum|delivered|levering|usage|inkoop|from[ _-]?grid|\bnet\b|netto/i;
  const TIJDKOP = /tijd|time|datum|date|stamp|moment|\bvan\b|start|from|last_changed|last_updated|periode|interval|uur|hour/i;

  function soortVanKop(naam) {
    const n = String(naam || "");
    if (GEEN_ENERGIE.test(n)) return "negeren";
    if (TERUG.test(n)) return "teruglevering";
    if (AFNAME.test(n)) return "afname";
    return "negeren";
  }

  // Wh in plaats van kWh: delen door duizend.
  function factorVanKop(naam) {
    const n = String(naam || "");
    return /\bwh\b|\(wh\)|_wh\b/i.test(n) && !/kwh/i.test(n) ? 0.001 : 1;
  }

  function isLangeVorm(kop) {
    const k = kop.map((x) => x.toLowerCase());
    return k.includes("entity_id") && k.includes("state") && (k.includes("last_changed") || k.includes("last_updated"));
  }

  function aandeel(lijst, toets) {
    if (!lijst.length) return 0;
    return lijst.filter(toets).length / lijst.length;
  }

  /* Meterstand (loopt alleen op) of verbruik per periode? Een meterstand is
     groot ten opzichte van zijn stappen en daalt hooguit bij een reset. Een
     kolom met verbruik per kwartier gaat elke dag op en neer. */
  function isOplopend(waarden) {
    const v = waarden.filter(Number.isFinite);
    if (v.length < 3) return false;
    let dalingen = 0;
    const stappen = [];
    for (let i = 1; i < v.length; i++) {
      const d = v[i] - v[i - 1];
      if (d < 0) dalingen++;
      else if (d > 0) stappen.push(d);
    }
    if (!stappen.length) return v[0] > 0 && dalingen === 0;
    const mediaan = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    return dalingen <= Math.max(2, v.length * 0.01) && mediaan(v) > 20 * mediaan(stappen);
  }

  /* Geeft een beschrijving van het bestand terug: de tijdkolom(men) en per
     energiekolom de soort, zodat de pagina het kan tonen en de bezoeker het
     kan bijstellen. */
  function herken(csv) {
    const { kop, rijen } = csv;
    if (!kop.length || !rijen.length) return { fout: "Het bestand bevat geen regels met gegevens." };

    if (isLangeVorm(kop)) {
      const k = kop.map((x) => x.toLowerCase());
      const iEnt = k.indexOf("entity_id"), iStaat = k.indexOf("state");
      const iTijd = k.includes("last_changed") ? k.indexOf("last_changed") : k.indexOf("last_updated");
      const namen = [...new Set(rijen.map((r) => r[iEnt]).filter(Boolean))];
      const kolommen = namen.map((naam) => ({ naam, soort: soortVanKop(naam), factor: factorVanKop(naam), oplopend: true }));
      return { vorm: "lang", iEnt, iStaat, iTijd, kolommen };
    }

    const voorbeeld = rijen.slice(0, 50);
    const parseert = (i, toets) => aandeel(voorbeeld.filter((r) => r[i] !== undefined && r[i] !== ""), (r) => toets(r[i]));
    // De tijdkolom: de eerste kolom waarvan vrijwel alles een tijdstip is,
    // met voorrang voor een kolom die ook zo heet.
    const kandidaten = kop.map((naam, i) => i).filter((i) => parseert(i, (x) => Number.isFinite(tijdstip(x))) >= 0.8);
    let iTijd = kandidaten.find((i) => TIJDKOP.test(kop[i]));
    if (iTijd === undefined) iTijd = kandidaten[0];
    // Datum en tijd in twee kolommen: "01-03-2026" en "14:15".
    let iKlok = -1;
    if (iTijd !== undefined) {
      const alleenDatum = parseert(iTijd, (x) => !/\d:\d/.test(x)) >= 0.8;
      if (alleenDatum) iKlok = kop.findIndex((naam, i) => i !== iTijd && parseert(i, (x) => ALLEEN_TIJD.test(String(x).trim())) >= 0.8);
    }
    if (iTijd === undefined) return { fout: "Ik vind geen kolom met datum en tijd." };

    const kolommen = [];
    kop.forEach((naam, i) => {
      if (i === iTijd || i === iKlok) return;
      if (parseert(i, (x) => Number.isFinite(getal(x))) < 0.8) return;
      const waarden = rijen.map((r) => getal(r[i]));
      kolommen.push({ index: i, naam, soort: soortVanKop(naam), factor: factorVanKop(naam), oplopend: isOplopend(waarden) });
    });
    if (!kolommen.length) return { fout: "Ik vind geen kolommen met getallen naast de tijd." };
    return { vorm: "breed", iTijd, iKlok, kolommen };
  }

  /* ------------------------------------------------------------------
     3. Naar kWh per klokuur
     ------------------------------------------------------------------ */

  // Verdeel een hoeveelheid over de klokuren die de periode [van, tot) raakt,
  // naar rato van de overlap. Elk geraakt uur geldt als gemeten, ook bij nul.
  function verdeel(emmer, van, tot, kwh) {
    if (!(tot > van)) {
      const u = Math.floor(van / UUR);
      emmer.set(u, (emmer.get(u) || 0) + kwh);
      return;
    }
    for (let u = Math.floor(van / UUR); u * UUR < tot; u++) {
      const overlap = Math.min(tot, (u + 1) * UUR) - Math.max(van, u * UUR);
      if (overlap <= 0) continue;
      emmer.set(u, (emmer.get(u) || 0) + kwh * overlap / (tot - van));
    }
  }

  function mediaanStap(tijden) {
    const d = [];
    for (let i = 1; i < tijden.length; i++) if (tijden[i] > tijden[i - 1]) d.push(tijden[i] - tijden[i - 1]);
    if (!d.length) return NaN;
    d.sort((a, b) => a - b);
    return d[Math.floor(d.length / 2)];
  }

  /* Eén reeks (tijd, waarde) naar een emmer met kWh per uur. */
  function reeksNaarUren(punten, oplopend, factor) {
    let p = punten.filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v));
    /* Meterstanden houden we in de volgorde van het bestand. Bij de overgang
       naar wintertijd komt het uur van twee tot drie twee keer voor, met
       dezelfde kloktijden. Sorteren op tijd vlocht die twee rondes door
       elkaar, en dan telde elke stap van de tweede ronde naar de eerste als
       verbruik: in een echte HomeWizard-export van oktober 2026 0,4 kWh te
       veel. Staat het bestand duidelijk door elkaar, dan sorteren we wel. */
    const terug = p.filter((x, i) => i > 0 && x[0] < p[i - 1][0]).length;
    if (!oplopend || terug > p.length * 0.05) p = p.sort((a, b) => a[0] - b[0]);
    const emmer = new Map();
    if (p.length < 2) return { emmer, stap: NaN };
    const stap = mediaanStap(p.map((x) => x[0]));
    if (oplopend) {
      for (let i = 1; i < p.length; i++) {
        const [t0, c0] = p[i - 1], [t1, c1] = p[i];
        const d = (c1 - c0) * factor;
        if (d < 0 || t1 - t0 > MAX_GAT) continue; // reset of gat
        // Loopt de klok terug (wintertijd), dan hoort de stap bij het uur
        // waar hij begon.
        verdeel(emmer, t0, Math.max(t0, t1), d);
      }
    } else {
      // Verbruik per periode: de tijd is het begin, de periode de gewone stap.
      for (const [t, v] of p) verdeel(emmer, t, t + stap, v * factor);
    }
    return { emmer, stap };
  }

  /* Van herkend bestand naar uren: [{ uur, afname, terug }], alleen de uren
     waarin elke gekozen reeks gemeten is. */
  function naarUren(csv, opzet) {
    if (!opzet || opzet.fout) return { fout: opzet ? opzet.fout : "Geen opzet." };
    const gekozen = opzet.kolommen.filter((k) => k.soort === "afname" || k.soort === "teruglevering");
    if (!gekozen.some((k) => k.soort === "afname")) return { fout: "Er is geen kolom met afname gekozen." };

    const reeksen = gekozen.map((k) => {
      let punten;
      if (opzet.vorm === "lang") {
        punten = csv.rijen.filter((r) => r[opzet.iEnt] === k.naam).map((r) => [tijdstip(r[opzet.iTijd]), getal(r[opzet.iStaat])]);
      } else {
        punten = csv.rijen.map((r) => {
          const tekst = opzet.iKlok >= 0 ? `${r[opzet.iTijd]} ${r[opzet.iKlok]}` : r[opzet.iTijd];
          return [tijdstip(tekst), getal(r[k.index])];
        });
      }
      return Object.assign({ kolom: k }, reeksNaarUren(punten, k.oplopend, k.factor));
    });

    const stap = Math.min(...reeksen.map((r) => r.stap).filter(Number.isFinite));
    if (!(stap <= UUR * 1.5)) {
      return { fout: "Dit bestand heeft één waarde per dag of grover. Voor een batterij telt wat er binnen de dag gebeurt, dus ik heb minstens waarden per uur nodig." };
    }

    // Een netto-kolom met negatieve waarden is afname en teruglevering in één.
    const uren = new Map();
    const gemeten = (soort) => reeksen.filter((r) => r.kolom.soort === soort);
    const afnameReeksen = gemeten("afname"), terugReeksen = gemeten("teruglevering");
    const alleUren = new Set();
    afnameReeksen.forEach((r) => r.emmer.forEach((_, u) => alleUren.add(u)));
    for (const u of alleUren) {
      if (!reeksen.every((r) => r.emmer.has(u))) continue;
      let a = 0, t = 0;
      for (const r of afnameReeksen) {
        const v = r.emmer.get(u);
        if (v >= 0) a += v; else t -= v;
      }
      for (const r of terugReeksen) t += Math.abs(r.emmer.get(u));
      uren.set(u, { uur: u * UUR, afname: a, terug: t });
    }
    const lijst = [...uren.values()].sort((x, y) => x.uur - y.uur);
    if (lijst.length < MIN_UREN) {
      return { fout: `Ik kon ${lijst.length} uur aan metingen gebruiken. Voor een uitkomst die iets zegt heb ik er minstens ${MIN_UREN} nodig, een week.` };
    }
    return { uren: lijst, stapMinuten: Math.round(stap / 60000) };
  }

  /* Totalen en dekking, voor de samenvatting op de pagina. */
  function samenvatting(uren) {
    let afname = 0, terug = 0;
    const urenPerMaand = new Map();
    for (const u of uren) {
      afname += u.afname; terug += u.terug;
      const d = new Date(u.uur);
      const m = d.getFullYear() * 12 + d.getMonth();
      urenPerMaand.set(m, (urenPerMaand.get(m) || 0) + 1);
    }
    // Een maand telt mee vanaf een week aan metingen. Een export van 1
    // oktober tot en met 1 november is één maand, geen twee.
    const maanden = new Set([...urenPerMaand].filter(([, n]) => n >= MIN_UREN).map(([m]) => m));
    const dagen = uren.length / 24;
    return {
      van: uren[0].uur, tot: uren[uren.length - 1].uur + UUR,
      uren: uren.length, dagen, afname, terug,
      // Hoeveel van de twaalf kalendermaanden zitten erin? Telt een maand dubbel
      // (twee jaren), dan telt hij hier één keer.
      maandenVanHetJaar: new Set([...maanden].map((m) => m % 12)).size,
      jaarFactor: 365 / dagen,
    };
  }

  /* ------------------------------------------------------------------
     4. De batterij laten meedraaien

     Per uur: eerst laden met wat er anders teruggeleverd werd, dan ontladen
     in wat er anders afgenomen werd. Het rendement telt half bij het laden
     en half bij het ontladen. Het vermogen begrenst beide; de batterij begint
     leeg. De batterij zelf gebruikt ook stroom (standby), die komt bij de
     afname.

     Binnen een uur kan de batterij hier laden en ontladen. Dat is iets te
     gunstig voor een uur met wisselende bewolking; met kwartierdata en
     een simulatie per kwartier zou het scherper kunnen, maar het verschil is
     klein tegenover wat de meting zelf al toevoegt.
     ------------------------------------------------------------------ */
  function simuleer(uren, batterij, opties) {
    const o = Object.assign({ standbyWatt: 10 }, opties);
    const cap = Math.max(0, batterij.bruikbaarKwh || 0);
    const r = Math.min(1, Math.max(0.5, batterij.rendement || 0.9));
    const half = Math.sqrt(r);
    const p = batterij.vermogenKw > 0 ? batterij.vermogenKw : Infinity;
    const standby = o.standbyWatt / 1000;
    let soc = 0, afnameVoor = 0, afnameNa = 0, terugVoor = 0, terugNa = 0, geladen = 0, ontladen = 0, vollePiek = 0;
    let vorigeDag = null, dagMax = 0, dagen = 0;
    // Per kalendermaand, voor de grafiek "wanneer levert hij het meest op".
    const perMaand = new Map();
    for (const u of uren) {
      const laad = Math.min(u.terug, p, (cap - soc) / half);
      soc += laad * half;
      const ontlaad = Math.min(u.afname, p, soc * half);
      soc -= ontlaad / half;
      afnameVoor += u.afname; terugVoor += u.terug;
      afnameNa += u.afname - ontlaad + standby;
      terugNa += u.terug - laad;
      geladen += laad; ontladen += ontlaad;
      const d = new Date(u.uur);
      const sleutel = d.getFullYear() * 12 + d.getMonth();
      const m = perMaand.get(sleutel) || { jaar: d.getFullYear(), maand: d.getMonth(), minderAf: 0, minderTerug: 0, ontladen: 0, uren: 0 };
      m.minderAf += ontlaad - standby;
      m.minderTerug += laad;
      m.ontladen += ontlaad;
      m.uren++;
      perMaand.set(sleutel, m);
      // Op hoeveel dagen raakt hij vol? Zegt of een grotere zin heeft.
      const dag = Math.floor(u.uur / (24 * UUR));
      if (dag !== vorigeDag) { if (vorigeDag !== null && dagMax >= cap * 0.98) vollePiek++; vorigeDag = dag; dagMax = 0; dagen++; }
      dagMax = Math.max(dagMax, soc);
    }
    if (vorigeDag !== null && cap > 0 && dagMax >= cap * 0.98) vollePiek++;
    return {
      afnameVoor, afnameNa, terugVoor, terugNa, geladen, ontladen,
      standbyKwh: standby * uren.length,
      cycli: cap > 0 ? ontladen / cap : 0,
      dagenVol: vollePiek, dagen,
      perMaand: [...perMaand.entries()].sort((a, b) => a[0] - b[0]).map(([, m]) => m),
    };
  }

  /* Wat scheelt dat in euro's over de gemeten periode? Minder afnemen spaart
     de stroomprijs; minder terugleveren kost de vergoeding en scheelt de
     terugleverkosten. */
  function opbrengst(sim, tarief) {
    const minderAf = sim.minderAf !== undefined ? sim.minderAf : sim.afnameVoor - sim.afnameNa;
    const minderTerug = sim.minderTerug !== undefined ? sim.minderTerug : sim.terugVoor - sim.terugNa;
    return minderAf * tarief.stroomprijs - minderTerug * (tarief.terugleverVergoeding - (tarief.terugleverKosten || 0));
  }

  /* Van batterij uit data/batterijen.json naar wat simuleer() nodig heeft.
     Zelfde aannames als de rekenmodule: zonder nagekeken bruikbare capaciteit
     90%, rendement van stopcontact tot stopcontact als de fabrikant dat
     opgeeft (het midden van een bereik), anders 90%. */
  function batterijVoorSimulatie(b) {
    const bruikbaar = b.capaciteit_soort === "bruikbaar" ? 1 : 0.9;
    let rendement = 0.9;
    if (b.rendement_soort === "ac" && typeof b.rendement_pct === "number") {
      rendement = (typeof b.rendement_tot_pct === "number" ? (b.rendement_pct + b.rendement_tot_pct) / 2 : b.rendement_pct) / 100;
    }
    return { bruikbaarKwh: (b.capaciteit_kwh || 0) * bruikbaar, rendement, vermogenKw: b.vermogen_kw || null };
  }

  /* ------------------------------------------------------------------
     Een verzonnen jaar, om de pagina te proberen zonder eigen bestand.
     Tien panelen (ongeveer 3.600 kWh), een huishouden van 2.900 kWh met een
     avondpiek. Vast zaad, dus elke keer hetzelfde jaar.
     ------------------------------------------------------------------ */
  function voorbeeldCsv(jaar) {
    const j = jaar || 2025;
    let zaad = 20261119;
    const toeval = () => { zaad = (zaad * 1664525 + 1013904223) % 4294967296; return zaad / 4294967296; };
    // Verbruiksprofiel per uur van de dag (som 1), met ochtend- en avondpiek.
    const profiel = [2, 1.6, 1.4, 1.3, 1.3, 1.6, 3, 4.5, 4.2, 3.4, 3.2, 3.3, 3.6, 3.3, 3.1, 3.3, 4.2, 6, 7.4, 7.2, 6.4, 5.4, 4.2, 2.8];
    const somP = profiel.reduce((a, b) => a + b, 0);
    const regels = ["tijd;afname_kwh;teruglevering_kwh"];
    const dagenInJaar = (Date.UTC(j + 1, 0, 1) - Date.UTC(j, 0, 1)) / 86400000;
    let dagWeer = 1;
    for (let d = 0; d < dagenInJaar; d++) {
      const dt = new Date(Date.UTC(j, 0, 1 + d));
      const doy = d + 1;
      // Zon: piek eind juni, en per dag een weerfactor die een beetje
      // doorloopt van de dag ervoor (grijze periodes duren meer dan een dag).
      const seizoen = 0.5 - 0.5 * Math.cos(2 * Math.PI * (doy - 10) / 365);
      dagWeer = Math.min(1, Math.max(0.08, 0.55 * dagWeer + 0.45 * toeval() * 1.25));
      const dagOpwek = (3.3 + 25.5 * seizoen) * dagWeer; // kWh bij 10 panelen
      const daglengte = 8 + 8.5 * seizoen;
      const midden = 13.5;
      const dagVerbruik = (2900 / 365) * (1.18 - 0.36 * seizoen) * (0.85 + 0.3 * toeval());
      for (let u = 0; u < 24; u++) {
        const x = (u + 0.5 - (midden - daglengte / 2)) / daglengte;
        const zon = x > 0 && x < 1 ? Math.sin(Math.PI * x) : 0;
        const opwek = dagOpwek * zon * (Math.PI / 2) / daglengte;
        const verbruik = dagVerbruik * profiel[u] / somP * (0.8 + 0.4 * toeval());
        const netto = verbruik - opwek;
        const tijd = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")} ${String(u).padStart(2, "0")}:00`;
        regels.push(`${tijd};${Math.max(0, netto).toFixed(3).replace(".", ",")};${Math.max(0, -netto).toFixed(3).replace(".", ",")}`);
      }
    }
    return regels.join("\n");
  }

  return {
    UUR, MAX_GAT, MIN_UREN,
    leesCsv, getal, tijdstip,
    soortVanKop, factorVanKop, isOplopend, herken,
    naarUren, samenvatting,
    simuleer, opbrengst, batterijVoorSimulatie,
    voorbeeldCsv,
  };
});
