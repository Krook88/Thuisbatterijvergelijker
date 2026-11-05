/* Het plaatje (1200 x 630) bij een gedeelde vergelijking. Zie _vergelijking.js.

   Gemaakt met @vercel/og. Het lettertype is Figtree, net als op de site,
   maar als ttf: satori leest geen woff2. fonts/ maakt een normaal en een vet
   exemplaar uit het variabele lettertype van de site. */
"use strict";

const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const LETTERS = [
  { name: "Figtree", data: readFileSync(join(__dirname, "fonts", "figtree-regular.ttf")), weight: 400, style: "normal" },
  { name: "Figtree", data: readFileSync(join(__dirname, "fonts", "figtree-bold.ttf")), weight: 700, style: "normal" },
];

const { SITE, soortVan, producten, naamVan, prijsVan, euro } = require("./_vergelijking");

const h = (type, style, children) => ({ type, props: { style: { display: "flex", ...style }, children } });

function kaart(lijst, soort) {
  const laagste = Math.min(...lijst.map(prijsVan).filter((w) => w !== null));
  const kolom = (p) => {
    const w = prijsVan(p);
    // Geen groene prijs als de prijzen niet hetzelfde soort getal zijn: bij
    // omvormers staat de prijs van één micro-omvormer naast die van een
    // complete omvormer, en dan is de laagste niet de goedkoopste.
    const beste = !soort.geenPrijswinnaar && w !== null && w === laagste && lijst.filter((x) => prijsVan(x) !== null).length > 1;
    return h("div", { flex: 1, flexDirection: "column", justifyContent: "space-between", padding: "28px", background: "#ffffff", borderRadius: "18px", borderTop: `8px solid ${beste ? "#15803d" : SITE.kleur}` }, [
      h("div", { fontSize: 22, color: "#5d6d6a", textTransform: "uppercase", letterSpacing: "1px" }, p.merk),
      h("div", { fontSize: lijst.length > 3 ? 30 : 36, fontWeight: 700, color: "#24312f", lineHeight: 1.15, marginTop: "8px" }, naamVan(p).replace(new RegExp("^" + p.merk + "\\s+", "i"), "")),
      h("div", { flexDirection: "column", marginTop: "18px" }, [
        h("div", { fontSize: 20, color: "#5d6d6a" }, w === null ? "prijs onbekend" : "vanaf"),
        h("div", { fontSize: 46, fontWeight: 700, color: beste ? "#15803d" : "#24312f" }, w === null ? "–" : euro(w)),
      ]),
    ]);
  };
  return h("div", { width: "1200px", height: "630px", flexDirection: "column", background: SITE.inkt, padding: "48px", fontFamily: "Figtree" }, [
    h("div", { justifyContent: "space-between", alignItems: "center", color: "#ffffff" }, [
      h("div", { fontSize: 30, fontWeight: 700 }, SITE.naam),
      h("div", { fontSize: 26, opacity: 0.8 }, `${lijst.length} ${soort.woord} vergeleken`),
    ]),
    h("div", { flex: 1, gap: "20px", marginTop: "36px" }, lijst.map(kolom)),
    h("div", { color: "#ffffff", fontSize: 24, marginTop: "28px", opacity: 0.85 }, "Beste waarde per regel gemarkeerd · onafhankelijk vergeleken"),
  ]);
}

module.exports = async function handler(req, res) {
  const q = req.query || {};
  const soortNaam = SITE.soorten[q.soort] ? q.soort : "standaard";
  const lijst = producten(q.ids, soortNaam);
  if (lijst.length < 2) {
    res.statusCode = 302;
    res.setHeader("Location", "/assets/og-image.png");
    res.end();
    return;
  }
  const { ImageResponse } = await import("@vercel/og");
  const plaatje = new ImageResponse(kaart(lijst, soortVan(soortNaam)), { width: 1200, height: 630, fonts: LETTERS });
  const buf = Buffer.from(await plaatje.arrayBuffer());
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800");
  res.end(buf);
};
