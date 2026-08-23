# Schrijfwijze

Deze site verkoopt niets. Wat hij te bieden heeft is een oordeel over een
aankoop van tweeduizend euro, en dat is alleen iets waard als de lezer het kan
nakijken. Alles hieronder volgt daaruit.

`npm run slop` bewaakt de vijf regels die te meten zijn. De rest is
mensenwerk — en dat is precies waarom ze hier staan opgeschreven.

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

Een gewone zin waarin "niet" en "maar" toevallig samen staan is doodgewoon
Nederlands en wordt niet geraakt.

**3. Een beroep op onderzoek zonder bron.** "Onderzoeken tonen aan", "studies
laten zien", "experts zeggen", "het is algemeen bekend". Noem wie, of laat het
weg en schrijf het feit zelf op. Een cijfer in dezelfde zin telt als genoeg:
dan staat er een jaartal of een bedrag bij en is het na te lopen.

**4. "Wij", "we", "ons" of "onze" in tekst die een bezoeker leest.** Deze site
is van één maker en zegt "ik". "Wij" suggereert een redactie die er niet is, en
dat is niet alleen een andere toon maar een onwaarheid.

De terugval is makkelijk — "wij tonen" is de standaardstem van elke
vergelijkingssite en van elk taalmodel — en daarom staat er een controle op.
Twee dingen veranderden bewust niet mee: het commentaar in de code, want dat is
de maker tegen zichzelf en geen tekst die iemand leest, en de bestandsnaam
`over-ons.html`, want een URL die verspringt kost zoekverkeer. Alleen het
menu-item en de voettekstlink heten nu "Over mij".

**5. Dezelfde zin op meer dan één site.** Boilerplate mag identiek zijn — een
privacyverklaring hoort niet drie keer anders geformuleerd te zijn, dus
`privacy.html`, `contact.html`, `steun.html` en `404.html` doen niet mee. Voor
de rest geldt: drie sites die dezelfde zin over drie verschillende producten
schrijven, zijn één sjabloon met drie kleuren, en zo leest het ook.

Hoort een zin er wél overal hetzelfde te staan — een uitspraak over
onafhankelijkheid bijvoorbeeld — zet hem dan in `scripts/gedeelde-zinnen.json`
en leg in de commit uit waarom. Dat is de hele bedoeling van dat bestand: het
verschil tussen een keuze en gemakzucht vastleggen op het moment dat je hem
maakt.

## Wat het script alleen meldt

**Claimdichtheid.** Hoeveel alinea's van 25 woorden of meer bevatten geen enkel
getal en geen enkele verwijzing? Dat is een oordeel en geen fout — een alinea
die een begrip uitlegt hoeft geen bedrag te bevatten. Daarom laat het de run
niet vallen.

Maar het is wel de eerlijkste maat die er is voor "staat hier iets". Loopt het
getal op, dan zakt de site weg richting algemeenheden. Op de dag dat dit
geschreven werd stond het op 64 van 185, met `uitleg.html` van batterijmaatje
als zwakste pagina: 13 van de 22.

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
