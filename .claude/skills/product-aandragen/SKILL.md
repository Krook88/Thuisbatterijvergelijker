---
name: product-aandragen
description: Verwerk een product dat een fabrikant, importeur of lezer aandraagt (mail, datasheet, brochure) op batterijmaatje, warmtepompmaatje of zonnestroommaatje. Gebruik bij "verwerk dit product", "een leverancier stuurde gegevens", "controleer deze datasheet", "zet dit model op de site", of wanneer een mail met specificaties, prijzen of certificaten wordt aangeleverd. Controleert de documentatie op tegenstrijdigheden, schrijft de records volgens DATASCHEMA.md en zoekt andere winkels en prijzen.
---

# Aangedragen product verwerken

Een aanbieder die zijn eigen product aandraagt, heeft belang bij een gunstig
beeld. Behandel alles wat hij stuurt als een bewering die je naast zijn eigen
datasheet legt. De regels van de site staan in `REDACTIE.md`, `DATASCHEMA.md`,
`SCHRIJFWIJZE.md` en `BIJDRAGEN.md` (paragraaf 4); lees die eerst als ze nog
niet in de context staan.

## 1. Documentatie uitlezen

- PDF's: `pdftotext -layout <bestand> -` (een brochure is groot, grep op
  `kWh|cycli|garantie|LFP|IP6|kW`).
- Fabrikantpagina's zijn vanuit de ontwikkelomgeving vaak niet bereikbaar
  (DNS of proxy). Probeer WebFetch één keer; lukt het niet, gebruik WebSearch
  en noteer dat de pagina niet zelf gelezen is.

## 2. Controleren: mail tegen datasheet tegen brochure

Zet per getal de drie bronnen naast elkaar en reken na. Typische fouten die
in aangeleverde datasheets zitten:

- **Bruikbaar vs. nominaal.** Klopt `bruikbaar = nominaal × DoD`? Staat
  hetzelfde getal bij beide, dan is het niet vastgesteld: `capaciteit_soort`
  `"nominaal"`. Een verschil is pas bruto/bruikbaar als de fabrikant dat zegt.
- **Systeemmaten.** Modules × modulemaat = opgegeven systeemmaat? Afronding
  (20,4 vs. 20,48; 22,7 vs. 22,8) melden, niet stil kiezen.
- **Gekopieerde regels** uit een zusterdatasheet (LV naar HV): spanningsbereik,
  Ah-bereik, stromen, "uitbreidbaar tot" die niet bij dit model passen.
- **Verwisselde labels**: "max. PV-ingangsspanning" met een waarde in W,
  MPPT-bereik en startspanning omgedraaid.
- **Vermogen**: C-rate tegenover ampère tegenover omvormermaat. Is niet
  eenduidig wat het systeem levert, dan `vermogen_kw: null` met uitleg in
  `vermogen_bron`. Nooit gokken.
- **Chemie** (LFP of NMC) in alle bronnen gelijk?
- **Prijs**: incl./excl. btw, incl./excl. installatie, en welke variant
  (omvormermaat, aantal modules) bij welk bedrag hoort.
- **Garantie**: modules en omvormer apart; capaciteitsgarantie met conditie
  (percentage, cycli, C-rate, temperatuur, DoD) en doorvoerlimiet.
- **Certificaten**: noteer CB-nummers; controleerbaar op
  certificates.iecee.org (meestal niet bereikbaar vanuit de omgeving, zeg dat).

## 3. Andere verkopers en prijzen zoeken

WebSearch (extended) op merk + model + "prijs", "kopen", "thuisbatterij", en
`-site:<fabrikantdomein>`. Neem een winkel alleen op als de pagina ons model
met een eigen bedrag toont. Geen winkel gevonden: geen `aanbiedingen`, op
productniveau `prijs_controle: "handmatig"` met reden en datum, en
`prijs_uit_offerte: true` als het een adviesprijs of offerteprijs is (anders
verdwijnt het product na 14 weken).

## 4. Records schrijven

- Eén regel per systeem; capaciteitsvarianten in `prijs_omvat`/tekst
  (REDACTIE.md). Kies een representatieve maat voor het record.
- Excl. btw: `richtprijs_btw_inbegrepen: false` (of `btw_inbegrepen: false`
  per aanbieding).
- Wat de aanbieder "niet opgegeven" noemt: `null`, niet `false`.
- `opmerkingen` in de eerste persoon, met iets controleerbaars, en noem de
  tegenstrijdigheden die je vond.
- Voeg records toe met een klein node-script (`JSON.stringify(d, null, 2)`),
  dan blijft de opmaak van het bestand gelijk.

## 5. Afronden

In de map van de site `npm run genereer` en `npm test`, in de wortel
`npm run controle` (browsercontroles vragen
`npm i --no-save playwright@1.63.0`). Zoek met de hand naar oude aantallen
(BIJDRAGEN.md stap 8). Zet het product met de bevindingen in `KANDIDATEN.md`.
Commit met de bron van specificaties en prijs in het bericht.

## 6. Terugkoppeling aan de gebruiker

Kort: wat is opgenomen, een lijst met wat niet klopt (voor een vraag aan de
aanbieder), wat niet te controleren was, en welke verkopers er gevonden zijn.
