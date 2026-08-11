# Merklogo's

Deze map is bedoeld voor officiële merklogo's van paneelfabrikanten, te tonen
naast de merknaam in de vergelijker en op de paneelpagina's.

## Beleid

- Gebruik alleen logo's uit de officiële pers-/brandkit van de fabrikant, of
  met schriftelijke toestemming.
- Sla ze op als SVG of PNG (hoogte ± 32 px is genoeg; ze worden op 16 px getoond).
- Registreer elk logo in `data/panelen.json` onder `merk_logos`, bijvoorbeeld:

```json
"merk_logos": {
  "Jinko Solar": "assets/logos/jinko.svg"
}
```

Zolang een merk niet geregistreerd is, toont de site gewoon de merknaam als
tekst; er is dus geen verplichting om logo's toe te voegen.
