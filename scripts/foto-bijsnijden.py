"""
Productfoto's op één maat brengen.

Waarom dit bestaat
------------------
De foto's komen van 20 verschillende winkels en fabrikanten, en dat zie je. Bij
het nameten van de 66 die er stonden, besloeg het product bij de Gree Versati
14% van het beeld en bij de EcoFlow Stream AC Pro 100%. In de kaartweergave
staan die twee naast elkaar in dezelfde tegel van 371 bij 277 pixels, en omdat
de browser met object-fit: contain het hele beeld inpast, komt de een als een
postzegel in het midden en de ander tot aan de rand. Dat is wat de rij er
bij elkaar geraapt uit laat zien - niet de foto's zelf, maar de witruimte die
er bij de bron omheen zat.

Daarnaast had 36 van de 66 een witte achtergrond en de tegel is crème, dus daar
stond een zichtbare witte rechthoek in de kaart.

Wat het doet
------------
Per foto: de vlakke rand eromheen wegsnijden tot aan het product, en er dan een
vaste marge van 6% omheen zetten in diezelfde achtergrondkleur (of transparant,
als het beeld dat was). De verhouding van het product blijft zoals hij is - een
zonnepaneel hoort breed te blijven en een batterijkast hoog - zodat contain in
beide richtingen hetzelfde resultaat geeft.

Wat het niet doet
-----------------
Foto's zonder vlakke rand blijven ongemoeid. Dat zijn de negen die op locatie
zijn gemaakt, met een muur of een vloer erachter; daar is geen achtergrond om
weg te snijden, en raden wat achtergrond is en wat product levert een foto op
waar een hoek van af is.

Waarom Python en niet Node: de site heeft nul afhankelijkheden en dat blijft zo.
Dit is gereedschap, net als cwebp in de fotoworkflow - het draait bij het
ophalen van een foto en nooit bij een bezoeker.

Draaien:  python3 scripts/foto-bijsnijden.py            alles, en wegschrijven
          python3 scripts/foto-bijsnijden.py --droog    alleen tonen
"""
import sys
import glob
from PIL import Image, ImageChops

MARGE = 0.06          # vaste rand om het product, als deel van de langste zijde
DREMPEL_KLEUR = 14    # hoeveel een pixel van de achtergrond mag afwijken
DREMPEL_ALPHA = 16    # vanaf welke alpha een pixel als product telt
HOEK_TOLERANTIE = 12  # hoeveel de vier hoeken onderling mogen schelen
KWALITEIT = 82

DROOG = "--droog" in sys.argv


def achtergrond(im):
    """Geeft ("transparant", None), ("vlak", (r,g,b)) of (None, None)."""
    w, h = im.size
    hoeken = [im.getpixel(p) for p in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]]
    if all(c[3] < DREMPEL_ALPHA for c in hoeken):
        return "transparant", None
    kleur = hoeken[0][:3]
    if all(max(abs(a - b) for a, b in zip(kleur, c[:3])) < HOEK_TOLERANTIE for c in hoeken[1:]):
        return "vlak", kleur
    return None, None


def productvak(im, soort, kleur):
    """Het kleinste rechthoekje waar het product in past."""
    if soort == "transparant":
        masker = im.getchannel("A").point(lambda a: 255 if a > DREMPEL_ALPHA else 0)
    else:
        vlak = Image.new("RGB", im.size, kleur)
        verschil = ImageChops.difference(im.convert("RGB"), vlak).convert("L")
        masker = verschil.point(lambda v: 255 if v > DREMPEL_KLEUR else 0)
    return masker.getbbox()


def verwerk(pad):
    im = Image.open(pad).convert("RGBA")
    soort, kleur = achtergrond(im)
    if soort is None:
        return "op locatie", None
    vak = productvak(im, soort, kleur)
    if not vak:
        return "leeg beeld", None
    product = im.crop(vak)
    pw, ph = product.size
    rand = round(max(pw, ph) * MARGE)

    # Al goed? Dan niet aanraken. Webp is lossy, dus elke keer opnieuw
    # wegschrijven kost beeldkwaliteit zonder dat er iets verandert; bij de
    # tweede run op dezelfde foto's werd elk bestand een paar honderd bytes
    # kleiner en elke pixel een beetje zachter. Een script dat op een
    # ongewijzigde invoer een gewijzigde uitvoer geeft, is niet af.
    marges = (vak[0], vak[1], im.size[0] - vak[2], im.size[1] - vak[3])
    if all(abs(m - rand) <= 2 for m in marges):
        return "al goed", None
    doek = Image.new("RGBA", (pw + 2 * rand, ph + 2 * rand),
                     (0, 0, 0, 0) if soort == "transparant" else (*kleur, 255))
    doek.paste(product, (rand, rand), product)
    voor = (pw * ph) / (im.size[0] * im.size[1])
    na = (pw * ph) / (doek.size[0] * doek.size[1])
    if not DROOG:
        if soort == "transparant":
            doek.save(pad, "WEBP", quality=KWALITEIT)
        else:
            doek.convert("RGB").save(pad, "WEBP", quality=KWALITEIT)
    return soort, (round(voor * 100), round(na * 100), doek.size)


tellers = {}
for pad in sorted(glob.glob("sites/*/assets/producten/*.webp")):
    soort, maat = verwerk(pad)
    tellers[soort] = tellers.get(soort, 0) + 1
    if maat:
        print(f"  {maat[0]:3}% -> {maat[1]:3}%  {maat[2][0]}x{maat[2][1]}  {pad.split('/')[-1]}")

print()
for soort, n in sorted(tellers.items()):
    print(f"{n:4} {soort}")
print("\nDroog: er is niets weggeschreven." if DROOG else "\nFoto's bijgewerkt.")
