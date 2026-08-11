# Wat komt er op de site, en wat niet

De prijzen werken zichzelf dagelijks bij en `scripts/nieuwe-modellen.mjs`
meldt elke dag welke modellen er in winkels staan die wij niet hebben. Wat er
vervolgens mee gebeurt is mensenwerk, en dat is met opzet zo: een verkeerd
toegevoegd model krijgt een pagina, een prijs en een plek in de vergelijking
zonder dat iemand de specificaties heeft gezien.

Dit bestand legt de keuzes vast die anders elke week opnieuw ter discussie
staan. Wie een kandidaat uit `data/nieuwe-modellen.json` beoordeelt, kijkt
eerst hier.

## Capaciteitsvarianten van hetzelfde systeem: één regel

De Huawei LUNA2000 staat in 7, 10 en 15 kWh in de schappen. Die krijgen samen
één regel in de vergelijking, met in de omschrijving welke maten er zijn.

Waarom: de vergelijker moet een keuze makkelijker maken, niet completer. Drie
kaarten van dezelfde fabrikant naast elkaar duwen de andere merken van het
scherm zonder dat de bezoeker iets leert. Wie een specifieke maat zoekt vindt
die via de omschrijving en de winkellink.

Wat dit kost: iemand die op "LUNA2000 15 kWh" zoekt komt niet op een eigen
pagina uit. Dat is bewust ingeruild tegen een leesbare lijst.

## Bundels en sets: wel opnemen

Een set - de Jackery SolarVault 3 met één, twee of drie uitbreidingsbatterijen,
een warmtepomp met binnenunit erbij - krijgt een eigen regel. Dat is wat mensen
kopen, dus dat hoort vergeleken te worden.

**Voorwaarde, en die is niet vrijblijvend:** bij zo'n aanbieding moet het veld
`omvat` gevuld zijn met wat er precies in zit ("incl. 2x BP2500 uitbreiding").
Zolang dat veld gevuld is, behandelt `prijs.js` de aanbieding niet als hetzelfde
product als de richtprijs, en wordt er dus geen korting berekend die er niet is.
Zonder dat veld vergelijkt de site een set van drie batterijen met een losse en
lijkt de set spectaculair duur.

Een set zonder `omvat` is dus geen slordigheid maar een fout in de vergelijking.

## Paneelvarianten: hogere vermogens erbij

Van een serie die we al volgen nemen we ook de hogere vermogens op. De Jinko
Tiger Neo staat bij ons op 440 Wp terwijl er inmiddels 455, 470 en 490 Wp is;
wie een klein dak heeft wil juist het hoogste vermogen per paneel.

Grens: `scripts/nieuwe-modellen.json` meldt panelen van 400 tot 500 Wp. Daarboven
gaat het om panelen voor bedrijfsdaken, en die horen niet op een site voor
huishoudens. Loopt de markt door, dan gaat die grens mee omhoog - dat is één
regel in de configuratie.

## Wat we niet opnemen

- Draagbare powerstations, kampeeraccu's en noodstroomkoffers. Die staan vol in
  de zoekresultaten omdat ze dezelfde woorden gebruiken, maar ze doen niet
  waarvoor iemand op deze site komt.
- Losse uitbreidingsmodules en toebehoren (uitbreidingsunit, energiebeheerunit,
  wandbeugel, kabel).
- Installatiediensten ("laten aansluiten door ...").
- Aanbieders zonder eigen merk die andermans cellen doorverkopen onder een
  naamloze titel ("Thuisbatterij 16Kwh LIFePO4"). Er valt niets over te
  schrijven dat de bezoeker verder helpt, en de aanbieder is er volgend jaar
  mogelijk niet meer.

Een kandidaat die hieronder valt hoort in `scripts/nieuwe-modellen.json` onder
`afgewezen`; dan komt hij niet terug.

## Als een winkel ons model anders noemt

Wij noteren "SolarCube AS-BBL09", bol schrijft "Solarcube 4.8 kWh". Het model
wordt dan elke dag als nieuw gemeld terwijl het er allang staat. Zet in dat
geval de winkelnaam in `zoeknamen` bij het model in `data/`:

```json
"zoeknamen": ["SolarCube 4.8 kWh"]
```

Niet het modelveld aanpassen: het artikelnummer daarin is echte informatie voor
wie bij een installateur bestelt.
