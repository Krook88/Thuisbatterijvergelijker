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
| `npm run dode-regels` | declaraties die er wel staan maar overal worden overruled |

Eén controle staat er met opzet *niet* bij. `npm run zoekmachine` kijkt wat een
zoekmachine van de sites te zien krijgt - titellengte, canonical, geldige
JSON-LD, `availability` en `priceValidUntil` in de offers, en of de sitemap en
de pagina's elkaar dekken. Die hoort niet in de ketting omdat een deel van zijn
meldingen niet met code op te lossen is: "geen prijs in het zoekresultaat, de
prijs is te oud" gaat weg door een prijs na te kijken, niet door iets te
programmeren. In de ketting zou hij binnen een week permanent rood staan, en
dat is precies wat dit bestand verderop over andere controles zegt. Draai hem
als je aan de vindbaarheid werkt; `--streng` geeft een foutcode terug.

Hij drukt onderaan ook twee getallen af die geen melding zijn: hoeveel
productpagina's geen `image` in de markup hebben, en hoeveel er geen `offers`
dragen. Google toont een productresultaat - foto, prijs, beschikbaarheid naast
het blauwe linkje - alleen als allebei er staan. Dat is niet aan de pagina te
zien, want die werkt gewoon.

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
`sites/`. Een push publiceert de sites waar iets aan veranderd is; Vercel
bepaalt dat zelf aan de hand van de gewijzigde paden.

## Dagelijkse prijsupdate

`.github/workflows/update-prijzen.yml` draait één keer per dag voor alle drie de
sites achter elkaar. Alle drie hebben dezelfde npm-commando's (`prijzen`,
`genereer`, `links`) met een eigen generator erachter, dus alleen de map
verschilt. Handmatig draaien kan per site via **Actions → Dagelijkse
prijsupdate → Run workflow**.

De secrets `BOL_CLIENT_ID` en `BOL_CLIENT_SECRET` staan op repositoryniveau en
gelden dus voor alle drie. Ontbreken ze, dan slaat het prijsscript bol over en
blijft de oude prijs staan.

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
