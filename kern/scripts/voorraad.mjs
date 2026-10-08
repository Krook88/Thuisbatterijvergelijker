/**
 * Is het artikel bij deze winkel nog te koop?
 *
 * De prijsupdate las bij Multi Solar elke dag netjes 994 euro voor de Marstek
 * Venus D, en bij Zendure 480 euro voor de SolarFlow Hyper 2000. Op beide
 * pagina's stond bij elke variant "uitverkocht". Het bedrag bleef in de
 * markup staan, dus voor het script was er niets aan de hand, en op de site
 * stond een prijs die je nergens kon afrekenen.
 *
 * Bij winkels met schema.org-data vangt prijs-uitlezen dit al af
 * (availability: OutOfStock), en bij bol.com zegt de API het. Shopify-winkels
 * hebben vaak geen van beide, maar wel iets beters: achter elke productpagina
 * staat /products/<naam>.js, met per variant of hij leverbaar is. Dat is de
 * winkel die het zelf zegt, geen gok op woorden in de tekst.
 *
 * Alleen als alle varianten uitverkocht zijn telt het artikel als niet
 * leverbaar. Eén leverbare variant is genoeg: dan is het product te koop, ook
 * als de uitvoering met extra panelen op is.
 */

const SHOPIFY_PRODUCT = /^(https?:\/\/[^/]+(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/(?:collections\/[^/]+\/)?products\/[^/?#]+)/i;

/** Het adres van de product-JSON, of null als dit geen Shopify-productpagina lijkt. */
export function shopifyJsonAdres(url) {
  const m = String(url || "").match(SHOPIFY_PRODUCT);
  return m ? `${m[1].replace(/\/$/, "")}.js` : null;
}

/** Uit de product-JSON: true (te koop), false (alles uitverkocht) of null (zegt niets). */
export function leverbaarUitShopify(data) {
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data.variants) && data.variants.length) {
    const metStand = data.variants.filter((v) => v && typeof v.available === "boolean");
    if (metStand.length) return metStand.some((v) => v.available);
  }
  return typeof data.available === "boolean" ? data.available : null;
}

/**
 * Vraagt de winkel of het artikel leverbaar is. Geeft true, false of null; null
 * betekent "weet ik niet" (geen Shopify, geen antwoord, geen JSON) en mag
 * nooit tot een wijziging leiden.
 */
export async function voorraadVolgensWinkel(url, haal = fetch) {
  const adres = shopifyJsonAdres(url);
  if (!adres) return null;
  try {
    const res = await haal(adres, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (prijscontrole maatje-sites)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const tekst = await res.text();
    if (!/^\s*\{/.test(tekst)) return null;
    return leverbaarUitShopify(JSON.parse(tekst));
  } catch {
    return null;
  }
}

/**
 * Past de markering op de aanbieding aan. Een markering die een mens heeft
 * gezet (met niet_leverbaar_reden, of zonder bron) blijft altijd staan; deze
 * functie haalt alleen weg wat hij zelf heeft gezet.
 *
 * Geeft "uitverkocht" als het artikel net onverkoopbaar werd, "weer" als het
 * terug is, "blijft" als het al gemarkeerd was en nog steeds op is, en null
 * als er niets verandert.
 */
export function verwerkVoorraad(aanbieding, leverbaar) {
  if (leverbaar === false) {
    if (aanbieding.niet_leverbaar) return "blijft";
    aanbieding.niet_leverbaar = true;
    aanbieding.niet_leverbaar_door = "voorraad";
    return "uitverkocht";
  }
  if (leverbaar === true && aanbieding.niet_leverbaar && aanbieding.niet_leverbaar_door === "voorraad") {
    delete aanbieding.niet_leverbaar;
    delete aanbieding.niet_leverbaar_door;
    return "weer";
  }
  return null;
}

/**
 * Bestaat de winkelpagina nog?
 *
 * Een 404 werd elke dag netjes gemeld in het verslag van de prijsupdate, maar
 * op de site bleef de knop naar die winkel staan. Thuisbatterij Outlet haalde
 * in oktober 2026 twee productpagina's weg; de prijs stond er nog, met een
 * link die op een foutpagina uitkwam, totdat iemand het met de hand
 * opruimde. Dat is precies wat een bezoeker ziet en wij niet.
 *
 * Eén mislukte dag is nog geen verdwenen pagina: een winkel kan een uur plat
 * liggen of een verbouwing doen. Daarom eerst een notitie (weg_sinds), en pas
 * als de pagina op een latere dag nog steeds weg is de markering
 * niet_leverbaar met als bron "pagina weg". Dan toont de site de winkel zonder
 * link, net als bij uitverkocht. Komt de pagina terug, dan gaat de markering
 * er vanzelf weer af - maar alleen als deze functie hem zelf zette; een
 * markering van een mens of van de voorraadcontrole blijft staan.
 *
 * bereikbaar: true (de pagina kwam binnen, met of zonder bedrag) of false (404,
 * 410 of geen antwoord van de server). Geeft "weg" als de aanbieding net
 * gemarkeerd is, "terug" als de markering eraf ging, "eerste keer" bij de
 * notitie, "blijft" als hij al gemarkeerd was, en null als er niets verandert.
 */
export function verwerkBereikbaarheid(aanbieding, bereikbaar, vandaag) {
  if (bereikbaar) {
    delete aanbieding.weg_sinds;
    if (aanbieding.niet_leverbaar && aanbieding.niet_leverbaar_door === "pagina weg") {
      delete aanbieding.niet_leverbaar;
      delete aanbieding.niet_leverbaar_door;
      return "terug";
    }
    return null;
  }
  if (aanbieding.niet_leverbaar) return aanbieding.niet_leverbaar_door === "pagina weg" ? "blijft" : null;
  if (!aanbieding.weg_sinds) {
    aanbieding.weg_sinds = vandaag;
    return "eerste keer";
  }
  if (aanbieding.weg_sinds < vandaag) {
    aanbieding.niet_leverbaar = true;
    aanbieding.niet_leverbaar_door = "pagina weg";
    return "weg";
  }
  return "eerste keer";
}

/**
 * verwerkBereikbaarheid plus de regel in het logboek. Stond woord voor woord in
 * alle drie de prijsscripts.
 */
export function meldBereikbaarheid(item, aanbieding, bereikbaar, vandaag) {
  const uitkomst = verwerkBereikbaarheid(aanbieding, bereikbaar, vandaag);
  if (uitkomst === "weg") console.log(`  ! ${item.id} @ ${aanbieding.winkel}: pagina weg sinds ${aanbieding.weg_sinds}, de site toont deze winkel nu zonder link`);
  if (uitkomst === "terug") console.log(`  ! ${item.id} @ ${aanbieding.winkel}: pagina is terug, de link komt weer op de site`);
  return uitkomst;
}

/** Betekent deze fout dat de pagina weg is (en niet: dat de winkel ons weert)? */
export function paginaWeg(err) {
  const status = (String(err && err.message).match(/HTTP (\d+)/) || [])[1];
  return status === "404" || status === "410" || (err && err.name === "TypeError");
}
