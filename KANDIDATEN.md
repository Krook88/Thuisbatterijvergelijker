# Kandidaten, uitgezocht

Wat `scripts/nieuwe-modellen.mjs` heeft gemeld, met de specificaties erbij die
ik heb kunnen vinden. Bedoeld als voorwerk voor de wekelijkse ronde: de harde
getallen staan hier, de opnamebeslissing en de tekst doen we samen.

**Hoe betrouwbaar dit is.** Directe productpagina's zijn vanuit deze omgeving
niet bereikbaar (de egress-proxy staat de winkelhosts niet toe), dus dit komt
uit zoekresultaten. Waar een getal maar uit één bron kwam of waar bronnen
elkaar tegenspraken, staat dat erbij. Niets hiervan is in `data/` gezet.

Toetsingskader: zie `REDACTIE.md`.

---

## batterijmaatje

### Huawei LUNA2000-S1 — geen variant maar een nieuwe generatie

Dit is het belangrijkste dat het onderzoek opleverde, want het verandert hoe
het beleid hier uitpakt. Wij hebben de **LUNA2000-10-S0**. Wat er nu in de
schappen ligt is de **S1**, en dat is geen andere maat van hetzelfde systeem:

| | onze S0 | de nieuwe S1 |
| --- | --- | --- |
| capaciteit | 10 kWh | 7 / 14 / 21 kWh (modules van 5–7 kWh) |
| vermogen | 5 kW | 3,5 kW per module, 10,5 kW per stack |
| behuizing | — | IP66, binnen én buiten |
| garantie | — | 15 jaar fabrieksgarantie |
| maximaal | — | 12 modules, tot 82,8 kWh |

Prijs in Nederland: €2.700 tot €11.000 excl. installatie, afhankelijk van de
maat.

De keuze "capaciteitsvarianten krijgen samen één regel" gaat hier dus niet op
zoals bedoeld: S0 en S1 zijn twee systemen. Mijn voorstel is één regel voor de
S1 met de maten in de tekst, en de S0 laten staan of vervangen — dat is aan
jou. De losse bol-meldingen (`LUNA2000-7-E1`, `LUNA2000-7-S1`,
`LUNA2000-15-S0`) zijn modules en maten binnen die twee systemen.

### Jackery SolarVault 3 — basisapparaat plus bundels

| | |
| --- | --- |
| BP2500 (uitbreidingsbatterij) | 2,52 kWh |
| Pro Max (basisstation) | 2,5 kW bidirectioneel AC |
| uitbreidbaar | tot 5× BP2500 = 15,12 kWh |
| cycli | 6.000+, LiFePO4 |
| noodstroom | omschakeling < 20 ms |
| bediening | Bluetooth, wifi of ethernet; app met sturing op marktprijzen |
| garantie | **niet gevonden** |

Verkrijgbaar in Nederland bij Solar Power Supply, Off Grid Power Station en
teqclub. Volgens jouw bundelbeleid: het basisapparaat als regel, de sets
ernaast, elk met `omvat` gevuld ("incl. 2× BP2500").

### SolarEdge Energy Bank 9,7 kWh — let op de celchemie

| | |
| --- | --- |
| capaciteit | 9,7 kWh bruikbaar (10,3 kWh nominaal, 100% DoD) |
| vermogen | 5 kW continu, 7,5 kW piek gedurende 10 seconden |
| chemie | **Li-ion NMC**, geen LiFePO4 |
| garantie | 10 jaar tot 70% restcapaciteit, onbeperkt aantal cycli |

Die NMC-chemie is het vermelden waard: alle andere batterijen op de site zijn
LFP. Dat is geen diskwalificatie maar wel een verschil dat een bezoeker hoort
te zien.

Twee dingen om na te gaan: de prijzen die ik vond zijn in dollars en het
datasheet is voor Noord-Amerika, dus de Nederlandse beschikbaarheid moet
bevestigd worden. En wij hebben al de **Home Battery 48V (9,2 kWh)** — dat is
een ander product van dezelfde fabrikant, geen dubbeling.

### Zendure SolarFlow 2400 AC+ — en een vraag over onze eigen cijfers

| | AC+ (nieuw) | 2400 Pro (hebben we) |
| --- | --- | --- |
| capaciteit | 2,4 kWh bruikbaar | 2,88 kWh in onze gegevens |
| vermogen | 2.400 W | 2.400 W |
| zonnepanelen | via bestaande omvormer (AC) | 4 MPPT, tot 3.000 W direct |
| behuizing | IP65 | IP67 |
| cycli / garantie | 6.000 / 10 jaar | idem |
| uitbreidbaar | tot 16,8 kWh met AB3000L | |

Hier komt iets aan het licht dat losstaat van deze kandidaat. De bronnen
noemen voor beide modellen 2,88 kWh nominaal en 2,4 kWh bruikbaar bij 90% DoD.
Bij ons staat de Pro op 2,88. **Vraag: hanteren we overal de nominale of overal
de bruikbare capaciteit?** Als dat door elkaar loopt, vergelijkt de site
appels met peren op het veld dat er het meest toe doet. Dat wil ik nakijken
over de hele lijst, los van deze toevoeging.

### Zendure SolarFlow 4000 Mix AC+ — gemeld via het contactformulier

Binnengekomen op 16 augustus 2026 van Richard Rozema: wij hebben de 3000 Mix
AC+ en de 4000 Mix Pro, maar het model dat er tussenin zit ontbreekt. Zijn
lezing is dat de AC+ dezelfde batterij is als de Pro zonder de directe
zonnepaneelaansluitingen. Dat klopt met wat ik terugvind.

| | 3000 Mix AC+ (hebben we) | **4000 Mix AC+ (nieuw)** | 4000 Mix Pro (hebben we) |
| --- | --- | --- | --- |
| capaciteit | 8 kWh | 8 kWh | 8 kWh |
| uitbreidbaar | **niet** — gesloten systeem | tot ca. 50 kWh, modules van 7 kWh | tot ca. 50 kWh, modules van 7 kWh |
| vermogen | 3 kW bidirectioneel | 4 kW bidirectioneel | 4 kW bidirectioneel |
| zonnepanelen direct | geen | geen MPPT; wel PV-IN AC tot 5 kW | 2 MPPT tot 8 kW + 5 kW AC = ca. 13 kW |
| noodstroom | 3.680 W | 3.680 W | niet vastgesteld |
| behuizing / garantie | IP65 / 10 jaar | IP65 / 10 jaar, 80 kg, −20 tot 55 °C | IP65 / 10 jaar |
| prijs | €2.059 | **adviesprijs €2.419**, €2.399 gezien bij TechPunt | €2.899 |

Waar hij op wijst is een echt gat in de lijst: tussen "goedkoop maar vast op
8 kWh" en "hybride topmodel met 13 kW PV" staat nu niets, terwijl dat voor wie
al zonnepanelen heeft juist de logische keuze is — je betaalt dan niet voor
MPPT-ingangen die je toch niet gebruikt. Dat is €480 verschil met de Pro.

Twee dingen om bij de opname te regelen:

1. **Onze notitie bij de 3000 Mix AC+ klopt niet.** Daar staat nu dat de
   fabrikant uitbreiding tot 50+ kWh belooft en dat de modules in Q4 2026
   komen. Die belofte geldt alleen voor de 4000-serie; de 3000 heeft geen
   uitbreidingspoort en blijft 8 kWh. Wil je meer, dan koop je een tweede unit
   en koppel je ze via HEMS 2.0. `uitbreidbaar_tot_kwh: null` blijft goed, de
   toelichting moet anders. Dit is precies het verschil dat de 4000 AC+ zijn
   bestaansrecht geeft, dus het hoort in één beweging recht te worden gezet.
2. **De uitbreidingsmodules zijn er nog steeds niet** (verwacht Q4 2026). Voor
   de AC+ hoort `uitbreidbaar_tot_kwh` dus op `null` met de belofte in de
   toelichting, gelijk aan hoe de Pro er nu in staat.

Vier Zendure-regels op 41 modellen is wel iets om bewust te doen. Ze
overlappen elkaar niet — 3 kW vast, 4 kW uitbreidbaar, 4 kW hybride — maar het
is een merk dat de lijst begint te vullen.

Betrouwbaarheid: zendure.nl, iotdomotica.nl en thuisbatterijgids.net zijn
vanuit deze omgeving niet bereikbaar (egress-proxy), dus dit komt uit
zoekresultaten. De prijs en de leverbaarheid van de uitbreidingsmodules horen
bij een winkel nagekeken te worden voordat dit in `data/` gaat.

### Dyness 16,1 kWh

Waarschijnlijk de **PowerBrick Plus 16,07 kWh** (de 16,1 in de winkeltitel is
afgerond):

| | |
| --- | --- |
| capaciteit | 16,07 kWh nominaal, 15,27 kWh bruikbaar bij 95% DoD |
| vermogen | 10,24 kW continu, 300 A piek gedurende 2 minuten |
| cycli | ≥ 8.000 bij 95% DoD |
| garantie | 10 jaar |
| overig | LiFePO4, 51,2 V, ingebouwde blusvoorziening, zelfverwarming, IP65 |

Wij hebben de **Powerbox G2 (10,24 kWh)** van hetzelfde merk. Andere serie.

### PEGO Smart Energy — mijn eerdere inschatting klopte niet

Ik had dit als "naamloze aanbieder" weggezet. Dat is onjuist: PEGO is een
Belgisch/Nederlands merk met een eigen productlijn en een eigen webshop.

| | |
| --- | --- |
| opbouw | modules van 3 kWh, van 6 tot 15 kWh |
| koppeling | AC, werkt met bestaande zonnepanelen en omvormer |
| aansluiting | stopcontact, P1-dongle, geen installateur nodig |
| functies | off-grid / UPS, sturing op in- en verkoopprijzen |

Het valt dus niet onder "aanbieders zonder eigen merk" in `REDACTIE.md`. Wel
een merk waar minder over te vinden is dan over de gevestigde namen; garantie
en cycli heb ik niet gevonden.

### Marstek Venus A — eerst dit uitzoeken

Specificaties: 2,12 kWh (uitbreidbaar tot 12,72 kWh), 1,2 kW AC uit met 1,44 kW
piek, 2,4 kW PV in over 4 MPPT, 6.000+ cycli, 10 jaar garantie, IP65, EPS.

Maar: **Thuisbatterij.nl is gestopt met dit model** omdat er in Nederland
exemplaren uitvielen — het systeem moet permanent via DC met zonnepanelen
verbonden zijn. Als dat klopt is dat het belangrijkste wat je erover kunt
schrijven, en is de eerste vraag niet hoe we hem beschrijven maar of hij op de
site hoort. Ik heb ook een prijs van €3.499 gezien; die kan niet kloppen voor
2,12 kWh en heb ik daarom niet overgenomen.

### Nog niet uitgezocht

`Growatt SPH5000 + 15,3 kWh` — een set van omvormer en batterij. De winkeltitel
schrijft kWh als "Kw", dus ook de capaciteit is onzeker.

---

## zonnestroommaatje

Wij hebben de Jinko Tiger Neo op 440 Wp. De gemelde varianten:

| Wp | type | opmerking |
| --- | --- | --- |
| 435 | JKM435N-54HL4R-B | 21,77% rendement, 1762×1134×30 mm, full black |
| 450 | JKM450N-54HL4R-B | zelfde serie en formaat |
| 455 | JKM455N-48HL4M-DB | glas-glas, ander celformaat |
| 470 | JKM470N-60HL4-V | **1903 mm lang en silver frame** — een groter paneel, geen full black |

Jinko geeft 30 jaar vermogensgarantie op deze serie. De 470 wijkt op twee
punten af van wat de site vergelijkt (formaat en uitvoering); dat is dus geen
vanzelfsprekende opvolger van onze 440.

DMEGC — wij hebben de DM450M10RT (450 Wp):

| Wp | type | uitvoering |
| --- | --- | --- |
| 440 | DM440M10RT-54HBB | mono full black, TOPCon N-type, 220 Wp/m² |
| 460 | DM460G12RT-B48HBT | glas-glas bifaciaal, transparant met zwart frame |
| 470 | DM470G12RT-G48HBB | glas-glas monofaciaal, full black |

DMEGC geeft 12 jaar productgarantie en 25 jaar vermogensgarantie.

Losse panelen:

- **JA Solar JAM54D40-465/LB** — 465 Wp, 23,27% rendement, glas-glas bifaciaal
  TOPCon met zwart frame, 1762×1134×30 mm. Garantie verschilt per uitvoering
  (12 jaar product + 30 jaar vermogen, of 15 jaar vermogen bij 0,4% degradatie
  per jaar) — bij opname moet je weten welke uitvoering de winkel levert.
- **Denim U-N3-490-BBG-120H** — 490 Wp, 22,63% rendement, N-TOPCon glas-glas
  bifaciaal (80% bifacialiteit), 1,6 mm gehard glas aan beide zijden,
  **1909×1134×30 mm** — ook dit is een groter paneel dan de rest van de lijst.
  Garantie niet gevonden.

Dat formaatverschil is bij panelen geen detail: 1909 mm past niet
vanzelfsprekend op een dak dat op 1762 mm is ingedeeld. De vraag is dus niet
alleen "is dit paneel beter" maar "vergelijken we hier nog hetzelfde soort
product".

---

## warmtepompmaatje

### Toshiba — opgelost, geen kandidaat

De melding `TOSHIBA bi-bloc R290` van Intercool is de **Estia Bi-Bloc R290**
die al op de site staat. Intercool laat "Estia" uit de naam weg. Opgelost met
een `zoeknamen`-regel; hij wordt niet meer gemeld.

### Stiebel Eltron WPL-serie

| model | vermogen | rendement | geluid |
| --- | --- | --- | --- |
| WPL-A 05 HK 230 Premium | ca. 5 kW (4,97) | SCOP 4,70 bij 35 °C | niet gevonden |
| WPL-A 07 HK 230 Premium | — | SCOP 4,88 bij 35 °C | niet gevonden |
| WPL 07 ACS classic | 2,08 kW bij A2/W35 · 3,20 kW bij A-7/W35 | energielabel A+ | niet gevonden |
| WPL 13 ACS classic | ca. 8–10 kW bij 7/35 °C | COP ca. 4,5 | ca. 53 dB(A) |

Twee dingen vallen op. De **WPL 07 ACS classic levert 2,08 kW bij A2/W35** —
fors minder dan het typenummer suggereert, en het energielabel is A+ waar de
rest van onze lijst A+++ is. Dat is een model dat je bewust wel of niet opneemt,
niet een die er vanzelf bij hoort.

En: wij hebben al `stiebel-wpl-a07` en `stiebel-wpl-a13`. De gemelde WPL-A 10
en 13 zijn de **400 V-uitvoeringen** (driefase) van dezelfde serie; de onze is
de 230 V. Of dat een eigen regel verdient hangt af van of we driefase-varianten
apart tonen — dezelfde vraag als bij Huawei, maar hier voor de aansluiting in
plaats van de capaciteit.

---

## Wat hier niet in staat en wel nodig is

Voor elk model dat je opneemt ontbreken nog: de actuele Nederlandse prijs bij
een winkel die we kunnen volgen, en de velden die deze site onderscheidend
maken — koppeling met zonnepanelen, Homey, Home Assistant, geschiktheid voor
een dynamisch contract. Die staan zelden in een datasheet en komen uit
productpagina's, en die kan ik van hieruit niet lezen.
