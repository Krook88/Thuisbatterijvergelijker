# E-mailhandtekening Batterijmaatje

De handtekening voor `info@batterijmaatje.nl` (Kaj Rook), gemaakt om in Spark
te plakken maar bruikbaar in elk mailprogramma dat opgemaakte tekst accepteert.

| Bestand | Wat het is |
| --- | --- |
| `handtekening.html` | de handtekening mét logo — dit is de versie die je installeert |
| `handtekening-zonder-logo.html` | dezelfde handtekening zonder afbeelding, als terugval |
| `handtekening.txt` | platte tekst, voor mailprogramma's zonder opmaak |

Het logo staat als PNG in de site: `sites/batterijmaatje/assets/handtekening-logo.png`,
en is na een deploy bereikbaar op <https://batterijmaatje.nl/assets/handtekening-logo.png>.

## Installeren in Spark (Mac)

1. Open `handtekening.html` in een browser (dubbelklikken volstaat).
2. Selecteer de hele pagina (⌘A) en kopieer (⌘C).
3. Spark → Instellingen → Handtekeningen → **+** (nieuwe handtekening).
4. Klik in het opmaakvak en plak met **⌘⇧V** (plakken met opmaak behouden).
   Gewone ⌘V werkt meestal ook; ⌘⌥⇧V plakt juist zónder opmaak, dus die niet.
5. Koppel de handtekening aan het account `info@batterijmaatje.nl` en zet hem
   aan voor nieuwe berichten én voor antwoorden.

Stuur daarna één testmail naar jezelf en bekijk hem op de telefoon: dat is waar
een handtekening als eerste stukloopt.

## Installeren in Spark (iPhone/iPad)

Spark op iOS heeft een eenvoudigere editor. De betrouwbaarste route is de
handtekening eerst op de Mac instellen en laten synchroniseren. Kan dat niet,
gebruik dan `handtekening.txt`: platte tekst blijft overal heel.

## Het logo

De afbeelding wordt uit de site geladen, niet meegestuurd als bijlage. Dat
scheelt gewicht per mail en houdt de handtekening op één plek onderhoudbaar:
vervang je het PNG-bestand in de site, dan verandert elke verstuurde mail mee.

Twee dingen om te weten:

- **Het logo verschijnt pas na een deploy** van batterijmaatje.nl. Tot die tijd
  toont de handtekening de alt-tekst "Batterijmaatje"; gebruik zolang de versie
  zonder logo.
- **Sommige ontvangers blokkeren externe afbeeldingen.** Zij zien dezelfde
  alt-tekst. De handtekening blijft daardoor leesbaar: alle contactgegevens
  staan in tekst, niet in het plaatje.

Wil je het logo liever meesturen in plaats van laden? Bewaar het PNG-bestand
lokaal en sleep het in Spark in het opmaakvak, op de plek van de afbeelding.
Elke mail wordt dan ongeveer 20 kB zwaarder.

## Zelf aanpassen

De opmaak staat volledig inline in de HTML (geen `<style>`-blok, geen klassen),
omdat mailprogramma's stylesheets weggooien. Wijzig je iets, houd dat dan zo.

- **Functietitel.** Staat in de regel onder de naam ("Redactie").
- **Telefoonnummer.** Nog niet opgenomen omdat de site er geen noemt. Toevoegen
  kan met een extra regel in hetzelfde blok als het e-mailadres:
  `<a href="tel:+31612345678" style="color:#0f766e;text-decoration:none;">06 12 34 56 78</a>`
- **Kleuren.** Overgenomen uit `assets/style.css`: teal `#0f766e`, lichter teal
  `#14b8a6` voor de streep, inkt `#0a3733`, amber `#f59e0b`, rand `#e7e1d3`.
- **Lettertype.** Figtree is het sitelettertype, maar mailprogramma's laden geen
  webfonts. De handtekening valt daarom terug op Helvetica/Arial; dat is precies
  wat vrijwel elke ontvanger te zien krijgt.

Wat je beter niet doet: de tekst in een afbeelding zetten (onleesbaar voor wie
plaatjes blokkeert, en niet te kopiëren), of social-icoontjes toevoegen die naar
accounts wijzen die er nog niet zijn.
