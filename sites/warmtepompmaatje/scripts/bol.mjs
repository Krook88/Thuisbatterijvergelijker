/* ------------------------------------------------------------------
   Bol.com Marketing Catalog API (officiële partnerroute).

   Bol blokkeert gewone scraping (403); met partner-inloggegevens halen we
   prijzen op via de API. Zonder BOL_CLIENT_ID/BOL_CLIENT_SECRET in de
   omgeving wordt dit overgeslagen en blijft de oude prijs staan.
   Auth: https://api.bol.com/marketing/docs/catalog-api/authentication.html

   Waarom dit in kern staat: de drie prijsscripts hadden elk een eigen kopie,
   en alleen die van batterijmaatje werkte. Bij de andere twee ontbrak de
   Accept-Language-kop (zonder die kop stuurt Node "*" en antwoordt bol met
   HTTP 400) en de omzetting van het bol-product-ID naar een EAN (de catalogus
   kent alleen EAN's). Dat viel niet op zolang daar geen bol-aanbieding stond;
   de eerste had elke dag "HTTP 400" gemeld.
   ------------------------------------------------------------------ */

const BOL_BASIS = "https://api.bol.com/marketing/catalog/v1";

let bolToken = null;

/** Zijn de inloggegevens er? Zonder slaat elke site bol.com over. */
export function bolBeschikbaar(env = process.env) {
  return Boolean(env.BOL_CLIENT_ID && env.BOL_CLIENT_SECRET);
}

async function haalBolToken(env = process.env) {
  if (!bolBeschikbaar(env)) return null;
  if (bolToken) return bolToken;
  const res = await fetch("https://login.bol.com/token?grant_type=client_credentials", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(`${env.BOL_CLIENT_ID}:${env.BOL_CLIENT_SECRET}`).toString("base64"),
      "Accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(`bol-token HTTP ${res.status}`);
  bolToken = (await res.json()).access_token;
  return bolToken;
}

// Defensief: vind de eerste plausibele price-waarde in de API-respons, zodat
// kleine wijzigingen in het responsformaat ons niet breken.
//
// De grenzen komen van de site: met een ondergrens van een paar tientjes pakt
// deze zoektocht net zo goed de verzendkosten of een los accessoire uit de
// respons als de productprijs.
export function zoekPrijsInRespons(obj, grenzen) {
  if (obj == null || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const x of obj) { const p = zoekPrijsInRespons(x, grenzen); if (p) return p; }
    return null;
  }
  if (typeof obj.price === "number" && obj.price >= grenzen.min && obj.price <= grenzen.max) return obj.price;
  for (const k of Object.keys(obj)) {
    const p = zoekPrijsInRespons(obj[k], grenzen);
    if (p) return p;
  }
  return null;
}

// Defensief, net als hierboven: pak de eerste waarde die eruitziet als een
// EAN. Zo blijft de omzetting werken als bol het veld ooit anders noemt.
export function zoekEanInRespons(obj) {
  if (obj == null) return null;
  if (typeof obj === "string") return /^\d{13}$/.test(obj) ? obj : null;
  if (typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const x of obj) { const e = zoekEanInRespons(x); if (e) return e; }
    return null;
  }
  for (const k of Object.keys(obj)) {
    const e = zoekEanInRespons(obj[k]);
    if (e) return e;
  }
  return null;
}

/** Het bol-product-ID uit een bol-URL, of null. */
export function bolProductId(url) {
  // Query en fragment eerst weg: bol-links dragen vaak een ?bltgh=-parameter,
  // en dan staat het product-id niet meer aan het eind van de URL.
  const pad = String(url || "").split(/[?#]/)[0];
  const m = pad.match(/\/(\d{8,})\/?$/);
  return m ? m[1] : null;
}

// Accept-Language is verplicht. Node stuurt zonder deze regel "*", en dat
// wijst bol af met HTTP 400 (violation: acceptLanguage).
function bolHeaders(token) {
  return {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/json",
    "Accept-Language": "nl",
  };
}

// De catalogus werkt op EAN's van 13 cijfers, maar een bol-URL bevat het
// bol-product-ID van 16 cijfers. Bol heeft daar een omzet-endpoint voor.
async function bolEan(id, token) {
  const res = await fetch(`${BOL_BASIS}/products/${id}/to-ean?country-code=NL`, {
    headers: bolHeaders(token),
  });
  if (!res.ok) {
    console.log(`  ~ bol-API ${id}: omzetten naar EAN gaf HTTP ${res.status} (${(await res.text()).slice(0, 300)})`);
    return null;
  }
  const ean = zoekEanInRespons(await res.json());
  if (!ean) console.log(`  ~ bol-API ${id}: geen EAN in de respons`);
  return ean;
}

// Tweede route naar de EAN. Het omzet-endpoint kent niet elk product, maar het
// zoek-endpoint geeft per resultaat zowel de EAN als het bol-product-ID terug.
// Zoeken op de productnaam uit de URL en dan matchen op dat ID is exact: we
// nemen alleen een EAN over als bol zelf hem aan hetzelfde product hangt.
async function bolEanViaZoeken(id, url, token) {
  const slug = (String(url).match(/\/p\/([^/]+)\//) || [])[1];
  if (!slug) return null;
  const zoekterm = decodeURIComponent(slug).replace(/-/g, " ").slice(0, 100);
  const res = await fetch(
    `${BOL_BASIS}/products/search?search-term=${encodeURIComponent(zoekterm)}&country-code=NL`,
    { headers: bolHeaders(token) },
  );
  if (!res.ok) return null;
  const data = await res.json();
  const treffer = (data.results || []).find((r) => String(r.bolProductId) === String(id));
  if (!treffer) return null;
  const ean = zoekEanInRespons(treffer);
  if (ean) console.log(`  ~ bol-API ${id}: EAN ${ean} gevonden via zoeken`);
  return ean;
}

/**
 * De beste prijs van een bol-aanbieding, in hele euro's (bol toont
 * consumentenprijzen, dus altijd inclusief btw), of null.
 *
 * Past de aanbieding aan zoals de winkel het zelf zegt: de EAN wordt na de
 * eerste keer bewaard, en een artikel dat bol niet (meer) verkoopt krijgt
 * niet_leverbaar, dat er weer afgaat zodra er een prijs is. Wie dat wil
 * rapporteren geeft bijNietLeverbaar en bijWeerLeverbaar mee.
 */
export async function bolApiPrijs(aanbieding, { grenzen, bijNietLeverbaar = () => {}, bijWeerLeverbaar = () => {}, env = process.env } = {}) {
  const token = await haalBolToken(env);
  if (!token) return null;

  // De EAN wordt na de eerste keer in de gegevens bewaard, zodat een dagelijkse
  // run maar één aanroep per aanbieding nodig heeft.
  let ean = typeof aanbieding.ean === "string" && /^\d{13}$/.test(aanbieding.ean) ? aanbieding.ean : null;
  if (!ean) {
    const id = bolProductId(aanbieding.url);
    if (!id) { console.log(`  ~ bol-API: geen product-id herkend in ${aanbieding.url}`); return null; }
    ean = (await bolEan(id, token)) || (await bolEanViaZoeken(id, aanbieding.url, token));
    if (!ean) {
      // Twee verschillende bol-endpoints kennen dit product-id niet: het
      // omzet-endpoint gaf 404 en het zoek-endpoint hangt de EAN aan geen
      // enkel resultaat met dit id. Dat is bol die zegt dat hij dit artikel
      // niet meer voert, net als een 404 verderop, en het telt dus ook zo.
      //
      // Zonder deze stap bleef de HomeWizard-aanbieding elke dag "geen prijs
      // gevonden" melden terwijl er 1.195 euro bij bol.com bovenaan stond die
      // daar niet meer af te rekenen was.
      if (!aanbieding.niet_leverbaar) {
        console.log(`  ! bol-API ${id}: bol kent dit product niet meer, telt niet meer mee voor de kopprijs`);
        bijNietLeverbaar(aanbieding);
      }
      aanbieding.niet_leverbaar = true;
      return null;
    }
    // Een eerder gemarkeerd artikel dat weer een EAN oplevert is terug; de
    // markering valt hieronder af zodra er ook een prijs bij hoort.
    aanbieding.ean = ean;
  }

  const res = await fetch(`${BOL_BASIS}/products/${ean}/offers/best?country-code=NL`, {
    headers: bolHeaders(token),
  });
  if (res.status === 404) {
    // Geen storing: bol heeft dit artikel op dit moment niet in de verkoop.
    // Dit is bol die het zelf zegt, geen gok van ons, en dus mag het de
    // gegevens aanpassen: de aanbieding telt niet meer mee voor de kopprijs.
    // Zonder deze stap blijft er een bedrag bovenaan staan dat je nergens kunt
    // afrekenen - precies wat er bij de Wolf CHA-07 bij Benem misging, en wat
    // daar met de hand rechtgezet moest worden.
    if (!aanbieding.niet_leverbaar) {
      console.log(`  ! bol-API ${ean}: bol verkoopt dit artikel niet meer, telt niet meer mee voor de kopprijs`);
      bijNietLeverbaar(aanbieding);
    }
    aanbieding.niet_leverbaar = true;
    return null;
  }
  if (!res.ok) {
    console.log(`  ~ bol-API ${ean}: HTTP ${res.status} (respons: ${(await res.text()).slice(0, 300)})`);
    return null;
  }
  const prijs = zoekPrijsInRespons(await res.json(), grenzen);
  // Weer te koop: de markering valt vanzelf af, zonder dat iemand ernaar
  // hoeft te kijken.
  if (prijs && aanbieding.niet_leverbaar) {
    console.log(`  ! bol-API ${ean}: weer leverbaar, markering vervalt`);
    delete aanbieding.niet_leverbaar;
    bijWeerLeverbaar(aanbieding);
  }
  return prijs ? Math.round(prijs) : null;
}
