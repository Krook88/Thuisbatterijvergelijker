# Bijdragen: van wijziging tot productie

Stand 7 oktober 2026. Dit bestand is de werkvolgorde; het *waarom* van elke
controle staat in README.md, de redactionele keuzes in REDACTIE.md, de
schrijfregels in SCHRIJFWIJZE.md en de velden in DATASCHEMA.md. Waar die
bestanden iets anders zeggen dan dit, kijk dan in de code: dit concept is
daartegen nagelopen.

## Inhoud

1. Wat je nodig hebt
2. Takken en publiceren
3. De controles: wat draait waar
4. Een nieuw product toevoegen
5. Een product verwijderen of hernoemen
6. Een prijs die niet klopt
7. Opmaak of scripts wijzigen (cachestempel)
8. De dagelijkse prijsupdate
9. Werkstromen en hun invoer
10. Npm-commando's per map

---

## 1. Wat je nodig hebt

- **Node 20 of hoger** (`engines` in elke `package.json`; de werkstromen
  draaien op 22). Voor de meeste controles is dat alles: de wortel heeft geen
  afhankelijkheden.
- **Playwright met Chromium** voor `npm run keuring`, `menubreedte`,
  `dode-regels` en de meet- en beeldscripts per site:
  `npm i --no-save playwright@1.63.0 && npx playwright install chromium`
  (de werkstromen gebruiken dezelfde vaste versie).
  Zonder stoppen die scripts met een foutmelding, niet met een stille overslag.
- **Per site** staan in `sites/<site>/package.json` nog `nodemailer` (het
  contactformulier op Vercel), `playwright` en `sharp` (meten en
  schermafdrukken). `npm install` in die map is alleen nodig voor `meet` en
  `beeld:*`.
- **Python 3 met Pillow** alleen voor `scripts/foto-bijsnijden.py`; `cwebp`
  alleen voor het fotoscript. Beide staan op de runner, niet in `package.json`.

**Wat de ontwikkelomgeving niet kan.** De egress-proxy van de
ontwikkelomgeving laat alleen npm en pypi door. Winkels, fabrikanten, bol.com
en rvo.nl zijn er niet bereikbaar. Alles wat een externe pagina leest
(prijzen, foto's, specificaties, bronnen) draai je daarom via een werkstroom op
GitHub, zie paragraaf 9. `npm run bronnen -- --tellen` en
`npm run nieuwe-modellen:proef` werken wel lokaal, want die halen niets op.

## 2. Takken en publiceren

| tak | rol |
| --- | --- |
| `claude/home-battery-comparison-nl-qxolhe` | **Productie.** De standaardtak van de repository. Vercel publiceert elke push hierop naar de drie domeinen; alle drie de projecten bouwen bij elke push, ook als maar één site veranderde. De dagelijkse prijsupdate duwt hier elke ochtend drie commits op ("Dagelijkse prijsupdate <site> <datum>", auteur `prijsupdate-bot`). |
| een eigen werktak, bijvoorbeeld `claude/websites-status-check-a9vguz` | Waar je werkt. Elke push krijgt per site een preview-URL op `*.vercel.app` (met `X-Robots-Tag: noindex`). |
| `claude/productfotos-<runnummer>` | Gemaakt door de werkstroom *Productfoto's ophalen*. Nooit rechtstreeks naar productie; eerst nakijken. |

**Naar productie.** Zo gaat het in dit project: haal productie op, voeg die in
je werktak samen als die achterloopt (zie hieronder), draai `npm run controle`,
en duw je werktak dan rechtstreeks door naar productie, zonder merge-commit:

```
git fetch origin claude/home-battery-comparison-nl-qxolhe
git log --oneline HEAD..origin/claude/home-battery-comparison-nl-qxolhe   # moet leeg zijn
git push origin HEAD:refs/heads/claude/home-battery-comparison-nl-qxolhe
```

Een pull request kan ook; de werkstroom *Kern en sites lopen gelijk* draait dan
vanzelf (als er iets onder `kern/`, `sites/`, `scripts/` of `package.json`
veranderde). Na de push staat het binnen een minuut live.

**Bijblijven met productie.** Omdat de prijsupdate elke dag naar productie
duwt, loopt een werktak na een dag al achter. Voeg productie eerst in je
werktak samen (`git merge origin/claude/home-battery-comparison-nl-qxolhe`)
voordat je een pull request opent. Botst er iets in `sites/*/data/*.json` of in
een gegenereerde pagina, neem dan voor de bedragen en datums de versie van
productie en draai daarna `npm run genereer` in die site opnieuw; de pagina's
los samenvoegen is zinloos, want de generator overschrijft ze toch.

**Let op bij een andere productietak.** De naam van de productietak staat
hard in `.github/workflows/kern-gelijk.yml` (`on.push.branches`). Wie de
standaardtak hernoemt, past die regel en Branch Tracking in Vercel mee aan.
`update-prijzen.yml` noemt geen taknaam: een geplande run draait op de
standaardtak en duwt daarnaar terug.

## 3. De controles: wat draait waar

| controle | `npm run controle` (lokaal) | CI bij een pull request | dagelijks | wekelijks |
| --- | --- | --- | --- | --- |
| `kern:controleer` (sites gelijk aan `kern/`) | ja | ja | - | - |
| `cachestempel.mjs --controleer` (cachestempel klopt) | ja | ja | - | - |
| `npm test` (alle proeven, wortel en sites) | ja | ja | per site, vóór de prijzen | - |
| `modellen` (modelherkenning) | ja | ja | - | - |
| `workflows` | ja | ja | - | - |
| `datums --streng` | ja | ja | als melding | - |
| `llms` | ja | ja | - | - |
| `slop` | ja | ja | - | - |
| `keuring` (browser) | ja | ja, aparte baan | - | - |
| `menubreedte` (browser) | ja | ja, aparte baan | - | - |
| `dode-regels` (browser) | ja | ja, aparte baan | - | - |
| `zoekmachine` | - | - | als melding | - |
| `vergelijkbaar.mjs` | - | - | als melding | - |
| `controleer-links.mjs --zonder-winkels` | - | - | per site; een kapotte interne link maakt de run rood, maar pas na de commit van de prijzen | - |
| `verse-data.mjs --streng` | - | - | faalt als data ouder dan 2 dagen | - |
| *Prijzen die aandacht vragen* | - | - | faalt op nieuwe, bevestigde punten | - |
| `bronnen-nakijken.mjs` | - | - | - | zondag, als melding |

CI draait sinds 7 oktober 2026 hetzelfde als `npm run controle`. Draai het toch
zelf voordat je naar productie duwt: bij een rechtstreekse push komt CI pas
achteraf.

**Wat de dagelijkse run laat vallen, en dus de volgende ochtend blokkeert.**
`npm test` in de map van de site draait vóór de prijzen. Daar zitten
`tellingen.test.mjs` (aantallen in de tekst), `eigen-tekst.test.mjs` en de
prijsproeven in. Een product toevoegen zonder de tellingen bij te werken laat
de prijsupdate van die site de volgende ochtend dus stilstaan.

## 4. Een nieuw product toevoegen

Deze volgorde is afgeleid van de commits 67d642f5 en 9f29291d (vijf
batterijen, een paneel en een warmtepomp op 7 oktober 2026).

1. **Beoordelen.** Is het een kandidaat volgens REDACTIE.md (geen powerstation,
   geen losse module, geen naamloze doorverkoper; een capaciteitsvariant van
   iets wat er al staat krijgt geen eigen regel)? Kandidaten komen uit
   `sites/<site>/data/nieuwe-modellen.json`. Afgewezen: zet de winkeltitel in
   kleine letters in `afgewezen` van `sites/<site>/scripts/nieuwe-modellen.json`.

2. **Specificaties ophalen.** Werkstroom *Wat staat er op een winkelpagina*
   met de fabrikantpagina, `naam` en `zoek` (bijvoorbeeld
   `scop,dB(A),aanvoertemperatuur` of `capaciteit,garantie`). Staat de
   specificatie een pagina verder, gebruik eerst `links`. Neem niets over van
   een ander model uit dezelfde reeks.

3. **Het record schrijven** in `sites/<site>/data/<bestand>.json`, volgens
   DATASCHEMA.md. Let op:
   - een `id` die de bestandsnaam van de pagina wordt;
   - bij elk vergelijkgetal het conditieveld (`capaciteit_soort`,
     `vermogen_conditie`, `scop_conditie`, `rendement_soort`, `btw_inbegrepen`);
   - bij panelen de vijf scorevelden, anders faalt `tellingen.test.mjs`;
   - bij warmtepompen een `isde_meldcode`, daarna
     `node scripts/isde-meldcodes.mjs --schrijf` en
     `node scripts/varianten.mjs --schrijf` in `sites/warmtepompmaatje`;
   - `opmerkingen` in de eerste persoon, met iets controleerbaars
     (SCHRIJFWIJZE.md);
   - aanbiedingen met `"datum": null` tot de prijsupdate ze bevestigd heeft;
   - `omvat` bij een set of een losse buitenunit.

4. **De prijs laten lezen.** Duw je werktak en start *Dagelijkse prijsupdate*
   op die tak met `site` = de site en `droog` = aan. Het logboek toont per
   winkel welk bedrag langs welke route gelezen werd; er wordt niets
   weggeschreven. Klopt het bedrag niet:
   - verkeerde variant op de pagina: `prijs_route` en zo nodig `prijs_variant`
     op de aanbieding (werkt nu alleen op batterijmaatje);
   - het bedrag hoort niet bij ons product: `"prijs_controle": "handmatig"`;
   - de winkel weigert (403): ook `handmatig`, met `prijs_controle_reden`.

5. **De modellenzoeker bijwerken.** Zet de winkeltitel die het model meldde in
   `sites/<site>/scripts/proef-titels.json` met `"verwacht": "bekend"`.
   Verkoopt een winkel het onder een andere naam, zet die naam in `zoeknamen`
   bij het product. Controle: `npm run modellen` in de wortel.

6. **Een foto.** Werkstroom *Productfoto's ophalen* met `alleen` = het id en
   `droog` aan. Kies uit de kandidaten in het logboek en draai opnieuw met
   `droog` uit en `beeld` = `id=adres` (met `|winkelpagina` erachter als het
   beeld op een cdn staat). De foto komt op een tak `claude/productfotos-<n>`;
   bekijk hem (een contactvel helpt, zie README.md) en voeg die tak samen in je
   werktak. Afgekeurd: zet het adres met een reden in
   `scripts/afgewezen-fotos.json`. Geen bruikbare foto is beter dan een
   verkeerde.

7. **Genereren.** In de map van de site: `npm run genereer`. Dat schrijft de
   productpagina, de voorgerenderde kaarten in `index.html`, de
   overzichtspagina's, de vergelijkingspagina's, de cijfers in `uitleg.html` en
   `sitemap.xml`. Vergelijkingspagina's ("X vs Y") staan als lijst
   `VERGELIJKINGEN` in de generator; die breid je met de hand uit.

8. **Tellingen in de tekst.** Handgeschreven pagina's noemen aantallen ("de 57
   batterijen hier"). `tellingen.test.mjs` controleert alleen een deel:
   - batterijmaatje: alleen "<n> thuisbatterijen" en "<n> energieleveranciers"
     op de pagina's in de hoofdmap, plus de teller in de hero;
   - warmtepompmaatje: "<n> pompen"/"warmtepompen", de dB(A)-grenzen, de
     ISDE-spreiding en de FAQ-aantallen;
   - zonnestroommaatje: "de/alle/van de <n> panelen/zonnepanelen/omvormers"
     en de glas-glas-telling.
   Zoek daarom ook zelf: `grep -rn "<oud aantal> " sites/<site>/*.html` en in
   de generator. Op 7 oktober 2026 stond op batterijmaatje nog op zes
   handgeschreven plekken "41 batterijen" of "de 41" terwijl er 57 zijn
   (contact, steun, regelgeving, thuisbatterij-met-stekker en twee keer
   index), plus in de twee vaste inleidingen in `genereer-batterijpaginas.mjs`
   voor de Home Assistant- en Homey-overzichten. Die worden nu uit de data
   berekend, en een extra proef in `tellingen.test.mjs` vangt "van de/de/alle
   <n> batterijen" voortaan af. "<n> modellen" ziet hij nog niet.

9. **Controleren en vastleggen.** `npm run controle` in de wortel. Komt het
   slop-plafond (`DUBBELE_PUNT_BUDGET`, `CLAIM_BUDGET` in `scripts/slop.mjs`)
   omhoog door de nieuwe pagina, herschrijf dan de zin; het plafond mag alleen
   omlaag. Commit met in het bericht de bron van de specificaties en de prijs.

## 5. Een product verwijderen of hernoemen

De generator ruimt geen pagina's op. Bij het weghalen van een product
(voorbeeld: commit 54cacd7c, de Deye-set):

1. haal het record uit het databestand;
2. verwijder `sites/<site>/<map>/<id>.html` en vergelijkingspagina's waar het id
   in voorkomt (en die regels uit `VERGELIJKINGEN`);
3. zet een permanente doorverwijzing in `sites/<site>/vercel.json`
   (`redirects`) naar het overzicht, want de pagina stond in de index;
4. `npm run genereer`, tellingen bijwerken (stap 8 hierboven), en `npm run controle`.

Een id hernoemen is hetzelfde plus de sleutel in `data/prijsverloop.json`
meenemen, anders begint de prijsgrafiek opnieuw.

## 6. Een prijs die niet klopt

De velden staan in DATASCHEMA.md, paragraaf 2. Kort:

| situatie | wat je doet |
| --- | --- |
| de pagina toont een ander bedrag dan het onze (set, losse module) | `prijs_route`/`prijs_variant` (batterijmaatje) of `prijs_controle: "handmatig"` |
| de winkel voert het niet meer | niets: de prijsupdate zet na twee dagen `niet_leverbaar` met `niet_leverbaar_door: "pagina weg"`; of zet `niet_leverbaar: true` zelf |
| "te controleren" in het rapport | werkstroom *Wat staat er op een winkelpagina* met de URL en de `naam` |
| een punt in `prijs-aandacht.json` dat je wilt vergeten | haal de regel uit dat bestand |
| een richtprijs zonder winkel (batterijen) | `prijs_bron_url` erbij, dan loopt hij mee; anders `prijs_controle: "handmatig"` op het product |

## 7. Opmaak of scripts wijzigen (cachestempel)

Alles onder `/assets/` ligt zeven dagen in de cache van de bezoeker.

1. Gedeeld bestand? Wijzig het in `kern/` en draai `npm run kern:verdeel`.
2. Iets veranderd aan css of js onder `sites/*/assets/`? Draai
   `npm run stempel` (zet `?v=` op vandaag met letter a; een tweede keer op
   dezelfde dag: `npm run stempel -- 20261007b`).
3. Draai daarna `npm run genereer` in elke site die geraakt is: de generator
   leest de stempel uit de `@import` in `assets/style.css`.
4. `npm run controle` en CI falen als je stap 2 vergeet.

## 8. De dagelijkse prijsupdate

`.github/workflows/update-prijzen.yml`, elke dag om 05:30 UTC op de
standaardtak. De drie sites draaien na elkaar (niet tegelijk, want ze duwen
naar dezelfde tak), met 45 minuten per site als bovengrens. Een tweede run op
dezelfde tak wacht tot de eerste klaar is. Per site:

1. `npm test` in de map van de site. Faalt dit, dan stopt die site hier.
2. Playwright installeren (mag mislukken; dan geen browserterugval).
3. `npm run prijzen`: leest elke winkelpagina, schrijft bedragen en datums,
   zet `laatst_bijgewerkt` op vandaag als er iets bevestigd is, houdt
   `data/prijs-aandacht.json` bij en
   geeft `alarm` door aan de laatste stap. Secrets `BOL_CLIENT_ID` en
   `BOL_CLIENT_SECRET` voor bol.com.
4. `npm run prijsverloop`: legt de laagste prijs van vandaag vast.
5. `npm run nieuwe-modellen` (melding).
6. Alleen batterijmaatje: `npm run vermogens` (melding).
7. `npm run genereer`.
8. `controleer-links.mjs --zonder-winkels` (meldend).
9. Commit en push, met tot drie pogingen als iemand er net tussen duwde.
   Was er bij stap 8 een kapotte interne link, dan wordt de run hierna rood.
10. *Prijzen die aandacht vragen*: rood als er een nieuw punt is dat ook de
    vorige run al zag.

Daarna, één keer voor alle sites: `zoekmachine.mjs`, `datumteksten.mjs` en
`vergelijkbaar.mjs` als melding, en `verse-data.mjs --streng` per site, dat
faalt als `laatst_bijgewerkt` meer dan twee dagen oud is.

**Wanneer is een prijs oud?** Na 14 dagen ziet de bezoeker "prijs van
<datum>"; na 21 dagen telt `update-prices.mjs` hem als verouderd en komt hij
in de aandachtlijst; na 30 dagen staat hij in het rapport van `verse-data.mjs`.

**Met de hand draaien:** Actions, *Dagelijkse prijsupdate*, Run workflow,
met `site` (alle of één) en `droog` (alleen kijken, niets wegschrijven of
duwen). Draai je hem op een andere tak dan productie, dan duwt hij naar die tak.

## 9. Werkstromen en hun invoer

| werkstroom | bestand | wanneer | invoer | schrijft |
| --- | --- | --- | --- | --- |
| Dagelijkse prijsupdate | `update-prijzen.yml` | dagelijks 05:30 UTC, of met de hand | `site` (alle, of een site), `droog` (ja/nee) | commit op de tak waarop hij draait |
| Kern en sites lopen gelijk | `kern-gelijk.yml` | pull request; push naar productie; met de hand | - | niets |
| Bronnen nakijken | `bronnen.yml` | zondag 06:47 UTC, of met de hand | `site`, `alleen` (id's met komma's) | niets; uitkomst in de samenvatting |
| Productfoto's ophalen | `productfotos.yml` | met de hand | `site`, `alleen`, `droog` (standaard aan), `beeld` (`id=adres` of `id=adres\|pagina`), `toon` (stuk adres, meerdere met \|), `tak` (standaard `claude/productfotos`) | eigen tak `<tak>-<runnummer>` |
| Wat staat er op een winkelpagina | `winkelpagina.yml` | met de hand | `urls`, `naam`, `zoek`, `links`, `bron` (ruwe HTML rond termen), `kort` | niets |

## 10. Npm-commando's per map

**In de wortel** (`package.json`): `controle` (alles uit paragraaf 3),
`kern:verdeel`, `kern:controleer`, `test`, `modellen`, `stempel`,
`workflows`, `datums`, `llms`, `keuring`, `slop`, `dode-regels`,
`zoekmachine`, `winkelpagina`, `bronnen`, `fotos`, `menubreedte`. Zonder
npm-alias: `node scripts/vervang.mjs` (zoeken en vervangen, schrijft pas met
`--doen`), `node scripts/vergelijkbaar.mjs`, `node scripts/datumteksten.mjs`,
`python3 scripts/foto-bijsnijden.py`.

**In elke site** (`cd sites/<site>`): `genereer`, `prijzen`, `prijsverloop`,
`nieuwe-modellen`, `nieuwe-modellen:proef`, `keuzehulp` (hoeveel verschillende
adviezen de keuzehulp geeft), `links`, `links:intern`, `meet`,
`meet:vergelijk`, `beeld:voor`, `beeld:na`, `beeld:verschil`, `test`.
`meet:bewaar` bestaat op warmtepompmaatje en zonnestroommaatje; op
batterijmaatje is het `npm run meet -- --bewaar`.

**Alleen batterijmaatje:** `capaciteit` (stand van `capaciteit_soort`),
`vermogens` (zoekt het ontlaadvermogen op fabrikantpagina's; alleen op een
runner zinvol). Zonder alias: `node scripts/oogst-productfotos.mjs`.

**Alleen warmtepompmaatje:** `condities` (stand van `vermogen_conditie` en
`scop_conditie`), `isde` (`isde-condities.mjs`: verkent de RVO-pagina; schrijft
op dit moment niets). Zonder alias, en wel degene die gegevens overneemt:
`node scripts/isde-meldcodes.mjs [--schrijf]` (ISDE-bedrag en Prated-vermogen
uit `data/bronnen/isde-meldcodes.csv`) en `node scripts/varianten.mjs
[--schrijf]`.
