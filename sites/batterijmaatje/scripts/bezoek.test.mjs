/**
 * Het verloop op de statistiekenpagina komt uit een eigen kopie van de
 * dagcijfers van Vercel (api/_bezoek.js). Wat er mis kan gaan: de
 * statistiekenpagina telt toch mee, een halve dag (vandaag) wordt als hele
 * dag bewaard, of een filter dat Vercel niet kent laat alles leeg.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const vereis = createRequire(import.meta.url);

function opzet(antwoordVercel) {
  process.env.STATISTIEK_TOKEN = "proef";
  process.env.KV_REST_API_URL = "https://opslag.proef";
  process.env.KV_REST_API_TOKEN = "proef";
  const vragen = [];
  const opgeslagen = [];
  globalThis.fetch = async (url, opties = {}) => {
    const u = new URL(url);
    if (u.hostname === "opslag.proef") {
      const lijst = JSON.parse(opties.body);
      opgeslagen.push(...lijst);
      return new Response(JSON.stringify(lijst.map(() => ({ result: "OK" }))), { status: 200 });
    }
    vragen.push(u);
    return antwoordVercel(u);
  };
  for (const m of ["../api/_bezoek.js", "../api/_opslag.js"]) delete vereis.cache[vereis.resolve(m)];
  return { bezoek: vereis("../api/_bezoek.js"), vragen, opgeslagen };
}

const rijen = [
  { timestamp: "2026-10-14T00:00:00.000Z", visitors: 3, pageviews: 7 },
  { timestamp: "2026-10-15T00:00:00.000Z", visitors: 5, pageviews: 9 },
  { timestamp: "2026-10-16T00:00:00.000Z", visitors: 1, pageviews: 1 },
];

test("bewaart de voorbije dagen per site, zonder vandaag, en vraagt zonder de statistiekenpagina", async () => {
  const { bezoek, vragen, opgeslagen } = opzet(() => new Response(JSON.stringify({ data: rijen }), { status: 200 }));
  const n = await bezoek.bewaarBezoek(new Date("2026-10-16T08:00:00Z"));
  assert.equal(n, 6, "twee dagen voor drie sites");
  assert.deepEqual(opgeslagen.filter((o) => o[1] === "bezoek:bat"), [
    ["HSET", "bezoek:bat", "2026-10-14", "3|7"],
    ["HSET", "bezoek:bat", "2026-10-15", "5|9"],
  ]);
  assert.ok(vragen.every((u) => u.searchParams.get("filter") === bezoek.FILTER));
  assert.match(bezoek.FILTER, /requestPath ne '\/statistieken\.html'/);
});

test("kent Vercel het filter niet, dan zonder filter in plaats van niets", async () => {
  const { bezoek, vragen } = opzet((u) => u.searchParams.has("filter")
    ? new Response("{}", { status: 400 })
    : new Response(JSON.stringify({ data: rijen }), { status: 200 }));
  assert.equal(await bezoek.bewaarBezoek(new Date("2026-10-16T08:00:00Z")), 6);
  assert.ok(vragen.some((u) => !u.searchParams.has("filter")));
});

test("niet() herkent alleen de statistiekenpagina", () => {
  const { bezoek } = opzet(() => new Response("{}"));
  assert.equal(bezoek.niet("/statistieken.html"), true);
  assert.equal(bezoek.niet("/statistieken"), true);
  assert.equal(bezoek.niet("/index.html"), false);
});
