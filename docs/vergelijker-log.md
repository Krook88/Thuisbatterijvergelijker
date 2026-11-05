# Logboek: de vergelijker naar wereldklasse

Per ronde één verbetering. Elke ronde begint met een meting (schermafdrukken
op 375, 768 en 1440 px, licht en donker), kiest de verbetering met de meeste
impact en eindigt met `npm run controle` en een nieuwe meting.

## De lat

- [x] Op 375 px drie producten kiezen en vergelijken in maximaal 4 tikken, zonder zoomen of opzij schuiven
- [x] Per regel de beste waarde gemarkeerd, en een schakelaar voor alleen de verschillen
- [x] De vergelijking staat in de URL; een gedeelde link opent dezelfde vergelijking, met eigen deelkaart (deelkaart werkt op de Vercel-preview, getest door de eigenaar)
- [x] Lighthouse mobiel: Performance ≥ 95, Accessibility 100, Best Practices ≥ 95, SEO 100
- [x] CLS < 0,05 en interactie < 100 ms (CLS 0; vinkje 40–72 ms, venster 48–80 ms bij 4× vertraging)
- [x] Volledig met toetsenbord en schermlezer te bedienen, contrast AA (donkere modus vervalt: besluit eigenaar 4 november)
- [x] Dezelfde verbeteringen op alle drie de sites, kern:controleer en controle groen
- [x] Eindafdrukken die naast de beste vergelijkers ter wereld kunnen staan (zie eindverslag)

## Ronde 1 – de vergelijktabel (4 november 2026)

**Gemeten.** De drie grootste ergernissen in het venster "Vergelijk nu":

1. Op 375 px nam de labelkolom drie kwart van het scherm in. Van drie
   producten zag je er één, en daarvan vier tekens. Onbruikbaar op de
   telefoon, waar de meeste bezoekers zitten.
2. Nergens zag je wie er per regel wint. Je moest zelf drie bedragen,
   drie capaciteiten en drie garanties tegen elkaar afwegen.
3. Regels waarin de producten gelijk zijn (zelfde type, zelfde garantie)
   stonden er even groot tussen als de regels die ertoe doen.

Daarnaast opgemerkt, voor een volgende ronde: het venster heeft geen
`role="dialog"`, Escape sluit het niet en de focus blijft achter de
overlay; de keuze staat niet in de URL en is dus niet te delen; maximaal
drie producten; geen donkere modus op de hele site.

**Gebouwd.** Een gedeelde component `kern/assets/vergelijktabel.js` met de
opmaak in `kern/assets/vergelijker.css`. Elke site geeft alleen nog zijn
regels op (label, weergave, en waar dat zinnig is een waarde met richting).

- Smal scherm: het label staat boven de regel over de volle breedte, de
  waarden eronder naast elkaar. Drie producten passen zonder schuiven; de
  productnamen blijven bovenaan staan tijdens het scrollen.
- De beste waarde per regel krijgt een groene markering met "beste". Alleen
  als er echt iets te kiezen valt: zijn alle waarden gelijk of is er maar
  één bekend, dan wint niemand. Schermlezers horen "Beste waarde:".
- Schakelaar "Alleen verschillen" met het aantal gelijke regels erbij.
- De inline stijlen uit de drie `app.js`-bestanden zijn weg.

Richting per regel: prijs, prijs per kWh/Wp en geluid lager is beter;
capaciteit, vermogen, garantie, rendement, subsidie, aanvoertemperatuur,
scores en koppelingen (ja > deels > nee) hoger is beter. De
temperatuurcoëfficiënt van zonnepanelen telt naar de kleinste daling.
Geen richting bij regels die smaak of situatie zijn (type, celtype,
uitvoering, koudemiddel, installatie).

**Gecontroleerd.** `npm test` 918 geslaagd, 0 mislukt. `kern:controleer`,
`stempel --controleer`, dataschema, modellen, workflows, llms, slop en
keuring schoon. `npm run datums` faalt op een verlopen leverdatum in de
gegevens van de EcoFlow Stream AC 5000 ("verwachte verzending vanaf
12 oktober"); dat faalde al vóór deze ronde en zit in `data/`, dat deze
loop niet aanraakt.

**Voor en na (375 px).** Voor: één product half zichtbaar, labelkolom
280 px breed. Na: drie kolommen van ±115 px, beste waarden groen, kop met
productnamen blijft staan. Op 1440 px: zelfde tabel, ruimere opmaak.

## Ronde 2 – de vergelijking delen (4 november 2026)

**Gemeten.** Na ronde 1 de drie grootste ergernissen:

1. Een vergelijking die je mooi vindt, kun je niet doorsturen. De keuze
   bestond alleen in het geheugen van de pagina; na verversen was hij weg.
2. Wie een link krijgt, ziet de lijst en moet zelf dezelfde drie producten
   terugzoeken en aanvinken.
3. Op een telefoon is er geen manier om het deelmenu van het systeem te
   gebruiken vanuit de vergelijking.

**Gebouwd.**

- De gekozen producten staan in de adresregel als `?vergelijk=a~b~c`,
  naast de filters die er al stonden. Verversen houdt de keuze vast.
- Opent iemand zo'n link, dan staat het venster meteen open met dezelfde
  producten in dezelfde volgorde. Onbekende namen (een product dat uit de
  lijst is gegaan) vallen weg; blijven er minder dan twee over, dan opent
  het venster niet.
- Knop "Deel deze vergelijking" boven de tabel. Op een aanraakscherm het
  deelmenu van het systeem, met als tekst de namen tegen elkaar
  ("Merk A vs Merk B"); elders gaat de link naar het klembord, met
  "Link gekopieerd" in de knop en voor schermlezers.

**Gecontroleerd.** Per site met Playwright: drie producten kiezen, delen,
de gekopieerde link in een nieuw tabblad openen. Op alle drie de sites
staat het venster open met dezelfde drie namen. `npm test` 918 geslaagd;
keuring, slop, llms en dode regels schoon. `datums` faalt nog steeds alleen
op de EcoFlow-leverdatum in `data/`.

**Nog open voor deze lat:** een eigen deelkaart (OG-afbeelding) per
vergelijking. Een statische site kan die niet per willekeurige combinatie
klaarzetten; dat vraagt een functie in `api/`. Volgende kandidaat.

## Tussendoor – controle groen (4 november 2026)

Met toestemming van de eigenaar de verlopen zin "Niet op voorraad,
verwachte verzending vanaf 12 oktober 2026" weggehaald bij de pre-sale van
de EcoFlow Stream AC 5000 (Thuisbatterij.nl). De winkel was vanuit deze
sessie niet bereikbaar, dus er staat geen nieuwe datum voor in de plaats.
`npm run controle` is nu volledig groen.

Besluit eigenaar: geen donkere modus. Contrast toetsen we alleen in licht.

## Ronde 3 – het venster met toetsenbord en schermlezer (4 november 2026)

**Gemeten.** De drie grootste ergernissen:

1. Escape deed niets. Wie het venster met het toetsenbord opende, kwam er
   alleen uit door naar het kruisje te tabben, en Tab liep ondertussen
   gewoon door naar de pagina erachter.
2. Een schermlezer hoorde geen venster: geen `role="dialog"`, geen naam.
   Het kruisje heette alleen "Sluiten".
3. Warmtepompmaatje gebruikte eigen klassen voor het venster
   (`.vergelijk-modal`). Daardoor werd het op de telefoon niet
   schermvullend zoals op de zustersites.

**Gebouwd.** `VergelijkTabel.open` en `VergelijkTabel.sluit` in de kern:

- `role="dialog"` en `aria-modal`, met de kop "Vergelijking" als naam.
- Bij openen staat de focus op "Vergelijking sluiten". Tab en Shift+Tab
  blijven binnen het venster. Escape sluit het, en daarna staat de focus
  weer op de knop waarmee je het opende.
- De pagina erachter scrollt niet mee zolang het venster open is.
- Warmtepompmaatje gebruikt nu dezelfde opbouw en klassen; de losse regels
  in de eigen `style.css` zijn weg.

**Gecontroleerd.** Per site met alleen het toetsenbord: twee producten
aanvinken met Spatie, openen met Enter, twaalf keer Tab (blijft binnen),
Escape (dicht, focus terug op "Vergelijk nu"). Op alle drie de sites
geslaagd. `npm run controle` volledig groen, 918 tests.

## Ronde 4 – kiezen op de telefoon (4 november 2026)

**Gemeten** op 375 px met een aanraakscherm (Pixel 7):

1. Het vinkje "vergelijk" in de lijst was 80 bij 24 px. Te klein voor een
   duim, en net onder een productnaam die ook een link is.
2. Maximaal drie producten, terwijl de keuze vaak tussen vier ligt (twee
   merken, elk in twee maten).
3. Wie terug scrolt, ziet niet welke producten al gekozen zijn: een
   aangevinkt vakje is het enige verschil.

Drie producten kiezen en vergelijken kostte 4 tikken (3 vinkjes en
"Vergelijk nu"); dat haalde de lat al.

**Gebouwd.**

- Op een aanraakscherm is het label het tikvlak: 44 px hoog, met een
  vinkje van 20 px.
- Een aangevinkt "vergelijk" staat vet in de merkkleur.
- Maximaal 4 producten op alle drie de sites, ook via een gedeelde link.
- De tabel breekt woorden op lettergrepen (`hyphens: auto`, de pagina is
  `lang="nl"`) in plaats van op elke letter; productnamen blijven heel.

**Gecontroleerd.** Tikvlak nu 107–110 × 44 px. Met 4 producten op 375 px
vier kolommen zonder opzij schuiven. Drie producten blijven 4 tikken, vier
producten 5. `npm run controle` volledig groen.

**Gevonden voor een volgende ronde:** `zonnestroommaatje/omvormers.html`
heeft een eigen vergelijker (`assets/omvormers.js`) met de oude tabel en
een maximum van 3. Die moet op dezelfde component.

## Ronde 5 – de omvormers op dezelfde vergelijker (4 november 2026)

**Gemeten.** `zonnestroommaatje/omvormers.html` had nog alles van vóór
ronde 1: de brede labelkolom op de telefoon, geen beste waarde, geen
verschillen-schakelaar, niet te delen, geen Escape en maximaal 3.

**Gebouwd.** `assets/omvormers.js` gebruikt nu dezelfde `VergelijkTabel`
(tabel, delen, venster) en `?vergelijk=` in de URL, met een maximum van 4.
Geen winnaar op prijs: daar staan richtprijzen naast winkelprijzen, en een
omvormer van 3 kW naast een van 10 kW. Wel op koppel-score, batterij,
Home Assistant, Homey, schaduwaanpak en garantie.

**Gecontroleerd.** Delen en terug openen: zelfde drie omvormers in het
venster. Toetsenbord: Tab blijft binnen, Escape sluit, focus terug.
375 px: drie kolommen zonder opzij schuiven. `npm run controle` groen.

## Ronde 6 – snelheid gemeten (4 november 2026)

**Lighthouse mobiel** (12.2.1, met gzip zoals op Vercel), vergelijkpagina:

| site | Performance | Accessibility | Best Practices | SEO | CLS |
| --- | --- | --- | --- | --- | --- |
| batterijmaatje | 99 | 100 | 96 | 100 | 0 |
| zonnestroommaatje | 99 | 100 | 96 | 100 | 0 |
| warmtepompmaatje | 99 | 100 | 96 | 100 | 0 |

Best Practices mist alleen op `/_vercel/insights/script.js` (404), dat
lokaal niet bestaat en op Vercel wel.

**Interactie.** Een vinkje bouwde de hele lijst opnieuw op: 140–290 ms bij
4× CPU-vertraging. Nu werkt een vinkje alleen de balk en de adresregel bij
(`balkBijwerken`): 40–72 ms. Het venster openen: 40 ms zonder vertraging,
96–144 ms bij 4×. Dat zit in het opmaken van de tabel zelf; scrollslot,
focus, afbreking en `content-visibility` gemeten en maakten geen verschil.

## Ronde 7 – een eigen deelkaart per vergelijking (4 november 2026)

**Gemeten.** Een gedeelde vergelijking liet in WhatsApp het algemene plaatje
van de site zien. Een chat-app voert geen JavaScript uit en leest dus alleen
de vaste `og:image` van `index.html`: de ontvanger zag niet welke producten
er tegen elkaar stonden.

**Gebouwd** (met akkoord van de eigenaar, want het raakt de hosting):

- Korte link `/v/a~b~c` (en `/v/omvormers/a~b` op zonnestroommaatje). Een
  rewrite in `vercel.json` stuurt die naar `api/v.js`. Die geeft een kleine
  pagina met eigen titel ("A vs B vs C"), beschrijving met de prijzen en
  een eigen plaatje, en stuurt de bezoeker meteen door naar
  `/?vergelijk=a~b~c`. `noindex`, met de vergelijker als canonical.
- `api/vergelijkkaart.js` maakt het plaatje van 1200 × 630 met
  `@vercel/og`: per product merk, model en vanaf-prijs, de laagste prijs
  groen, in de kleuren van de site en in Figtree (als ttf in `api/fonts/`,
  omdat satori geen woff2 leest).
- De gedeelde code staat in `kern/api/`; per site staat alleen
  `api/_site.js` met naam, kleuren en welke lijst bij welke soort hoort.
  Prijzen komen uit dezelfde `assets/prijs.js` als op de site.
- De knop "Deel deze vergelijking" deelt nu de korte link.
- Op warmtepompmaatje staan de `/v/`-regels vóór de vangregel die elke URL
  zonder punt naar `.html` stuurt.

**Gecontroleerd.** Lokaal beide functies aangeroepen voor alle drie de
sites en de omvormers: 200 met de juiste titel, beschrijving en plaatje.
Minder dan twee bekende producten: doorgestuurd naar de vergelijker en het
algemene plaatje. `npm run controle` groen. **Nog niet gecontroleerd op
Vercel zelf**: de rewrites en de functie draaien pas na een deploy.

## Ronde 8 – contrast en opentijd (4 november 2026)

**Contrast.** axe-core 4.10 (WCAG 2.2 AA) op het geopende venster, op
375 en 1440 px, voor alle vier de vergelijkers. Eén overtreding: het label
"bruto" haalde 4,17:1. Oorzaak was de eigen regel `.vt-tabel tbody td small`,
die elke `<small>` grijs maakte en zo de donkerdere kleur van het label
overschreef. Nu alleen `<small>` zonder klasse. Daarna: 0 overtredingen.

**Opentijd.** Zodra er twee of meer producten gekozen zijn, vult en maakt de
pagina het venster op als de browser even niets te doen heeft
(`VergelijkTabel.voorbereid`), onzichtbaar en niet te bedienen. "Vergelijk
nu" hoeft het dan alleen te tonen. Bij 4× CPU-vertraging van 96–144 ms naar
48–80 ms. Een gedeelde link opent nog steeds direct (dan wordt het venster
bij het openen gevuld).

## Eindverslag (4 november 2026)

Afdrukken gemaakt op 375, 768 en 1440 px voor de drie vergelijkers en de
omvormers (alleen licht: de eigenaar koos op 4 november voor geen donkere
modus). Op geen enkele breedte schuift de pagina opzij.

Waarom ze naast de beste vergelijkers kunnen staan:

- **Het antwoord eerst.** De beste waarde per regel is groen gemarkeerd, met
  "beste" erbij. Wie drie batterijen naast elkaar zet, ziet in één oogopslag
  dat de PowerBrick de meeste kWh en de laagste prijs per kWh heeft, en de
  TSUN de laagste prijs. Gelijke waarden markeren we niet, en regels die smaak
  of situatie zijn (type, uitvoering) ook niet: de markering zegt nooit meer
  dan de gegevens.
- **Ruis weg met één tik.** "Alleen verschillen" verbergt de gelijke regels,
  met het aantal ervoor, zodat je weet wat er wegvalt.
- **Gemaakt voor de telefoon.** Vier producten naast elkaar op 375 px zonder
  opzij schuiven, het label boven de regel, de productnamen blijven staan,
  afbreken op lettergrepen. Tikvlakken van 44 px.
- **Delen doet het werk.** Een korte link met een eigen plaatje van precies
  die vergelijking in WhatsApp, en wie hem opent zit meteen in dezelfde
  vergelijking. Werkt op de Vercel-preview.
- **Voor iedereen bruikbaar.** Escape, Tab blijft binnen het venster, focus
  terug, een echte dialoog voor schermlezers, 0 overtredingen in axe
  (WCAG 2.2 AA).
- **Snel.** Lighthouse mobiel 99/100/96/100, CLS 0, een vinkje 40–72 ms en het
  venster 48–80 ms bij 4× CPU-vertraging.
- **Eén code voor alles.** De vier vergelijkers gebruiken dezelfde component
  uit `kern/`; een verbetering komt voortaan op alle sites tegelijk.

Wat er nog beter kan, voor een volgende keer: een gekozen product uit het
venster zelf kunnen weghalen of toevoegen, zonder terug naar de lijst; en de
lange prijstoelichtingen in de tabel inklappen tot één regel met "meer".

## Vervolg – de open punten uit de eerste prompt (4 november 2026)

Na de merge van #112 nagelopen wat uit de taak nog niet gedaan was.

**Filteren en sorteren.** Gemeten bij 4× CPU-vertraging, tijd tot het
volgende beeld. Batterijmaatje kostte 200–356 ms per filter: de lijst bouwde
bij elk filter alle 55 regels op (3.373 elementen), ook de 45 achter "Toon
alle". Nu bouwt de browser alleen de zichtbare regels (`snel: true` in
`Kaart.lijstHtml`); de voorgerenderde HTML blijft compleet voor wie zonder
JavaScript leest. Daarnaast onthoudt de prijsgrafiek zijn datumopmaak. Na
de eerste keer: 71–84 ms per filter, waarvan ±20 ms script.

**Vaste vergelijkpagina's** (`vergelijk/a-vs-b.html`). Op 375 px zag je
alleen het eerste product; het tweede zat buiten beeld in een schuifvak.
Nu op de telefoon dezelfde opbouw als het vergelijkvenster: label boven de
regel, de twee producten eronder naast elkaar, namen bovenaan in beeld.

**Twee tikken.** Echt twee tikken kan alleen als het venster vanzelf opent
bij het tweede vinkje, en dan kun je geen derde of vierde meer kiezen. Niet
gedaan. Wel: de balk verschijnt al bij het eerste vinkje ("1 gekozen, kies
er nog één"), met "Vergelijk nu" pas actief vanaf twee. Twee producten
vergelijken blijft drie tikken.

**Niet gedaan:** de uitslagpagina's en de rekenmodule zijn niet bekeken;
swipen tussen producten is niet nodig nu alles naast elkaar past.

## Rekenmodule (5 november 2026)

De uitslagpagina's (`uitslag/*.html`) zijn deelpagina's die meteen
doorsturen naar de rekenmodule; daar valt niets aan te zien. Het werk zat in
de rekenmodule zelf.

**Gemeten** op 375 px, met een product gekozen:

1. De rekentabellen waren breder dan het scherm: de eerste kolom van
   `.vergelijk-tabel` is 230 px, bedoeld voor de grote productlijst.
   "Bespaard" viel half weg en het schuifvak was met een toetsenbord niet
   te bereiken (axe: scrollable-region-focusable).
2. De grafiek werd van 640 naar ±290 pixels verkleind, met getallen langs de
   assen van ±5 pixels.
3. Op zonnestroommaatje en warmtepompmaatje bleef de pagina na het kiezen
   van een product bij het formulier; het resultaat stond eronder, buiten
   beeld.

**Gebouwd.** In de kern: op een smal scherm geen minimumbreedte voor de eerste
kolom in rekentabellen, koppen mogen afbreken, bedragen in het resultaat
niet. De grafiek van batterijmaatje tekent op een telefoon op 360 breed met
13 px tekst. Zonnestroom- en warmtepompmaatje scrollen na een productkeuze
naar het resultaat. Het groene saldo staat nu in de donkere groen (3,3:1 werd
5:1).

**Gecontroleerd.** Alle tabellen passen (293/293, 335/335), geen opzij
schuiven op 375 en 1440 px, axe 0 overtredingen op alle drie de
rekenmodules, resultaat in beeld na een keuze. `npm run controle` groen.

## Gemeten op de live sites (5 november 2026)

Lighthouse 12.2.1 mobiel, twee keer per site, op batterijmaatje.nl,
zonnestroommaatje.nl en warmtepompmaatje.nl: **100 / 100 / 100 / 100** op alle
drie, LCP 1,1–1,5 s, TBT 0–80 ms, CLS 0.

Reactietijd tot het volgende beeld bij 4× CPU-vertraging, op 375 px:
vinkje vergelijk 10–31 ms, venster openen 19–25 ms, filter 26–69 ms. axe
(WCAG 2.2 AA) op het geopende venster: 0 overtredingen. Testbezoeken met
`#niet-tellen`, dus niet in de eigen statistieken.

Deellinks `/v/...` op alle drie: 200, eigen titel en plaatje (1200 × 630).
Daarbij gevonden: op het omvormerplaatje stond € 132 (per micro-omvormer)
groen als laagste naast € 1.250 voor een complete omvormer. Op de kaart nu
geen prijswinnaar voor soorten waar de prijzen geen gelijk getal zijn
(`geenPrijswinnaar` in `api/_site.js`), net als in de tabel.
