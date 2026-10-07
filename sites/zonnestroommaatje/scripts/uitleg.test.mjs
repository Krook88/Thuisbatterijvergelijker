import { test } from "node:test";
import assert from "node:assert/strict";
import { bouwMetEerlijkeDatum, vulCijfers, vervangBlok, korteAntwoorden, begrippen, uitlegSchema, inhoudsopgave, prijsbeweging, mediaan } from "./uitleg.mjs";

test("cijfers worden ingevuld, een onbekende naam is een fout", () => {
  const html = `<p>Er staan er <span data-cijfer="aantal">41</span>.</p>`;
  assert.equal(vulCijfers(html, { aantal: 52 }), `<p>Er staan er <span data-cijfer="aantal">52</span>.</p>`);
  assert.throws(() => vulCijfers(html, {}), /aantal/);
});

test("een blok wordt vervangen, een ontbrekende markering is een fout", () => {
  const html = "a <!-- blok:x -->oud<!-- /blok:x --> b";
  assert.match(vervangBlok(html, "x", "nieuw"), /<!-- blok:x -->\nnieuw\n {2}<!-- \/blok:x -->/);
  assert.throws(() => vervangBlok(html, "y", ""), /blok:y/);
});

test("korte antwoorden zonder het label", () => {
  const html = `<div class="kort-antwoord" data-vraag="Moet je hem aanmelden?"><p class="kort-label">Kort antwoord</p><p>Ja, op energieleveren.nl.</p></div>`;
  assert.deepEqual(korteAntwoorden(html), [{ vraag: "Moet je hem aanmelden?", antwoord: "Ja, op energieleveren.nl." }]);
});

test("begrippen in alle drie de vormen", () => {
  const html = `<div class="woord" id="kwh"><dt>kWh</dt><dd>De hoeveelheid.</dd></div>
    <dt id="scop"><b>SCOP</b></dt><dd>Seizoensrendement.</dd>
    <div class="woord" id="wp"><b>Wattpiek (Wp)</b>. Het maximale vermogen.</div>`;
  assert.deepEqual(begrippen(html).map((b) => [b.id, b.naam, b.uitleg]), [
    ["kwh", "kWh", "De hoeveelheid."],
    ["wp", "Wattpiek (Wp)", "Het maximale vermogen."],
    ["scop", "SCOP", "Seizoensrendement."],
  ]);
});

test("het schema bevat FAQ en woordenlijst als ze er zijn", () => {
  const html = `<div class="kort-antwoord" data-vraag="V?"><p>A.</p></div><div class="woord" id="k"><dt>K</dt><dd>U.</dd></div>`;
  const ld = uitlegSchema(html, { url: "https://x.nl/uitleg.html", titel: "T", beschrijving: "B", iso: "2026-10-07", uitgever: { naam: "X", url: "https://x.nl" } });
  assert.deepEqual(ld["@graph"].map((g) => g["@type"]), ["Article", "FAQPage", "DefinedTermSet"]);
});

test("inhoudsopgave eist een id op elke kop", () => {
  assert.match(inhoudsopgave(`<h2 id="a">Een</h2><h2 id="b">Twee</h2>`, { zonder: ["b"] }), /href="#a">Een<\/a>/);
  assert.throws(() => inhoudsopgave(`<h2>Zonder</h2>`), /Zonder/);
});

test("prijsbeweging telt per winkel, en een correctie is geen prijsdaling", () => {
  const verloop = { bijgewerkt: "2026-10-07", winkels: {
    a: { X: [["2026-08-11", 1000], ["2026-09-20", 900]] },
    b: { Y: [["2026-08-11", 500], ["2026-10-01", 550]] },
    c: { Z: [["2026-08-11", 300], ["2026-10-01", null]] },
    // De aanbieding kreeg een andere naam en een ander bedrag: twee winkels, geen van beide aan twee kanten.
    d: { "oud": [["2026-08-11", 6200], ["2026-10-02", null]], "nieuw": [["2026-10-02", 2990]] },
  } };
  const p = prijsbeweging(verloop, { dagen: 30 });
  assert.equal(p.gemeten, 2);
  assert.equal(p.goedkoper, 1);
  assert.equal(p.duurder, 1);
  assert.equal(p.grootste.id, "a");
});

test("mediaan", () => {
  assert.equal(mediaan([3, 1, 2]), 2);
  assert.equal(mediaan([4, 1, 3, 2]), 3);
  assert.equal(mediaan([]), null);
});

test("de datum verspringt alleen als de pagina echt verandert", () => {
  const maak = (getal) => (iso) => `<time data-bijgewerkt datetime="${iso}">x</time><p>${getal}</p>`;
  const oud = maak(52)("2026-10-01");
  assert.equal(bouwMetEerlijkeDatum(oud, "2026-10-07", maak(52)).iso, "2026-10-01");
  assert.equal(bouwMetEerlijkeDatum(oud, "2026-10-07", maak(53)).iso, "2026-10-07");
});
