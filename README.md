# Maatje-sites

Drie onafhankelijke vergelijkingssites in één repository:

| map | domein | onderwerp |
| --- | --- | --- |
| `sites/batterijmaatje` | batterijmaatje.nl | thuisbatterijen |
| `sites/zonnestroommaatje` | zonnestroommaatje.nl | zonnepanelen en omvormers |
| `sites/warmtepompmaatje` | warmtepompmaatje.nl | warmtepompen |

Elke site is statisch: geen build-stap, geen framework. In elke sitemap staat
een eigen `README.md` met de details van die site.

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

`npm run controle` draait de vier controles achter elkaar, en dat is precies
wat CI ook doet:

| Commando | Wat het bewaakt |
| --- | --- |
| `npm run kern:controleer` | de sites lopen gelijk met `kern/`, en de `?v=`-nummers binnen een site lopen gelijk |
| `npm test` | de proeven bij het prijsrekenen en het uitlezen van winkelpagina's |
| `npm run modellen` | het herkennen van modelnamen, dat anders stil faalt |
| `npm run workflows` | stappen die naar een stap in een ander blok verwijzen en zichzelf daardoor overslaan |
| `npm run datums` | teksten die aan een voorbije datum hangen, en jaartallen in titels die achterlopen |
| `npm run llms` | `llms.txt` loopt achter op het menu van de site |
| `npm run keuring` | contrast, aanraakvlakken, tekstmaten en javascriptfouten op elke pagina van de drie sites, op 1280 en 390 pixels |
| `npm run dode-regels` | declaraties die er wel staan maar overal worden overruled |

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
vraagt, met een link vanuit de voettekst en een blok onderaan `over-ons.html`
en `rekenmodule.html`. Nederlandse bezoekers betalen met iDEAL, en daarvoor is
een bunq.me-link gekozen: die is gratis, verloopt niet, kan zonder
KvK-inschrijving en stuurt de bezoeker naar een betaalpagina in plaats van naar
een betaalscript op onze site — dat scheelt een privacyverhaal.

**De betaallink staat op één plek per site**: in `sites/<site>/steun.html`, in
de enige `<a class="knop">` van het steunblok, met een commentaarregel ernaast.
Zolang daar `https://bunq.me/JOUWNAAM` staat, wijst de knop nergens heen; de
dagelijkse linkcontrole meldt hem dan als kapotte externe link. Vervang hem dus
vóór de eerste publicatie, op alle drie de sites.

De knop is bewust niet in het hoofdmenu gezet en staat niet op de vergelijker
zelf. Een vergelijkingssite die om geld vraagt op de plek waar hij prijzen
toont, roept precies de vraag op die `over-ons.html` juist probeert weg te
nemen. Het blok staat daarom onderaan de twee pagina's waar de bezoeker net
iets gekregen heeft, en verder in de voettekst.

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
waarop elk punt voor het eerst opdook. Alleen wat daar niet in staat is nieuws
en maakt de run rood; wat eraf gaat wordt als opgelost gemeld; de rest is
werkvoorraad en staat in het rapport. Wil je een punt vergeten, haal de regel
uit dat bestand.

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
