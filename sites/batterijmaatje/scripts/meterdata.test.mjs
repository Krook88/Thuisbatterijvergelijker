/**
 * Tests voor assets/meterdata.js: een meterexport inlezen en een batterij uur
 * voor uur laten meedraaien.
 *
 * De bestanden hieronder zijn nagebouwd naar de vormen die in omloop zijn:
 * meterstanden per kwartier met aparte kolommen voor twee tarieven, verbruik
 * per uur met puntkomma en decimale komma, datum en tijd in twee kolommen, een
 * netto-kolom met negatieve teruglevering, en de lange vorm van een Home
 * Assistant-export. Draaien: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const M = createRequire(import.meta.url)("../assets/meterdata.js");
const bijna = (a, b, marge = 1e-6) => assert.ok(Math.abs(a - b) <= marge, `${a} is geen ${b}`);
const pad = (n) => String(n).padStart(2, "0");
const lokaal = (d, u, mi = 0) => `2026-03-${pad(d)} ${pad(u)}:${pad(mi)}`;

test("getallen met komma, punt, duizendtallen en eenheid", () => {
  assert.equal(M.getal("0,25"), 0.25);
  assert.equal(M.getal("1.234,5"), 1234.5);
  assert.equal(M.getal("1,234.5"), 1234.5);
  assert.equal(M.getal("-0,3"), -0.3);
  assert.equal(M.getal("2.5 kWh"), 2.5);
  assert.ok(Number.isNaN(M.getal("unavailable")));
});

test("tijdstippen in de gangbare vormen", () => {
  const t = new Date(2026, 2, 1, 14, 15).getTime();
  assert.equal(M.tijdstip("2026-03-01 14:15"), t);
  assert.equal(M.tijdstip("2026-03-01T14:15:00"), t);
  assert.equal(M.tijdstip("01-03-2026 14:15"), t);
  assert.equal(M.tijdstip("1/3/2026 14:15:00"), t);
  assert.equal(M.tijdstip("2026-03-01T13:15:00Z"), Date.UTC(2026, 2, 1, 13, 15));
  assert.equal(M.tijdstip("2026-03-01T14:15:00+01:00"), Date.UTC(2026, 2, 1, 13, 15));
  assert.equal(M.tijdstip("2026-03-01 14:15 - 2026-03-01 14:30"), t);
  assert.ok(Number.isNaN(M.tijdstip("0,25")));
});

test("kolomnamen: teruglevering gaat voor levering, vermogen en gas vallen af", () => {
  assert.equal(M.soortVanKop("Teruglevering (kWh)"), "teruglevering");
  assert.equal(M.soortVanKop("Levering (kWh)"), "afname");
  assert.equal(M.soortVanKop("Import T1 kWh"), "afname");
  assert.equal(M.soortVanKop("Export T2 kWh"), "teruglevering");
  assert.equal(M.soortVanKop("sensor.p1_meter_energy_import_tariff_1"), "afname");
  assert.equal(M.soortVanKop("sensor.p1_meter_active_power"), "negeren");
  assert.equal(M.soortVanKop("Gas (m3)"), "negeren");
  assert.equal(M.factorVanKop("Afname (Wh)"), 0.001);
  assert.equal(M.factorVanKop("Afname (kWh)"), 1);
});

/* Acht dagen, elke dag hetzelfde: 2 kWh teruglevering tussen 12 en 13 uur,
   1 kWh afname tussen 19 en 20 en tussen 20 en 21 uur. */
function dagpatroon(u) {
  return { af: u === 19 || u === 20 ? 1 : 0, terug: u === 12 ? 2 : 0 };
}

test("meterstanden per kwartier, met twee tarieven, worden kWh per uur", () => {
  const regels = ["time,Import T1 kWh,Import T2 kWh,Export T1 kWh,Export T2 kWh"];
  let i1 = 1000, i2 = 2000, e1 = 500, e2 = 600;
  for (let d = 1; d <= 9; d++) for (let u = 0; u < 24; u++) for (let k = 0; k < 4; k++) {
    regels.push(`${lokaal(d, u, k * 15)},${i1.toFixed(3)},${i2.toFixed(3)},${e1.toFixed(3)},${e2.toFixed(3)}`);
    const { af, terug } = dagpatroon(u);
    // Afname op tarief 1, teruglevering verdeeld over beide tarieven.
    i1 += af / 4; e1 += terug / 8; e2 += terug / 8;
  }
  const csv = M.leesCsv(regels.join("\n"));
  const opzet = M.herken(csv);
  assert.equal(opzet.vorm, "breed");
  assert.deepEqual(opzet.kolommen.map((k) => [k.soort, k.oplopend]), [["afname", true], ["afname", true], ["teruglevering", true], ["teruglevering", true]]);
  const { uren, stapMinuten } = M.naarUren(csv, opzet);
  assert.equal(stapMinuten, 15);
  const s = M.samenvatting(uren);
  bijna(s.afname / s.dagen, 2, 0.01);
  bijna(s.terug / s.dagen, 2, 0.01);
  const twaalf = uren.find((x) => new Date(x.uur).getHours() === 12);
  bijna(twaalf.terug, 2);
});

test("verbruik per uur met puntkomma, decimale komma en aparte datum- en tijdkolom", () => {
  const regels = ["Datum;Tijd;Afname (kWh);Teruglevering (kWh)"];
  for (let d = 1; d <= 8; d++) for (let u = 0; u < 24; u++) {
    const { af, terug } = dagpatroon(u);
    regels.push(`${pad(d)}-03-2026;${pad(u)}:00;${String(af).replace(".", ",")};${String(terug).replace(".", ",")}`);
  }
  const csv = M.leesCsv(regels.join("\r\n"));
  assert.equal(csv.sep, ";");
  const opzet = M.herken(csv);
  assert.equal(opzet.iTijd, 0);
  assert.equal(opzet.iKlok, 1);
  assert.deepEqual(opzet.kolommen.map((k) => [k.soort, k.oplopend]), [["afname", false], ["teruglevering", false]]);
  const { uren } = M.naarUren(csv, opzet);
  assert.equal(uren.length, 8 * 24);
  const s = M.samenvatting(uren);
  bijna(s.afname, 16); bijna(s.terug, 16);
});

test("een netto-kolom met negatieve waarden wordt afname en teruglevering", () => {
  const regels = ["timestamp,netto kWh"];
  for (let d = 1; d <= 8; d++) for (let u = 0; u < 24; u++) {
    const { af, terug } = dagpatroon(u);
    regels.push(`${lokaal(d, u)},${af - terug}`);
  }
  const csv = M.leesCsv(regels.join("\n"));
  const { uren } = M.naarUren(csv, M.herken(csv));
  const s = M.samenvatting(uren);
  bijna(s.afname, 16); bijna(s.terug, 16);
});

test("de lange vorm van Home Assistant, met onregelmatige tijden en een vermogenssensor erbij", () => {
  const regels = ["entity_id,state,last_changed"];
  let imp = 3000, exp = 1500;
  for (let d = 1; d <= 9; d++) for (let u = 0; u < 24; u++) {
    const { af, terug } = dagpatroon(u);
    // Elke 20 minuten een nieuwe stand, met wat ruis in de tijd.
    for (const mi of [0, 20, 40]) {
      const t = new Date(2026, 2, d, u, mi, 7).toISOString();
      regels.push(`sensor.p1_meter_energy_import,${imp.toFixed(3)},${t}`);
      regels.push(`sensor.p1_meter_energy_export,${exp.toFixed(3)},${t}`);
      regels.push(`sensor.p1_meter_active_power,${Math.round(Math.random() * 3000)},${t}`);
      imp += af / 3; exp += terug / 3;
    }
  }
  regels.push(`sensor.p1_meter_energy_import,unavailable,${new Date(2026, 2, 10).toISOString()}`);
  const csv = M.leesCsv(regels.join("\n"));
  const opzet = M.herken(csv);
  assert.equal(opzet.vorm, "lang");
  assert.deepEqual(opzet.kolommen.map((k) => k.soort), ["afname", "teruglevering", "negeren"]);
  const { uren } = M.naarUren(csv, opzet);
  const s = M.samenvatting(uren);
  bijna(s.afname / s.dagen, 2, 0.05);
  bijna(s.terug / s.dagen, 2, 0.05);
});

test("dagwaarden en te korte bestanden worden met een uitleg geweigerd", () => {
  const dag = ["datum;afname;teruglevering"];
  for (let d = 1; d <= 28; d++) dag.push(`2026-02-${pad(d)};8,1;5,2`);
  const csvDag = M.leesCsv(dag.join("\n"));
  assert.match(M.naarUren(csvDag, M.herken(csvDag)).fout, /per dag/);

  const kort = ["tijd;afname;teruglevering"];
  for (let u = 0; u < 48; u++) kort.push(`${lokaal(1 + Math.floor(u / 24), u % 24)};0,3;0`);
  const csvKort = M.leesCsv(kort.join("\n"));
  assert.match(M.naarUren(csvKort, M.herken(csvKort)).fout, /minstens 168/);
});

test("simulatie: laden met overschot, ontladen bij afname, begrensd door rendement en vermogen", () => {
  const uren = [];
  for (let u = 0; u < 24; u++) {
    const { af, terug } = dagpatroon(u);
    uren.push({ uur: Date.UTC(2026, 2, 1, u), afname: af, terug });
  }
  // Rendement 81%: 0,9 bij laden en 0,9 bij ontladen.
  const sim = M.simuleer(uren, { bruikbaarKwh: 5, rendement: 0.81, vermogenKw: 2.5 }, { standbyWatt: 0 });
  bijna(sim.geladen, 2);            // al het overschot gaat erin
  bijna(sim.ontladen, 1.62);        // 2 x 0,9 x 0,9 komt er weer uit
  bijna(sim.afnameNa, 2 - 1.62);
  bijna(sim.terugNa, 0);
  // Met 0,5 kW gaat er per uur niet meer dan 0,5 kWh in of uit.
  const zwak = M.simuleer(uren, { bruikbaarKwh: 5, rendement: 0.81, vermogenKw: 0.5 }, { standbyWatt: 0 });
  bijna(zwak.geladen, 0.5);
  // Te klein: 1 kWh bruikbaar loopt vol.
  const klein = M.simuleer(uren, { bruikbaarKwh: 1, rendement: 0.81, vermogenKw: 2.5 }, { standbyWatt: 0 });
  bijna(klein.geladen, 1 / 0.9);
  assert.equal(klein.dagenVol, 1);
  // Standby komt bij de afname.
  const metStandby = M.simuleer(uren, { bruikbaarKwh: 5, rendement: 0.81, vermogenKw: 2.5 }, { standbyWatt: 10 });
  bijna(metStandby.afnameNa - sim.afnameNa, 0.24);
});

test("opbrengst: minder afname spaart de stroomprijs, minder teruglevering kost de vergoeding", () => {
  const sim = { afnameVoor: 1000, afnameNa: 600, terugVoor: 900, terugNa: 450 };
  bijna(M.opbrengst(sim, { stroomprijs: 0.30, terugleverVergoeding: 0.01, terugleverKosten: 0 }), 400 * 0.30 - 450 * 0.01);
  bijna(M.opbrengst(sim, { stroomprijs: 0.30, terugleverVergoeding: 0.05, terugleverKosten: 0.12 }), 400 * 0.30 + 450 * 0.07);
});

test("batterijgegevens: bruikbaar deel en rendement zoals in de rekenmodule", () => {
  assert.deepEqual(M.batterijVoorSimulatie({ capaciteit_kwh: 10, capaciteit_soort: "nominaal", vermogen_kw: 5 }),
    { bruikbaarKwh: 9, rendement: 0.9, vermogenKw: 5 });
  const ac = M.batterijVoorSimulatie({ capaciteit_kwh: 5, capaciteit_soort: "bruikbaar", rendement_soort: "ac", rendement_pct: 70, rendement_tot_pct: 85 });
  bijna(ac.rendement, 0.775);
  assert.equal(ac.bruikbaarKwh, 5);
});

test("het voorbeeldjaar loopt door de hele keten en levert een redelijk huishouden op", () => {
  const csv = M.leesCsv(M.voorbeeldCsv(2025));
  const { uren } = M.naarUren(csv, M.herken(csv));
  // 8.760 uur, of 8.759 in een tijdzone met zomertijd: in maart bestaat
  // 02:00 niet, dat uur valt samen met 03:00.
  assert.ok(uren.length === 8760 || uren.length === 8759, `${uren.length} uur`);
  const s = M.samenvatting(uren);
  assert.equal(s.maandenVanHetJaar, 12);
  // Zonder batterij: afname rond de 1.900 kWh en teruglevering rond de 2.500.
  assert.ok(s.afname > 1300 && s.afname < 2600, `afname ${s.afname}`);
  assert.ok(s.terug > 1800 && s.terug < 3400, `teruglevering ${s.terug}`);
  const sim = M.simuleer(uren, { bruikbaarKwh: 5, rendement: 0.9, vermogenKw: 2.5 });
  assert.ok(sim.ontladen > 500 && sim.ontladen < 1300, `ontladen ${sim.ontladen}`);
});

test("wintertijd: het dubbele uur telt één keer, en een losse dag is geen maand", () => {
  // Meterstanden per kwartier van 20 oktober tot en met 1 november 2026, zoals
  // HomeWizard ze schrijft: lokale tijd zonder zone, dus op 25 oktober komt
  // 02:00-02:45 twee keer voor. Verbruik: 0,1 kWh per kwartier, altijd.
  const regels = ["time,Import T1 kWh,Import T2 kWh,Export T1 kWh,Export T2 kWh,L1 max W,L2 max W,L3 max W"];
  let stand = 15000, kwartieren = 0;
  for (let d = 20; d <= 32; d++) {
    const dag = d <= 31 ? `2026-10-${pad(d)}` : "2026-11-01";
    for (let u = 0; u < 24; u++) {
      const rondes = d === 25 && u === 2 ? 2 : 1;
      for (let r = 0; r < rondes; r++) for (let k = 0; k < 4; k++) {
        regels.push(`${dag} ${pad(u)}:${pad(k * 15)},${stand.toFixed(3)},19000.000,3600.000,8200.000,${200 + k},,`);
        stand += 0.1; kwartieren++;
      }
    }
  }
  const csv = M.leesCsv(regels.join("\n"));
  const opzet = M.herken(csv);
  assert.equal(opzet.kolommen.find((k) => k.naam === "L1 max W").soort, "negeren");
  const { uren } = M.naarUren(csv, opzet);
  const s = M.samenvatting(uren);
  // Elk kwartier na het eerste is 0,1 kWh; niets dubbel, niets kwijt.
  bijna(s.afname, (kwartieren - 1) * 0.1, 1e-6);
  assert.equal(s.maandenVanHetJaar, 1);
});
