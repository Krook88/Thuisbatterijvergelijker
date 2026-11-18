/**
 * Tests voor voorladen.mjs: preload-hints voor de @imports van style.css.
 * Draaien: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { importsVan, fontsVan, metVoorladen } from "./voorladen.mjs";

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

const FONTCSS = `/* @font-face { src: url("fonts/oud.woff2"); } */\n@font-face {\n  font-family: "Figtree";\n  src: url("fonts/figtree-variable.woff2") format("woff2-variations");\n}`;

test("de font uit @font-face krijgt een preload vóór de stylesheets", () => {
  assert.deepEqual(fontsVan(FONTCSS), ["fonts/figtree-variable.woff2"]);
  const uit = metVoorladen(PAGINA, importsVan(CSS), fontsVan(FONTCSS));
  assert.match(uit, /  <link rel="preload" href="\.\.\/assets\/fonts\/figtree-variable\.woff2" as="font" type="font\/woff2" crossorigin>\n  <link rel="preload" href="\.\.\/assets\/maatlat\.css/);
});

test("een font-preload die er al stond, ook elders in de kop, staat er daarna één keer", () => {
  const met = PAGINA.replace("<meta charset=\"UTF-8\">\n", "<meta charset=\"UTF-8\">\n  <link rel=\"preload\" href=\"/assets/fonts/figtree-variable.woff2\" as=\"font\" type=\"font/woff2\" crossorigin>\n");
  const uit = metVoorladen(met, importsVan(CSS), fontsVan(FONTCSS));
  assert.equal((uit.match(/as="font"/g) || []).length, 1);
  assert.equal(metVoorladen(uit, importsVan(CSS), fontsVan(FONTCSS)), uit);
});
