/**
 * De Black Friday-pagina: welke prijs is vandaag echt lager, en welke niet.
 *
 * Waarom dit bestaat: rond Black Friday (vrijdag 27 november 2026) en Cyber
 * Monday (maandag 30 november) staat bij bijna elke winkel een doorgestreepte
 * van-prijs. Die zegt weinig. Vaak is het een adviesprijs die niemand
 * betaalde, en soms is de prijs een week eerder opgehoogd zodat de korting
 * groter lijkt. Een bezoeker kan dat bij de winkel niet zien; wij wel, want
 * de dagelijkse prijsrun houdt sinds augustus 2026 per model de laagste
 * winkelprijs bij (data/prijsverloop.json).
 *
 * Het oordeel per model komt uit PrijsGrafiek.dealcheck (kern/assets/
 * prijsgrafiek.js), dezelfde functie die het blokje boven de grafiek op de
 * productpagina schrijft. Zo kan de pagina nooit iets anders zeggen dan de
 * productpagina.
 *
 * Dit bestand maakt alleen de inhoud van <main>. De kop, het menu en de voet
 * verschillen per site en blijven in de generator van die site.
 */

export const BLACK_FRIDAY = "2026-11-27";
export const CYBER_MONDAY = "2026-11-30";

const GOED = new Set(["laagste", "daling"]);

/**
 * items: [{ id, naam, url }] - alle modellen van de site.
 * woorden: { enkel: "thuisbatterij", meervoud: "thuisbatterijen" }
 * Geeft { html, telling, deals } terug.
 */
export function dealOverzicht({ items, PrijsGrafiek, esc, eur, datum, woorden, extraTips = [] }) {
  const rijen = items
    .map((it) => ({ ...it, d: PrijsGrafiek.dealcheck(it.id) }))
    .filter((r) => r.d);
  const per = (soort) => rijen.filter((r) => r.d.soort === soort);
  const deals = rijen.filter((r) => GOED.has(r.d.soort)).sort((a, b) => b.d.procent - a.d.procent);
  const schijn = per("schijnkorting").sort((a, b) => (b.d.vorige - b.d.nu) - (a.d.vorige - a.d.nu));
  const boven = per("boven").sort((a, b) => a.d.procent - b.d.procent);
  const telling = {
    gevolgd: rijen.length,
    laagste: per("laagste").length,
    daling: per("daling").length,
    schijnkorting: schijn.length,
    boven: boven.length,
    normaal: per("normaal").length,
    teKort: per("te-kort").length,
    nietTeKoop: per("niet-te-koop").length,
  };
  const pct = (n) => `${Number(n).toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%`;
  const model = (r) => `<a href="${esc(r.url)}">${esc(r.naam)}</a>`;
  const label = (r) => {
    const tekst = { laagste: "laagste ooit gemeten", daling: "echte daling", schijnkorting: "schijnkorting", boven: "duurder" }[r.d.soort];
    return `<span class="deal-label deal-label-${r.d.soort}">${esc(tekst)}</span>`;
  };
  const tabel = (kop, regels) => `<div class="tabel-blok"><table class="data-tabel deal-tabel">
    <thead><tr>${kop.map((k) => `<th scope="col">${esc(k)}</th>`).join("")}</tr></thead>
    <tbody>${regels.join("")}</tbody>
  </table></div>`;
  const sinds = (d) => esc(datum(d));

  const M = esc(woorden.meervoud);
  const E = esc(woorden.enkel);
  const drempel = pct(PrijsGrafiek.DEAL_DREMPEL);
  const dealBlok = deals.length
    ? `<p>Vandaag ${deals.length === 1 ? `is er één ${E}` : `zijn er ${deals.length} modellen`} waarvan de laagste winkelprijs minstens ${drempel} onder de laagste prijs van de 30 dagen ervoor ligt${telling.laagste ? `. ${telling.laagste === 1 ? "Eén daarvan staat" : `${telling.laagste} daarvan staan`} op de laagste prijs sinds ik ze volg` : ""}. De grootste daling staat bovenaan.</p>
  ${tabel(["Model", "Nu", "Laagste 30 dagen ervoor", "Lager"], deals.map((r) =>
    `<tr><td>${model(r)}<br>${label(r)} <small>sinds ${sinds(r.d.sinds)}</small></td><td class="cijfer"><b>${esc(eur(r.d.nu))}</b></td><td class="cijfer">${esc(eur(r.d.ref))}</td><td class="cijfer">${esc(pct(r.d.procent))}</td></tr>`))}`
    : `<p>Vandaag ligt bij geen van de ${telling.gevolgd} gevolgde modellen de laagste winkelprijs minstens ${drempel} onder de laagste prijs van de 30 dagen ervoor. Ik reken deze lijst elke ochtend opnieuw uit, dus kijk in de week van ${esc(datum(BLACK_FRIDAY))} nog eens.</p>`;

  const schijnBlok = schijn.length
    ? `<p>Bij ${schijn.length === 1 ? `deze ${E}` : `deze ${schijn.length} modellen`} is de prijs gezakt ten opzichte van de dag ervoor. Volgens de wettelijke 30-dagenregel is het toch geen korting, want in de 30 dagen daarvoor stond ${schijn.length === 1 ? "hij" : "elk van deze modellen"} al voor hetzelfde bedrag of minder te koop. Meestal ging de prijs eerst omhoog.</p>
  ${tabel(["Model", "Nu", "Prijs ervoor", "Al eerder voor"], schijn.map((r) =>
    `<tr><td>${model(r)}<br><small>verlaagd op ${sinds(r.d.sinds)}</small></td><td class="cijfer"><b>${esc(eur(r.d.nu))}</b></td><td class="cijfer">${esc(eur(r.d.vorige))}</td><td class="cijfer">${esc(eur(r.d.ref))}</td></tr>`))}`
    : `<p>Vandaag zie ik bij geen enkele ${E} een prijs die eerst is opgehoogd en daarna "afgeprijsd". Gebeurt dat in aanloop naar ${esc(datum(BLACK_FRIDAY))}, dan komt het hier te staan.</p>`;

  const bovenBlok = boven.length
    ? `<p>Bij ${boven.length === 1 ? `deze ${E}` : `deze ${boven.length} modellen`} betaal je vandaag meer dan de laagste prijs van de afgelopen 30 dagen. Een korting die de winkel er toch bij zet, rekent dus vanaf een opgehoogde prijs.</p>
  ${tabel(["Model", "Nu", "Laagste 30 dagen ervoor", "Duurder"], boven.map((r) =>
    `<tr><td>${model(r)}</td><td class="cijfer"><b>${esc(eur(r.d.nu))}</b></td><td class="cijfer">${esc(eur(r.d.ref))}</td><td class="cijfer">${esc(pct(-r.d.procent))}</td></tr>`))}`
    : `<p>Vandaag is geen enkele ${E} duurder dan de laagste prijs van de 30 dagen ervoor.</p>`;

  const html = `
  <h2 id="echte-deals">Echte deals vandaag</h2>
  ${dealBlok}

  <h2 id="schijnkortingen">Pas op voor schijnkortingen</h2>
  ${schijnBlok}

  <h2 id="duurder">Nu duurder dan normaal</h2>
  ${bovenBlok}

  <h2 id="dealcheck-uitleg">Hoe ik een deal toets</h2>
  <p>De van-prijs van de winkel laat ik links liggen. Ik kijk naar wat ik zelf gemeten heb, elke ochtend de laagste winkelprijs incl. btw van elke ${E}, sinds augustus 2026. Daarop pas ik de regel toe die winkels sinds 28 mei 2022 zelf moeten volgen (de Omnibus-richtlijn, artikel 6a van de Prijsaanduidingsrichtlijn). Een korting telt alleen ten opzichte van de laagste prijs van de 30 dagen vóór de verlaging.</p>
  <ul>
    <li><b>Echte daling</b> betekent dat de prijs van vandaag minstens ${drempel} onder de laagste prijs ligt van de 30 dagen voordat hij ging gelden. Minder reken ik niet mee, want dat is op een ${E} van € 1.500 nog geen € 30.</li>
    <li><b>Laagste ooit gemeten</b> is een echte daling waarbij het model ook goedkoper is dan elke prijs die ik er eerder voor zag.</li>
    <li><b>Schijnkorting</b> is een prijs die lager is dan de dag ervoor, maar niet lager dan de laagste prijs van de 30 dagen daarvoor.</li>
    <li><b>Te kort gevolgd</b> zegt dat ik in die 30 dagen minder dan 14 dagen een prijs heb gemeten. Dan doe ik geen uitspraak.</li>
  </ul>
  <p>Van de ${telling.gevolgd} modellen met een prijsverloop staan er vandaag ${telling.normaal} op hun gewone prijs, ${telling.teKort} volg ik nog te kort en ${telling.nietTeKoop} zijn bij geen winkel te koop. Op de pagina van elke ${E} staat het volledige verloop als grafiek, met per winkel wat die vroeg.</p>

  <h2 id="checklist">${["Vier", "Vijf", "Zes", "Zeven"][extraTips.length] || "Wat"} dingen om na te gaan voor je een ${E} bestelt</h2>
  <ul>
    <li><b>Is het dezelfde set?</b> Een lage prijs voor een ${E} is soms een kale unit zonder de meter, de kabel of het montagemateriaal dat bij de gewone prijs zat. Bij een andere samenstelling reken ik geen korting, de winkel doet dat vaak wel.</li>
    <li><b>Is het bedrag incl. btw?</b> Groothandels tonen hun ${M} vaak excl. 21% btw. Alle bedragen op deze pagina zijn incl. btw.</li>
    <li><b>Koop je bij een erkende verkoper?</b> De fabrieksgarantie op een ${E} loopt vaak alleen via de officiële dealer. Lees bij een onbekende webwinkel eerst de voorwaarden over garantie en retour.</li>
    <li><b>Kun je terugsturen?</b> Online heb je in Nederland 14 dagen bedenktijd, behalve voor een ${E} die al geïnstalleerd is.</li>
    ${extraTips.map((t) => `<li>${t}</li>`).join("\n    ")}
  </ul>`;

  return { html, telling, deals, schijn, boven };
}
