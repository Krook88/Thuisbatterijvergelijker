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
