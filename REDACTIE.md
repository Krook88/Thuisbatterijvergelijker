# Wat komt er op de site, en wat niet

De prijzen werken zichzelf dagelijks bij en `scripts/nieuwe-modellen.mjs`
meldt elke dag welke modellen er in winkels staan die wij niet hebben. Wat er
vervolgens mee gebeurt is mensenwerk, en dat is met opzet zo: een verkeerd
toegevoegd model krijgt een pagina, een prijs en een plek in de vergelijking
zonder dat iemand de specificaties heeft gezien.

Dit bestand legt de keuzes vast die anders elke week opnieuw ter discussie
staan. Wie een kandidaat uit `data/nieuwe-modellen.json` beoordeelt, kijkt
eerst hier.

## Capaciteit: we vergelijken op wat je er echt uit haalt

Fabrikanten geven twee getallen op. De bruto pakketmaat ("nominaal") en wat je
er werkelijk uit haalt ("bruikbaar"), en dat scheelt tot twintig procent. Zet je
die naast elkaar zonder onderscheid, dan lijkt een batterij goedkoper per kWh
zonder dat er iets goedkoper is - precies dezelfde fout als een prijs excl. btw
naast een prijs incl. btw zetten.

**Norm: `capaciteit_kwh` is de bruikbare capaciteit.** Dat is wat de besparing
bepaalt, en dus wat de bezoeker vergelijkt.

Dat dit ertoe doet bleek bij de Zendure SolarFlow 2400 Pro. Winkels noemden
2,88 kWh, de fabrikant 2,4 kWh, en dat leek een tegenspraak. Het waren twee
verschillende maten: 2,88 bruto, 2,4 bruikbaar bij 90% ontlaaddiepte. Op de
site ging dat model daarmee van 420 naar 504 euro per kWh - van middenmoot naar
de duurste in zijn klasse.

Per model leggen we vast waar het getal vandaan komt:

```json
"capaciteit_kwh": 2.4,
"capaciteit_soort": "bruikbaar",
"capaciteit_nominaal_kwh": 2.88
```

`capaciteit_soort` is `"bruikbaar"`, `"nominaal"`, of afwezig als het niet is
vastgesteld. Zolang het niet vaststaat hoort de site dat te zeggen in plaats van
te doen alsof; `Prijs.capaciteitToelichting()` levert die tekst.

`npm run capaciteit` laat zien hoe ver we zijn en waar je het eerst moet kijken.

## Warmtepompen: onder welke omstandigheden geldt een getal?

Bij een warmtepomp betekent hetzelfde getal verschillende dingen, afhankelijk
van waar het gemeten is. Dat is dezelfde valkuil als btw bij prijzen en bruto
bij capaciteit, maar hier zit hij op de twee cijfers waar een koper zijn keuze
op baseert.

**Vermogen.** "7 kW" is meestal gemeten bij 7 graden buiten - een milde dag,
precies wanneer je de pomp het minst nodig hebt. De Stiebel WPL 07 ACS heet 7 kW
en levert er 2,08 bij A2/W35. Wie op het typenummer afgaat koopt een pomp die
zijn huis op de koudste dag niet warm krijgt.

**SCOP.** Het seizoensrendement hangt af van de aanvoertemperatuur. Bij 35
graden (vloerverwarming) haalt een pomp ruim een punt meer dan bij 55 graden
(radiatoren in een bestaande woning). De hele lijst ligt tussen 4,5 en 5,0, dus
dat verschil is groter dan de spreiding die de site laat zien.

**Norm:**

```json
"vermogen_kw": 5, "vermogen_conditie": "Prated",
"scop": 4.7,      "scop_conditie": "35"
```

- `vermogen_kw` is Prated volgens EU 811/2013: het vermogen bij de
  ontwerpbuitentemperatuur (-10 graden bij gemiddeld klimaat).
- `scop` is de labelwaarde bij 35 graden aanvoer, gemiddeld klimaat.

Waarom Prated en niet letterlijk A-7/W35, wat inhoudelijk de vraag is: dat
laatste staat in datasheets en lang niet elke fabrikant publiceert het. Prated
staat voor elke pomp in de ISDE-meldcodelijst van RVO, is in Europese
regelgeving gedefinieerd, en is het getal waarop de Nederlandse subsidie is
gebaseerd. Het meet hetzelfde wat we willen weten - haalt deze pomp het op een
koude dag - maar uit een bron die volledig en controleerbaar is.

Dat is meteen de route om dit in te vullen: **alle dertig pompen hebben al een
`isde_meldcode`.** De meldcodelijst van RVO koppelt die code aan het thermisch
vermogen volgens EU 811/2013. Dat maakt dit geen dertig keer handwerk maar een
script, net zoals de bol-API dat voor de batterijprijzen is.

`npm run condities` laat zien hoever we zijn.

## Capaciteitsvarianten van hetzelfde systeem: één regel

De Huawei LUNA2000 staat in 7, 10 en 15 kWh in de schappen. Die krijgen samen
één regel in de vergelijking, met in de omschrijving welke maten er zijn.

Waarom: de vergelijker moet een keuze makkelijker maken, niet completer. Drie
kaarten van dezelfde fabrikant naast elkaar duwen de andere merken van het
scherm zonder dat de bezoeker iets leert. Wie een specifieke maat zoekt vindt
die via de omschrijving en de winkellink.

Wat dit kost: iemand die op "LUNA2000 15 kWh" zoekt komt niet op een eigen
pagina uit. Dat is bewust ingeruild tegen een leesbare lijst.

Let op de grens van deze regel: een opvolger is geen variant. De LUNA2000-S1
heeft een andere modulemaat, andere behuizing en andere garantie dan de S0 die
wij hebben - dat zijn twee systemen en dus twee regels.

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

Kijk wel naar het formaat. Onze lijst staat vol panelen van 1762 mm; de Jinko
470 Wp is 1903 mm en de Denim 490 Wp 1909 mm. Dat past niet vanzelf op een dak
dat op die kleinere maat is ingedeeld, dus dat hoort in de tekst te staan.

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

Dat laatste gaat over aanbieders zonder merk, niet over kleine merken. PEGO
heeft een eigen productlijn en een eigen webshop en valt er dus niet onder - die
beoordeel je op zijn eigen merites.

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
