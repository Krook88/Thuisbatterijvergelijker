# 🔋 Batterijmaatje.nl

Een gebruiksvriendelijke, statische vergelijkingssite voor thuisbatterijen op de Nederlandse markt. Draait op Vercel: geen build-stap, geen server nodig.

## Wat kan de site?

- **Vergelijken** van de populairste thuisbatterijen op capaciteit, vermogen, prijs en prijs per kWh opslag.
- **Filteren** op type (plug-in, AC-gekoppeld, hybride), capaciteit, installatiegemak, merk, Homey, Home Assistant, dynamisch energiecontract en actuele aanbiedingen.
- **Koppelgemak-score** (1 tot 5 sterren) die laat zien hoe makkelijk een batterij aan een bestaand zonnepanelensysteem te koppelen is.
- **Kaart- en tabelweergave**, plus zij-aan-zij vergelijken van maximaal 3 batterijen.
- **Directe links** naar de winkel of aanbieder met de beste prijs ("Bekijk aanbieding").
- **Rekenmodule terugverdientijd** (`rekenmodule.html`): berekent per batterij en per situatie (met of zonder zonnepanelen, vast of dynamisch contract, slim laden en ontladen op uurprijzen) de jaarlijkse opbrengst en terugverdientijd, met instelbare en gedocumenteerde aannames.
- **Keuzehulp** (`advies.html`): adviseert op basis van verbruik, zonnepanelen, contract en wensen de juiste accugrootte (bandbreedte in kWh) en de drie best passende batterijen uit de vergelijker.
- **Uitlegpagina** over de actuele overheidsregels: einde salderingsregeling per 2027, terugleverkosten, btw en subsidies, met bronvermelding.

## Structuur

```
index.html                      De vergelijker
rekenmodule.html                Rekenmodule terugverdientijd
regelgeving.html                Uitleg regels en subsidies
assets/style.css                Vormgeving
assets/app.js                   Filter-, sorteer- en renderlogica
assets/rekenmodule.js           Rekenlogica terugverdientijd
data/batterijen.json            Alle batterijgegevens, prijzen en aanbiedingen
assets/prijs.js                 Prijsvergelijking: één vergelijkprijs incl. btw
assets/kaart.js                 Opmaak van een batterijkaart, gedeeld met de generator
assets/iconen.js                Lijniconen (Lucide), gedeeld met de generator
api/contact.js                  Serverloze functie achter het contactformulier
scripts/update-prices.mjs       Dagelijks prijsupdate-script (Node.js)
scripts/controleer-links.mjs    Controleert interne en externe links
vercel.json                     Cache- en beveiligingsheaders voor Vercel
.github/workflows/
  update-prijzen.yml            Dagelijkse Action: prijzen, pagina's en linkcontrole
```

## De vergelijker staat in de HTML

`index.html` bevat de 41 kaarten kant-en-klaar tussen de markeringen
`<!-- kaarten:begin -->` en `<!-- kaarten:eind -->`. Die worden geschreven door
`scripts/genereer-batterijpaginas.mjs`, met de opmaak uit `assets/kaart.js` -
dezelfde module die de browser gebruikt, zodat er geen verschil kan ontstaan.
Zodra de bezoeker filtert of sorteert neemt `assets/app.js` het over.

Pas je iets aan de kaart aan, doe dat dan in `assets/kaart.js` en draai daarna
`npm run genereer`. Bewerk de kaarten nooit met de hand in `index.html`: die
worden bij de eerstvolgende generatie overschreven.

## Prijzen vergelijkbaar houden

Winkelprijzen komen zowel incl. als excl. btw binnen en dekken niet altijd hetzelfde.
`assets/prijs.js` rekent alles om naar één vergelijkprijs incl. btw en is de enige plek
waar korting wordt bepaald; de vergelijker, de keuzehulp, de rekenmodule en de generator
van de batterijpagina's gebruiken dezelfde functies. Voeg je een aanbieding toe waarvan
de prijs excl. btw is, zet dan `"btw_inbegrepen": false` bij die aanbieding. Dekt hij
minder dan de richtprijs (bijvoorbeeld zonder P1-meter), zet dan `"omvat": "excl.
P1-meter"`; dan wordt het verschil niet als korting getoond.

## Publiceren

De site staat op Vercel en is gekoppeld aan deze repository: elke push naar de
productiebranch levert automatisch een nieuwe versie op `https://batterijmaatje.nl/`.
Andere branches krijgen een preview-URL die als testomgeving dient.

Cache- en beveiligingsheaders staan in `vercel.json`. Het opzetten van een project, het
koppelen van een domein en de bijbehorende DNS-stappen staan in
[VERCEL-DEPLOY.md](VERCEL-DEPLOY.md).

## Dagelijkse prijsupdate

De workflow `update-prijzen.yml` draait elke ochtend en:

1. bezoekt de winkel-URL's uit `data/batterijen.json`;
2. leest de actuele prijs uit structured data (schema.org JSON-LD), meta-tags of als laatste redmiddel de paginatekst;
3. accepteert een nieuwe prijs alleen als die dicht genoeg bij de vorige ligt (75% tot 125%); grotere sprongen komen in de samenvatting van de run te staan voor een menselijke controle, want die duiden meestal op een andere variant of een prijs excl. btw;
4. commit de wijzigingen, waarna de site opnieuw wordt gepubliceerd.

Winkels die zich niet automatisch laten uitlezen behouden de laatst bekende prijs. De datum van de laatste succesvolle controle staat per aanbieding in het databestand en per batterij zichtbaar op de site.

Handmatig draaien kan ook: `node scripts/update-prices.mjs` (Node.js 18 of hoger) of via **Actions → Dagelijkse prijsupdate → Run workflow**.

## Data bijwerken of batterijen toevoegen

Alle inhoud staat in `data/batterijen.json`. Voeg een object toe aan de `batterijen`-array met dezelfde velden als de bestaande items. De site pikt nieuwe items automatisch op; er is geen build-stap.

## Contactformulier en linkcontrole

Het contactformulier draait op een serverloze functie (`api/contact.js`) die verstuurt via
de mailserver van TransIP; er is geen externe maildienst en geen DNS-wijziging voor nodig.
Zonder inloggegevens toont het formulier netjes het mailadres in plaats van berichten te
verliezen. De linkcontrole draait mee in de dagelijkse
prijsupdate: het prijsscript meldt zelf welke winkelpagina's verdwenen zijn (het bezoekt
ze toch al), en `controleer-links.mjs` doet de interne links en de overige externe links. Beide staan uitgelegd in
[VERCEL-DEPLOY.md](VERCEL-DEPLOY.md).

## Disclaimer

Prijzen, specificaties en regelgeving veranderen regelmatig. De prijs en voorwaarden op de website van de aanbieder zijn altijd leidend.
