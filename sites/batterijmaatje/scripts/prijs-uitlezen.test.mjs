/**
 * Tests voor scripts/prijs-uitlezen.mjs.
 *
 * De gevallen hieronder zijn geen bedachte randgevallen. Het zijn de vier
 * manieren waarop het prijsscript van batterijmaatje er de afgelopen maand
 * naast zat, met de schade erbij:
 *
 *   - Zonneplan: 5.990 euro werd 664, want dat bedrag stond het vaakst op de
 *     overzichtspagina.
 *   - SolarEdge bij Thuisbatterij Nederland: 6.200 werd 1.495, om dezelfde
 *     reden.
 *   - Sessy en HomeWizard: "geen prijs gevonden", terwijl het bedrag in een
 *     JSON-blok in de pagina stond.
 *   - Twaalf prijzen stonden een maand stil zonder dat één van die twaalf een
 *     scriptfout was: zes hadden helemaal geen winkelpagina.
 *
 * Alle vier zaten in de extractie, en die is nu gedeeld. Gaat hij stuk, dan
 * gaat hij op drie sites tegelijk stuk en verandert elke prijs op elke pagina.
 *
 * Draaien: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  andereHostvorm,
  ankerWoorden,
  haalPagina,
  parsePrijsWaarde,
  prijsUitJsonLd,
  prijsUitScriptJson,
  prijsUitJsonVeld,
  prijsveldMetDekking,
  prijsUitWooVariaties,
  prijsBijVariant,
  prijsUitTekst,
  prijsUitPagina,
  toontExclBtw,
  btwVolgensPagina,
  zonderExclBijschrift,
  controleerbaar,
  bedragenMetContext,
  tekstMetContext,
  linksMetTekst,
} from "./prijs-uitlezen.mjs";

/* ------------------------------------------------------------------
   Ophalen: één herkansing, en niet meer dan dat

   Deze staan hier omdat het bijna misging: de tweede poging met de andere
   schrijfwijze van de hostnaam probeerde daarna meteen weer de eerste, en
   die weer de andere. Het script liep vast op de eerste winkel die geen
   antwoord gaf - zonder foutmelding, gewoon oneindig lang bezig.
   ------------------------------------------------------------------ */

test("de andere schrijfwijze van de hostnaam is er precies één", () => {
  assert.equal(andereHostvorm("https://winkel.nl/p/1"), "https://www.winkel.nl/p/1");
  assert.equal(andereHostvorm("https://www.winkel.nl/p/1"), "https://winkel.nl/p/1");
  assert.equal(andereHostvorm("geen url"), null);
});

test("een weigering krijgt één herkansing, een 404 geen", async () => {
  let verzoeken = 0;
  const server = createServer((req, res) => {
    verzoeken++;
    res.writeHead(req.url === "/weg" ? 404 : 403).end();
  });
  await new Promise((r) => server.listen(0, r));
  const basis = `http://127.0.0.1:${server.address().port}`;
  try {
    verzoeken = 0;
    await assert.rejects(() => haalPagina(`${basis}/weg`), /HTTP 404/);
    assert.equal(verzoeken, 1, "een verdwenen pagina komt niet terug");

    verzoeken = 0;
    await assert.rejects(() => haalPagina(`${basis}/geweigerd`), /HTTP 403/);
    assert.equal(verzoeken, 2, "één herkansing, en dan is het klaar");
  } finally {
    server.close();
  }
});

/* ------------------------------------------------------------------
   Bedragen lezen
   ------------------------------------------------------------------ */

test("Nederlandse en Engelse schrijfwijzen leveren hetzelfde bedrag op", () => {
  assert.equal(parsePrijsWaarde("€ 1.299,00"), 1299);
  assert.equal(parsePrijsWaarde("1299.00"), 1299);
  assert.equal(parsePrijsWaarde("1.299"), 1299);
  assert.equal(parsePrijsWaarde("5990,-"), 5990);
  assert.equal(parsePrijsWaarde(""), null);
  assert.equal(parsePrijsWaarde(null), null);
});

/* ------------------------------------------------------------------
   De productnaam als anker
   ------------------------------------------------------------------ */

test("het anker houdt alleen de woorden over waarmee dit product zich onderscheidt", () => {
  const a = ankerWoorden("Zonneplan Nexus (10 kWh)");
  assert.ok(a.includes("zonneplan"));
  assert.ok(a.includes("nexus"));
  assert.ok(!a.includes("kwh"), "kWh staat bij elk product op een overzichtspagina");
});

test("een naam zonder onderscheidende woorden levert geen anker op", () => {
  assert.deepEqual(ankerWoorden("Thuisbatterij set"), []);
  assert.deepEqual(ankerWoorden(""), []);
});

/* ------------------------------------------------------------------
   Meerdere producten op één pagina
   Zonneplan gaf 664 voor een batterij van 5.990; SolarEdge 1.495 voor 6.200.
   ------------------------------------------------------------------ */

const OVERZICHTSPAGINA = `
  <h2>Zonneplan Nexus</h2>
  <p>Vanaf € 5.990 inclusief installatie.</p>
  <section>
    <h3>Zonneplan Thuisaccu klein</h3><p>€ 664</p>
    <h3>Slimme meter</h3><p>€ 664</p>
    <h3>Laadpaal</h3><p>€ 664</p>
  </section>`;

test("het bedrag bij de productnaam wint van het bedrag dat het vaakst voorkomt", () => {
  assert.equal(prijsUitTekst(OVERZICHTSPAGINA, ankerWoorden("Zonneplan Nexus")), 5990);
});

test("zonder anker wint het vaakst voorkomende bedrag nog steeds, zoals vroeger", () => {
  assert.equal(prijsUitTekst(OVERZICHTSPAGINA, []), 664);
});

test("op een pagina met veel losse bedragen en geen anker zwijgt het script", () => {
  const rommel = ["100", "200", "300", "400", "500", "600", "700", "800", "900", "1000"]
    .map((p) => `<p>€ ${p}</p>`).join("");
  assert.equal(prijsUitTekst(rommel, ["bestaatniet"]), null);
});

test("een bedrag verderop de pagina hoort niet meer bij het product", () => {
  const ver = `<h1>Marstek Venus</h1><p>€ 1.299</p>${"x".repeat(4000)}<p>€ 49</p><p>€ 49</p>`;
  assert.equal(prijsUitTekst(ver, ankerWoorden("Marstek Venus")), 1299);
});

test("bij twee bedragen even dicht bij de naam telt het laagste, dat is wat je betaalt", () => {
  const korting = `<h1>Marstek Venus</h1><p>van € 1.499 voor € 1.299</p>`;
  assert.equal(prijsUitTekst(korting, ankerWoorden("Marstek Venus")), 1299);
});

/* ------------------------------------------------------------------
   Structured data met meer dan één product
   ------------------------------------------------------------------ */

function ld(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
}

test("één product in de structured data telt zonder meer", () => {
  const html = ld({ "@type": "Product", name: "Iets", offers: { price: "1299.00" } });
  assert.equal(prijsUitJsonLd(html, ankerWoorden("Marstek Venus")).prijs, 1299);
});

test("bij meerdere producten kiest de naam, niet de volgorde", () => {
  const html =
    ld({ "@type": "Product", name: "Zonneplan Thuisaccu klein", offers: { price: "664" } }) +
    ld({ "@type": "Product", name: "Zonneplan Nexus 10 kWh", offers: { price: "5990" } });
  assert.equal(prijsUitJsonLd(html, ankerWoorden("Zonneplan Nexus")).prijs, 5990);
});

test("wijst de naam niets aan, dan neemt het script niets over", () => {
  const html =
    ld({ "@type": "Product", name: "Laadpaal", offers: { price: "664" } }) +
    ld({ "@type": "Product", name: "Slimme meter", offers: { price: "199" } });
  assert.equal(prijsUitJsonLd(html, ankerWoorden("Zonneplan Nexus")), null);
});

test("een lowPrice van een AggregateOffer telt niet mee, tenzij de site erom vraagt", () => {
  // Bij een batterij is dat de goedkoopste variant op de pagina - een kleiner
  // model, of zonder P1-meter - en niet de prijs van dit product. Bij een
  // paneel dat tien winkels voeren is het juist wél wat je betaalt.
  const html = ld({ "@type": "Product", name: "Marstek Venus", offers: { "@type": "AggregateOffer", lowPrice: "899" } });
  assert.equal(prijsUitJsonLd(html, ankerWoorden("Marstek Venus")), null);
  assert.equal(prijsUitJsonLd(html, ankerWoorden("Marstek Venus"), { lowPriceTelt: true }).prijs, 899);
});

test("een bedrag in dollars is niet de prijs die wij zoeken", () => {
  const html = ld({ "@type": "Product", name: "Marstek Venus", offers: { price: "1299", priceCurrency: "USD" } });
  assert.equal(prijsUitJsonLd(html, ankerWoorden("Marstek Venus")), null);
});

test("een uitverkocht product houdt vaak een oude prijs in de markup", () => {
  const html = ld({
    "@type": "Product", name: "Marstek Venus",
    offers: { price: "1299", availability: "https://schema.org/OutOfStock" },
  });
  assert.equal(prijsUitJsonLd(html, ankerWoorden("Marstek Venus")), null);
});

test("zegt de markup zelf dat de btw er niet in zit, dan telt dat zwaarder dan de tekst", () => {
  const html = ld({
    "@type": "Product", name: "GoodWe Lynx",
    offers: { price: "2383", priceSpecification: { price: "2383", valueAddedTaxIncluded: false } },
  }) + "<p>Alle prijzen inclusief btw.</p>";
  assert.equal(prijsUitPagina(html, "GoodWe Lynx").btw, "excl");
});

/* ------------------------------------------------------------------
   De prijs in een JSON-blok
   Sessy, HomeWizard en Vattenfall meldden elke dag "geen prijs gevonden".
   ------------------------------------------------------------------ */

test("een prijs uit een JSON-blok in de pagina wordt gevonden", () => {
  const html = `<script>window.__NUXT__ = ${JSON.stringify({
    data: { product: { title: "Sessy 5 kWh thuisbatterij", price: 3550 } },
  })}</script>`;
  assert.equal(prijsUitScriptJson(html, ankerWoorden("Sessy 5 kWh")), 3550);
});

test("centen worden herkend als centen", () => {
  const html = `<script type="application/json">${JSON.stringify({
    product: { title: "HomeWizard Plug-In Battery", price: 119500 },
  })}</script>`;
  assert.equal(prijsUitScriptJson(html, ankerWoorden("HomeWizard Plug-In Battery")), 1195);
});

test("een bedrag zonder productnaam ernaast wordt niet overgenomen", () => {
  // Anders pakt het script het eerste beste getal uit een verzendtarief of
  // een winkelwagen.
  const html = `<script type="application/json">${JSON.stringify({
    cart: { price: 9 }, verzending: { price: 695 },
  })}</script>`;
  assert.equal(prijsUitScriptJson(html, ankerWoorden("Sessy 5 kWh")), null);
});

test("zonder anker kijkt het script niet in JSON-blokken", () => {
  const html = `<script type="application/json">{"name":"iets","price":1234}</script>`;
  assert.equal(prijsUitScriptJson(html, []), null);
});

/* ------------------------------------------------------------------
   Het prijsveld zonder productnaam: de laatste, grofste weg
   ------------------------------------------------------------------ */

test("een benoemd prijsveld volstaat, ook zonder productnaam ernaast", () => {
  // Bij warmtepompmaatje haalt deze route elke dag prijzen binnen bij winkels
  // waar geen enkele andere weg iets oplevert.
  assert.equal(prijsUitJsonVeld(`<script>{"unitPrice":"4199,00"}</script>`), 4199);
});

test("de grenzen van de site houden centen en centenbedragen buiten de deur", () => {
  assert.equal(prijsUitJsonVeld(`<script>{"price":419900}</script>`), null);
  assert.equal(prijsUitJsonVeld(`<script>{"price":49}</script>`), null);
  assert.equal(prijsUitJsonVeld(`<script>{"price":800}</script>`, { min: 1500 }), null);
});

test("bij evenveel treffers wint het laagste bedrag, want dat is de kale prijs", () => {
  // Het hogere bedrag is doorgaans een set of een variant met toebehoren.
  assert.equal(prijsUitJsonVeld(`<script>{"price":4199,"salePrice":5299}</script>`), 4199);
});

test("een benoemd prijsveld gaat vóór een euroteken in de tekst", () => {
  // Dit is de volgorde waarop het bijna misging: bij Aircozonderstek zakten
  // vier warmtepompen 42 tot 60 procent toen de zichtbare tekst even voorging.
  const html = `<script>{"price":5695}</script><h1>Bosch Compress 5800i</h1><p>vanaf € 2.375</p>`;
  const uit = prijsUitPagina(html, "Bosch Compress 5800i");
  assert.equal(uit.prijs, 5695);
  assert.equal(uit.hoe, "prijsveld in de pagina");
});

/* ------------------------------------------------------------------
   Btw volgens de tekst op de pagina
   ------------------------------------------------------------------ */

test("alleen een eenduidige pagina levert een oordeel over btw", () => {
  assert.equal(toontExclBtw("<p>Prijzen excl. btw</p>"), true);
  assert.equal(toontExclBtw("<p>Prijzen incl. btw</p>"), false);
  // Toont de winkel beide bedragen, dan is wat wij oppikken vrijwel altijd
  // het bedrag inclusief.
  assert.equal(toontExclBtw("<p>€ 1.000 excl. btw, € 1.210 incl. btw</p>"), false);
  assert.equal(toontExclBtw("<p>Geen woord over belasting.</p>"), false);
});

test("een bijschrift excl. btw onder een prijs incl. btw maakt de pagina niet exclusief", () => {
  // NKON, oktober 2026: de hoofdprijs is inclusief, het bijschrift niet.
  assert.equal(toontExclBtw("<p>€ 1.924,95</p><p>excl. btw: € 1.590,87</p>"), false);
  // Zonder bedrag dat 21 procent hoger ligt is het label wel de prijs zelf.
  assert.equal(toontExclBtw("<p>Prijs excl. btw: € 1.000,00</p>"), true);
  // Het label achter het bedrag (Zonnige Winkel) blijft exclusief.
  assert.equal(toontExclBtw("<p>€ 109,00 excl. btw</p>"), true);
});

/* ------------------------------------------------------------------
   De volgorde van de wegen
   ------------------------------------------------------------------ */

test("structured data gaat voor op de zichtbare tekst, en het logboek zegt welke weg het was", () => {
  const html =
    ld({ "@type": "Product", name: "Marstek Venus E", offers: { price: "1299" } }) +
    "<p>Actie! € 49 korting op accessoires. € 49</p>";
  const uit = prijsUitPagina(html, "Marstek Venus E");
  assert.equal(uit.prijs, 1299);
  assert.equal(uit.hoe, "structured data");
});

test("een pagina zonder enig bedrag levert geen prijs en geen weg op", () => {
  const uit = prijsUitPagina("<p>Vraag een offerte aan.</p>", "Zonneplan Nexus");
  assert.equal(uit.prijs, null);
  assert.equal(uit.hoe, null);
});

/* ------------------------------------------------------------------
   Wat een script überhaupt kan controleren
   Zes van de twaalf stilstaande prijzen hadden geen winkelpagina.
   ------------------------------------------------------------------ */

test("zonder adres valt er niets te controleren", () => {
  assert.equal(controleerbaar({ prijs_eur: 5990 }), false);
  assert.equal(controleerbaar(null), false);
  assert.equal(controleerbaar({ url: "https://winkel.nl/product" }), true);
  assert.equal(controleerbaar({ prijs_bron_url: "https://winkel.nl/product" }), true);
});

test("een prijs die als handmatig is aangemerkt blijft handmatig, ook met een adres erbij", () => {
  // Een offerteprijs staat niet op de pagina waar hij vandaan komt.
  assert.equal(controleerbaar({ url: "https://zonneplan.nl/thuisbatterij", prijs_controle: "handmatig" }), false);
});

/* ------------------------------------------------------------------
   Wat staat er eigenlijk op deze pagina
   De diagnose achter "€6200 → €1495 (-76%)": prijsdaling of buurman?
   ------------------------------------------------------------------ */

test("elk bedrag komt terug met de tekst eromheen, op volgorde van de pagina", () => {
  const uit = bedragenMetContext(OVERZICHTSPAGINA);
  assert.deepEqual(uit.map((b) => b.prijs), [5990, 664, 664, 664]);
  assert.match(uit[0].context, /zonneplan nexus/);
  assert.match(uit[1].context, /thuisaccu klein/);
});

test("de context laat zien waar een bedrag bij hoort, ook als het het verkeerde is", () => {
  // Dit is de hele reden dat deze functie er is: op een pagina met modules en
  // pakketten moet een mens kunnen zien of 1.495 bij één module hoort.
  const pagina = `
    <h1>SolarEdge Home Battery 48V</h1><p>Pakket 9,2 kWh: € 6.200</p>
    <h2>Losse module 4,6 kWh</h2><p>€ 1.495</p>`;
  const uit = bedragenMetContext(pagina);
  assert.deepEqual(uit.map((b) => b.prijs), [6200, 1495]);
  assert.match(uit[1].context, /losse module 4,6 kwh/);
});

test("bedragen buiten de grenzen tellen niet mee", () => {
  const uit = bedragenMetContext(`<p>€ 1.299</p><p>€ 12</p><p>€ 99.000</p>`);
  assert.deepEqual(uit.map((b) => b.prijs), [1299]);
});

test("bedragen in een script tellen niet mee, net als bij de zichtbare tekst", () => {
  const uit = bedragenMetContext(`<script>var p = "€ 4.999";</script><p>€ 1.299</p>`);
  assert.deepEqual(uit.map((b) => b.prijs), [1299]);
});

test("een pagina zonder bedragen levert een lege lijst, geen fout", () => {
  assert.deepEqual(bedragenMetContext("<p>Tijdelijk uitverkocht</p>"), []);
});

test("tekstMetContext toont de zin waar een gezocht woord in staat", () => {
  // Voor het opnemen van een nieuw model: de SCOP en het geluidsvermogen staan
  // in gewone zinnen op de fabrikantpagina, niet in een prijsveld.
  const html = `<p>De WPL 09 haalt een SCOP van 4,2 bij 35 graden aanvoer.</p>
    <p>Het geluidsvermogen bedraagt 54 dB(A).</p>`;
  const uit = tekstMetContext(html, ["scop", "dB(A)"]);
  assert.equal(uit.length, 2);
  assert.match(uit[0].context, /scop van 4,2 bij 35 graden/);
  assert.match(uit[1].context, /54 db\(a\)/);
});

test("een woord dat er niet staat levert niets op", () => {
  assert.deepEqual(tekstMetContext("<p>niets bijzonders</p>", ["scop"]), []);
});

test("scripts en stijl tellen niet mee, net als bij de bedragen", () => {
  // Anders vind je het woord in een json-blok dat de bezoeker nooit ziet.
  const html = `<script>var scop = 9.9;</script><p>SCOP 4,2 volgens het label.</p>`;
  const uit = tekstMetContext(html, ["scop"]);
  assert.equal(uit.length, 1);
  assert.match(uit[0].context, /4,2 volgens het label/);
});

test("meer treffers van hetzelfde woord worden begrensd", () => {
  const html = "<p>" + "scop ".repeat(40) + "</p>";
  assert.ok(tekstMetContext(html, ["scop"], { maxPerWoord: 3 }).length <= 3);
});

test("de treffers staan op volgorde van de pagina", () => {
  const html = `<p>eerst het geluid: 54 dB(A).</p><p>daarna de scop: 4,2.</p>`;
  const uit = tekstMetContext(html, ["scop", "dB(A)"]);
  assert.equal(uit[0].woord, "db(a)");
  assert.equal(uit[1].woord, "scop");
});

/* ------------------------------------------------------------------
   linksMetTekst
   ------------------------------------------------------------------ */

const CATEGORIE = `
  <nav><a href="#top">Naar boven</a><a href="javascript:void(0)">Menu</a></nav>
  <ul>
    <li><a href="/nl/producten/wpl-07-acs-classic.html">WPL 07 ACS Classic Compact Set 1.1</a></li>
    <li><a href='/nl/producten/wpl-09-acs-classic.html'>WPL 09 ACS <b>Classic</b> Compact Set 1.1</a></li>
    <li><a href="https://www.elders.nl/wpl-13">WPL 13 elders</a></li>
    <li><a href="/nl/producten/wpl-07-acs-classic.html">nog een keer dezelfde</a></li>
    <li><a href="/nl/service/garantie.html">Garantie</a></li>
  </ul>`;

const BASIS = "https://www.stiebel-eltron.nl/nl/producten/lucht-water-warmtepompen.html";

test("relatieve adressen worden tegen de basis opgelost", () => {
  const links = linksMetTekst(CATEGORIE, "wpl-09", { basis: BASIS });
  assert.equal(links.length, 1);
  assert.equal(links[0].url, "https://www.stiebel-eltron.nl/nl/producten/wpl-09-acs-classic.html");
});

test("de linktekst komt zonder opmaak terug", () => {
  // <b>Classic</b> middenin de tekst mag geen tags in het logboek opleveren.
  const links = linksMetTekst(CATEGORIE, "wpl-09", { basis: BASIS });
  assert.equal(links[0].tekst, "WPL 09 ACS Classic Compact Set 1.1");
});

test("het patroon slaat op het adres of op de linktekst", () => {
  // "elders" staat alleen in het adres, "Garantie" alleen in de tekst.
  assert.equal(linksMetTekst(CATEGORIE, "elders", { basis: BASIS }).length, 1);
  assert.equal(linksMetTekst(CATEGORIE, "garantie", { basis: BASIS }).length, 1);
});

test("ankers, javascript en mailto wijzen niet naar een pagina", () => {
  const alles = linksMetTekst(CATEGORIE, "", { basis: BASIS });
  assert.ok(!alles.some((l) => /#top|javascript:/i.test(l.url)));
});

test("hetzelfde adres komt één keer terug", () => {
  // De 07 staat twee keer in de lijst, met verschillende linktekst.
  const links = linksMetTekst(CATEGORIE, "wpl-07", { basis: BASIS });
  assert.equal(links.length, 1);
});

test("zonder basis blijven alleen absolute adressen over", () => {
  // Anders staat er "/nl/producten/..." in het logboek, en daar kun je niets mee.
  const links = linksMetTekst(CATEGORIE, "wpl");
  assert.deepEqual(links.map((l) => l.url), ["https://www.elders.nl/wpl-13"]);
});

test("entiteiten in de linktekst worden opgelost", () => {
  // Stiebel schrijft "4,06&nbsp;kW WPL 09 ACS classic" in de linktekst.
  const html = '<a href="/p/wpl-09.html">4,06&nbsp;kW WPL 09 ACS classic</a>';
  const links = linksMetTekst(html, "wpl-09", { basis: "https://x.nl/a/b.html" });
  assert.equal(links[0].tekst, "4,06 kW WPL 09 ACS classic");
});

/* De rem op het prijsveld.
 *
 * Bij Thuisbatterij.nl stonden in september drie verschillende producten op
 * hetzelfde bedrag (1.650) en bij het nakijken was dat inmiddels 849 - weer op
 * alle drie. Die winkel bouwt zijn prijzen met JavaScript, dus een kaal
 * verzoek ziet geen enkel zichtbaar bedrag en alleen een veld dat "price" heet
 * en overal dezelfde waarde draagt. Het ergste daaraan was niet het foute
 * bedrag maar wat het verdrong: er stond een prijs, dus de terugval naar een
 * echte browser sloeg nooit aan.
 */
test("prijsveldMetDekking: zonder zichtbaar bedrag telt het veld niet", () => {
  const jsPagina = `<html><body><h1>Marstek Venus E 3.0</h1>
    <div id="app"></div>
    <script>window.__DATA__ = {"price": 849};</script></body></html>`;
  assert.equal(prijsUitJsonVeld(jsPagina), 849, "het veld staat er wel");
  assert.equal(prijsveldMetDekking(jsPagina), null, "maar de pagina bevestigt het nergens");
});

test("prijsveldMetDekking: met een zichtbaar bedrag telt het veld gewoon", () => {
  const gewonePagina = `<html><body><h1>Marstek Venus E 3.0</h1>
    <p>Nu voor &euro; 1.199,00 inclusief btw.</p>
    <script>{"price":1199}</script></body></html>`;
  assert.equal(prijsveldMetDekking(gewonePagina), 1199);
});

test("prijsveldMetDekking: geen veld blijft geen prijs", () => {
  assert.equal(prijsveldMetDekking(`<p>&euro; 1.199</p>`), null);
});

test("prijsUitPagina kiest het prijsveld niet op een pagina zonder bedragen", () => {
  const jsPagina = `<html><body><h1>Indevolt SolidFlex 3000</h1>
    <script>window.__DATA__ = {"price": 849};</script></body></html>`;
  assert.equal(prijsUitPagina(jsPagina, "Indevolt SolidFlex 3000").prijs, null);
});

test("meerdere naalden met | geven de links die op een van de naalden passen", () => {
  const links = linksMetTekst(CATEGORIE, "wpl-09|garantie", { basis: BASIS });
  assert.deepEqual(
    links.map((l) => l.url),
    [
      "https://www.stiebel-eltron.nl/nl/producten/wpl-09-acs-classic.html",
      "https://www.stiebel-eltron.nl/nl/service/garantie.html",
    ],
  );
});

test("een lege naald tussen de strepen vangt niet ineens alles", () => {
  // "wpl-09||" mag niet als "elke link" gelezen worden.
  const links = linksMetTekst(CATEGORIE, "wpl-09||", { basis: BASIS });
  assert.equal(links.length, 1);
});

/* Varianten bij WooCommerce, zoals Thuisbatterij.nl ze toont: de eerste
 * variant in de lijst is een losse module (849), voorgeselecteerd staat de
 * uitvoering van 5 kWh zonder meter (1.199,95). */
const wooPagina = (selectie) => {
  const varianten = [
    { attributes: { attribute_pa_opslag: "module-2-kwh", attribute_pa_meter: "" }, display_price: 849 },
    { attributes: { attribute_pa_opslag: "venus-5-kwh", attribute_pa_meter: "eigen-meter" }, display_price: 1199.95 },
    { attributes: { attribute_pa_opslag: "venus-5-kwh", attribute_pa_meter: "p1-meter" }, display_price: 1299 },
  ];
  const attr = JSON.stringify(varianten).replace(/"/g, "&quot;");
  const opt = (naam, waarden) => `<select name="attribute_pa_${naam}"><option value="">Kies</option>${waarden.map((w) => `<option value="${w}"${selectie.includes(w) ? " selected='selected'" : ""}>${w}</option>`).join("")}</select>`;
  return `<form class="variations_form" data-product_variations="${attr}">${opt("opslag", ["module-2-kwh", "venus-5-kwh"])}${opt("meter", ["eigen-meter", "p1-meter"])}</form>
    <p>€ 849,00 - € 1.299,00</p><script>{"price":849}</script>`;
};

test("prijsUitWooVariaties: de voorgeselecteerde variant, niet de eerste", () => {
  assert.equal(prijsUitWooVariaties(wooPagina(["venus-5-kwh", "eigen-meter"])), 1200);
  assert.equal(prijsUitPagina(wooPagina(["venus-5-kwh", "eigen-meter"]), "Marstek Venus E", { route: "gekozen variant" }).prijs, 1200);
});

test("prijsUitWooVariaties: een lege waarde in een variant past op elke keuze", () => {
  assert.equal(prijsUitWooVariaties(wooPagina(["module-2-kwh", "p1-meter"])), 849);
});

test("prijsUitWooVariaties: zonder voorselectie, of met meer dan één passende variant, geen prijs", () => {
  assert.equal(prijsUitWooVariaties(wooPagina([])), null);
  assert.equal(prijsUitWooVariaties(wooPagina(["venus-5-kwh"])), null, "5 kWh met en zonder meter passen allebei");
});

test("prijsUitPagina: de route van de gekozen variant alleen op verzoek, en een gevraagde route is de enige", () => {
  const html = wooPagina(["venus-5-kwh", "eigen-meter"]);
  assert.notEqual(prijsUitPagina(html, "Marstek Venus E").hoe, "gekozen variant", "zonder verzoek de gewone volgorde");
  const metaPagina = `<meta property="og:price:amount" content="789"><script>{"name":"SolarVault 3 BP2500","price":609}</script>`;
  assert.deepEqual(prijsUitPagina(metaPagina, "SolarVault 3", { route: "meta-tag" }).prijs, 789);
  assert.equal(prijsUitPagina(metaPagina, "SolarVault 3", { route: "structured data" }).prijs, null);
});

test("prijsBijVariant: het bedrag direct na de genoemde uitvoering", () => {
  const capaciteiten = "<p>Prijzen exclusief installatie 4,6 kWh: &euro; 1.495 9,2 kWh: &euro; 2.990 13,8 kWh: &euro; 4.485</p>";
  assert.equal(prijsBijVariant(capaciteiten, { variant: "9,2 kWh" }), 2990);
  const keuzelijst = `<select><option selected>MAU 5000 / Zelf ophalen - €849,00</option><option>MAU 5000 / Powerness Express - €899,00</option><option>MAU 5000 / Standaardverzending - €1.449,00</option></select>`;
  assert.equal(prijsBijVariant(keuzelijst, { variant: "Powerness Express" }), 899);
  assert.equal(prijsBijVariant(keuzelijst, { variant: "Bestaat niet" }), null);
  assert.equal(prijsUitPagina(keuzelijst, "TSUN MAU 5000", { route: "bij variant", variant: "Powerness Express" }).prijs, 899);
  assert.notEqual(prijsUitPagina(keuzelijst, "TSUN MAU 5000").hoe, "bij variant", "alleen op verzoek");
});

test("de btw-controle van de prijsscripts: alleen een eenduidige pagina, heffingen tellen niet", () => {
  assert.equal(btwVolgensPagina("<p>€ 1.000,00 incl. btw</p>"), true);
  assert.equal(btwVolgensPagina("<p>€ 826,45 excl. btw</p>"), false);
  assert.equal(btwVolgensPagina("<p>Geen woord over belasting.</p>"), null);
  // Multi Solar: de Bebat-bijdrage "per kg excl. btw" zegt niets over de prijs.
  assert.equal(btwVolgensPagina("<p>€ 1.299 incl. btw.</p><p>Bebat-bijdrage per kg excl. btw.</p>"), true);
  // NKON: een bijschrift excl. btw onder een prijs incl. btw.
  assert.equal(btwVolgensPagina("<p>€ 1.924,95</p><p>excl. btw: € 1.590,87</p>"), null);
});
