# Gegevensschema van de drie sites

Concept, opgesteld op 7 oktober 2026 uit de gegevens zoals ze op dat moment in
de repository stonden (`claude/websites-status-check-a9vguz`, commit 570d8168)
en uit de code die ze leest. De aantallen tussen haakjes (`41/57`) zeggen bij
hoeveel producten het veld voorkomt; ze zijn bedoeld om te laten zien wat
gebruikelijk is, niet als eis.

Er bestaat geen formeel schema (JSON Schema of iets dergelijks). Wat hier
"verplicht" heet, is wat de generator, de proeven of de vergelijker nodig
hebben om niet stil iets verkeerds te tonen.

`npm run dataschema` (`scripts/dataschema.mjs`, ook onderdeel van `npm run
controle` en CI) bewaakt de kern hiervan: de velden en waarden van een
aanbieding, het id, de datums en de velden met een vaste reeks waarden. Voeg
je een veld of waarde toe, zet hem daar en hier tegelijk.

## Inhoud

1. Algemene regels voor alle sites
2. Aanbiedingen (gedeeld door alle sites)
3. Productfoto's (gedeeld)
4. `sites/batterijmaatje/data/batterijen.json`
5. `sites/batterijmaatje/data/leveranciers.json`
6. `sites/warmtepompmaatje/data/warmtepompen.json`
7. `sites/zonnestroommaatje/data/panelen.json`
8. `sites/zonnestroommaatje/data/omvormers.json`
9. Bestanden die scripts zelf bijhouden
10. Configuratiebestanden naast de scripts
11. Wie schrijft welk veld

---

## 1. Algemene regels

**Bestandsvorm.** Elk productbestand is een object met een paar velden op het
hoogste niveau en één lijst met producten:

| veld | type | betekenis |
| --- | --- | --- |
| `laatst_bijgewerkt` | `"JJJJ-MM-DD"` | Wordt door `update-prices.mjs` op vandaag gezet als er die dag minstens één aanbieding bevestigd is (en op batterijmaatje niet bij `--alleen`). `verse-data.mjs --streng` faalt als deze datum meer dan 2 dagen oud is. |
| `toelichting` | tekst | Uitleg die op de site onder de lijst verschijnt. |
| `merk_logos` | object `{merknaam: pad}` | Alleen bij batterijen en panelen; nu leeg. Zie `assets/logos/MERKBELEID.md` van die site voordat hier iets in komt. |
| `batterijen` / `warmtepompen` / `panelen` / `omvormers` | lijst | De producten. |

**`id`.** Kleine letters, cijfers en koppeltekens (`marstek-venus-e-3`). Het
id wordt de bestandsnaam van de productpagina (`batterij/<id>.html`,
`pomp/<id>.html`, `paneel/<id>.html`), de sleutel in `prijsverloop.json` en
`prijs-aandacht.json`, en het argument van `--alleen` bij de fotoscripts.
Verander een id dus niet zonder een doorverwijzing in `vercel.json` (zie
BIJDRAGEN.md, "Een product verwijderen of hernoemen").

**Leeg is niet nul.** `null` of een ontbrekend veld betekent "niet bekend" en
wordt op de site als zodanig getoond. Vul nooit een getal in omdat het veld
leeg oogt (REDACTIE.md). Uitzondering: velden waarmee een score rekent; zie de
proef "elk paneel heeft de velden die de Zeker-score ... nodig hebben".

**Vergelijkvelden hebben een conditieveld.** Een getal waarop de site sorteert
of rekent, hoort een begeleidend veld te hebben dat zegt wát het is
(`capaciteit_soort`, `vermogen_conditie`, `scop_conditie`, `rendement_soort`,
`btw_inbegrepen`, `panelen_per_eenheid`). Het register staat bovenin
`scripts/vergelijkbaar.mjs`. Voeg je een nieuw getalsveld toe, registreer het
daar; anders meldt de dagelijkse run het.

**Datums** zijn overal `"JJJJ-MM-DD"` als tekst.

**Bedragen** zijn hele euro's (`prijs_eur`, `richtprijs_eur`). Incl. btw,
tenzij een `btw_inbegrepen: false` het tegendeel zegt.

---

## 2. Aanbiedingen

Elk product kan een lijst `aanbiedingen` hebben: één regel per winkel waar het
te koop is. Dit deel is op de drie sites hetzelfde; de prijsscripts verschillen
wel in welke velden ze lezen (zie de laatste kolom).

| veld | type | verplicht | betekenis | gelezen door |
| --- | --- | --- | --- | --- |
| `winkel` | tekst | ja | Naam zoals de bezoeker hem ziet. Is ook deel van de sleutel in `prijs-aandacht.json` en `prijsverloop.json`; hernoemen begint daar een nieuwe reeks. | alle |
| `url` | tekst | ja | De productpagina bij de winkel. Wordt dagelijks bezocht. | alle |
| `prijs_eur` | geheel getal | ja | Het bedrag zoals de winkel het toont. Wordt door de prijsupdate overschreven. | alle |
| `datum` | datum of `null` | ja | Laatste dag waarop het bedrag bij de winkel bevestigd is. `null` = nog nooit bevestigd. Wordt alleen bij een geslaagde lezing bijgewerkt. | alle |
| `btw_inbegrepen` | `false` of weglaten | nee | `false` = het bedrag is excl. btw; `assets/prijs.js` rekent het om. Weglaten = incl. btw. | alle |
| `omvat` | tekst | nee | Wat deze aanbieding anders dekt dan de richtprijs ("incl. 2x BP2500 uitbreiding", "losse buitenunit"). Zolang dit gevuld is, berekent de site geen korting. Verplicht bij sets en bundels (REDACTIE.md). | alle |
| `prijs_controle` | `"handmatig"` | nee | De pagina toont wel een bedrag, maar niet ons bedrag. De ronde bezoekt de pagina nog (dode link valt op) maar schrijft de prijs nooit over. | alle |
| `prijs_controle_reden` | tekst | nee | Waarom handmatig. Alleen voor mensen; geen script leest het. | - |
| `niet_leverbaar` | `true` of weglaten | nee | De winkel voert het artikel nu niet. Telt niet mee voor de kopprijs, de markup en de fotozoektocht; de winkel blijft in de lijst staan, zonder link. | alle |
| `niet_leverbaar_door` | `"voorraad"`, `"pagina weg"` | nee | Wie de markering zette. `"voorraad"`: de Shopify-voorraadcontrole (`kern/scripts/voorraad.mjs`). `"pagina weg"`: twee dagen na elkaar 404/410/geen antwoord. Beide halen de markering zelf weer weg als het artikel terugkomt. Zonder dit veld is de markering met de hand gezet en blijft hij staan. | alle |
| `niet_leverbaar_reden` | tekst | nee | Toelichting bij een met de hand gezette markering. | `voorraad.mjs` |
| `weg_sinds` | datum | nee | Gezet door de prijsupdate bij de eerste dag dat de pagina weg is; de dag erna volgt `niet_leverbaar` met `"pagina weg"`. Niet met de hand invullen. | `voorraad.mjs` |
| `prijs_route` | `"gekozen variant"`, `"bij variant"`, of een naam uit de vaste volgorde (`"structured data"`, `"json in de pagina"`, `"meta-tag"`, `"prijsveld in de pagina"`, `"zichtbare tekst"`) | nee | Dwingt één uitleesroute af voor deze winkel. Alleen nodig als de vaste volgorde aantoonbaar het verkeerde bedrag pakt. **Werkt nu alleen op batterijmaatje**: de prijsscripts van de andere twee sites geven dit veld niet door. | batterijmaatje |
| `prijs_variant` | tekst | bij `"bij variant"` | De tekst die op de pagina vlak vóór het juiste bedrag staat ("9,2 kWh", "Powerness Express"). Het eerste bedrag binnen 60 tekens erna is de prijs. | batterijmaatje |
| `ean` | tekst (13 cijfers) | nee | Alleen bij bol.com. Wordt door de prijsupdate één keer opgezocht en bewaard; niet met de hand invullen. | alle (`kern/scripts/bol.mjs`), nieuwe-modellen |
| `affiliate_url` | tekst | nee | Commissielink. De knop gebruikt deze; de prijscontrole altijd `url`. | batterijmaatje |

**Uitleesroutes.** `kern/scripts/prijs-uitlezen.mjs` probeert zonder
`prijs_route` deze volgorde: structured data, json in de pagina, meta-tag,
prijsveld in de pagina, zichtbare tekst. De twee varianten-routes draaien nooit
vanzelf. `"gekozen variant"` leest de door de winkel voorgeselecteerde variant
uit `data-product_variations` (WooCommerce, zoals Thuisbatterij.nl).
`"bij variant"` zoekt de tekst uit `prijs_variant` op. Welke route een pagina
oplevert, laat de werkstroom *Wat staat er op een winkelpagina* zien.

**Plausibiliteit.** Een nieuw bedrag wordt alleen overgenomen binnen een marge
rond het vorige: 75 tot 125 procent bij batterijen, 40 tot 250 procent bij
warmtepompen en panelen, 60 tot 160 procent bij omvormers. Warmtepompen,
panelen (20 tot 2.000 euro) en omvormers (50 tot 3.000 euro) hebben daarnaast
absolute grenzen. Daarbuiten komt het bedrag als "te controleren" in het
rapport en blijft de oude prijs staan.

---

## 3. Productfoto's

Op alle vier de productsoorten hetzelfde. `npm run fotos` (in de wortel) vult
ze; met de hand mag ook.

| veld | type | betekenis |
| --- | --- | --- |
| `afbeelding` | pad of URL | `assets/producten/<id>.webp`, ongeveer 900 px breed. Zonder dit veld toont de kaart geen foto en de productpagina een type-illustratie; Google toont dan geen productresultaat. |
| `afbeelding_bron` | tekst | Bronvermelding in de hoek van de foto, "foto: <partij>". Noem de partij waar het beeld vandaan komt, niet het merk op het apparaat. |
| `afbeelding_herkomst` | URL | Het adres van het beeldbestand zelf. Gevuld door het fotoscript. |
| `afbeelding_via` | URL | De pagina waar het beeld gevonden is. Laat leeg als het niet vaststaat. |

Afgekeurde beelden staan in `scripts/afgewezen-fotos.json`, elk met een reden.

---

## 4. batterijen.json (batterijmaatje)

57 batterijen. Lijst: `batterijen`.

### Identiteit en tekst

| veld | type | aanwezig | betekenis |
| --- | --- | --- | --- |
| `id` | tekst | 57/57 | Zie hierboven. |
| `merk` | tekst | 57/57 | Merknaam zoals op de kaart. |
| `model` | tekst | 57/57 | Modelnaam met het artikelnummer of de maat ("Venus E 3.0 (4,6 kWh bruikbaar)"). Niet aanpassen om een winkelnaam te laten matchen; gebruik `zoeknamen`. |
| `opmerkingen` | tekst | 57/57 | Eigen aantekening in de eerste persoon. Verschijnt op de kaart en op de productpagina; de proef `scripts/eigen-tekst.test.mjs` bewaakt dat. Valt onder SCHRIJFWIJZE.md. |
| `zoeknamen` | lijst tekst | 8/57 | Andere namen waaronder winkels dit model verkopen. Alleen gebruikt door `nieuwe-modellen.mjs` om het model als bekend te herkennen. |
| `product_url` | URL | 56/57 | De fabrikantpagina. Gebruikt voor de link op de productpagina, de bronnencontrole (`npm run bronnen`) en het fotoscript. |

### Techniek

| veld | type | aanwezig | waarden / betekenis |
| --- | --- | --- | --- |
| `type` | tekst | 57/57 | `"plug-in"` (36), `"hybride"` (18), `"ac-gekoppeld"` (3). Bepaalt filters, icoon en keuzehulp. |
| `capaciteit_kwh` | getal | 57/57 | De **bruikbare** capaciteit (norm, REDACTIE.md). |
| `capaciteit_soort` | tekst | 57/57 | `"bruikbaar"` (19), `"nominaal"` (12), `"onbekend"` (26: nagezocht, fabrikant publiceert het niet). Weglaten = nog niet nagekeken. `npm run capaciteit` toont de stand. |
| `capaciteit_nominaal_kwh` | getal | 23/57 | De bruto pakketmaat, als die naast de bruikbare bekend is. Komt ook in de paginatekst, omdat winkels op die maat verkopen. |
| `uitbreidbaar_tot_kwh` | getal of `null` | 57/57 | `null` = niet uitbreidbaar of onbekend. Volgt dezelfde maat als `capaciteit_kwh`. |
| `vermogen_kw` | getal of `null` | 57/57 | Ontlaadvermogen. |
| `vermogen_conditie` | tekst | 52/57 | `"continu"` (14), `"max"` (16: piek of off-grid maximum), `"stopcontact"` (8: de 800 W-grens van een gedeelde groep), `"vaste-aansluiting"` (2: het volle vermogen pas na een vaste aansluiting door een installateur, in het stopcontact 800 W), `"onbekend"` (12). Ontbreekt waar `vermogen_kw` `null` is. |
| `vermogen_bron` | tekst | 39/57 | Waar de conditie op gebaseerd is; komt in de tooltip. |
| `fase` | tekst | 57/57 | Meestal `"1-fase"`, `"3-fase"` of `"beide"`; soms een zin. |
| `installatie` | tekst | 57/57 | `"zelf"` of `"installateur"`. |
| `garantie_jaar` | geheel getal of `null` | 57/57 | |
| `cycli` | getal, tekst of `null` | 57/57 | Gemengd: `6000` of `"6.000 (fabrieksopgave)"`. De rekenmodule leest het getal eruit. |
| `ip_klasse` | tekst | 49/57 | `"IP65"` enz., of `"onbekend"`. |
| `buiten_toelichting` | tekst | 49/57 | Mag hij buiten staan, en volgens wie. |
| `noodstroom` | `true`, `false`, tekst of `null` | 57/57 | Tekst = "deels, met deze kanttekening". |
| `noodstroom_uitleg` | tekst | 57/57 | |
| `rendement_pct` | getal | 9/57 | Alleen samen met `rendement_soort`. |
| `rendement_tot_pct` | getal | 1/57 | Bovenkant van een bereik. |
| `rendement_soort` | tekst | 9/57 | `"ac"` (stopcontact tot stopcontact; de enige die de rekenmodule gebruikt), `"zonzijde"`, `"accu"`. |
| `rendement_bron` | tekst | 9/57 | Wie het opgeeft. |

### Slim aansturen

Deze drie velden vormen samen de Koppel-score (0 tot 6: ja = 2, deels = 1,
nee = 0). `assets/kaart.js` leest ze zo: object `{status, tekst}` = die status;
`true` = ja; tekst = deels, met die tekst als uitleg; `false` = nee; `null` of
ontbrekend = onbekend (telt als 0).

| veld | type | aanwezig |
| --- | --- | --- |
| `homey` | `true`/`false`/tekst/object/`null` | 57/57 |
| `home_assistant` | idem | 57/57 |
| `dynamisch_contract` | idem | 57/57 |
| `app` | tekst | 57/57 |
| `koppeling_gemak` | geheel getal 1-5 | 57/57; aparte schaal "PV-koppeling", hoe makkelijk hij bij bestaande panelen past |
| `zonnepanelen_koppeling` | tekst | 57/57; uitleg bij `koppeling_gemak` |
| `onbalans` | object | 7/57; `{status: "ja"/"nee"/"onbekend", via: [{partij, dienst, eigen_contract, bron?}], toelichting}` |

### Prijs

| veld | type | aanwezig | betekenis |
| --- | --- | --- | --- |
| `richtprijs_eur` | geheel getal of `null` | 57/57 | Terugvalprijs als er geen winkelprijs is. |
| `richtprijs_btw_inbegrepen` | `false` | 2/57 | Idem als bij aanbiedingen. |
| `prijs_omvat` | tekst | 57/57 | Wat de prijs dekt ("incl. btw, stekkerklaar; excl. installatie"). |
| `prijs_datum` | datum | 57/57 | Wordt door de prijsupdate gezet op de jongste `datum` van de aanbiedingen. |
| `prijs_bron` | tekst | 31/57 | Waar de richtprijs vandaan komt. |
| `prijs_bron_url` | URL | 22/57 | Als die er is, gaat de richtprijs mee in de dagelijkse ronde. |
| `prijs_controle` | `"handmatig"` | 3/57 | Op productniveau: de richtprijs is mensenwerk (offerte, schatting). |
| `prijs_controle_reden` | tekst | 2/57 | |
| `totaalprijs_van_eur`, `totaalprijs_tot_eur` | geheel getal of `null` | 56/57, 55/57 | Compleet gebruiksklaar, incl. installatie. |
| `totaalprijs_geschat_van_eur`, `totaalprijs_geschat_tot_eur` | geheel getal | 5/57 | Schatting (toestel plus installatie); telt niet mee in de rangschikking. |
| `totaalprijs_toelichting` | tekst | 56/57 | |
| `aanbiedingen` | lijst | 57/57 | Zie paragraaf 2. |

### Minimaal voorbeeld

```json
{
  "id": "voorbeeld-accu-5",
  "merk": "Voorbeeld",
  "model": "Accu 5 (4,8 kWh bruikbaar)",
  "type": "plug-in",
  "capaciteit_kwh": 4.8,
  "capaciteit_soort": "bruikbaar",
  "capaciteit_nominaal_kwh": 5.12,
  "uitbreidbaar_tot_kwh": null,
  "vermogen_kw": 0.8,
  "vermogen_conditie": "stopcontact",
  "vermogen_bron": "800 W is de grens op een gedeelde groep; volgens de fabrikant 2,5 kW off-grid",
  "fase": "1-fase",
  "installatie": "zelf",
  "richtprijs_eur": 1499,
  "prijs_omvat": "incl. btw, stekkerklaar; excl. installatie",
  "prijs_datum": "2026-10-07",
  "zonnepanelen_koppeling": "...",
  "koppeling_gemak": 5,
  "homey": null,
  "home_assistant": null,
  "dynamisch_contract": null,
  "app": "Voorbeeld-app",
  "garantie_jaar": 10,
  "cycli": 6000,
  "noodstroom": null,
  "noodstroom_uitleg": "Niet vastgesteld; controleer bij de fabrikant.",
  "opmerkingen": "Eigen aantekening, in de eerste persoon.",
  "product_url": "https://fabrikant.example/accu-5",
  "totaalprijs_van_eur": 1499,
  "totaalprijs_tot_eur": null,
  "totaalprijs_toelichting": "stekkerklaar, zelf te installeren",
  "aanbiedingen": [
    { "winkel": "Voorbeeldwinkel", "prijs_eur": 1499, "url": "https://winkel.example/accu-5", "datum": null }
  ]
}
```

---

## 5. leveranciers.json (batterijmaatje)

16 energieleveranciers, voor de rekenmodule en `regelgeving.html`. Lijst:
`leveranciers`; daarnaast `peildatum` en `toelichting`. Wordt niet dagelijks
bijgewerkt. Het aantal staat ook in lopende tekst en wordt door
`tellingen.test.mjs` nageteld ("16 energieleveranciers").

| veld | type | betekenis |
| --- | --- | --- |
| `id`, `naam` | tekst | |
| `contract` | `"vast-variabel"` of `"dynamisch"` | |
| `terugleverkosten_model` | tekst | `"geen"`, `"per teruggeleverde kWh"`, een staffel |
| `terugleverkosten_omschrijving` | tekst | |
| `terugleverkosten_per_kwh_indicatie` | getal | euro per kWh; 0 = geen |
| `terugleververgoeding_omschrijving` | tekst | |
| `vanaf_2027` | tekst of `null` | aangekondigde wijziging na de saldering |
| `kanttekening` | tekst of `null` | |
| `bron` | URL | ook in de linkcontrole |
| `peildatum` | `"JJJJ"` of `"JJJJ-MM"` | |

---

## 6. warmtepompen.json (warmtepompmaatje)

33 warmtepompen. Lijst: `warmtepompen`.

| veld | type | aanwezig | betekenis |
| --- | --- | --- | --- |
| `id`, `merk`, `model` | tekst | 33/33 | |
| `type` | tekst | 33/33 | `"all-electric"` (26) of `"hybride"` (7). |
| `voorbeeld_variant` | tekst | 33/33 | De uitvoering waar de getallen en de prijs bij horen ("S2125-8 (monoblock) met SVM-binnenunit"). |
| `vermogen_kw` | geheel getal | 33/33 | **Prated volgens EU 811/2013** (vermogen bij de ontwerpbuitentemperatuur), uit de ISDE-meldcodelijst. Wijkt vaak af van het typenummer. |
| `vermogen_conditie` | tekst | 33/33 | Nu overal `"Prated"`. Mogelijk ook `"A7/W35"` of `"onbekend"` (zie `assets/condities.js`). |
| `vermogen_a7_kw` | getal | 0/33 | Ondersteund door de code, nu nergens gebruikt. |
| `scop` | getal | 20/33 | Labelwaarde. |
| `scop_conditie` | tekst | 20/33 | `"35"` (16), `"55"`, `"onbekend"` (4). Weglaten = niet nagekeken. `npm run condities` toont de stand. |
| `scop_toelichting` | tekst | 33/33 | |
| `geluid_db` | geheel getal | 26/33 | Geluidsvermogen buitenunit in dB(A), volgens label of datasheet. Geen nachtstand of geluidsdruk. |
| `geluid_toelichting` | tekst | 33/33 | Is tevens het conditieveld bij `geluid_db`. |
| `max_aanvoer_c` | geheel getal | 27/33 | |
| `koudemiddel` | tekst | 33/33 | `"R290 (natuurlijk)"`, `"R32"`, `"R410A (GWP 2088)"`, ... |
| `tapwater` | tekst | 33/33 | |
| `buitenunit` | `false` | 3/33 | Pompen zonder buitenunit (ventilatiewarmtepomp). |
| `isde_meldcode` | tekst | 33/33 | Code uit de RVO-meldcodelijst (`KA12345`). |
| `isde_indicatie_eur` | geheel getal | 33/33 | Subsidiebedrag bij die meldcode. Gevuld door `node scripts/isde-meldcodes.mjs --schrijf`. |
| `varianten` | lijst | 26/33 | Andere maten in dezelfde reeks: `{vermogen_kw, isde_eur, meldcode}`. Gevuld door `node scripts/varianten.mjs --schrijf`. |
| `sturing`, `home_assistant`, `homey` | object `{status, tekst}` | 33/33 | `status`: `"ja"`, `"deels"`, `"nee"`, `"onbekend"`. Vormen de Koppel-score. |
| `app` | tekst | 18/33 | |
| `garantie_jaar` | geheel getal | 22/33 | |
| `garantie_toelichting` | tekst | 8/33 | Voorwaarden ("alleen als je hem online koppelt"). |
| `opmerkingen` | tekst | 33/33 | Eigen aantekening; moet ook op de pomppagina staan (proef). |
| `zoeknamen` | lijst tekst | 4/33 | |
| `product_url` | URL | 32/33 | |
| `richtprijs_eur` | geheel getal of `null` | 22/33 | Voor het complete toestel, excl. installatie. |
| `prijs_toelichting` | tekst | 25/33 | Wat de prijs dekt. |
| `prijs_datum` | datum | 25/33 | |
| `prijs_controle` | `"handmatig"` | 3/33 | Op productniveau. |
| `aanbiedingen` | lijst | 26/33 | Zie paragraaf 2. Een losse buitenunit krijgt `omvat`. |
| `afbeelding*` | | 22/33 | Zie paragraaf 3. |

---

## 7. panelen.json (zonnestroommaatje)

20 panelen. Lijst: `panelen`. Prijzen zijn **per paneel**, 0% btw bij levering
voor een woning.

| veld | type | aanwezig | betekenis |
| --- | --- | --- | --- |
| `id`, `merk`, `model` | tekst | 20/20 | |
| `vermogen_wp` | geheel getal | 20/20 | STC. **Verplicht** (Zeker-score, dakscore; proef in `tellingen.test.mjs`). |
| `rendement_pct` | getal | 20/20 | **Verplicht** (dakscore). |
| `celtype` | tekst | 20/20 | `"topcon"`, `"back-contact"`, `"hjt"`. |
| `uitvoering` | tekst | 20/20 | `"glas-glas"` of `"glas-folie"`. **Verplicht** (Zeker-score). |
| `full_black`, `bifaciaal` | boolean | 20/20 | |
| `afmetingen_mm` | tekst | 20/20 | `"1762 × 1134 × 30"` (met ×-teken). |
| `gewicht_kg` | getal | 20/20 | |
| `garantie_product_jaar` | geheel getal | 20/20 | **Verplicht** (Zeker-score). |
| `garantie_vermogen_jaar` | geheel getal | 20/20 | |
| `vermogen_behoud_eind_pct` | getal | 20/20 | Aan het eind van de vermogensgarantie. |
| `vermogen_behoud_25j_pct` | getal | 20/20 | **Verplicht** (Zeker-score). Afleiden uit het eindpunt mag (formule in REDACTIE.md). |
| `temp_coefficient` | getal | 20/20 | Procent per graad, negatief (`-0.29`). |
| `richtprijs_eur` | geheel getal | 20/20 | Per paneel. |
| `prijs_omvat` | tekst | 20/20 | |
| `prijs_datum` | datum | 20/20 | |
| `opmerkingen` | tekst | 20/20 | |
| `product_url` | URL | 20/20 | Vaak de homepage van de fabrikant; de bronnencontrole meldt die als "geen productpagina". |
| `zoeknamen` | lijst tekst | 1/20 | |
| `aanbiedingen` | lijst | 20/20 | Zie paragraaf 2. |
| `afbeelding*` | | 12/20 | |

---

## 8. omvormers.json (zonnestroommaatje)

12 omvormers. Lijst: `omvormers`. Krijgen geen eigen pagina; ze staan op
`omvormers.html` en voeden de systeemsamensteller (`systeem.html`,
`assets/systeem.js`) en `energieplan.html`.

| veld | type | aanwezig | betekenis |
| --- | --- | --- | --- |
| `id`, `merk`, `model` | tekst | 12/12 | |
| `type` | tekst | 12/12 | `"hybride"` (9), `"micro"` (2), `"optimizer"` (1). |
| `fase` | tekst | 12/12 | Vrije tekst. |
| `vermogen_bereik` | tekst | 12/12 | Vrije tekst ("3 - 10 kW", "per paneel (circa 300-380 VA)"). |
| `voorbeeld_variant` | tekst | 12/12 | De uitvoering waar de richtprijs bij hoort. |
| `richtprijs_eur` | geheel getal | 12/12 | Per eenheid; zie `panelen_per_eenheid`. |
| `prijs_toelichting` | tekst | 12/12 | |
| `prijs_datum` | datum | 10/12 | |
| `panelen_per_eenheid` | 1, 2 of `null` | 12/12 | Bij micro-omvormers: hoeveel panelen één stuk bedient. `null` = centrale omvormer, prijs per systeem. Conditieveld bij de prijs. |
| `systeem_toeslag_eur` | geheel getal | 2/12 | Eenmalige extra kosten per systeem (gateway). |
| `batterij`, `home_assistant`, `homey`, `schaduw` | object `{status, tekst}` | 12/12 | |
| `samensteller` | object | 12/12 | Invoer voor de systeemsamensteller: `soort` (`"centraal"`, `"per_paneel"`, `"per_2_panelen"`, `"centraal_optimizer"`), `bron` (datasheet), en per soort `max_wp_per_paneel`, `extra_per_systeem {label, prijs_eur}`, `optimizer {label, prijs_eur}`, `voorbeeld_ac_kw`, `ac_kw_bereik` (lijst kW), `max_dc_ac`. |
| `app`, `garantie_jaar`, `opmerkingen`, `product_url` | | 12/12 | |
| `aanbiedingen` | lijst | 12/12 | 9 van de 22 aanbiedingen zijn excl. btw (`btw_inbegrepen: false`). |
| `afbeelding*` | | 8/12 | |

---

## 9. Bestanden die scripts zelf bijhouden

Niet met de hand bewerken, behalve waar het erbij staat.

| bestand | geschreven door | vorm |
| --- | --- | --- |
| `sites/<site>/data/prijsverloop.json` | `npm run prijsverloop` (dagelijks) | `{toelichting, bijgewerkt, producten: {id: [[datum, prijs\|null], ...]}, winkels: {id: {winkel: [[datum, prijs\|null]]}}}`. Alleen wijzigingspunten; `null` = die dag geen winkelprijs. Opnieuw op te bouwen met `--uit-git`. |
| `sites/<site>/data/prijs-aandacht.json` | `update-prices.mjs` via `kern/scripts/prijs-aandacht.mjs` | `{bijgewerkt, punten: {"<familie>\|<id>\|<winkel>": {sinds, soort, tekst, bevestigd}}}`. Soorten: `verouderd`, `onbereikbaar`, `te controleren`, `geweigerd` en `zonder bedrag` (die twee delen de familie `zonder prijs`). Een punt verwijderen = het vergeten. |
| `sites/<site>/data/nieuwe-modellen.json` | `npm run nieuwe-modellen` (dagelijks) | `{toelichting, kandidaten: [{titel, bron, url, ean, prijs_eur, lijkt_op, maat_uit_titel, eerst_gezien}]}`. |
| `scripts/stempels.json` | `npm run stempel` | Vingerafdruk van alle css en js per site; `--controleer` faalt als die niet meer klopt. |
| `sites/<site>/meting-ijkpunt.json` | `npm run meet -- --bewaar` | IJkpunt voor `meet:vergelijk`. |
| `sites/warmtepompmaatje/data/bronnen/isde-meldcodes.csv` | met de hand, uit de RVO-lijst | Lucht/water-regels van de meldcodelijst. Er is nog geen script dat het RVO-Excelbestand omzet (zie het rapport). |

## 10. Configuratiebestanden naast de scripts

| bestand | waarvoor |
| --- | --- |
| `sites/<site>/scripts/nieuwe-modellen.json` | Bronnen voor de modellenzoeker (`soort: "bol"` met `zoektermen`, of `soort: "overzicht"` met `winkel`, `url`, `link`), woordfilters (`onderwerp_woorden`, `uitsluit_woorden`, `extra_generiek`), `minimum_prijs_eur`, een bereik (`min`/`max`, bij panelen 400-500 Wp), `maat_eenheid` en `afgewezen`: winkeltitels in kleine letters met enkele spaties, die nooit meer gemeld worden. |
| `sites/<site>/scripts/proef-titels.json` | `{toelichting, titels: [{titel, verwacht: "bekend"\|"nieuw"\|"genegeerd", waarom?, bron?, buur?}]}`. Vaste proef op de modelherkenning; draait mee in `npm run modellen` (wortel) en `npm run nieuwe-modellen:proef` (site). Zodra een nieuw model is opgenomen, zet je de titel die het meldde hier op `"bekend"`. |
| `sites/<site>/scripts/paginas.json` | `[["naam", "/pad.html"], ...]`: welke pagina's `meet` en `beeld:*` bekijken. Namen niet wijzigen, anders valt de vergelijking met het ijkpunt weg. |
| `scripts/afgewezen-fotos.json` | Afgekeurde productfoto's, elk met een reden (proef bewaakt dat). |
| `scripts/gedeelde-zinnen.json` | Zinnen die bewust op meer dan één site staan (slop-regel 6). |

## 11. Wie schrijft welk veld

| veld | mens | script |
| --- | --- | --- |
| specificaties, teksten, `opmerkingen`, conditievelden, `omvat`, `prijs_controle`, `prijs_route`, `prijs_variant`, `zoeknamen` | ja | nee |
| `aanbiedingen[].prijs_eur`, `.datum`, `prijs_datum`, `laatst_bijgewerkt` | eerste invoer | dagelijks `update-prices.mjs` |
| `aanbiedingen[].ean` | nee | `update-prices.mjs` (bol) |
| `niet_leverbaar` | mag, zonder `_door` | `update-prices.mjs`/`voorraad.mjs` met `_door` |
| `weg_sinds` | nee | `update-prices.mjs` |
| `richtprijs_eur` (batterijen met `prijs_bron_url`) | eerste invoer | `update-prices.mjs` |
| `afbeelding*` | mag | `npm run fotos` |
| `vermogen_kw`, `isde_indicatie_eur` (warmtepompen) | nee | `isde-meldcodes.mjs --schrijf` |
| `varianten` (warmtepompen) | nee | `varianten.mjs --schrijf` |
