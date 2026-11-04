/* De pagina achter /v/a~b~c. Zie _vergelijking.js. */
"use strict";

const { SITE, soortVan, producten, naamVan, prijsVan, euro, esc } = require("./_vergelijking");

module.exports = function handler(req, res) {
  const q = req.query || {};
  const soortNaam = SITE.soorten[q.soort] ? q.soort : "standaard";
  const soort = soortVan(soortNaam);
  const lijst = producten(q.ids, soortNaam);
  const ids = lijst.map((p) => p.id).join("~");
  const doel = lijst.length >= 2 ? `${soort.pagina}?vergelijk=${ids}` : soort.pagina;

  if (lijst.length < 2) {
    res.statusCode = 302;
    res.setHeader("Location", doel);
    res.end();
    return;
  }

  const titel = lijst.map(naamVan).join(" vs ");
  const prijzen = lijst.map((p) => { const w = prijsVan(p); return w ? `${naamVan(p)} ${euro(w)}` : null; }).filter(Boolean);
  const omschrijving = `${lijst.length} ${soort.woord} naast elkaar op ${SITE.naam}${prijzen.length ? `: ${prijzen.join(", ")}` : ""}. Met de beste waarde per regel gemarkeerd.`;
  const basis = SITE.domein;
  const kaart = `${basis}/api/vergelijkkaart?soort=${soortNaam}&ids=${encodeURIComponent(ids)}`;
  const url = `${basis}/v/${soortNaam === "standaard" ? "" : soortNaam + "/"}${ids}`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800");
  res.end(`<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titel)} | ${esc(SITE.naam)}</title>
<meta name="description" content="${esc(omschrijving)}">
<meta name="robots" content="noindex">
<link rel="canonical" href="${esc(basis + doel)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="nl_NL">
<meta property="og:site_name" content="${esc(SITE.naam)}">
<meta property="og:title" content="${esc(titel)}">
<meta property="og:description" content="${esc(omschrijving)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(kaart)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(titel)}">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=${esc(doel)}">
<script>location.replace(${JSON.stringify(doel)});</script>
</head>
<body><p><a href="${esc(doel)}">Naar de vergelijking: ${esc(titel)}</a></p></body>
</html>`);
};
