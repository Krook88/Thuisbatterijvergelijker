# Schrijfwijze

Deze site verkoopt niets. Wat hij te bieden heeft is een oordeel over een
aankoop van tweeduizend euro, en dat is alleen iets waard als de lezer het kan
nakijken. Alles hieronder volgt daaruit.

`npm run slop` bewaakt de zeven regels die te meten zijn. De rest is
mensenwerk, en dat is precies waarom ze hier staan opgeschreven.

## De regel waar de rest uit volgt

**Elke bewering draagt iets controleerbaars.** Een bedrag, een datum, een
aantal, een merknaam, een norm, een bron. Zonder dat is een zin niet fout, hij
is alleen niets waard: de lezer kan hem niet nakijken en moet je op je woord
geloven.

| In plaats van | Schrijf |
| --- | --- |
| gaat lang mee | 6.000 laadcycli volgens de garantie van de fabrikant |
| relatief goedkoop | € 192 per kWh, de laagste van de 41 hier |
| wordt steeds populairder | van 28 naar 41 modellen sinds januari |
| experts adviseren | het verschil zelf, in één zin |
| onderzoeken tonen aan | CE Delft komt uit op 6,5 tot 22 jaar |

De laatste twee zijn geen stijlkwestie. Een beroep op autoriteit zonder de
autoriteit te noemen klinkt onderbouwd en is het niet, en dat is precies het
patroon waaraan lezers gegenereerde tekst herkennen.

## Wat `npm run slop` hard afkeurt

**1. Woorden die alleen toon toevoegen.** Naadloos, baanbrekend, moeiteloos,
talloze, ongeëvenaard, het beste van beide werelden, de sleutel tot, ontgrendel,
ontketen, state-of-the-art, game-changer. De volledige lijst staat in
`scripts/slop.mjs`, met per woord waarom.

Gewone Nederlandse woorden staan er bewust níet in. "Cruciaal" en "essentieel"
zijn soms precies het juiste woord, en een lijst die goede zinnen afkeurt wordt
weggeklikt.

**2. "Niet X, maar Y."** Als stijlfiguur, dus als losse zin of als "het is niet
X, het is Y". Dit geldt als de meest herkende vorm van AI-tekst die er is.
Schrijf gewoon op wat het wél is.

Het scharnier hoeft geen "maar" te zijn. "Dat is geen afkeuring: dit is ook de
goedkoopste" is dezelfde beweging met een dubbele punt, en die kwam er in
augustus 2026 gewoon doorheen tot een lezer hem aanwees. Wat de vorm verklikt
is de beweging: eerst ontkennen, dan het echte antwoord geven, zodat de zin
dieper klinkt dan hij is.

Een gewone zin waarin "niet" en "maar" toevallig samen staan is doodgewoon
Nederlands en wordt niet geraakt. Een ontkenning die alleen afbakent en er
niets tegenoverstelt ook niet: "Dit is een hulpmiddel, geen persoonlijk
advies" blijft gewoon staan. Beide soorten zinnen staan als proef in
`scripts/slop.mjs` en worden bij elke run nagelopen, zodat de controle niet
stilletjes kan gaan missen.

**3. Een beroep op onderzoek zonder bron.** "Onderzoeken tonen aan", "studies
laten zien", "experts zeggen", "het is algemeen bekend". Noem wie, of laat het
weg en schrijf het feit zelf op. Een cijfer in dezelfde zin telt als genoeg:
dan staat er een jaartal of een bedrag bij en is het na te lopen.

**4. "Wij", "we", "ons" of "onze" in tekst die een bezoeker leest.** Deze site
is van één maker en zegt "ik". "Wij" suggereert een redactie die er niet is, en
dat is niet alleen een andere toon maar een onwaarheid.

De terugval is makkelijk: "wij tonen" is de standaardstem van elke
vergelijkingssite en van elk taalmodel. Daarom staat er een controle op.
Twee dingen veranderden bewust niet mee: het commentaar in de code, want dat is
de maker tegen zichzelf en geen tekst die iemand leest, en de bestandsnaam
`over-ons.html`, want een URL die verspringt kost zoekverkeer. Alleen het
menu-item en de voettekstlink heten nu "Over mij".

**5. Het lange streepje.** Het teken dat je krijgt met alt+0151 en dat een
zin openbreekt: `—`. Of het echt een verklikker van AI-tekst is, is
betwist; het staat in boeken en journalistiek net zo goed, en het zegt eerder
iets over geredigeerd schrijven dan over de schrijver. Maar het is wel het
eerste waar lezers naar wijzen, en dat is hier reden genoeg. De zin wordt er
nooit slechter van als je hem uitschrijft.

Wat er meestal voor in de plaats kan:

| Als het tweede deel | Gebruik |
| --- | --- |
| het eerste uitlegt | een dubbele punt |
| een terzijde is | haakjes |
| een zin op zichzelf is die erbij hoort | een puntkomma |
| er los van staat | een punt |

Het gewone koppelteken in samenstellingen (`glas-glas`, `all-electric`) en het
kortere streepje in bereiken blijven gewoon staan; het gaat alleen om het lange.

De controle leest ook `title`, `aria-label` en `alt` mee. Dat is geen
theoretische toevoeging: de uitsplitsing van de Koppel-score staat in een
tooltip, en die stond 71 keer met een lang streepje in de vergelijker zonder
dat iemand het zag.

En hij leest het teken in alle spellingen waarin het voorkomt: `—`, maar ook
`&mdash;`, `&#8212;` en `&#x2014;`. Dat gat kostte 55 streepjes. De controle
gaf groen terwijl ze er stonden, omdat de regel die HTML-entiteiten opruimt
vóór de controle draaide en het bewijs dus weghaalde. Een controle die iets
mist is erger dan geen controle, want hij geeft groen en dan stop je met
kijken. Daarom staan er nu proefzinnen in `scripts/slop.mjs` die bij elke run
nagaan of de patronen nog raken wat ze horen te raken.

**6. Dezelfde zin op meer dan één site.** Boilerplate mag identiek zijn: een
privacyverklaring hoort niet drie keer anders geformuleerd te zijn, dus
`privacy.html`, `contact.html`, `steun.html` en `404.html` doen niet mee. Voor
de rest geldt: drie sites die dezelfde zin over drie verschillende producten
schrijven, zijn één sjabloon met drie kleuren, en zo leest het ook.

Hoort een zin er wél overal hetzelfde te staan (een uitspraak over
onafhankelijkheid bijvoorbeeld), zet hem dan in `scripts/gedeelde-zinnen.json`
en leg in de commit uit waarom. Dat is de hele bedoeling van dat bestand: het
verschil tussen een keuze en gemakzucht vastleggen op het moment dat je hem
maakt.

**7. Een lange alinea zonder één controleerbaar detail.** Hoeveel alinea's van
25 woorden of meer bevatten geen enkel getal en geen enkele verwijzing? Dat is
de eerlijkste maat die er is voor "staat hier iets".

Dit was lang een signaal dat de run niet liet vallen, want bij invoering stond
het op 64 van de 185 alinea's, met `uitleg.html` van batterijmaatje als
zwakste pagina op 13 van de 22. Een controle die bij invoering 64 meldingen
geeft, klik je weg.

In augustus 2026 zijn die 64 stuk voor stuk nagelopen en van een bedrag, een
aantal, een merknaam of een bron voorzien, bijna allemaal uit de eigen data van
de site: 41 batterijen van 669 tot 9.000 euro, 14 panelen van 12 tot 52 cent
per Wp, 30 warmtepompen van 48 tot 59 dB(A). De teller staat op nul, en daarmee
voldoet deze controle aan dezelfde eis als de andere zes. Dus laat hij nu wél
vallen.

Loop je erop vast bij een alinea die echt geen getal hoort te dragen, dan is de
uitweg om hem korter dan 25 woorden te maken, of om er de bron bij te zetten
waar hij toch al op leunt.

## Wat een script niet kan bewaken

**Schrijf zoals je praat, niet zoals een persbericht.** Korte zinnen mogen.
Eén gedachte per zin.

**Zeg wat niet werkt.** Een vergelijker die alleen opsomt wat er goed is aan
elk product, is een folder. De zin die het meeste vertrouwen wint is die waarin
je een model afraadt, of toegeeft dat je iets niet weet.

**Eén eigen waarneming per productpagina is meer waard dan drie alinea's uit
een datasheet.** Wat je zelf hebt gemerkt, wat er tegenviel, waarom je iets
niet zou kopen. Dat is het enige wat een generator niet kan produceren, en
daarmee het enige wat definitief het verschil maakt.

## Draaien

```
npm run slop                      alle drie de sites
npm run slop -- batterijmaatje    één site
```

Loopt mee in `npm run controle` en in CI.
