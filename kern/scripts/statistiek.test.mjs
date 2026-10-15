import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { metStatistiek, zonderStatistiek, htmlBestanden, NIET_TELLEN, STATISTIEK_TAG, UITZET_TAG, TELLER_PATROON } from "./statistiek.mjs";

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

test("#niet-tellen zet de sleutel, beforeSend laat dan alles vallen; #wel-tellen zet hem terug", () => {
  const opslag = new Map();
  const omgeving = {
    location: { hash: "#niet-tellen" },
    localStorage: {
      getItem: (k) => (opslag.has(k) ? opslag.get(k) : null),
      setItem: (k, v) => opslag.set(k, String(v)),
      removeItem: (k) => opslag.delete(k),
    },
  };
  const luisteraars = [];
  omgeving.addEventListener = (naam, f) => luisteraars.push(f);
  omgeving.window = omgeving;
  runInNewContext(UITZET_TAG.replace(/^<script>|<\/script>$/g, ""), omgeving);
  const [naam, filter] = omgeving.vaq[0];
  assert.equal(naam, "beforeSend");
  assert.equal(filter({ url: "x" }), null);
  omgeving.location.hash = "#wel-tellen";
  luisteraars.forEach((f) => f());
  assert.deepEqual(filter({ url: "x" }), { url: "x" });
});
