# Logboek: de vergelijker naar wereldklasse

Per ronde één verbetering. Elke ronde begint met een meting (schermafdrukken
op 375, 768 en 1440 px, licht en donker), kiest de verbetering met de meeste
impact en eindigt met `npm run controle` en een nieuwe meting.

## De lat

- [x] Op 375 px drie producten kiezen en vergelijken in maximaal 4 tikken, zonder zoomen of opzij schuiven
- [x] Per regel de beste waarde gemarkeerd, en een schakelaar voor alleen de verschillen
- [ ] De vergelijking staat in de URL; een gedeelde link opent dezelfde vergelijking, met eigen deelkaart (URL en link klaar, deelkaart nog niet)
- [ ] Lighthouse mobiel: Performance ≥ 95, Accessibility 100, Best Practices ≥ 95, SEO 100
- [ ] CLS < 0,05 en interactie < 100 ms
- [ ] Volledig met toetsenbord en schermlezer te bedienen, contrast AA (donkere modus vervalt: besluit eigenaar 4 november)
- [x] Dezelfde verbeteringen op alle drie de sites, kern:controleer en controle groen
- [ ] Eindafdrukken die naast de beste vergelijkers ter wereld kunnen staan

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
