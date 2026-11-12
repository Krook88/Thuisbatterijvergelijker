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
 * productpagina schrijft. Schijnkortingen komen per winkel uit
 * PrijsGrafiek.schijnkortingen, net als het label in de winkeltabel. Zo kan
 * de pagina nooit iets anders zeggen dan de productpagina.
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
export function dealOverzicht({ items, PrijsGrafiek, esc, eur, datum, woorden, extraTips = [], extraVragen = [] }) {
  const rijen = items
    .map((it) => ({ ...it, d: PrijsGrafiek.dealcheck(it.id) }))
    .filter((r) => r.d);
  const per = (soort) => rijen.filter((r) => r.d.soort === soort);
  const deals = rijen.filter((r) => GOED.has(r.d.soort)).sort((a, b) => b.d.procent - a.d.procent);
  // Per winkel: een schijnkorting is iets wat één winkel doet.
  const schijn = items
    .flatMap((it) => PrijsGrafiek.schijnkortingen(it.id).map((s) => ({ ...it, s })))
    .sort((a, b) => (b.s.vorige - b.s.nu) - (a.s.vorige - a.s.nu));
  const schijnModellen = new Set(schijn.map((r) => r.id)).size;
  const boven = per("boven").sort((a, b) => a.d.procent - b.d.procent);
  const telling = {
    gevolgd: rijen.length,
    laagste: per("laagste").length,
    daling: per("daling").length,
    schijnkorting: schijnModellen,
    boven: boven.length,
    normaal: per("normaal").length,
    teKort: per("te-kort").length,
    nietTeKoop: per("niet-te-koop").length,
  };
  const pct = (n) => `${Number(n).toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%`;
  const model = (r) => `<a href="${esc(r.url)}">${esc(r.naam)}</a>`;
  const label = (r) => {
    const tekst = { laagste: "laagste ooit gemeten", daling: "echte daling", boven: "duurder" }[r.d.soort];
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
    ? `<p>${schijn.length === 1 ? "Deze winkel vraagt" : `Deze ${schijn.length} winkels vragen`} minder dan de dag ervoor. Volgens de wettelijke 30-dagenregel is het toch geen korting, want in de 30 dagen daarvoor vroeg ${schijn.length === 1 ? "dezelfde winkel" : "elke winkel zelf"} al hetzelfde bedrag of minder. Meestal ging de prijs eerst omhoog. Op de pagina van het model staat het label bij die winkel.</p>
  ${tabel(["Model", "Winkel", "Nu", "Prijs ervoor", "Al eerder voor"], schijn.map((r) =>
    `<tr><td>${model(r)}<br><small>verlaagd op ${sinds(r.s.sinds)}</small></td><td>${esc(r.s.winkel)}</td><td class="cijfer"><b>${esc(eur(r.s.nu))}</b></td><td class="cijfer">${esc(eur(r.s.vorige))}</td><td class="cijfer">${esc(eur(r.s.ref))}</td></tr>`))}`
    : `<p>Vandaag zie ik bij geen enkele winkel een ${E} die eerst is opgehoogd en daarna "afgeprijsd". Gebeurt dat in aanloop naar ${esc(datum(BLACK_FRIDAY))}, dan komt het hier te staan.</p>`;

  const bovenBlok = boven.length
    ? `<p>Bij ${boven.length === 1 ? `deze ${E}` : `deze ${boven.length} modellen`} betaal je vandaag meer dan de laagste prijs van de afgelopen 30 dagen. Een korting die de winkel er toch bij zet, rekent dus vanaf een opgehoogde prijs.</p>
  ${tabel(["Model", "Nu", "Laagste 30 dagen ervoor", "Duurder"], boven.map((r) =>
    `<tr><td>${model(r)}</td><td class="cijfer"><b>${esc(eur(r.d.nu))}</b></td><td class="cijfer">${esc(eur(r.d.ref))}</td><td class="cijfer">${esc(pct(-r.d.procent))}</td></tr>`))}`
    : `<p>Vandaag is geen enkele ${E} duurder dan de laagste prijs van de 30 dagen ervoor.</p>`;

  /* Vragen zoals mensen ze intikken. Het antwoord is platte tekst, want het
     gaat ook letterlijk de FAQ-markup in; de zichtbare tekst en de markup
     zijn zo altijd gelijk. De getallen zijn die van vandaag. */
  const vragen = [
    {
      vraag: `Zijn Black Friday-kortingen op ${woorden.meervoud} echt?`,
      antwoord: `Lang niet altijd. Van de ${telling.gevolgd} modellen die ik volg, ${deals.length === 1 ? "is er vandaag één" : `zijn er vandaag ${deals.length}`} echt goedkoper dan de laagste prijs van de 30 dagen ervoor${schijnModellen ? `, en bij ${schijnModellen === 1 ? "één ervan" : `${schijnModellen} ervan`} heeft een winkel een schijnkorting, een prijs die bij die winkel eerst omhoog ging en daarna weer zakte` : ""}. Een doorgestreepte adviesprijs bij de winkel zegt daar niets over.`,
    },
    {
      vraag: `Hoe zie ik of een korting op een ${woorden.enkel} echt is?`,
      antwoord: `Vergelijk de prijs met de laagste prijs van de 30 dagen voor de verlaging. De adviesprijs zegt daar niets over. Winkels moeten die laagste prijs volgens de Omnibus-richtlijn zelf noemen als ze een korting aankondigen. Op deze pagina en op de pagina van elke ${woorden.enkel} doe ik die toets elke ochtend met mijn eigen metingen.`,
    },
    ...extraVragen,
  ];
  const faqLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": vragen.map((v) => ({ "@type": "Question", "name": v.vraag, "acceptedAnswer": { "@type": "Answer", "text": v.antwoord } })),
  }, null, 2);
  const vragenHtml = vragen.map((v) => `  <h2>${esc(v.vraag)}</h2>
  <p>${esc(v.antwoord)}</p>`).join("\n\n");

  const html = `
  <h2 id="echte-deals">Echte deals vandaag</h2>
  ${dealBlok}

  <h2 id="schijnkortingen">Pas op voor schijnkortingen</h2>
  ${schijnBlok}

  <h2 id="duurder">Nu duurder dan normaal</h2>
  ${bovenBlok}

${vragenHtml}

  <h2 id="dealcheck-uitleg">Hoe ik een deal toets</h2>
  <p>De van-prijs van de winkel laat ik links liggen. Ik kijk naar wat ik zelf gemeten heb, elke ochtend de laagste winkelprijs incl. btw van elke ${E}, sinds augustus 2026. Daarop pas ik de regel toe die winkels sinds 28 mei 2022 zelf moeten volgen (de Omnibus-richtlijn, artikel 6a van de Prijsaanduidingsrichtlijn). Een korting telt alleen ten opzichte van de laagste prijs van de 30 dagen vóór de verlaging.</p>
  <ul>
    <li><b>Echte daling</b> betekent dat de prijs van vandaag minstens ${drempel} onder de laagste prijs ligt van de 30 dagen voordat hij ging gelden. Minder reken ik niet mee, want dat is op een ${E} van € 1.500 nog geen € 30.</li>
    <li><b>Laagste ooit gemeten</b> is een echte daling waarbij het model ook goedkoper is dan elke prijs die ik er eerder voor zag.</li>
    <li><b>Schijnkorting</b> is een winkel die minder vraagt dan de dag ervoor, maar niet minder dan hij zelf in de 30 dagen daarvoor al vroeg. Dat toets ik per winkel. Komt er een goedkopere winkel bij, of is een andere winkel nu de goedkoopste, dan is dat geen schijnkorting, want niemand verhoogde eerst zijn prijs.</li>
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

  return { html, telling, deals, schijn, boven, vragen, faqLd };
}
