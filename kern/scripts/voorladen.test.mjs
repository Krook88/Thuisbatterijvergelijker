/**
 * Tests voor voorladen.mjs: preload-hints voor de @imports van style.css.
 * Draaien: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { importsVan, metVoorladen } from "./voorladen.mjs";

const CSS = `/* kop */\n@import url("maatlat.css?v=20261022a");\n@import url("vergelijker.css?v=20261022a");\n\nbody { margin: 0; }`;
const PAGINA = `<head>\n  <meta charset="UTF-8">\n  <link rel="stylesheet" href="../assets/style.css?v=20261022a">\n</head>`;

test("de imports komen uit style.css, met hun versie", () => {
  assert.deepEqual(importsVan(CSS), ["maatlat.css?v=20261022a", "vergelijker.css?v=20261022a"]);
  assert.deepEqual(importsVan("/* @import url(\"x.css?v=1\"); */ body{}"), []);
});

test("elke import krijgt een preload vóór style.css, met hetzelfde pad", () => {
  const uit = metVoorladen(PAGINA, importsVan(CSS));
  assert.match(uit, /  <link rel="preload" href="\.\.\/assets\/maatlat\.css\?v=20261022a" as="style">\n  <link rel="preload" href="\.\.\/assets\/vergelijker\.css\?v=20261022a" as="style">\n  <link rel="stylesheet" href="\.\.\/assets\/style\.css/);
});

test("een tweede keer verandert niets, en een nieuwe versie vervangt de oude", () => {
  const een = metVoorladen(PAGINA, importsVan(CSS));
  assert.equal(metVoorladen(een, importsVan(CSS)), een);
  const nieuw = metVoorladen(een, ["maatlat.css?v=20261023a"]);
  assert.doesNotMatch(nieuw, /20261022a" as="style"/);
  assert.equal((nieuw.match(/rel="preload"/g) || []).length, 1);
});

test("een pagina zonder style.css blijft zoals hij is", () => {
  const los = "<head><title>Plan</title></head>";
  assert.equal(metVoorladen(los, importsVan(CSS)), los);
});
