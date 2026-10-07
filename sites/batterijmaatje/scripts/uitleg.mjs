/**
 * De uitlegpagina bijwerken vanuit de gegevens van de site.
 *
 * uitleg.html is met de hand geschreven, en dat moet zo blijven: het is de
 * pagina waar de toon het meest telt. Maar de getallen erin verouderden stil.
 * In oktober 2026 stond er "de 41 batterijen die op deze site staan" terwijl
 * de vergelijker er 52 telde, en zo'n getal rekent een lezer na. Dit script
 * laat de tekst met rust en vult alleen in wat de generator al weet:
 *
 *   <span data-cijfer="aantal">41</span>         een getal in de lopende tekst
 *   <!-- blok:markt --> ... <!-- /blok:markt -->  een heel stuk HTML
 *   <time data-bijgewerkt datetime="...">         de datum van vandaag
 *
 * en het zet er de gegevens voor zoekmachines bij (FAQ uit de korte antwoorden,
 * de woordenlijst als begrippenset), afgeleid van wat er op de pagina staat.
 * Wat in de tekst staat en wat in de markup staat kan zo niet uit elkaar lopen.
 *
 * Een cijfer of blok dat in de pagina staat maar dat de generator niet kent,
 * is een fout en geen stille lege plek: dan is er een naam verkeerd getypt.
 */

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Vult elk <span data-cijfer="naam"> met waarden[naam]. */
export function vulCijfers(html, waarden) {
  const onbekend = new Set();
  const uit = html.replace(/(<span\b[^>]*\bdata-cijfer="([^"]+)"[^>]*>)[\s\S]*?(<\/span>)/g, (heel, open, naam, sluit) => {
    if (!(naam in waarden)) { onbekend.add(naam); return heel; }
    return `${open}${waarden[naam]}${sluit}`;
  });
  if (onbekend.size) throw new Error(`uitleg.html noemt cijfers die de generator niet kent: ${[...onbekend].join(", ")}`);
  return uit;
}

/** Vervangt de inhoud tussen <!-- blok:naam --> en <!-- /blok:naam -->. */
export function vervangBlok(html, naam, inhoud) {
  const begin = `<!-- blok:${naam} -->`;
  const eind = `<!-- /blok:${naam} -->`;
  const a = html.indexOf(begin);
  const b = html.indexOf(eind);
  if (a < 0 || b < a) throw new Error(`uitleg.html mist de markering ${begin} ... ${eind}`);
  return html.slice(0, a + begin.length) + "\n" + inhoud + "\n  " + html.slice(b);
}

/** <time data-bijgewerkt> op de gegeven datum (ISO) met de tekst ernaast. */
export function zetBijgewerkt(html, iso, tekst) {
  return html.replace(/<time\b[^>]*\bdata-bijgewerkt\b[^>]*>[^<]*<\/time>/g,
    `<time data-bijgewerkt datetime="${esc(iso)}">${esc(tekst)}</time>`);
}

/** De datum die nu in <time data-bijgewerkt datetime="..."> staat, of null. */
export function vorigeDatum(html) {
  const m = /<time\b[^>]*\bdata-bijgewerkt\b[^>]*\bdatetime="(\d{4}-\d{2}-\d{2})"/.exec(html);
  return m ? m[1] : null;
}

/**
 * Bouwt de pagina, en zet de datum alleen op vandaag als er echt iets anders
 * staat. maak(iso) moet de hele pagina teruggeven met die datum erin.
 *
 * Waarom zo: "bijgewerkt op" die elke dag vandaag zegt, betekent niets, en
 * de dagelijkse run zou hem elke dag verzetten. Eerst bouwen met de oude
 * datum; is dat letter voor letter de pagina die er al lag, dan is er niets
 * veranderd en blijft die datum staan.
 */
export function bouwMetEerlijkeDatum(oud, vandaag, maak) {
  const vorige = vorigeDatum(oud);
  if (vorige) {
    const metOudeDatum = maak(vorige);
    if (metOudeDatum === oud) return { html: oud, iso: vorige, veranderd: false };
  }
  return { html: maak(vandaag), iso: vandaag, veranderd: true };
}

const platteTekst = (h) => String(h)
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&euro;/g, "€")
  .replace(/\s+/g, " ").trim();

/**
 * De korte antwoorden: <div class="kort-antwoord" data-vraag="..."> met de
 * tekst erin. Het label ("Kort antwoord") staat in een element met
 * class="kort-label" en telt niet mee in het antwoord.
 */
export function korteAntwoorden(html) {
  const uit = [];
  const re = /<div\b[^>]*\bclass="kort-antwoord"[^>]*\bdata-vraag="([^"]+)"[^>]*>([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tekst = platteTekst(m[2].replace(/<[^>]*class="kort-label"[^>]*>[\s\S]*?<\/[a-z]+>/, ""));
    uit.push({ vraag: platteTekst(m[1]), antwoord: tekst });
  }
  return uit;
}

/**
 * De begrippen uit de woordenlijst, in de drie vormen die de sites gebruiken:
 *   <div class="woord" id="x"><dt>Term</dt><dd>Uitleg</dd></div>
 *   <dt id="x"><b>Term</b></dt><dd>Uitleg</dd>
 *   <div class="woord" id="x"><b>Term</b>. Uitleg</div>
 */
export function begrippen(html) {
  const uit = [];
  let m;
  const blok = /<div\b[^>]*\bclass="woord"[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/div>/g;
  while ((m = blok.exec(html)) !== null) {
    const [, id, binnen] = m;
    const dt = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/.exec(binnen);
    if (dt) { uit.push({ id, naam: platteTekst(dt[1]), uitleg: platteTekst(dt[2]) }); continue; }
    const b = /^\s*<b>([\s\S]*?)<\/b>\.?\s*([\s\S]*)$/.exec(binnen);
    if (b) uit.push({ id, naam: platteTekst(b[1]), uitleg: platteTekst(b[2]) });
  }
  const los = /<dt\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/g;
  while ((m = los.exec(html)) !== null) uit.push({ id: m[1], naam: platteTekst(m[2]), uitleg: platteTekst(m[3]) });
  return uit;
}

/** De markup voor zoekmachines, als één JSON-LD-graaf. */
export function uitlegSchema(html, { url, titel, beschrijving, iso, uitgever }) {
  const graaf = [{
    "@type": "Article",
    "@id": `${url}#artikel`,
    headline: titel,
    description: beschrijving,
    dateModified: iso,
    inLanguage: "nl-NL",
    mainEntityOfPage: url,
    // De maker staat niet met naam op de site, dus de site is de auteur.
    author: { "@type": "Organization", name: uitgever.naam, url: uitgever.url },
    publisher: { "@type": "Organization", name: uitgever.naam, url: uitgever.url },
  }];
  const faq = korteAntwoorden(html);
  if (faq.length) {
    graaf.push({
      "@type": "FAQPage",
      "@id": `${url}#vragen`,
      mainEntity: faq.map((f) => ({ "@type": "Question", name: f.vraag, acceptedAnswer: { "@type": "Answer", text: f.antwoord } })),
    });
  }
  const termen = begrippen(html);
  if (termen.length) {
    graaf.push({
      "@type": "DefinedTermSet",
      "@id": `${url}#woordenlijst`,
      name: `Woordenlijst ${uitgever.naam}`,
      hasDefinedTerm: termen.map((t) => ({ "@type": "DefinedTerm", "@id": `${url}#${t.id}`, name: t.naam, description: t.uitleg, url: `${url}#${t.id}` })),
    });
  }
  return { "@context": "https://schema.org", "@graph": graaf };
}

/** Zet (of vervangt) <script type="application/ld+json" data-uitleg> in de head. */
export function zetSchema(html, ld) {
  const open = '<script type="application/ld+json" data-uitleg>';
  const blok = `${open}\n${JSON.stringify(ld, null, 2)}\n  </script>`;
  const a = html.indexOf(open);
  if (a >= 0) {
    const b = html.indexOf("</script>", a) + "</script>".length;
    return html.slice(0, a) + blok + html.slice(b);
  }
  return html.replace("</head>", `  ${blok}\n</head>`);
}

/**
 * De inhoudsopgave uit de h2's met een id, in de volgorde van de pagina.
 * Een h2 zonder id kan geen link krijgen; die staat er dan niet in, en de
 * controle hieronder meldt hem, want dan is de opgave stilletjes onvolledig.
 */
export function inhoudsopgave(html, { zonder = [] } = {}) {
  const koppen = [];
  const zonderId = [];
  const re = /<h2\b([^>]*)>([\s\S]*?)<\/h2>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = /\bid="([^"]+)"/.exec(m[1]);
    const tekst = platteTekst(m[2]);
    if (!id) { zonderId.push(tekst); continue; }
    // In de opgave alleen het deel voor de dubbele punt: "Woordenlijst", niet
    // "Woordenlijst: alle moeilijke woorden uitgelegd". Korter om te scannen.
    if (!zonder.includes(id[1])) koppen.push({ id: id[1], tekst: tekst.split(/: (?=[a-z])/)[0] });
  }
  if (zonderId.length) throw new Error(`uitleg.html heeft koppen zonder id, die kunnen niet in de inhoudsopgave: ${zonderId.join("; ")}`);
  return `  <nav class="inhoud" aria-label="Op deze pagina">
    <p class="inhoud-kop">Op deze pagina</p>
    <ol>${koppen.map((k) => `<li><a href="#${esc(k.id)}">${esc(k.tekst)}</a></li>`).join("")}</ol>
  </nav>`;
}

/**
 * Het blok met de markt in cijfers. Elk cijfer heeft een eigen id, zodat
 * iemand die er op een forum naar verwijst precies dat getal aanwijst, met
 * de datum erbij waarop het gold.
 */
export function marktBlok({ kop, iso, datumTekst, cijfers, voet }) {
  return `  <section class="markt" id="markt" aria-labelledby="markt-kop">
    <h2 id="markt-kop">${esc(kop)}</h2>
    <p class="markt-stand">De site rekent deze cijfers elke dag opnieuw uit de vergelijker. Laatst veranderd op <time datetime="${esc(iso)}">${esc(datumTekst)}</time>.</p>
    <dl class="markt-cijfers">${cijfers.map((c) => `
      <div class="markt-cijfer" id="${esc(c.id)}"><dt>${esc(c.label)}</dt><dd><span class="markt-getal">${c.getal}</span>${c.toelichting ? `<span class="markt-noot">${c.toelichting}</span>` : ""}</dd></div>`).join("")}
    </dl>
    ${voet ? `<p class="markt-voet">${voet}</p>` : ""}
  </section>`;
}

/** Mediaan; bij een even aantal het hogere van de twee middelste, zoals elders op de sites. */
export function mediaan(getallen) {
  const g = getallen.filter((n) => typeof n === "number" && Number.isFinite(n)).sort((a, b) => a - b);
  return g.length ? g[Math.floor(g.length / 2)] : null;
}

/**
 * Hoe de prijzen bewogen in de laatste `dagen` dagen, uit
 * data/prijsverloop.json: hoeveel producten goedkoper en duurder werden, en
 * de grootste daling.
 *
 * Alleen per winkel. De reeks met de laagste prijs per product ziet ook
 * correcties: toen een aanbieding van SolarEdge in augustus 2026 bleek te
 * gaan over twee modules in plaats van één, sprong die reeks van 6.200 naar
 * 2.990, en dat stond hier als "grootste daling 52%". Geen winkel had iets
 * goedkoper gemaakt. Daarom telt een product alleen mee via een winkel die
 * aan beide kanten van het venster een prijs had, en de beweging is die van
 * de goedkoopste van die winkels. Een gat (niet te koop) is geen daling.
 */
export function prijsbeweging(verloop, { dagen = 30 } = {}) {
  const tot = verloop && verloop.bijgewerkt;
  const perWinkel = (verloop && verloop.winkels) || {};
  if (!tot) return null;
  const grens = new Date(Date.parse(`${tot}T12:00:00Z`) - dagen * 86400000).toISOString().slice(0, 10);
  const prijsOp = (reeks, datum) => {
    let p;
    for (const [d, w] of reeks) { if (d > datum) break; p = w; }
    return p;
  };
  let goedkoper = 0, duurder = 0, gelijk = 0, gemeten = 0;
  let grootste = null;
  for (const [id, winkels] of Object.entries(perWinkel)) {
    const paren = [];
    for (const reeks of Object.values(winkels)) {
      if (!reeks.length || reeks[0][0] > grens) continue;
      const toen = prijsOp(reeks, grens);
      const nu = reeks[reeks.length - 1][1];
      if (typeof toen === "number" && typeof nu === "number") paren.push([toen, nu]);
    }
    if (!paren.length) continue;
    const toen = Math.min(...paren.map((p) => p[0]));
    const nu = Math.min(...paren.map((p) => p[1]));
    gemeten++;
    if (nu < toen) goedkoper++; else if (nu > toen) duurder++; else gelijk++;
    const procent = (nu - toen) / toen * 100;
    if (nu < toen && (!grootste || procent < grootste.procent)) grootste = { id, toen, nu, procent };
  }
  return { dagen, gemeten, goedkoper, duurder, gelijk, grootste, sinds: grens };
}
