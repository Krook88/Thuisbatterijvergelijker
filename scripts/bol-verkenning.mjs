/*
  Tijdelijk hulpscript. De Catalog API wil een EAN, maar onze aanbiedingen
  bevatten alleen het bol-product-ID uit de URL. Volgens de documentatie
  bestaat daar een omzet-endpoint voor, alleen staat het exacte pad nergens
  in de vindbare documentatie. Dit script leest de openbare documentatie en
  probeert daarna een aantal kandidaat-paden met echte inloggegevens, zodat
  we niet hoeven te gokken. Draait alleen handmatig.
*/

const ID = process.env.BOL_CLIENT_ID || "";
const SECRET = process.env.BOL_CLIENT_SECRET || "";
const PROEF_PRODUCT = "9300000240523865"; // Marstek Venus E 3.0

if (!ID || !SECRET) {
  console.error("BOL_CLIENT_ID/BOL_CLIENT_SECRET ontbreken.");
  process.exit(1);
}

async function token() {
  const res = await fetch("https://login.bol.com/token?grant_type=client_credentials", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${ID}:${SECRET}`).toString("base64"),
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`token HTTP ${res.status}`);
  return (await res.json()).access_token;
}

// 1. Welke paden noemt de documentatie zelf?
async function paden() {
  console.log("== paden uit de documentatie ==");
  const bronnen = [
    "https://api.bol.com/marketing/docs/api-reference/catalog-api-v1.html",
    "https://api.bol.com/marketing/docs/catalog-api/api-documentation.html",
    "https://api.bol.com/marketing/docs/catalog-api/conventions.html",
  ];
  const gevonden = new Set();
  for (const url of bronnen) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" } });
      if (!res.ok) { console.log(`  ${url} -> HTTP ${res.status}`); continue; }
      const tekst = await res.text();
      for (const m of tekst.matchAll(/\/marketing\/catalog\/v\d[^\s"'<>)\\]*/g)) gevonden.add(m[0]);
      // De referentiepagina laadt haar inhoud vaak uit een losse specificatie.
      for (const m of tekst.matchAll(/["']([^"']+\.(?:json|yaml|yml))["']/g)) {
        if (/spec|openapi|swagger|catalog/i.test(m[1])) gevonden.add("SPEC: " + m[1]);
      }
      console.log(`  ${url} -> HTTP 200 (${tekst.length} tekens)`);
    } catch (e) {
      console.log(`  ${url} -> ${e.message}`);
    }
  }
  for (const p of [...gevonden].sort()) console.log("   ", p);
}

// 2. Werkt een van de voor de hand liggende omzet-paden?
async function kandidaten(t) {
  console.log("\n== kandidaat-paden (bol-product-ID -> EAN) ==");
  const basis = "https://api.bol.com/marketing/catalog/v1";
  const lijst = [
    `${basis}/products/${PROEF_PRODUCT}`,
    `${basis}/products/${PROEF_PRODUCT}/ean`,
    `${basis}/products/${PROEF_PRODUCT}/eans`,
    `${basis}/converter/bol-product-ids/${PROEF_PRODUCT}`,
    `${basis}/converter?bol-product-id=${PROEF_PRODUCT}`,
    `${basis}/products/converter?bol-product-id=${PROEF_PRODUCT}`,
    `${basis}/eans?bol-product-ids=${PROEF_PRODUCT}`,
    `${basis}/products?bol-product-ids=${PROEF_PRODUCT}&country-code=NL`,
    `${basis}/products/list?bol-product-ids=${PROEF_PRODUCT}&country-code=NL`,
    `${basis}/products/search?search-term=marstek%20venus%20e&country-code=NL`,
  ];
  for (const url of lijst) {
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${t}`,
          Accept: "application/json",
          "Accept-Language": "nl",
        },
      });
      const body = (await res.text()).slice(0, 300);
      console.log(`  ${res.status}  ${url.replace(basis, "")}`);
      if (res.status !== 404) console.log(`        ${body}`);
    } catch (e) {
      console.log(`  fout  ${url}: ${e.message}`);
    }
  }
}

const t = await token();
console.log("token opgehaald\n");
await paden();
await kandidaten(t);
