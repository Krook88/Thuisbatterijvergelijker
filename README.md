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
| `npm run keuring` | contrast, aanraakvlakken, tekstmaten en javascriptfouten op elke pagina van de drie sites, op 1280 en 390 pixels |
| `npm run dode-regels` | declaraties die er wel staan maar overal worden overruled |

`npm run workflows` kwam uit een eigen misser. Een stap die de dagelijkse
prijsrun rood moest laten worden bij verouderde prijzen belandde onderaan het
bestand, en dus in het verkeerde blok. Hij keek naar `steps.keuze` en
`steps.prijzen`, die alleen in het blok erboven bestaan. GitHub keurt dat niet
af: zo'n verwijzing wordt een lege tekst, de `if` is altijd onwaar, en de stap
slaat zichzelf elke dag over. In de lijst staat hij dan grijs, alsof dat de
bedoeling was.

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

## Waar bezoekers vandaan komen

`docs/zoekwoorden.md` verzamelt de woorden waarop gezocht wordt, wat daarvan
al gedekt is en welke pagina's ontbreken. Geen gemeten zoekvolumes — die
kunnen pas uit Search Console komen — wel de termen waarop de markt zelf
schrijft, en waarom die taal in 2026 verschuift.

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
