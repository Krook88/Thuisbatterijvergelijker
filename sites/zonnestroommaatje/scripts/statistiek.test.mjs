import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { metStatistiek, zonderStatistiek, htmlBestanden, NIET_TELLEN, STATISTIEK_TAG, UITZET_TAG, UITZET_PATROON, TELLER_PATROON } from "./statistiek.mjs";

test("de tag komt één keer vlak voor </head>", () => {
  const uit = metStatistiek("<html><head><title>x</title></head><body></body></html>");
  assert.match(uit, /<script defer src="\/_vercel\/insights\/script\.js"><\/script>\n<\/head>/);
  assert.equal(metStatistiek(uit), uit);
  assert.equal(metStatistiek("<p>geen kop</p>"), "<p>geen kop</p>");
});

test("de eigen teller komt erbij met het stempel van de site, één keer", () => {
  const uit = metStatistiek("<html><head></head></html>", "20261015a");
  assert.match(uit, /<script defer src="\/assets\/teller\.js\?v=20261015a"><\/script>/);
  assert.equal(metStatistiek(uit, "20261015b"), uit, "een ander stempel zet 'npm run stempel' recht");
});

test("elke pagina van deze site telt mee in de statistieken", () => {
  // Deze proef draait in kern/ en in elke site. In kern/ is er geen site om na
  // te kijken; in een site moet elke pagina de tag hebben, ook de korte pagina
  // van een product zonder actuele prijs.
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  if (!/sites[\\/][^\\/]+$/.test(root)) return;
  const fout = htmlBestanden(root).filter((p) => {
    const html = readFileSync(p, "utf8");
    const heeft = html.includes(UITZET_TAG + "\n  " + STATISTIEK_TAG) && TELLER_PATROON.test(html);
    const geen = !html.includes(STATISTIEK_TAG) && !html.includes(UITZET_TAG) && !TELLER_PATROON.test(html);
    return NIET_TELLEN.has(relative(root, p).replaceAll("\\", "/")) ? !geen : !heeft;
  });
  assert.deepEqual(fout.map((p) => relative(root, p)), [], "draai npm run genereer");
});

test("zonderStatistiek haalt beide tags weg en laat de rest staan", () => {
  const met = metStatistiek("<html><head>\n  <title>x</title>\n</head></html>", "20261015a");
  assert.equal(zonderStatistiek(met), "<html><head>\n  <title>x</title>\n</head></html>");
});

test("de uitzetter staat vóór het script van Vercel, ook op een oude pagina", () => {
  const oud = `<html><head>\n  ${STATISTIEK_TAG}\n</head></html>`;
  assert.ok(metStatistiek(oud).includes(`${UITZET_TAG}\n  ${STATISTIEK_TAG}`));
  assert.ok(metStatistiek("<html><head></head></html>").includes(`${UITZET_TAG}\n  ${STATISTIEK_TAG}`));
});

function draaiUitzetter(hash, opener) {
  const opslag = new Map();
  const luisteraars = [];
  const omgeving = {
    location: { hash, hostname: "www.warmtepompmaatje.nl" },
    localStorage: {
      getItem: (k) => (opslag.has(k) ? opslag.get(k) : null),
      setItem: (k, v) => opslag.set(k, String(v)),
      removeItem: (k) => opslag.delete(k),
    },
    document: { readyState: "loading", addEventListener() {}, querySelectorAll: () => [] },
    addEventListener: (naam, f) => luisteraars.push(f),
    opener,
    gesloten: false,
    close() { omgeving.gesloten = true; },
  };
  omgeving.window = omgeving;
  runInNewContext(UITZET_TAG.replace(/^<script>|<\/script>$/g, ""), omgeving);
  return { omgeving, opslag, luisteraars, filter: omgeving.vaq[0][1] };
}

test("#niet-tellen zet de sleutel, beforeSend laat dan alles vallen; #wel-tellen zet hem terug", () => {
  const { omgeving, opslag, luisteraars, filter } = draaiUitzetter("#niet-tellen");
  assert.equal(omgeving.vaq[0][0], "beforeSend");
  assert.equal(opslag.get("va-disable"), "1");
  assert.equal(filter({ url: "x" }), null);
  omgeving.location.hash = "";
  assert.equal(filter({ url: "x" }), null, "blijft uit na het weghalen van de hash");
  omgeving.location.hash = "#wel-tellen";
  luisteraars.forEach((f) => f());
  assert.equal(opslag.has("va-disable"), false);
  omgeving.location.hash = "";
  assert.deepEqual(filter({ url: "x" }), { url: "x" });
  assert.equal(omgeving.gesloten, false, "zonder opener sluit er niets");
});

test("in een venster van de schakelaar: stand terugmelden aan batterijmaatje.nl, sluiten, zelf niet tellen", () => {
  const berichten = [];
  const opener = { postMessage: (data, doel) => berichten.push([data, doel]) };
  const { omgeving, filter } = draaiUitzetter("#teller-stand", opener);
  assert.equal(JSON.stringify(berichten), JSON.stringify([[{ teller: "aan", site: "warmtepompmaatje.nl" }, "https://batterijmaatje.nl"]]));
  assert.equal(omgeving.gesloten, true);
  assert.equal(filter({ url: "x" }), null, "het controlebezoek telt niet mee");
  assert.equal(draaiUitzetter("#niet-tellen", opener).omgeving.gesloten, true);
});

test("een oudere uitzetter wordt vervangen, niet verdubbeld", () => {
  const oud = `<html><head>\n  <script>(function(){var x="va-disable"})()</script>\n  ${STATISTIEK_TAG}\n</head></html>`;
  const uit = metStatistiek(oud);
  assert.equal(uit.match(new RegExp(UITZET_PATROON.source, "g")).length, 1);
  assert.ok(uit.includes(`${UITZET_TAG}\n  ${STATISTIEK_TAG}`));
});
