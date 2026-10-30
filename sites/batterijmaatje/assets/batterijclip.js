/**
 * Uitlegclip "Thuisbatterij: wel of niet?"
 *
 * Een korte, zelflopende uitleg in zeven scènes (67 seconden) die op alle drie
 * de sites op de uitlegpagina staat. Hij zegt overal hetzelfde, net als een
 * filmpje dat je op drie plekken insluit; daarom staat de tekst hier in het
 * script en niet in de HTML, en schrijft elke pagina zelf een eigen inleiding.
 *
 * Insluiten:
 *   <div class="batterijclip" data-cta-href="rekenmodule.html"
 *        data-cta-tekst="Reken jouw terugverdientijd uit"> ...terugval... </div>
 *
 * Wat in het element staat, is de terugval zonder javascript; het script
 * vervangt het. De getallen komen uit de sites zelf: 30 procent eigen
 * verbruik en 5,6 kWh per avond bij 2.900 kWh (uitleg batterijmaatje),
 * € 0,30 en € 0,07 per kWh (rekenvoorbeeld zonnestroommaatje), 6.000
 * laadcycli (woordenlijst batterijmaatje).
 *
 * Opmaak volgt de maatlat: alleen tekstmaten en rondingen van de ladder, want
 * de keuring meet het. Bij "minder beweging" in het systeem speelt hij niet
 * vanzelf; dan blader je met de hoofdstukknoppen en staat elk beeld stil in
 * zijn eindtoestand.
 */
(function () {
  "use strict";

  const houders = document.querySelectorAll(".batterijclip");
  if (!houders.length) return;

  const CSS = `
.batterijclip{container-type:inline-size;margin:var(--ruimte-28) 0;border:1px solid var(--kleur-rand);border-radius:var(--radius);background:var(--kleur-wit);overflow:hidden}
.batterijclip .bc-buhne{display:grid;padding:var(--ruimte-20);cursor:pointer}
.batterijclip .bc-scene{grid-area:1/1;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:var(--ruimte-20);align-items:center;opacity:0;visibility:hidden;transition:opacity .4s ease,visibility 0s linear .4s}
.batterijclip .bc-scene.bc-actief{opacity:1;visibility:visible;transition:opacity .4s ease}
.batterijclip .bc-breed{grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start}
.batterijclip .bc-breed .bc-woord{grid-column:1/-1}
.batterijclip .bc-woord{min-width:0}
.batterijclip .bc-label{margin:0;font-size:var(--tekst-12);font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--kleur-tekst-licht)}
.batterijclip .bc-kop{margin:var(--ruimte-6) 0 var(--ruimte-10);font-size:var(--tekst-22);font-weight:800;line-height:1.25;color:var(--kleur-inkt);text-wrap:balance}
.batterijclip .bc-tekst{margin:0;line-height:1.6}
.batterijclip .bc-beeld{min-width:0;display:flex;justify-content:center}
.batterijclip .bc-beeld svg{width:100%;max-width:440px}
.batterijclip .bc-rijen{display:grid;gap:var(--ruimte-14);width:100%}
.batterijclip .bc-rij{display:grid;gap:var(--ruimte-4);font-size:var(--tekst-15)}
.batterijclip .bc-rij b{color:var(--kleur-inkt)}
.batterijclip .bc-spoor{height:20px;background:var(--kleur-achtergrond);border-radius:var(--radius-mini);overflow:hidden}
.batterijclip .bc-vul{height:100%;width:var(--w);border-radius:var(--radius-mini)}
.batterijclip .bc-noot{font-size:var(--tekst-15);color:var(--kleur-tekst-licht)}
.batterijclip .bc-accu{display:flex;align-items:center;gap:var(--ruimte-28);width:100%;justify-content:center}
.batterijclip .bc-cel{position:relative;flex:none;width:72px;height:140px;border:5px solid var(--kleur-primair);border-radius:var(--radius);padding:var(--ruimte-4);display:flex;align-items:flex-end}
.batterijclip .bc-cel::before{content:"";position:absolute;top:-12px;left:22px;width:18px;height:7px;background:var(--kleur-primair)}
.batterijclip .bc-lading{width:100%;height:20%;border-radius:var(--radius-mini);background:var(--kleur-accent-donker)}
.batterijclip .bc-stappen{display:grid;gap:var(--ruimte-10);min-width:0}
.batterijclip .bc-stap{border:2px solid var(--kleur-rand);border-radius:var(--radius);padding:var(--ruimte-10) var(--ruimte-14);font-size:var(--tekst-15)}
.batterijclip .bc-stap b{display:block;color:var(--kleur-inkt)}
.batterijclip .bc-seizoenen{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--ruimte-14);width:100%}
.batterijclip .bc-seizoen{border:1px solid var(--kleur-rand);border-radius:var(--radius);padding:var(--ruimte-10);display:grid;gap:var(--ruimte-6);font-size:var(--tekst-15)}
.batterijclip .bc-seizoen b{color:var(--kleur-inkt)}
.batterijclip .bc-lijst{border-radius:var(--radius);padding:var(--ruimte-14);font-size:var(--tekst-15)}
.batterijclip .bc-wel{background:var(--kleur-groen-licht)}
.batterijclip .bc-niet{background:var(--kleur-accent-licht)}
.batterijclip .bc-lijst b{display:block;font-size:var(--tekst-19);color:var(--kleur-inkt)}
.batterijclip .bc-lijst ul{margin:var(--ruimte-6) 0 0;padding-left:var(--ruimte-20);line-height:1.5}
.batterijclip .bc-som{display:grid;gap:var(--ruimte-10);width:100%}
.batterijclip .bc-invoer{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--ruimte-10)}
.batterijclip .bc-chip{border:1px solid var(--kleur-rand);border-radius:var(--radius);padding:var(--ruimte-10);font-size:var(--tekst-15);text-align:center}
.batterijclip .bc-uitkomst{background:var(--kleur-primair-licht);border-radius:var(--radius);padding:var(--ruimte-14);font-size:var(--tekst-15)}
.batterijclip .bc-uitkomst b{display:block;font-size:var(--tekst-19);color:var(--kleur-inkt)}
.batterijclip .bc-cta{justify-self:start;background:var(--kleur-primair);color:var(--kleur-wit);font-weight:700;text-decoration:none;border-radius:var(--radius-klein);padding:var(--ruimte-10) var(--ruimte-20)}
.batterijclip .bc-balk{display:flex;flex-wrap:wrap;align-items:center;gap:var(--ruimte-10);padding:var(--ruimte-10) var(--ruimte-20);border-top:1px solid var(--kleur-rand)}
.batterijclip .bc-knop{font-size:var(--tekst-15);font-weight:600;color:var(--kleur-inkt);background:var(--kleur-wit);border:1px solid var(--kleur-rand);border-radius:var(--radius-klein);padding:var(--ruimte-6) var(--ruimte-14);cursor:pointer}
.batterijclip .bc-knop[aria-current="true"]{background:var(--kleur-primair);border-color:var(--kleur-primair);color:var(--kleur-wit)}
.batterijclip .bc-voortgang{flex:1 1 120px;height:6px;background:var(--kleur-rand);border-radius:var(--radius-mini);overflow:hidden}
.batterijclip .bc-voortgang span{display:block;height:100%;width:0;background:var(--kleur-primair)}
.batterijclip .bc-tijd{font-size:var(--tekst-15);color:var(--kleur-tekst-licht);font-variant-numeric:tabular-nums}
.batterijclip .bc-hoofdstukken{display:flex;flex-wrap:wrap;gap:var(--ruimte-6);padding:0 var(--ruimte-20) var(--ruimte-14)}
.batterijclip .bc-hoofdstukken .bc-knop{font-weight:400}
.batterijclip .bc-zon{transform-box:view-box;transform-origin:200px 215px}
.batterijclip .bc-groei{transform-box:fill-box;transform-origin:50% 100%}
@container (max-width: 620px){
  .batterijclip .bc-scene,.batterijclip .bc-breed{grid-template-columns:minmax(0,1fr);align-items:start}
  .batterijclip .bc-buhne{padding:var(--ruimte-14)}
  .batterijclip .bc-scene{align-content:start}
  .batterijclip .bc-hoofdstukken{flex-wrap:nowrap;overflow-x:auto}
  .batterijclip .bc-hoofdstukken .bc-knop{flex:none}
}
@keyframes bc-op{from{transform:translateY(10px);opacity:.3}to{transform:none;opacity:1}}
@keyframes bc-in{from{opacity:0}to{opacity:1}}
@keyframes bc-zonbaan{from{transform:rotate(-62deg)}to{transform:rotate(62deg)}}
@keyframes bc-stroom{to{stroke-dashoffset:-15}}
@keyframes bc-teken{from{stroke-dashoffset:900}to{stroke-dashoffset:0}}
@keyframes bc-groei{from{transform:scaleY(0)}to{transform:scaleY(1)}}
@keyframes bc-breedte{from{width:0}to{width:var(--w)}}
@keyframes bc-laden{0%{height:12%;background:var(--kleur-groen)}45%{height:94%;background:var(--kleur-groen)}58%{height:94%;background:var(--kleur-accent-donker)}100%{height:20%;background:var(--kleur-accent-donker)}}
@keyframes bc-dag{0%,52%{border-color:var(--kleur-groen);background:var(--kleur-groen-licht)}60%,100%{border-color:var(--kleur-rand);background:var(--kleur-wit)}}
@keyframes bc-avond{0%,52%{border-color:var(--kleur-rand);background:var(--kleur-wit)}60%,100%{border-color:var(--kleur-accent-donker);background:var(--kleur-accent-licht)}}
.bc-beweegt .bc-actief .bc-woord>*{animation:bc-op .6s ease-out both}
.bc-beweegt .bc-actief .bc-woord>:nth-child(2){animation-delay:.15s}
.bc-beweegt .bc-actief .bc-woord>:nth-child(3){animation-delay:.35s}
.bc-beweegt .bc-actief .bc-zon{animation:bc-zonbaan 7s linear both}
.bc-beweegt .bc-actief .bc-stroomlijn{stroke-dasharray:6 9;animation:bc-stroom .9s linear infinite}
.bc-beweegt .bc-actief .bc-lijn{stroke-dasharray:900;animation:bc-teken 2.4s .5s ease-out both}
.bc-beweegt .bc-actief .bc-groei{animation:bc-groei 1.4s 2.4s ease-out both}
.bc-beweegt .bc-actief .bc-later{animation:bc-in .5s 4.2s both}
.bc-beweegt .bc-actief .bc-vul{animation:bc-breedte 1.1s 1s ease-out both}
.bc-beweegt .bc-actief .bc-rij+.bc-rij .bc-vul{animation-delay:2.6s}
.bc-beweegt .bc-actief .bc-lading{animation:bc-laden 7.5s .4s ease-in-out both}
.bc-beweegt .bc-actief .bc-dag{animation:bc-dag 7.5s .4s both}
.bc-beweegt .bc-actief .bc-avond{animation:bc-avond 7.5s .4s both}
.bc-beweegt .bc-actief .bc-lijst li{animation:bc-op .5s calc(var(--d) * .55s + .8s) ease-out both}
.bc-beweegt .bc-actief .bc-chip{animation:bc-in .45s calc(var(--d) * .35s + .4s) both}
.bc-beweegt .bc-actief .bc-uitkomst{animation:bc-in .5s 1.8s both}
.bc-beweegt .bc-actief .bc-cta{animation:bc-in .5s 2.8s both}
.batterijclip.bc-stil *{animation-play-state:paused}
`;

  /* Grafieken in gebruikerseenheden; kleuren komen uit de site zelf. */
  const kleur = (n) => `style="fill:var(--kleur-${n})"`;
  const lijnkleur = (n, dik) => `style="fill:none;stroke:var(--kleur-${n});stroke-width:${dik};stroke-linejoin:round;stroke-linecap:round"`;
  const label = 'style="fill:var(--kleur-tekst-licht)"';

  const HUIS = `<svg viewBox="0 0 400 240" aria-hidden="true">
    <path d="M65 215 A135 135 0 0 1 335 215" ${lijnkleur("rand", 2)} stroke-dasharray="3 6"/>
    <g class="bc-zon"><circle cx="200" cy="80" r="17" ${kleur("accent")}/><circle cx="200" cy="80" r="27" ${kleur("accent")} opacity=".25"/></g>
    <line x1="20" y1="215" x2="380" y2="215" ${lijnkleur("inkt", 2)}/>
    <rect x="140" y="140" width="110" height="75" style="fill:var(--kleur-wit);stroke:var(--kleur-inkt);stroke-width:2.5"/>
    <polygon points="128,142 195,92 262,142" style="fill:var(--kleur-primair-licht);stroke:var(--kleur-inkt);stroke-width:2.5;stroke-linejoin:round"/>
    <polygon points="146,131 186,101 190,107 150,137" ${kleur("primair")}/>
    <polygon points="204,101 244,131 240,137 200,107" ${kleur("primair")}/>
    <rect x="182" y="175" width="26" height="40" style="fill:var(--kleur-primair-licht);stroke:var(--kleur-inkt);stroke-width:2"/>
    <rect x="152" y="158" width="20" height="18" style="fill:var(--kleur-accent-licht);stroke:var(--kleur-inkt);stroke-width:2"/>
    <rect x="218" y="158" width="20" height="18" style="fill:var(--kleur-accent-licht);stroke:var(--kleur-inkt);stroke-width:2"/>
    <path d="M335 215 L350 120 L365 215 M342 168 L358 168 M339 190 L361 190 M330 132 L370 132 M335 145 L365 145" ${lijnkleur("inkt", 2)}/>
    <path class="bc-stroomlijn" d="M252 168 C285 168 300 150 330 140" ${lijnkleur("groen", 3.5)}/>
    <text x="292" y="200" font-size="12" text-anchor="middle" ${label}>naar het net</text>
  </svg>`;

  const DAG = `<svg viewBox="0 0 480 290" aria-hidden="true">
    <path d="M145 40 V250 M250 40 V250 M355 40 V250" ${lijnkleur("rand", 1)} stroke-dasharray="2 5"/>
    <line x1="40" y1="250" x2="460" y2="250" ${lijnkleur("inkt", 1.5)}/>
    <g font-size="12" text-anchor="middle" ${label}><text x="40" y="270">0:00</text><text x="145" y="270">6:00</text><text x="250" y="270">12:00</text><text x="355" y="270">18:00</text><text x="460" y="270">24:00</text></g>
    <path class="bc-later" d="M337.5 250 L337.5 170 L372.5 105 L407.5 130 L442.5 205 L442.5 250 Z" ${kleur("accent-licht")}/>
    <path class="bc-groei" d="M145 250 C200 250 215 60 267.5 60 C320 60 335 250 390 250 Z" ${kleur("groen")} fill-opacity=".85"/>
    <path class="bc-lijn" d="M40 225 L145 222 L180 185 L215 215 L302.5 212 L337.5 170 L372.5 105 L407.5 130 L442.5 205 L460 220" ${lijnkleur("accent-donker", 4)}/>
    <g class="bc-later" font-size="14" font-weight="700" text-anchor="middle"><text x="267" y="150" ${kleur("wit")}>overschot</text><text x="420" y="92" ${kleur("accent-donker")}>tekort</text></g>
    <g font-size="12" ${label}><rect x="40" y="10" width="11" height="11" ${kleur("groen")}/><text x="57" y="20">opwek panelen</text><rect x="160" y="10" width="11" height="11" ${kleur("accent-donker")}/><text x="177" y="20">verbruik huis</text></g>
  </svg>`;

  /* Zomer- en winterdag op dezelfde schaal, zodat het verschil echt te zien is. */
  const seizoen = (bel, verbruik) => `<svg viewBox="-12 0 244 178" aria-hidden="true">
    <line x1="10" y1="160" x2="210" y2="160" ${lijnkleur("inkt", 1.2)}/>
    <path class="bc-groei" d="${bel}" ${kleur("groen")} fill-opacity=".85"/>
    <path class="bc-lijn" d="${verbruik}" ${lijnkleur("accent-donker", 3)}/>
    <g font-size="11" text-anchor="middle" ${label}><text x="10" y="173">0:00</text><text x="110" y="173">12:00</text><text x="210" y="173">24:00</text></g>
  </svg>`;

  const SCENES = [
    { duur: 7, naam: "De vraag", label: "Thuisbatterij: wel of niet?",
      kop: "Je panelen leveren het meest als je het minst gebruikt.",
      tekst: "Zonder batterij gebruikt een huishouden ongeveer 30 procent van de eigen zonnestroom meteen zelf. De rest gaat het net op.",
      beeld: HUIS },
    { duur: 10, naam: "Opwek en verbruik", label: "1 · Opwek en verbruik",
      kop: "Zon overdag, verbruik 's avonds.",
      tekst: "Zonnestroom piekt rond het middaguur. Je verbruik piekt tussen 17 en 21 uur, als je kookt, de warmtepomp draait en de auto aan de lader hangt.",
      beeld: DAG },
    { duur: 9, naam: "2027", label: "2 · Wat er verandert",
      kop: "Op 1 januari 2027 stopt het salderen.",
      tekst: "Een kWh die je zelf gebruikt, blijft zo'n 30 cent waard. Lever je hem terug, dan krijg je een paar cent, en veel leveranciers rekenen er terugleverkosten bij.",
      beeld: `<div class="bc-rijen">
        <div class="bc-rij"><span><b>Zelf gebruikt</b>, € 0,30 per kWh</span><div class="bc-spoor"><div class="bc-vul" style="--w:100%;background:var(--kleur-groen-donker)"></div></div></div>
        <div class="bc-rij"><span><b>Teruggeleverd vanaf 2027</b>, € 0,07 per kWh</span><div class="bc-spoor"><div class="bc-vul" style="--w:23%;background:var(--kleur-accent-donker)"></div></div></div>
        <span class="bc-noot">Afgeronde bedragen. De vergoeding verschilt per leverancier.</span>
      </div>` },
    { duur: 9, naam: "De batterij", label: "3 · Wat een batterij doet",
      kop: "Een batterij schuift je zonnestroom naar de avond.",
      tekst: "Bij 2.900 kWh verbruik per jaar gaat er buiten de zonuren zo'n 5,6 kWh per dag doorheen. Een batterij van ongeveer 6 kWh dekt dat.",
      beeld: `<div class="bc-accu">
        <div class="bc-cel" aria-hidden="true"><div class="bc-lading"></div></div>
        <div class="bc-stappen">
          <div class="bc-stap bc-dag"><b>Overdag laden</b>met het overschot van je panelen</div>
          <div class="bc-stap bc-avond"><b>'s Avonds ontladen</b>voor koken, warmtepomp en lader</div>
        </div>
      </div>` },
    { duur: 11, naam: "Zomer en winter", label: "4 · Zomer en winter",
      kop: "In juni te veel, in december te weinig.",
      tekst: "In december wekken panelen minder dan een vijfde op van wat ze in juni doen. 's Zomers is de batterij dus snel vol en gaat de rest alsnog het net op. 's Winters raakt hij nauwelijks vol, terwijl de warmtepomp dan het meest stroom vraagt.",
      beeld: `<div class="bc-seizoenen">
        <div class="bc-seizoen"><b>Juni</b>${seizoen("M51.7 160 C95 160 95 20 122.5 20 C150 20 150 160 193 160 Z", "M10 150 L60 148 L75 135 L90 148 L140 146 L160 120 L175 105 L190 118 L205 140 L210 148")}<span>Batterij snel vol, de rest gaat naar het net</span></div>
        <div class="bc-seizoen"><b>December</b>${seizoen("M80.8 160 C100 160 100 140 114 140 C128 140 128 160 147.5 160 Z", "M10 115 L60 112 L75 85 L95 100 L140 100 L160 70 L175 55 L190 65 L205 95 L210 105")}<span>Batterij laadt nauwelijks, de warmtepomp vraagt veel</span></div>
      </div>` },
    { duur: 13, naam: "Wel of niet", label: "5 · Jouw situatie", breed: true,
      kop: "Of het loont, hangt af van je huis.",
      beeld: `<div class="bc-lijst bc-wel"><b>Wel interessant als</b><ul>
          <li style="--d:0">je 's zomers veel teruglevert</li>
          <li style="--d:1">je veel 's avonds verbruikt, met een warmtepomp, elektrische auto of inductie</li>
          <li style="--d:2">je een dynamisch contract hebt, zodat hij 's winters goedkope nachtstroom kan opslaan</li>
        </ul></div>
        <div class="bc-lijst bc-niet"><b>Niet interessant als</b><ul>
          <li style="--d:3">je weinig panelen en dus weinig overschot hebt</li>
          <li style="--d:4">je verbruik kunt verschuiven, zoals de warmtepomp overdag het boilervat laten opwarmen</li>
          <li style="--d:5">de terugverdientijd langer is dan de levensduur</li>
        </ul></div>` },
    { duur: 8, naam: "Reken het door", label: "6 · Conclusie",
      kop: "Reken het eerst door.",
      tekst: "Bij 6.000 laadcycli en één cyclus per dag gaat een batterij ruim 15 jaar mee. Verdient hij zich binnen die tijd terug, dan is hij de moeite waard.",
      beeld: null },
  ];

  const tijd = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

  function slotbeeld(href, tekst) {
    return `<div class="bc-som">
      <div class="bc-invoer">
        <div class="bc-chip" style="--d:0">Je overschot overdag</div>
        <div class="bc-chip" style="--d:1">Je verbruik 's avonds</div>
        <div class="bc-chip" style="--d:2">Je contract</div>
      </div>
      <div class="bc-uitkomst"><b>Jouw terugverdientijd</b>Korter dan de levensduur? Dan loont het.</div>
      <a class="bc-cta" href="${esc(href)}">${esc(tekst)}</a>
    </div>`;
  }

  function bouw(houder) {
    const href = houder.dataset.ctaHref || "https://batterijmaatje.nl/rekenmodule.html";
    const ctaTekst = houder.dataset.ctaTekst || "Reken jouw terugverdientijd uit";
    const totaal = SCENES.reduce((a, s) => a + s.duur, 0);

    houder.setAttribute("role", "region");
    houder.setAttribute("aria-label", "Uitlegclip: thuisbatterij wel of niet kopen");
    const vast = (x) => x.replace(/'s /g, "'s\u00a0");
    houder.innerHTML = `<div class="bc-buhne">${SCENES.map((s) => `
      <div class="bc-scene${s.breed ? " bc-breed" : ""}">
        <div class="bc-woord">
          <p class="bc-label">${s.label}</p>
          <p class="bc-kop">${vast(s.kop)}</p>
          ${s.tekst ? `<p class="bc-tekst">${vast(s.tekst)}</p>` : ""}
        </div>
        ${s.breed ? vast(s.beeld) : `<div class="bc-beeld">${vast(s.beeld || slotbeeld(href, ctaTekst))}</div>`}
      </div>`).join("")}</div>
      <div class="bc-balk">
        <button type="button" class="bc-knop bc-speel">Afspelen</button>
        <button type="button" class="bc-knop bc-opnieuw">Opnieuw</button>
        <div class="bc-voortgang" aria-hidden="true"><span></span></div>
        <span class="bc-tijd">0:00 / ${tijd(totaal)}</span>
      </div>
      <div class="bc-hoofdstukken">${SCENES.map((s) => `<button type="button" class="bc-knop">${s.naam}</button>`).join("")}</div>`;

    const buhne = houder.querySelector(".bc-buhne");
    const scenes = [...houder.querySelectorAll(".bc-scene")];
    const speel = houder.querySelector(".bc-speel");
    const balkje = houder.querySelector(".bc-voortgang span");
    const klok = houder.querySelector(".bc-tijd");
    const knoppen = [...houder.querySelectorAll(".bc-hoofdstukken .bc-knop")];
    const beweging = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (beweging) houder.classList.add("bc-beweegt");

    let nr = 0, t = 0, loopt = false, vorige = 0, gezien = false;

    function toon(i) {
      nr = i; t = 0;
      scenes.forEach((s, k) => { s.classList.remove("bc-actief"); s.setAttribute("aria-hidden", String(k !== i)); });
      void buhne.offsetWidth;
      scenes[i].classList.add("bc-actief");
      knoppen.forEach((k, j) => k.setAttribute("aria-current", String(j === i)));
      /* Op een smal scherm schuift de rij hoofdstukken mee, zonder de pagina te verplaatsen. */
      const rij = knoppen[i].parentElement;
      rij.scrollLeft += knoppen[i].getBoundingClientRect().left - rij.getBoundingClientRect().left - 20;
      teken();
    }
    function zet(aan) {
      if (aan && nr === scenes.length - 1 && t >= SCENES[nr].duur) toon(0);
      loopt = aan;
      houder.classList.toggle("bc-stil", !aan);
      speel.textContent = aan ? "Pauze" : "Afspelen";
      if (aan) { vorige = performance.now(); requestAnimationFrame(stap); }
    }
    function teken() {
      const gedaan = SCENES.slice(0, nr).reduce((a, s) => a + s.duur, 0) + t;
      balkje.style.width = (gedaan / totaal * 100) + "%";
      klok.textContent = tijd(gedaan) + " / " + tijd(totaal);
    }
    function stap(nu) {
      if (!loopt) return;
      t += Math.min((nu - vorige) / 1000, 0.25);
      vorige = nu;
      if (t >= SCENES[nr].duur) {
        if (nr < scenes.length - 1) toon(nr + 1);
        else { t = SCENES[nr].duur; teken(); zet(false); return; }
      }
      teken();
      requestAnimationFrame(stap);
    }

    speel.addEventListener("click", (e) => { e.stopPropagation(); zet(!loopt); });
    houder.querySelector(".bc-opnieuw").addEventListener("click", (e) => { e.stopPropagation(); toon(0); zet(beweging); });
    knoppen.forEach((k, i) => k.addEventListener("click", (e) => { e.stopPropagation(); toon(i); zet(beweging); }));
    buhne.addEventListener("click", (e) => { if (!e.target.closest("a")) zet(!loopt); });

    toon(0);
    zet(false);
    /* Pas starten als hij in beeld komt, anders mist de lezer het begin. */
    if (beweging && "IntersectionObserver" in window) {
      new IntersectionObserver((items, waarnemer) => {
        if (items.some((i) => i.isIntersecting) && !gezien) { gezien = true; waarnemer.disconnect(); zet(true); }
      }, { threshold: 0.5 }).observe(houder);
    }
  }

  const stijl = document.createElement("style");
  stijl.textContent = CSS;
  document.head.appendChild(stijl);
  houders.forEach(bouw);
})();
