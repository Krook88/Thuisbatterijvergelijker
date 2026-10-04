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
