# Maatje-sites

Drie onafhankelijke vergelijkingssites in één repository:

| map | domein | onderwerp |
| --- | --- | --- |
| `sites/batterijmaatje` | batterijmaatje.nl | thuisbatterijen |
| `sites/zonnestroommaatje` | zonnestroommaatje.nl | zonnepanelen en omvormers |
| `sites/warmtepompmaatje` | warmtepompmaatje.nl | warmtepompen |

Elke site is statisch: geen build-stap, geen framework. In de map van elke site
staat een eigen `README.md` met de details van die site.

## Waarom één repository

De drie sites deelden veertien bestanden, en geen enkele daarvan was nog
identiek. `app.js` was voor veertig tot zestig procent uit elkaar gelopen,
`prijs.js` ontbrak op zonnestroommaatje, en de voorgerenderde vergelijking
bestond alleen op batterijmaatje. Elke verbetering moest drie keer, en in de
praktijk gebeurde dat niet.

## Hoe de gedeelde code werkt

`kern/` is de bron. `scripts/kern-verdelen.mjs` kopieert de inhoud daarvan naar
elke site, en dezelfde opdracht met `--controleer` faalt zodra een site
afwijkt.

```
npm run kern:verdeel        kopieer kern/ naar elke site
npm run kern:controleer     faalt als een site afwijkt (draait ook in CI)
```

**Waarom kopiëren en niet verwijzen.** Vercel neemt per project alleen de map
mee die als Root Directory is ingesteld. Een bestand in `kern/` komt dus niet
mee in de deployment van een site, en `../kern/contact.js` is als URL sowieso
onbereikbaar. Zonder build-stap is kopiëren met een harde controle erop de
eerlijkste oplossing.

**Wat er in kern hoort.** Alleen wat aantoonbaar identiek kan zijn voor alle
drie. Vormgeving en domeinlogica horen er niet in: de accentkleur verschilt per
site, en een batterij rekent in kWh waar een paneel in wattpiek rekent. De kern
groeit per stap, en elke stap begint met vaststellen dat de bestanden echt
hetzelfde kunnen zijn.

Dat geldt ook voor losse functies. `houdbaarTot` - de regel dat een prijs dertig
dagen meegaat in het zoekresultaat - stond woord voor woord in alle drie de
generatoren en staat sinds kort in `kern/scripts/prijs-houdbaarheid.mjs`. De
titelhulpjes die ernaast stonden (`titelMetMerk`, `besteTitel`) zijn met opzet
blijven staan: die lezen `TITEL_MAX` en het merkachtervoegsel van hun eigen
site, en dan kost delen meer dan het oplevert. Tien regels kopiëren is goedkoper
dan tien regels met drie parameters.

Wijzig je iets aan een gedeeld bestand, doe dat dan in `kern/` en draai
`npm run kern:verdeel`. Hoort een wijziging bij één site, haal dat bestand dan
uit `kern/` en leg in de commit vast waarom het niet langer gedeeld is.

## Controleren

`npm run controle` draait de controles hieronder achter elkaar, en dat is
precies wat CI ook doet:

| Commando | Wat het bewaakt |
| --- | --- |
| `npm run kern:controleer` | de sites lopen gelijk met `kern/`, en de `?v=`-nummers binnen een site lopen gelijk |
| `npm test` | de proeven bij het prijsrekenen en het uitlezen van winkelpagina's |
| `npm run modellen` | het herkennen van modelnamen, dat anders stil faalt |
| `npm run workflows` | stappen die naar een stap in een ander blok verwijzen en zichzelf daardoor overslaan |
| `npm run datums` | teksten die aan een voorbije datum hangen, en jaartallen in titels die achterlopen |
| `npm run llms` | `llms.txt` loopt achter op het menu van de site |
| `npm run slop` | tekst die vager is dan deze site wil zijn; de regels staan in `SCHRIJFWIJZE.md` |
| `npm run keuring` | contrast, aanraakvlakken, tekstmaten en javascriptfouten op elke pagina van de drie sites, op 1280 en 390 pixels |
| `npm run menubreedte` | de kop wikkelt niet naar twee regels, en niets steekt buiten de pagina op 320 tot 390 pixels |
| `npm run dode-regels` | declaraties die er wel staan maar overal worden overruled |

### Waarom de kop een eigen controle heeft

`npm run menubreedte` lijkt een detail en was het grootste layoutprobleem dat de
sites hadden. De navigatiebalk week pas onder 767 pixels voor een menuknop, maar
het volledige menu pást daar niet: gemeten op de voorpagina blijft de kop pas op
één regel vanaf 768 pixels bij batterijmaatje, 912 bij warmtepompmaatje en 976
bij zonnestroommaatje. Met de terugvalfont die de bezoeker de eerste halve
seconde ziet: vanaf 864, 1056 en 1128. Daartussen wikkelde de navigatie onder
het logo door — twee regels, met de terugvalfont zelfs drie.

Dat kostte twee dingen, en geen van beide valt op als je op een laptop test. Op
een tablet oogt de kop verkeerd. En zodra de webfont binnenkomt krimpt de kop
terug naar één regel, waardoor alles eronder omhoog schuift: een gemeten
verschuiving van 0,24 op 768 pixels, waar Google 0,1 als grens voor "goed"
aanhoudt.

De inklapgrens staat nu per site op de terugvalbreedte plus marge (879, 1071 en
1143 pixels). Dat getal hangt aan de inhoud van het menu: komt er een item bij,
of wordt een label langer, dan wikkelt de kop weer — stil, want de pagina blijft
werken. Vandaar de controle, die met én zonder webfont meet.

Het alternatief staat er niet voor niets in de foutmelding: een menu-item onder
"Meer ▾" zetten geeft de volledige balk terug op tabletbreedte. Dat is een keuze
over wat hoofdzaak is, en die hoort bij de eigenaar van de site, niet bij een
script.

### Wat de pagina bij het laden laat verspringen

Drie oorzaken, gemeten met een echte browser en een kunstmatige vertraging van
250 ms op beeld, font en javascript — want op een plaatselijke server komt alles
zo snel binnen dat je een probleem wegmeet dat de bezoeker op zijn telefoon wel
heeft. De uitkomst varieert met de timing, dus meet drie keer en neem de hoogste.

**De klasse `html.js` hoort in de `<head>`.** Of de navigatie inklapt hing aan
een klasse die `nav.js` zette, en dat bestand laadt onderaan de pagina. Dus werd
de kop eerst met het volledige menu getekend, wikkelde die over meerdere regels,
en klapte daarna in: elke bezoeker zag de inhoud één keer 56 pixels
verspringen. Nu zet één regel in de `<head>` die klasse vóór het eerste tekenen.
Het vangnet blijft: zonder javascript komt de klasse er niet en staat het menu
gewoon open — nagemeten, 13 van 13 links klikbaar.

**Wat de generator al weet, hoort in de HTML.** De datum achter "gecontroleerd"
stond er als `…` en werd pas in de browser gevuld. Eén teken dat "2 oktober
2026" wordt, in een badgerij die afbreekt: de rij herverdeelt en alles eronder
schuift mee. Dat kostte 0,23 op warmtepompmaatje en 0,68 op zonnestroommaatje.
De generator schrijft hem nu voor, met de opmaak aan beide kanten nagerekend
(`toLocaleDateString` met day/month/year tegen `Intl` met `dateStyle: "long"`,
allebei "2 oktober 2026"), zodat app.js er daarna precies hetzelfde in zet.

**En de webfont, met een afruil.** Wat er na die twee nog overbleef was de
wissel van de terugvalfont naar Figtree. Die terugvalfont is ongeveer 11 procent
breder, dus brak alle tekst anders af: de hero kromp 129 pixels zodra Figtree
binnenkwam — de h1 een regel, de badgerij een regel, de knoppenrij 65 pixels — en
alles eronder schoof mee. 0,25 op warmtepompmaatje, 0,45 op zonnestroommaatje.

De nette oplossing is een terugvalfont met bijgestelde metriek (`size-adjust`,
`ascent-override`), en die kan hier niet verantwoord gemaakt worden. De stack
begint met `ui-sans-serif`: dat is Roboto op Android, SF op Apple en Segoe UI op
Windows. Gemeten in de bouwomgeving liepen de benodigde waarden van 89 tot 111
procent uiteen — de correctie draait zelfs van richting — en die drie fonts staan
hier niet eens geïnstalleerd, dus wat je hier meet is niet wat de bezoeker heeft.
Eén waarde die overal klopt bestaat niet.

Daarom staat `font-display` nu op `optional`: geen wisselperiode, dus geen
verschuiving. Gemeten nul op alle drie de sites. Wat het kost: bij een eerste
bezoek is de font nog niet in de cache en gebruikt de browser hem niet, ook niet
met de preload. Nieuwe bezoekers zien dus de systeemfont; elk volgend bezoek
staat Figtree er wel. Bewust ingeruild — wie de site voor het eerst ziet heeft
geen vergelijking met de huisstijl, maar een pagina die onder zijn duim
wegspringt merkt hij wel.

Die keuze had één gevolg dat eerst niet zichtbaar was: de bredere terugvalfont is
nu wat een nieuwe bezoeker werkelijk krijgt, en daarmee ging de overloop op een
telefoon van 320 pixels van 5 naar 31 pixels (`.dagmaat-invoer` met
`white-space: nowrap`). Opgelost met `flex-wrap`, en `npm run menubreedte` meet
die smalle breedtes nu mee — op de terugvalfont, want dat is de brede stand.

Eén controle staat er met opzet niet bij de ketting, maar draait wel elke dag
mee in `update-prijzen.yml` als melding. `npm run zoekmachine` kijkt wat een
zoekmachine van de sites te zien krijgt - titellengte, canonical, geldige
JSON-LD, `availability` en `priceValidUntil` in de offers, en of de sitemap en
de pagina's elkaar dekken. Die hoort niet in de ketting omdat een deel van zijn
meldingen niet met code op te lossen is: "geen prijs in het zoekresultaat, de
prijs is te oud" gaat weg door een prijs na te kijken, niet door iets te
programmeren. In de ketting zou hij binnen een week permanent rood staan, en
dat is precies wat dit bestand verderop over andere controles zegt. In de
dagelijkse workflow staat hij daarom op `continue-on-error`. Draai hem met de
hand als je aan de vindbaarheid werkt; `--streng` geeft een foutcode terug.

Hij drukt onderaan ook twee getallen af die geen melding zijn: hoeveel
productpagina's geen `image` in de markup hebben, en hoeveel er geen `offers`
dragen. Google toont een productresultaat - foto, prijs, beschikbaarheid naast
het blauwe linkje - alleen als allebei er staan. Dat is niet aan de pagina te
zien, want die werkt gewoon.

`npm test` draait meer proeven dan er staan: de vier testbestanden uit `kern/`
worden naar elke site gekopieerd en dus vier keer uitgevoerd, wat van de 431
proeven er 328 een echo maakt. Dat is geen slordigheid maar de prijs van een
keuze die ergens anders zijn nut heeft: de dagelijkse prijsrun draait per site
`npm test` in de map van díé site, vóórdat hij prijzen wegschrijft. Daar wil je
de bestanden toetsen die dat script straks importeert, en niet een kopie
elders. Het kost zeven seconden.

`npm run workflows` kwam uit een eigen misser. Een stap die de dagelijkse
prijsrun rood moest laten worden bij verouderde prijzen belandde onderaan het
bestand, en dus in het verkeerde blok. Hij keek naar `steps.keuze` en
`steps.prijzen`, die alleen in het blok erboven bestaan. GitHub keurt dat niet
af: zo'n verwijzing wordt een lege tekst, de `if` is altijd onwaar, en de stap
slaat zichzelf elke dag over. In de lijst staat hij dan grijs, alsof dat de
bedoeling was.

`npm run datums` bewaakt fouten zonder dader: niemand verandert iets, de
kalender verschuift en de site heeft ongelijk. Een jaartal in een titel hoort
daarbij. "Beste thuisbatterij (2026)" nodigt uit tot klikken zolang het 2026
is, en is op 1 januari juist een reden om niet te klikken.

De generatoren halen dat jaartal inmiddels uit de kalender (`const JAAR`), dus
die titels rollen bij de eerste prijsrun van het nieuwe jaar vanzelf om. De
handgeschreven pagina's kunnen dat niet: bij hún jaartal hoort inhoud die
klopt voor dat jaar — de ISDE-bedragen, de rekengrondslag — en die mag niet
stilletjes meebewegen. Die worden dus gemeld, en een mens past ze aan. Op
1 januari 2027 zijn dat er vijf; nagemeten door de klok vooruit te zetten.

`npm run llms` bewaakt hetzelfde soort scheefgroei, maar dan tussen twee
bestanden die allebei op zichzelf kloppen. `sitemap.xml` wordt gegenereerd en
loopt dus vanzelf mee; `llms.txt` — de index die assistenten lezen — is
handwerk. Toen er zes pagina's bij kwamen, bleef die op de oude negen staan
zonder dat iets dat liet zien. De controle vergelijkt hem met het hoofdmenu,
want dat is precies de selectie die de site zelf belangrijk vindt; de
productpagina's horen in de sitemap en niet in `llms.txt`.

`npm run slop` bewaakt hetzelfde als de andere twee, maar dan aan de
tekstkant. Lezers noemen sites als deze "AI-slop", en dat verwijt gaat zelden
over lelijk en zelden over onjuist: het gaat over zinnen die alles raken en
niets zeggen. De scherpste omschrijving die ervan rondgaat is die van
slop-reacties op Reddit: ze prijzen in vage termen en er zit "niets in dat op
iets specifieks reageert".

Dat is meteen het tegengif. Een bewering met een bedrag, een datum of een
winkelnaam erbij kán geen slop zijn, want die kun je nakijken, en daar heeft
deze site zijn hele bestaansrecht van gemaakt. Vier dingen laten de run vallen:
woorden die alleen toon toevoegen, "niet X maar Y" als stijlfiguur, een beroep
op onderzoek zonder te zeggen welk, en een zin die ongemerkt op twee sites
staat, sinds de stemwissel ook "wij" waar "ik" hoort, en sinds kort het lange
streepje. Ze zijn zo gekozen dat ze bij invoering op nul stonden, dus alles wat
ze melden is nieuw. Een
controle die meteen honderd meldingen geeft, is een controle die je wegklikt.

Die laatste hangt samen met wat er in augustus 2026 veranderde: de sites
spraken als "wij" en zijn van één maker. Dat was niet alleen een toon maar een
onwaarheid. Alle 144 pagina's, de sjablonen in de generatoren, de schermteksten
en de opmerkingen in de gegevens spreken nu als "ik"; het commentaar in de code
niet, want dat leest geen bezoeker. De controle staat er omdat de terugval
makkelijk is: "wij tonen" is de standaardstem van elke vergelijkingssite.

De vijfde is een signaal en laat niets vallen: hoeveel alinea's van 25 woorden
of meer bevatten geen enkel getal en geen enkele verwijzing. Dat is een oordeel
en geen fout, want een alinea die een begrip uitlegt hoeft geen bedrag te
bevatten, maar het is wel de eerlijkste maat voor "staat hier iets". Bij
invoering: 64 van 185.

Bij het schrijven van die controle viel er meteen één zin door: "Experts
adviseren bij een nieuwe warmtepomp te kiezen voor een model met Modbus of
EEBUS." Welke experts stond er niet bij. Vervangen door het verschil zelf:
SG-ready kent vier standen, Modbus en EEBUS geven ook temperaturen, vermogens
en storingen door. Dat is korter en controleerbaar.

`npm run dode-regels` vangt wat de keuring niet kan vangen. Het opschrift boven
de hero stond op 12px in de merkkleur en rendeerde als 19px grijs, omdat
`.hero p` specifieker is dan `.hero-opschrift`. Formeel klopte dat: 19px staat
op de maatlat en het contrast was 5,4:1. De code deed alleen niet wat er stond.

Het meet dat niet door de cascade na te rekenen, maar door hem te vragen: elke
declaratie krijgt even `!important` mee, en verandert er dan iets aan wat de
browser uitrekent, dan verloor hij. Gemeld wordt alleen wat bij *elk* element
verliest, op *elke* pagina en *elke* breedte — een modifier die een deel van de
elementen overschrijft is immers precies waar modifiers voor zijn. De breedtes
komen uit de breekpunten in de stylesheet zelf, zodat elke mediaquery ergens
de smalste is die geldt en dus een eerlijke kans krijgt.

De keuring start een echte browser en is daarom de enige stap met een
afhankelijkheid. Die staat bewust niet in `package.json`; installeer hem als je
hem nodig hebt:

```
npm i --no-save playwright && npx playwright install chromium
```

Ontbreekt playwright, dan stopt de keuring met een foutmelding in plaats van
de controle stil over te slaan.

### Twee hulpmiddelen

`npm run stempel` zet het `?v=`-nummer van alle css en js binnen een site
gelijk. Alles onder `/assets/` ligt zeven dagen in de cache van de bezoeker,
dus verandert er iets aan de opmaak of de scripts, dan moet dit nummer mee.
Draai daarna de generatoren opnieuw: die lezen de stempel uit `style.css`.

`node scripts/vervang.mjs` doet zoeken-en-vervangen over meerdere bestanden,
maar schrijft niets tenzij je `--doen` meegeeft. Zonder die vlag toont het wat
er zou veranderen, met een telling per bestand. Die telling is het punt:
veranderen er 43 bestanden terwijl je er één bedoelde, dan zie je dat vóór het
schrijven.

## Steun-knop

Elke site heeft een `steun.html`: een korte pagina die om een kop koffie
vraagt. Er wijzen vier dingen naartoe: een item in het "Meer"-menu (dus op elke
pagina), een link in de voettekst, en een blok onderaan `index.html`,
`advies.html`, `rekenmodule.html` en `over-ons.html`. Nederlandse bezoekers
betalen met iDEAL, en daarvoor is een bunq.me-link gekozen: die is gratis,
verloopt niet, kan zonder KvK-inschrijving en stuurt de bezoeker naar een
betaalpagina in plaats van naar een betaalscript op de site zelf, en dat
scheelt een privacyverhaal.

**De betaallink staat op één plek per site**: in `sites/<site>/steun.html`, in
de enige `<a class="knop">` van het steunblok, met een commentaarregel ernaast.
Alle drie de sites wijzen naar dezelfde link, want er is één maker. Verandert
die link ooit, dan zijn het dus drie bestanden, en dat is te merken aan de
dagelijkse linkcontrole, die hem als externe link meeneemt.

Wat er niet gebeurt: de vraag staat nergens bovenaan, en nergens tussen de
prijzen. Een vergelijkingssite die om geld vraagt op de plek waar hij prijzen
toont, roept precies de vraag op die `over-ons.html` juist probeert weg te
nemen. Elk blok staat daarom onderaan zijn pagina, nadat de bezoeker heeft
gekregen waarvoor hij kwam. Om diezelfde reden staat er op `steun.html` een
kader dat een donatie geen positie, vermelding of score koopt.

Het menu-item is het enige met een icoon ernaast, en dat is met opzet: het is
ook het enige item dat om iets vraagt in plaats van ergens heen te wijzen.
Zonder dat verschil is het de negende grijze regel in een lijst van negen.

`steun.html` staat daardoor in het hoofdmenu, en `npm run llms` eist dan dat
hij ook in `llms.txt` staat. Dat is geen formaliteit: een assistent die de site
samenvat hoort te kunnen vertellen dat hij van één maker is en van koffie
draait.

## Waar bezoekers vandaan komen

`docs/zoekwoorden.md` verzamelt de woorden waarop gezocht wordt, wat daarvan
al gedekt is en welke pagina's ontbreken. Geen gemeten zoekvolumes — die
kunnen pas uit Search Console komen — wel de termen waarop de markt zelf
schrijft, en waarom die taal in 2026 verschuift.

### De datum in de sitemap

`<lastmod>` stond op elke URL op vandaag, elke dag. Eenenzestig pagina's
beweerden dus dagelijks gewijzigd te zijn. Technisch klopte dat net — de
dagelijkse prijsrun herschrijft de bestanden — maar inhoudelijk niet: wat er
veranderde was het datumstempel en een teller "34 dagen geleden" die 35 werd.

Google gebruikt `lastmod` zolang het betrouwbaar is en negeert het zodra het
dat niet is. Een sitemap waarin alles altijd van vandaag is, leert Google
precies dat. `kern/scripts/sitemap-datum.mjs` leest daarom de pagina's in vóór
het genereren en vergelijkt erna: verandert er niets van betekenis, dan houdt
de URL zijn oude datum. Welke teksten met de kalender meelopen zonder dat de
pagina anders is, staat in dat bestand, met per stuk waar het vandaan komt —
vastgesteld door de generator twee keer te draaien met een dag ertussen, niet
door te bedenken wat het zou kunnen zijn.

## Publiceren

Elke site heeft een eigen Vercel-project met **Root Directory** op zijn map in
`sites/`:

| Vercel-project | Root Directory | domein |
| --- | --- | --- |
| `batterijmaatje` | `sites/batterijmaatje` | batterijmaatje.nl |
| `zonnestroommaatje` | `sites/zonnestroommaatje` | zonnestroommaatje.nl |
| `warmtepompmaatje` | `sites/warmtepompmaatje` | warmtepompmaatje.nl |

De eerste twee heetten tot 2 oktober 2026 nog `thuisbatterijvergelijker` en
`zonnemaatje`, namen van vóór de rebranding. Dat las in het dashboard alsof er
sites waren samengevoegd. De automatisch gegenereerde `*.vercel.app`-adressen
houden hun oude naam; die zijn hernoemen niet waard, want er wijst niets naar.

Hier stond dat een push alleen de sites publiceert waar iets aan veranderd is.
Dat klopt niet: op 2 oktober maakten twee prijsruns zes publicaties aan, dus
alle drie de projecten bouwen bij elke push. Voor statische sites zonder
build-stap kost dat weinig, en het staat hier zodat de volgende die het opmerkt
niet gaat zoeken naar een storing. Wil je het wel zo hebben, dan is
*Ignored Build Step* per project de knop ervoor.

## Dagelijkse prijsupdate

`.github/workflows/update-prijzen.yml` draait één keer per dag voor alle drie de
sites achter elkaar. Alle drie hebben dezelfde npm-commando's (`prijzen`,
`genereer`, `links`) met een eigen generator erachter, dus alleen de map
verschilt. Handmatig draaien kan per site via **Actions → Dagelijkse
prijsupdate → Run workflow**.

De secrets `BOL_CLIENT_ID` en `BOL_CLIENT_SECRET` staan op repositoryniveau en
gelden dus voor alle drie. Ontbreken ze, dan slaat het prijsscript bol over en
blijft de oude prijs staan.

### Wat er verder elke dag meeloopt

Vier scripts draaien mee in `update-prijzen.yml` zonder de run te laten vallen.
Ze staan niet in `npm run controle`, want ze gaan over gegevens en niet over
code: wat ze melden los je op door iets na te kijken, niet door iets te
programmeren.

| script | wat het meldt |
| --- | --- |
| `scripts/zoekmachine.mjs` | titels, canonicals, JSON-LD en de sitemap; hierboven uitgelegd |
| `scripts/datumteksten.mjs` | teksten die aan een voorbije datum hangen |
| `scripts/vergelijkbaar.mjs` | een getal dat de gegevens in komt zonder dat vastligt wát het is |
| `scripts/controleer-links.mjs --zonder-winkels` | links die nergens heen gaan, minus de winkels - die heeft het prijsscript net gehad |
| `sites/<site>/scripts/nieuwe-modellen.mjs` | modellen bij winkels die wij nog niet hebben (`npm run nieuwe-modellen` in de map van de site) |
| `scripts/bronnen-nakijken.mjs` | getallen die hun eigen bronpagina tegenspreken; hieronder uitgelegd |

### Staan onze getallen nog op de pagina waar ze vandaan komen?

`npm run bronnen` houdt elk na te kijken getal tegen de fabrikantpagina waar het
vandaan komt. Dat is iets anders dan wat er al draaide: `controleer-links.mjs`
kijkt of een `product_url` nog *bestaat*, en `verse-data.mjs` of de prijzen vers
zijn. Of de *inhoud* achter die URL nog klopt met wat wij publiceren, controleerde
niemand.

Dat is de duurste onzichtbare fout die hier nog over was. Een fabrikant kan de
URL houden en de SCOP herzien. En de zes Stiebel WPL-maten zijn met de hand uit
een logboek overgenomen — zulke getallen horen controleerbaar te blijven, want ze
zijn precies waarvoor iemand deze site gebruikt. Nu gaat het om 199 waarden
(SCOP, geluid, aanvoertemperatuur, koudemiddel, garantie, capaciteit) over 99
productpagina's bij 63 fabrikanten.

Hij ankert elk getal aan een woord dat erbij hoort — "scop",
"geluidsniveau", "aanvoertemperatuur" — en kijkt alleen in die zin of onze waarde
er staat. Een getal los zoeken werkt niet: "57" staat op elke pagina wel ergens,
en dan bevestigt de controle alles en betekent hij niets. Dat levert vier
uitkomsten op, en juist het verschil ertussen is de hele waarde:

| uitkomst | wat het betekent |
| --- | --- |
| bevestigd | het ankerwoord staat op de pagina en onze waarde staat erbij |
| **afwijkend** | de pagina praat over de SCOP en noemt een ánder getal dan wij — hier moet iemand naar kijken |
| geen bron | het ankerwoord staat er niet; de pagina zet die specificatie niet in tekst (een tabblad via javascript, of een pdf) |
| geen productpagina | `product_url` noemt het product niet, meestal een homepage |

Die laatste twee zijn geen fouten, en dat onderscheid is niet cosmetisch. Zonder
de poort "noemt deze pagina het product eigenlijk?" zou elke regel waarvan
`product_url` naar een homepage wijst — `solar.huawei.com/nl/`,
`victronenergy.nl` — een afwijking melden, want "garantie" staat in elk menu en
ons getal staat er nergens bij. Dan loopt de lijst binnen een week vol met
pagina's die het goed doen, en een lijst die nooit leeg raakt leest niemand meer.
Precies de reden waarom `zoekmachine.mjs` buiten de ketting staat.

Draai hem niet hier maar via de werkstroom *Bronnen nakijken* (wekelijks op
zondag, en met de hand te starten). De ontwikkelomgeving komt niet bij
fabrikanten; `npm run bronnen -- --tellen` laat wél zien wát hij zou nakijken,
zonder iets op te halen. Wekelijks en niet dagelijks omdat 99 pagina's bij 63
fabrikanten ophalen die getallen niet sneller laat veranderen.

Het vergelijken zelf staat apart in `scripts/bron-vergelijken.mjs`, met proeven
op echte zinnen uit het logboek van de Stiebel-run. Dat is geen formaliteit: een
vergelijking die te makkelijk "bevestigd" zegt maakt de hele controle waardeloos,
en dat is aan de uitvoer niet te zien — die is dan juist mooi groen. Die proef
vond ook meteen een fout, namelijk dat onze 4,5 de 4,50 van de pagina niet
terugvond.

`vergelijkbaar.mjs` verdient een toelichting, want hij bewaakt de duurste fout
die deze sites kunnen maken. Vijf keer is hier een getal vergeleken met een getal
dat iets anders betekende: btw tegenover geen btw, bruto tegenover bruikbare
capaciteit, apparaat tegenover compleet geïnstalleerd, milde dag tegenover koude
dag, stuksprijs tegenover systeemprijs. Elke keer viel het pas op toen iemand het
toevallig zag. Deze week kwam daar een zesde bij die hij niet kón zien: de
SolarEdge stond op 6.200 euro voor twee modules terwijl de winkel-URL naar één
module wees. Dat is dezelfde soort fout, maar tussen twee bronnen in plaats van
binnen één kolom.

`nieuwe-modellen` heette tot voor kort `npm run modellen`, precies zoals de stap
in `kern-gelijk.yml` die iets heel anders doet - die toetst of we modelnamen goed
herkennen. Twee keer dezelfde opdracht in dezelfde workflow, één keer in een
sitemap en één keer erbuiten. Nu heet alleen de wortelversie nog `modellen`.

### Wanneer een prijs stilstaat

Niet elke winkel laat zich uitlezen, dus bij een deel van de producten staat
het bedrag stil terwijl de pagina eromheen elke dag ververst wordt. Daar zijn
drie signalen voor, op oplopende afstand van de bezoeker:

| na | wat er gebeurt |
| --- | --- |
| 14 dagen | de bezoeker ziet *prijs van 13 juli* onder het bedrag, op de kaart, in de regel en op de productpagina |
| 21 dagen | `update-prices.mjs` telt hem mee en de dagelijkse run wordt rood |
| 30 dagen | `verse-data.mjs` zet hem in het dagrapport, gegroepeerd naar wat eraan te doen valt |

De bezoeker weet het dus eerder dan de beheerder, en dat is de bedoeling: hij
rekent op dat bedrag en de beheerder niet.

`verse-data.mjs --streng` faalt hier níét op. Dat kan niet, want
`update-prices.mjs` zet `laatst_bijgewerkt` elke geslaagde run op vandaag, of
er nu iets veranderd is of niet. `--streng` beantwoordt de vraag "heeft de
leiding gedraaid?"; de stap in de workflow beantwoordt "heeft de leiding iets
opgeleverd?".

### Alleen nieuws maakt de run rood

De stap *Prijzen die aandacht vragen* werd eerst rood zodra er íéts aandacht
vroeg. Dat was elke dag: zevenentwintig punten op batterijmaatje, waarvan drie
winkels die bots weren met een 403 en dat blijven doen. Zo'n controle staat
binnen een week permanent rood en wordt dan behang — precies wat er in dezelfde
workflow al over een andere controle stond:

> Faalt de run niet: een controle die rood kan blijven staan omdat een
> fabrikant iets niet publiceert, leest niemand meer.

Dit geldt op alle drie de sites. Zonnestroommaatje en warmtepompmaatje vingen
elke fout eerst op in één `catch` die "oude prijs blijft staan" logde en verder
niets: geen onderscheid tussen een winkel die ons weert en een pagina die weg
is, en geen ouderdomscontrole. In de workflow zag dat er hetzelfde uit als
"niets aan de hand". `kern/scripts/prijs-signalen.mjs` doet dat nu voor
allebei; batterijmaatje heeft zijn eigen, uitgebreidere versie inline.

`data/prijs-aandacht.json` houdt per site bij wat we al weten, met de datum
waarop elk punt voor het eerst opdook. Wat eraf gaat wordt als opgelost gemeld;
de rest is werkvoorraad en staat in het rapport. Wil je een punt vergeten, haal
de regel uit dat bestand.

Nieuws is niet hetzelfde als vandaag voor het eerst gezien. Een punt gaat bij
de eerste keer in de lijst met `"bevestigd": false` en houdt niets tegen; staat
het er de volgende run nog, dan is het nieuws en wordt de run rood; is het dan
weg, dan verdwijnt het stil, want het is nooit gemeld. Dat scheelde op
27 augustus zes van de zeven meldingen: om 16:41 stond zonnestroommaatje rood
op vier omvormers bij Zonnige Winkel en op twee 403's, en om 17:45 gaven ze
alle zes gewoon weer een prijs. Winkels haperen, en zonder die voorwaarde werd
de run daar rood van — en de dag erna nog eens.

Een prijs die van € 850 naar € 860 kruipt is geen nieuw punt — de sleutel is
soort plus product plus winkel, zonder bedrag. Van "geweigerd" naar
"onbereikbaar" is dat wél, want dat is een andere storing.

### Winkels die een gewoon verzoek weigeren

Drie winkels antwoorden met 403 hoeveel headers we ook meesturen, en twee
andere tonen wel een pagina maar vullen de prijs pas in de browser in. Dat is
dezelfde oorzaak van twee kanten: wie zo weigert kijkt naar de
TLS-vingerafdruk en naar of er javascript draait.

Daarom valt `prijs-uitlezen.mjs` terug op een echte browser — bij een 403 of
429, en bij een pagina die wél antwoordt maar geen bedrag prijsgeeft. Alleen
als terugval: een browser starten kost een paar seconden, en voor de veertig
winkels die gewoon antwoorden is dat weggegooide tijd.

Playwright staat niet in `package.json`; de workflow installeert hem in de
prijsstap. Ontbreekt hij, dan gedraagt alles zich precies zoals eerst en zegt
het rapport dat erbij — "de winkel weigert" en "we hebben het niet geprobeerd"
zijn twee verschillende dingen, en alleen het eerste vraagt om actie.

### Wat staat er op die pagina?

Blijft een prijs op "te controleren" staan, dan is de melding zelf niet genoeg
om te beslissen. "solaredge-home-battery-48v @ Thuisbatterij Nederland:
€6200 → €1495 (-76%)" kan betekenen dat de winkel gehalveerd is, of dat het
script de losse module van 4,6 kWh leest op een pagina waar ook het pakket van
9,2 kWh staat. In het eerste geval moet er een prijs veranderen, in het tweede
een URL.

`npm run winkelpagina -- <url> --naam "..."` toont wat er op zo'n pagina staat:
via welke weg hij binnenkwam, wat elke uitleesroute apart oplevert, en elk
bedrag op de pagina met de tekst eromheen. Bewust zonder oordeel — het
overnemen van dat oordeel door een script is precies wat die meldingen
veroorzaakte.

Draai hem niet hier maar via de werkstroom *Wat staat er op een winkelpagina*
(met de hand te starten, adressen als invoer). De ontwikkelomgeving komt niet
bij winkels: de egress-proxy laat alleen npm en pypi door, dus curl en fetch
krijgen daar een 403 van de proxy in plaats van een antwoord van de winkel. Een
runner komt er wel bij. Die werkstroom schrijft niets weg.

**Geef de productnaam mee.** Zonder `--naam` draait elke route zonder
ankerwoorden, en dan lijkt het alsof het script niets kan lezen terwijl het in
de echte run wél iets leest. Dat is één keer misgegaan: bij Frank Energie
meldde de diagnose "geen prijs" langs alle zes de routes, en met de naam erbij
kwam de zichtbare-tekstroute gewoon met € 4.945.

**En hij kan meer dan bedragen.** Met `--zoek "scop,dB(A),aanvoertemperatuur"`
toont hij elk stuk zichtbare tekst waar een van die woorden in staat, met de
zin eromheen. Dat is voor de andere vraag die deze omgeving niet kan
beantwoorden: bij het opnemen van een nieuw model gaat het niet over de prijs
maar over de SCOP, het geluidsvermogen en de maximale aanvoertemperatuur, en
die staan in gewone zinnen op de fabrikantpagina. Voorheen moest dat met de
hand uit een datasheet komen.

Het kiest nog steeds niets. Een script dat zelf "SCOP 4,8" uit een zin vist,
vist er vroeg of laat de SCOP van het verkeerde model uit - precies de fout
waar `REDACTIE.md` een hoofdstuk over heeft.

**En met `--links "acs-classic"` toont hij de adressen op de pagina** waar dat
stuk tekst in het adres of in de linktekst staat, relatief adres opgelost tegen
de pagina zelf. Dat is de stap vóór `--zoek`: die laatste gaf op de
Stiebel-categoriepagina netjes de hele WPL ACS classic-familie, maar dat zijn
namen en geen adressen, en de specificaties staan een pagina verder.

Raden werkt daar niet. Een verzonnen pad gaf eerst een 404, en daarna bleek dat
Stiebel bij een onbekend adres helemaal geen 404 stuurt maar een vangnetpagina:
twee volgende gokken kwamen met een nette 200 terug, met de familie-introductie
erop in plaats van specificaties. Aan de statuscode zie je dus niet of je goed
zat, en dan is raden niet alleen duur maar ook niet te controleren. Met de links
erbij is het één run: categoriepagina lezen, adressen eruit, die lezen. Dat is
het pad dat een mens met een browser ook zou lopen, en zo kwamen de SCOP, het
geluidsvermogen en het koudemiddel van alle zes WPL-maten in één keer binnen.

**Twee winkels weigeren een runner,** en dat scheelt van een storing: Boilermarkt
geeft HTTP 500 op elk adres dat ik probeerde, bol.com geeft 403. Dat is geen
kapot script en ook geen verlopen URL. Voor bol betekent het dat de
kandidatenlijst van batterijmaatje - die vrijwel helemaal uit bol-adressen
bestaat - niet via deze werkstroom na te kijken is.

### Een prijs die mensenwerk blijft

Twee velden op een aanbieding zeggen tegen de dagelijkse ronde wat ze ermee aan
moet. Ze staan naast elkaar omdat ze makkelijk verward worden.

| veld | betekenis | wat de ronde doet |
| --- | --- | --- |
| `"prijs_controle": "handmatig"` | de winkel toont wel een bedrag, maar niet ons bedrag | bezoekt de pagina nog wel (zodat een dode link opvalt) en schrijft de prijs nooit over |
| `"niet_leverbaar": true` | de winkel voert het artikel niet meer | de aanbieding telt niet mee in de prijs, de markup en de foto-zoektocht; de URL blijft staan zodat de markering vanzelf afvalt als het artikel terugkomt |

`handmatig` is voor een pagina waar het bedrag wel staat maar niet bij ons
product hoort. Thuisbatterij Nederland verkoopt de SolarEdge per module, dus de
metatag van de 4,6 kWh-pagina staat op € 1.495 terwijl wij de 9,2 kWh van
€ 2.990 tonen - zonder deze markering schrijft de ronde elke ochtend de halve
accu terug. Frank Energie zet acht bedragen bij dezelfde SMILE G3-T10, van
€ 4.945 tot € 14.895, en welke daarvan onze 8,2 kWh is staat er niet bij.

Zet het op de aanbieding en niet op het product, tenzij het hele product
mensenwerk is (een offerteprijs, een schatting). `verse-data.mjs` rekent een
product als mensenwerk zodra elke aanbieding die nog meetelt zo gemarkeerd
staat, net als `update-prices.mjs` al deed.

## Productfoto's ophalen

Zonder `image` in de markup toont Google geen productresultaat, en dat gold
voor 58 van de 85 productpagina's. `npm run fotos` haalt een foto op bij de
fabrikant en daarna bij elke winkel die het artikel voert, zet hem om naar webp
van 900 pixels breed en vult `afbeelding`, `afbeelding_bron`,
`afbeelding_herkomst` (het beeldadres) en `afbeelding_via` (de pagina waar we
het vonden).

`afbeelding_via` is er later bij gekomen. Van de 59 foto's die er al stonden
zijn er 21 met terugwerkende kracht ingevuld - daar is de host van het beeld
precies die van een pagina die het script voor dat product bezoekt, dus dat
staat vast. Bij 11 kan dat niet (het beeld staat op een CDN) en 27 zijn met de
hand toegevoegd en hebben ook geen `afbeelding_herkomst`. Die zijn leeg
gelaten; een veld dat zegt waar iets vandaan komt is waardeloos zodra je er
gokken in zet.

```
npm run fotos -- --droog                 tonen wat hij zou kiezen, niets schrijven
npm run fotos -- --site warmtepompmaatje  één site
npm run fotos -- --alleen nibe-s2125     één of meer product-id's
```

Ook dit draait op een runner (werkstroom *Productfoto's ophalen*), en om
dezelfde reden. Hij commit naar een eigen tak met het runnummer erachter, nooit
naar de hoofdtak, want **het script kiest niet welke foto goed genoeg is**. Dat
blijft mensenwerk, en dat is geen formaliteit: van 33 kandidaten in de laatste
ronde overleefden er drie het nakijken. De rest was een hand op een thermostaat,
een gevel met een fiets ervoor, een energielabel, of - vaker - de foto van een
ánder model dan wij tonen. Het adres verraadt dat: `aiko-445wp-abc-n-type` bij
een paneel van 455 Wp, `chc.-monoblock` bij een Wolf CHA-07.

Wat het script wél zelf beslist ligt vast in `scripts/productfotos.test.mjs`:
welke adressen kandidaat zijn, in welke volgorde, en wanneer hij mag ophouden
met zoeken. Die laatste grens is de belangrijkste. Het merk telt niet mee, want
op het domein van de fabrikant staat dat in élke bestandsnaam - `BYD_transparent.png`
won daardoor van de echte productfoto's die eronder stonden. Alleen het model
onderscheidt, en een sfeerbeeld sluit de zoektocht nooit af, ook al noemt het
adres het model vier keer.
