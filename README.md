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
scripts/update-prices.mjs       Dagelijks prijsupdate-script (Node.js)
vercel.json                     Cache- en beveiligingsheaders voor Vercel
.github/workflows/
  update-prijzen.yml            Dagelijkse GitHub Action die prijzen ververst
```

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
3. accepteert een nieuwe prijs alleen als die plausibel is ten opzichte van de vorige prijs (tussen 40% en 250%);
4. commit de wijzigingen, waarna de site opnieuw wordt gepubliceerd.

Winkels die zich niet automatisch laten uitlezen behouden de laatst bekende prijs. De datum van de laatste succesvolle controle staat per aanbieding in het databestand en per batterij zichtbaar op de site.

Handmatig draaien kan ook: `node scripts/update-prices.mjs` (Node.js 18 of hoger) of via **Actions → Dagelijkse prijsupdate → Run workflow**.

## Data bijwerken of batterijen toevoegen

Alle inhoud staat in `data/batterijen.json`. Voeg een object toe aan de `batterijen`-array met dezelfde velden als de bestaande items. De site pikt nieuwe items automatisch op; er is geen build-stap.

## Disclaimer

Prijzen, specificaties en regelgeving veranderen regelmatig. De prijs en voorwaarden op de website van de aanbieder zijn altijd leidend.
