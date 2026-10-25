/**
 * Welke producten er op de site staan.
 *
 * De regel: een product staat er alleen als er een prijs is die in de
 * afgelopen 14 weken (98 dagen) bevestigd is. Een prijs van een half jaar oud
 * naast een prijs van gisteren is geen vergelijking meer, en een product
 * zonder prijs kan de bezoeker niet afwegen. Zo besloten op 14 oktober 2026,
 * toen 14 producten geen prijs of een prijs zonder datum hadden en er voor
 * nog eens tien de laatste bevestiging van half juli was.
 *
 * Wat telt als bevestigd:
 * - de jongste datum van een aanbieding die een bedrag heeft en leverbaar is;
 * - is er geen leverbare aanbieding, dan de prijs_datum van de richtprijs.
 * Een leverbare aanbieding zonder datum (nooit bevestigd) telt niet.
 *
 * Uitzondering: "prijs_uit_offerte": true. Een vanaf-prijs uit een offerte of
 * een pakket (Zonneplan Nexus, Enphase via Vattenfall) kan geen script ooit
 * bevestigen, en die producten blijven staan zolang er een bedrag is; de site
 * toont er de leeftijd van de prijs bij.
 *
 * Wat er met een verborgen product gebeurt: het verdwijnt uit de lijst, de
 * keuzehulp, de vergelijkingen en de sitemap, en zijn pagina wordt een korte
 * pagina met noindex die naar de vergelijker verwijst. De gegevens blijven in
 * data/; komt er weer een bevestigde prijs, dan staat het product er bij de
 * volgende generatie weer op.
 */

export const HOUDBAAR_DAGEN = 98;

const isDatum = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

function dagenTussen(datum, vandaag) {
  const nu = new Date(`${vandaag}T12:00:00Z`);
  const toen = new Date(`${datum}T12:00:00Z`);
  return Math.round((nu - toen) / 86400000);
}

/** De datum waarop de prijs die de site toont het laatst bevestigd is, of null. */
export function laatstePrijsdatum(p) {
  const leverbaar = (p.aanbiedingen || []).filter((a) => a && typeof a.prijs_eur === "number" && a.niet_leverbaar !== true);
  if (leverbaar.length) {
    const datums = leverbaar.map((a) => a.datum).filter(isDatum).sort();
    return datums.length ? datums[datums.length - 1] : null;
  }
  if (typeof p.richtprijs_eur === "number" && isDatum(p.prijs_datum)) return p.prijs_datum;
  return null;
}

function heeftBedrag(p) {
  return typeof p.richtprijs_eur === "number" || (p.aanbiedingen || []).some((a) => a && typeof a.prijs_eur === "number");
}

/**
 * Staat dit product op de site? Geeft { zichtbaar, reden }. De reden is voor
 * het logboek van de generator en de pagina van een verborgen product.
 */
export function beoordeel(p, vandaag = new Date().toISOString().slice(0, 10)) {
  if (p.prijs_uit_offerte === true && heeftBedrag(p)) return { zichtbaar: true, reden: "prijs uit een offerte" };
  const datum = laatstePrijsdatum(p);
  if (!datum) return { zichtbaar: false, reden: heeftBedrag(p) ? "prijs zonder bevestigde datum" : "geen prijs" };
  const dagen = dagenTussen(datum, vandaag);
  if (dagen > HOUDBAAR_DAGEN) return { zichtbaar: false, reden: `prijs ${dagen} dagen oud (sinds ${datum})` };
  return { zichtbaar: true, reden: null };
}

/** Splitst een productlijst in wat er op de site staat en wat niet. */
export function verdeel(lijst, vandaag) {
  const zichtbaar = [];
  const verborgen = [];
  for (const p of lijst || []) {
    const { zichtbaar: ja, reden } = beoordeel(p, vandaag);
    if (ja) zichtbaar.push(p);
    else verborgen.push({ product: p, reden });
  }
  return { zichtbaar, verborgen };
}

/**
 * Bij hoeveel winkels de prijzen van deze producten worden nagelopen, geteld
 * per webadres. De winkelnamen in de gegevens lopen uiteen ("Techpunt" en
 * "TechPunt", "Marstek.nl (officieel)"), het domein niet.
 */
export function aantalWinkels(...lijsten) {
  const domeinen = new Set();
  for (const p of lijsten.flat()) {
    for (const a of (p && p.aanbiedingen) || []) {
      try { domeinen.add(new URL(a.url).hostname.replace(/^www\./, "")); } catch { /* geen geldig adres */ }
    }
  }
  return domeinen.size;
}

/**
 * De pagina voor een product dat er nu niet op staat, gemaakt uit de 404 van
 * de site: dezelfde kop en voet, noindex, en een <main> met de uitleg. De
 * adressen in de 404 zijn relatief en de productpagina's staan een map dieper,
 * dus alle interne adressen worden absoluut.
 */
export function verborgenPagina(html404, { titel, kop, alineas, terug }) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const absoluut = html404.replace(/\b(href|src)="(?!https?:|\/|#|mailto:|data:)([^"]*)"/g, '$1="/$2"');
  const main = [
    '<main class="content-pagina foutpagina">',
    `  <h1>${esc(kop)}</h1>`,
    ...alineas.map((t) => `  <p>${t}</p>`),
    `  <p class="foutpagina-acties"><a class="knop" href="${esc(terug.href)}">${esc(terug.tekst)}</a></p>`,
    "</main>",
  ].join("\n");
  const uit = absoluut
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(titel)}</title>`)
    .replace(/<main\b[\s\S]*?<\/main>/, main);
  if (!/<meta name="robots" content="noindex">/.test(uit)) {
    return uit.replace("</title>", '</title>\n  <meta name="robots" content="noindex">');
  }
  return uit;
}

/* De producten die er niet op staan, onder de vergelijker genoemd.

   Een reviewer zag "53 batterijen" in de kop terwijl er 60 in de gegevens
   staan, zonder dat de site zegt waar de andere zeven zijn. Ze horen niet in
   de lijst (zonder actuele prijs valt er niets af te wegen), maar wie een
   model zoekt moet kunnen zien dat het bekend is en waarom het ontbreekt.
   Een ingeklapt blok, buiten #resultaten, zodat app.js het laat staan. */
const ZP_BEGIN = "<!-- zonder-prijs:begin -->";
const ZP_EIND = "<!-- zonder-prijs:eind -->";

function zpEsc(t) {
  return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function redenTekst(reden) {
  if (reden === "geen prijs") return "nog geen prijs gevonden";
  if (reden === "prijs zonder bevestigde datum") return "prijs niet bevestigd";
  const m = /^prijs (\d+) dagen oud/.exec(reden || "");
  return m ? `laatste prijs ${m[1]} dagen oud` : String(reden || "");
}

/** Het blok als HTML, of "" als alles een prijs heeft. */
export function zonderPrijsHtml(verborgen, { meervoud, pad, naamVan }) {
  if (!verborgen || !verborgen.length) return "";
  const n = verborgen.length;
  const regels = [...verborgen]
    .sort((a, b) => naamVan(a.product).localeCompare(naamVan(b.product), "nl"))
    .map(({ product, reden }) => `      <li><a href="${zpEsc(pad)}/${encodeURIComponent(product.id)}.html">${zpEsc(naamVan(product))}</a> <small>(${zpEsc(redenTekst(reden))})</small></li>`)
    .join("\n");
  return `<details class="legenda zonder-prijs">
    <summary>Nog ${n} ${meervoud} zonder actuele prijs</summary>
    <p>Deze staan niet in de vergelijking, omdat er geen prijs is die in de afgelopen ${Math.round(HOUDBAAR_DAGEN / 7)} weken bevestigd is. Zodra er weer een winkelprijs is, staan ze er vanzelf weer tussen.</p>
    <ul>
${regels}
    </ul>
  </details>`;
}

/** Zet het blok in index.html: tussen de markeringen, of de eerste keer direct onder #resultaten. */
export function zetZonderPrijs(html, blok) {
  const inhoud = `${ZP_BEGIN}\n  ${blok}\n  ${ZP_EIND}`;
  const b = html.indexOf(ZP_BEGIN);
  const e = html.indexOf(ZP_EIND);
  if (b !== -1 && e !== -1) return html.slice(0, b) + inhoud + html.slice(e + ZP_EIND.length);
  // De sluittag van #resultaten zoeken door de divs te tellen; de opmaak
  // eromheen verschilt per site.
  const start = html.indexOf('<div id="resultaten">');
  if (start === -1) throw new Error("zetZonderPrijs: geen #resultaten gevonden");
  const tag = /<div\b|<\/div>/g;
  tag.lastIndex = start;
  let diepte = 0;
  for (let m; (m = tag.exec(html));) {
    diepte += m[0] === "</div>" ? -1 : 1;
    if (diepte === 0) {
      const na = m.index + m[0].length;
      return `${html.slice(0, na)}\n  ${inhoud}${html.slice(na)}`;
    }
  }
  throw new Error("zetZonderPrijs: #resultaten wordt niet gesloten");
}
