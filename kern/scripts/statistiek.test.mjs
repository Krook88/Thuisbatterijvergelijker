import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { metStatistiek, htmlBestanden, STATISTIEK_TAG, TELLER_PATROON } from "./statistiek.mjs";

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
  const zonder = htmlBestanden(root).filter((p) => {
    const html = readFileSync(p, "utf8");
    return !html.includes(STATISTIEK_TAG) || !TELLER_PATROON.test(html);
  });
  assert.deepEqual(zonder.map((p) => relative(root, p)), [], "draai npm run genereer");
});
