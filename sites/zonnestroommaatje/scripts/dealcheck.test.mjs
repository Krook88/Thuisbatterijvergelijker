import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const G = createRequire(import.meta.url)("../assets/prijsgrafiek.js");
const check = (reeks, bijgewerkt) => {
  G.laad({ bijgewerkt, producten: { x: reeks } });
  return G.dealcheck("x");
};

test("een prijs onder de laagste van de 30 dagen ervoor is een echte daling", () => {
  const d = check([["2026-08-01", 950], ["2026-08-20", 1100], ["2026-10-20", 1000]], "2026-10-25");
  assert.equal(d.soort, "daling");
  assert.equal(d.ref, 1100);
  assert.equal(d.procent, 9.1);
  assert.equal(d.sinds, "2026-10-20");
});

test("de laagste prijs sinds we meten heet zo", () => {
  const d = check([["2026-08-01", 1100], ["2026-10-20", 1000]], "2026-10-25");
  assert.equal(d.soort, "laagste");
});

test("eerst omhoog en dan terug is een schijnkorting", () => {
  // Wat de dyness-powerbox-g2 deed: 1.809, een paar dagen 1.997, dan "afgeprijsd" naar 1.809.
  const d = check([["2026-09-01", 1809], ["2026-10-19", 1997], ["2026-10-24", 1809]], "2026-10-25");
  assert.equal(d.soort, "schijnkorting");
  assert.equal(d.vorige, 1997);
  assert.equal(d.ref, 1809);
});

test("een nieuwe, goedkopere winkel is geen schijnkorting", () => {
  // De HYXi Halo op 12 november 2026: Voltbaas kwam erbij voor 739, onder de
  // 749 van de dag ervoor. In de 30 dagen daarvoor stond hij elders op 619.
  G.laad({
    bijgewerkt: "2026-11-12",
    producten: { x: [["2026-10-07", 749], ["2026-10-20", 619], ["2026-10-22", 749], ["2026-11-12", 739]] },
    winkels: { x: { A: [["2026-10-07", 749], ["2026-10-20", 619], ["2026-10-22", 749]], B: [["2026-11-12", 739]] } },
  });
  const d = G.dealcheck("x");
  assert.equal(d.soort, "boven");
  assert.equal(d.ref, 619);
});

test("schijnkorting per winkel: dezelfde winkel eerst omhoog en dan terug", () => {
  G.laad({
    bijgewerkt: "2026-10-25",
    producten: { x: [["2026-09-01", 1809], ["2026-10-19", 1997], ["2026-10-24", 1809]] },
    winkels: { x: { A: [["2026-09-01", 1809], ["2026-10-19", 1997], ["2026-10-24", 1809]], B: [["2026-09-01", 2100]] } },
  });
  const d = G.dealcheck("x");
  assert.equal(d.soort, "schijnkorting");
  assert.equal(d.winkel, "A");
  assert.equal(d.vorige, 1997);
  assert.match(G.dealHtml("x"), /A vraagt minder dan op 23 oktober 2026/);
});

test("een winkel die echt zakt is geen schijnkorting, ook als een ander eerder goedkoper was", () => {
  // A vroeg 1.900 en ging op 20 oktober naar 2.000. B zakte op 24 oktober
  // van 2.100 naar 1.950. De laagste prijs gaat van 2.000 naar 1.950, terwijl
  // hij in de 30 dagen ervoor 1.900 was: de oude toets noemde dat schijnkorting.
  G.laad({
    bijgewerkt: "2026-10-25",
    producten: { x: [["2026-09-01", 1900], ["2026-10-20", 2000], ["2026-10-24", 1950]] },
    winkels: { x: { A: [["2026-09-01", 1900], ["2026-10-20", 2000]], B: [["2026-09-01", 2100], ["2026-10-24", 1950]] } },
  });
  const d = G.dealcheck("x");
  assert.equal(d.soort, "boven");
  assert.equal(d.ref, 1900);
});

test("een daling onder de drempel is ruis en geen deal", () => {
  const d = check([["2026-08-01", 1000], ["2026-10-20", 990]], "2026-10-25");
  assert.equal(d.soort, "normaal");
});

test("duurder dan de laagste van de 30 dagen ervoor", () => {
  const d = check([["2026-08-01", 1000], ["2026-10-20", 1100]], "2026-10-25");
  assert.equal(d.soort, "boven");
  assert.equal(d.procent, -10);
});

test("een prijs die nooit veranderde is gewoon de prijs", () => {
  assert.equal(check([["2026-08-01", 1000]], "2026-10-25").soort, "normaal");
});

test("te weinig metingen vóór de verlaging zegt niets", () => {
  const d = check([["2026-10-15", 1100], ["2026-10-20", 900]], "2026-10-25");
  assert.equal(d.soort, "te-kort");
});

test("gaten tellen niet als meting en niet als prijs", () => {
  const d = check([["2026-08-01", 1000], ["2026-10-01", null], ["2026-10-24", 999]], "2026-10-25");
  // Na 23 dagen zonder winkel gelden er nog 7 metingen in het venster: te weinig.
  assert.equal(d.soort, "te-kort");
  assert.equal(check([["2026-08-01", 1000], ["2026-10-24", null]], "2026-10-25").soort, "niet-te-koop");
});

test("dealHtml geeft een zin met kop en link naar de uitleg", () => {
  G.laad({ bijgewerkt: "2026-10-25", producten: { x: [["2026-08-01", 1200], ["2026-10-20", 1000]] } });
  const html = G.dealHtml("x", { uitlegUrl: "/black-friday.html" });
  assert.match(html, /pg-deal-laagste/);
  assert.match(html, /href="\/black-friday.html"/);
  assert.equal(G.dealHtml("onbekend"), "");
});
