/**
 * Tests voor het prijsalarm: wie krijgt wanneer een mail (api/_prijsalarm.js),
 * en de route aanmelden, bevestigen, afmelden en de dagelijkse ronde
 * (api/prijsalarm.js, api/prijsalarm-check.js), met de opslag en de mail
 * nagebootst. Draaien: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const WORTEL = join(dirname(fileURLToPath(import.meta.url)), "..");
const PA = require("../api/_prijsalarm.js");

const VANDAAG = "2026-11-19";
const batterij = (id, prijs, extra = {}) => Object.assign({
  id, merk: "Merk", model: id, capaciteit_kwh: 5, richtprijs_eur: prijs + 100, prijs_datum: VANDAAG,
  aanbiedingen: [{ winkel: "Winkel", prijs_eur: prijs, datum: VANDAAG, url: "https://winkel.example/x" }],
}, extra);

test("aanmelden: adres, batterij en bedrag worden nagekeken", () => {
  const lijst = [batterij("a", 1000)];
  assert.equal(PA.nakijken({ email: "geen-adres", batterij: "a" }, lijst, VANDAAG).veld, "email");
  assert.match(PA.nakijken({ email: "x@y.nl", batterij: "onbekend" }, lijst, VANDAAG).fout, /ken ik niet/);
  assert.equal(PA.nakijken({ email: "x@y.nl", batterij: "a", drempel: "12" }, lijst, VANDAAG).veld, "drempel");
  // Zonder bedrag: elke daling onder de prijs van vandaag.
  assert.equal(PA.nakijken({ email: " X@Y.nl ", batterij: "a", drempel: "" }, lijst, VANDAAG).drempel, 999);
  assert.equal(PA.nakijken({ email: "x@y.nl", batterij: "a", drempel: "€ 1.250" }, lijst, VANDAAG).drempel, 1250);
  assert.equal(PA.nakijken({ email: " X@Y.nl ", batterij: "a" }, lijst, VANDAAG).email, "x@y.nl");
});

test("geen alarm op een richtprijs of een batterij die nergens leverbaar is", () => {
  const alleenRicht = batterij("r", 900, { aanbiedingen: [] });
  const weg = batterij("w", 900, { aanbiedingen: [{ winkel: "W", prijs_eur: 900, datum: VANDAAG, niet_leverbaar: true }] });
  assert.equal(PA.alarmPrijs(alleenRicht, VANDAAG), null);
  assert.equal(PA.alarmPrijs(weg, VANDAAG), null);
  assert.match(PA.nakijken({ email: "x@y.nl", batterij: "r" }, [alleenRicht], VANDAAG).fout, /Vul een bedrag in/);
});

test("de ronde: een mail bij de drempel, daarna alleen nog bij een verdere daling", () => {
  const lijst = [batterij("a", 900)];
  const alarm = { status: "actief", batterij: "a", drempel: "950", email: "x@y.nl" };
  assert.equal(PA.teMelden([alarm], lijst, VANDAAG).length, 1);
  assert.equal(PA.teMelden([{ ...alarm, laatstGemeld: "900" }], lijst, VANDAAG).length, 0, "zelfde prijs: geen tweede mail");
  assert.equal(PA.teMelden([{ ...alarm, laatstGemeld: "920" }], lijst, VANDAAG).length, 1, "verder gezakt: wel");
  assert.equal(PA.teMelden([{ ...alarm, drempel: "850" }], lijst, VANDAAG).length, 0, "boven de drempel: niet");
  assert.equal(PA.teMelden([{ ...alarm, status: "wacht" }], lijst, VANDAAG).length, 0, "onbevestigd: niet");
});

/* De handlers, met een opslag in het geheugen en een postbode die alleen
   onthoudt wat hij zou versturen. */
function nagebootst() {
  const db = new Map();
  const mails = [];
  const voer = ([cmd, sleutel, ...rest]) => {
    const h = db.get(sleutel);
    switch (cmd) {
      case "HSET": { const o = h || {}; for (let i = 0; i < rest.length; i += 2) o[rest[i]] = rest[i + 1]; db.set(sleutel, o); return 1; }
      case "HGETALL": return h ? Object.entries(h).flat() : [];
      case "EXPIRE": case "PERSIST": return 1;
      case "SADD": { const s = h || new Set(); rest.forEach((x) => s.add(x)); db.set(sleutel, s); return 1; }
      case "SREM": { if (h) rest.forEach((x) => h.delete(x)); return 1; }
      case "SMEMBERS": return h ? [...h] : [];
      case "EXISTS": return db.has(sleutel) ? 1 : 0;
      case "DEL": db.delete(sleutel); return 1;
      default: throw new Error(`onbekend: ${cmd}`);
    }
  };
  const opslag = require.resolve("../api/_opslag.js");
  const mail = require.resolve("../api/_mail.js");
  const echteMail = require("../api/_mail.js");
  require.cache[opslag] = { id: opslag, filename: opslag, loaded: true, exports: { instellingen: () => ({}), opdrachten: async (l) => l.map(voer) } };
  require.cache[mail] = { id: mail, filename: mail, loaded: true, exports: { ...echteMail, ingesteld: () => true, postbode: () => null, verstuur: async (m) => { mails.push(m); } } };
  for (const f of ["../api/prijsalarm.js", "../api/prijsalarm-check.js"]) delete require.cache[require.resolve(f)];
  return { db, mails, aanvraag: require("../api/prijsalarm.js"), ronde: require("../api/prijsalarm-check.js") };
}

function antwoord() {
  const r = { statusCode: 200, kop: {}, lijf: null };
  r.setHeader = (k, v) => { r.kop[k] = v; };
  r.status = (s) => { r.statusCode = s; return r; };
  r.json = (j) => { r.lijf = j; return r; };
  r.end = () => r;
  return r;
}

test("aanmelden, bevestigen via de link, de ronde en afmelden", async () => {
  const cwd = process.cwd();
  process.chdir(WORTEL);
  try {
    const { db, mails, aanvraag, ronde } = nagebootst();
    const { batterijen } = require("../data/site/batterijen.json");
    const b = batterijen.find((x) => PA.alarmPrijs(x) !== null);
    const prijs = PA.alarmPrijs(b);

    let r = antwoord();
    await aanvraag({ method: "POST", headers: { host: "batterijmaatje.nl" }, body: { actie: "aanmelden", batterij: b.id, email: "Test@Voorbeeld.nl", drempel: String(prijs + 10) } }, r);
    assert.equal(r.statusCode, 200, JSON.stringify(r.lijf));
    assert.equal(mails.length, 1);
    assert.match(mails[0].onderwerp, /Bevestig/);
    const token = mails[0].tekst.match(/bevestig=([a-f0-9]{32})/)[1];
    assert.equal(db.get(`pa:${token}`).status, "wacht");

    // De link uit de mail stuurt door naar de batterijpagina, zonder iets te doen.
    r = antwoord();
    await aanvraag({ method: "GET", headers: {}, query: { bevestig: token } }, r);
    assert.equal(r.statusCode, 302);
    assert.equal(r.kop.Location, `/batterij/${b.id}.html?prijsalarm=bevestig&t=${token}#prijsalarm`);
    assert.equal(db.get(`pa:${token}`).status, "wacht");

    r = antwoord();
    await aanvraag({ method: "POST", headers: {}, body: { actie: "bevestig", token } }, r);
    assert.equal(db.get(`pa:${token}`).status, "actief");

    // De ronde: prijs ligt onder de drempel, dus één mail; een tweede ronde niet.
    r = antwoord();
    await ronde({ headers: {} }, r);
    assert.deepEqual(r.lijf, { alarmen: 1, gemeld: 1 });
    assert.match(mails[1].onderwerp, /Prijsalarm/);
    assert.match(mails[1].tekst, new RegExp(`afmelden=${token}`));
    r = antwoord();
    await ronde({ headers: {} }, r);
    assert.deepEqual(r.lijf, { alarmen: 1, gemeld: 0 });

    r = antwoord();
    await aanvraag({ method: "POST", headers: {}, body: { actie: "afmelden", token } }, r);
    assert.equal(db.has(`pa:${token}`), false);
    assert.equal(db.get("pa:actief").size, 0);

    // De honingpot krijgt een gewoon antwoord, maar er gebeurt niets.
    r = antwoord();
    await aanvraag({ method: "POST", headers: {}, body: { actie: "aanmelden", batterij: b.id, email: "bot@x.nl", website: "spam" } }, r);
    assert.equal(r.statusCode, 200);
    assert.equal(mails.length, 2);
  } finally {
    process.chdir(cwd);
  }
});
