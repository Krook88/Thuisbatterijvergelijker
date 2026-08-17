/**
 * Het ophalen en beoordelen van externe links.
 *
 * Waarom dit bestaat: de drie sites hadden elk hun eigen kopie van dezelfde
 * controle, en die liepen uiteen. Dat was niet alleen rommelig, het was fout.
 * Op 16 augustus 2026 las de prijsupdate van warmtepompmaatje om 18:12 een
 * prijs van €8812 bij Wasco, en meldde de linkcontrole om 18:13 dat diezelfde
 * pagina een 404 was. Allebei in dezelfde run.
 *
 * De oorzaak: de controle vroeg eerst HEAD - dat scheelt bandbreedte bij de
 * winkel - en probeerde alleen bij 403, 405 of 501 alsnog GET. Wasco antwoordt
 * op HEAD met 404 en op GET met de pagina. Zulke servers zijn niet zeldzaam;
 * HEAD is voor veel webshops een bijzaak die langs een andere route loopt dan
 * de echte pagina.
 *
 * Wat dat aanricht is erger dan een verkeerde regel in een log. Een
 * linkcontrole die verzonnen 404's meldt, is een linkcontrole die niemand meer
 * gelooft - en dan valt een échte kapotte winkelpagina ook niet meer op,
 * terwijl daar de bezoeker op klikt die denkt dat hij iets kan kopen.
 *
 * Wat hier bewust niet in zit: het verzamelen van de links. Welke bestanden en
 * welke velden dat zijn verschilt per site (batterijen tegenover panelen en
 * omvormers tegenover warmtepompen, en alleen batterijmaatje heeft
 * leveranciers), dus dat blijft per site staan.
 */

/**
 * Codes die "wij houden bots buiten" betekenen, niet "de pagina bestaat niet".
 *
 * 415 hoort in dat rijtje omdat "verkeerd mediatype" bij een verzoek zonder
 * inhoud nergens op slaat; dat komt van een firewall. 406 net zo: dat zegt dat
 * de server niets kan leveren dat wij accepteren, en niet dat de pagina weg is.
 * Zonnefabriek en Energiewaaier stonden daardoor als kapot in de lijst terwijl
 * hun pagina's het gewoon doen. Apart houden, anders verdrinkt een echte 404
 * in de ruis.
 */
export const GEWEERD = [401, 403, 406, 415, 429];

export const TIJDSLIMIET_MS = 20000;
const GELIJKTIJDIG = 4;
const PAUZE_PER_HOST_MS = 1500;

export function gelukt(status) {
  return status >= 200 && status < 400;
}

/**
 * Accept hoort erbij: een client die niet zegt wat hij aankan, krijgt van
 * sommige servers een 406 of 415 terug. De User-Agent blijft eerlijk - dit is
 * een linkcontrole en die hoeft zich niet voor te doen als een browser.
 */
function kopregels(userAgent) {
  return {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "nl,en;q=0.8",
  };
}

/**
 * Haalt één adres op en zegt of het er nog is.
 *
 * HEAD eerst, GET erachteraan zodra HEAD geen bruikbaar antwoord geeft - of
 * dat nu een 404 is, een 500, of een verbinding die afbreekt. Het idee achter
 * HEAD blijft overeind (de meeste adressen antwoorden goed en dan schelen we
 * de winkel een hele pagina), maar het oordeel "kapot" wordt nooit meer op
 * alleen een HEAD gebaseerd. Een pagina die echt weg is, is met GET net zo weg.
 *
 * `haal` is er voor de proeven; in productie is dat gewoon fetch.
 */
export async function bereikbaarheid(url, opties = {}) {
  const { userAgent, tijdslimietMs = TIJDSLIMIET_MS, haal = fetch, viaBrowser = null } = opties;
  const verzoek = (methode) =>
    haal(url, {
      method: methode,
      redirect: "follow",
      signal: AbortSignal.timeout(tijdslimietMs),
      headers: kopregels(userAgent),
    });

  const noem = (fout) =>
    fout.name === "TimeoutError" ? "geen antwoord binnen 20 seconden" : fout.message;

  let eersteMelding = null;
  try {
    const reactie = await verzoek("HEAD");
    if (gelukt(reactie.status)) {
      return { url, status: reactie.status, eind: reactie.url, methode: "HEAD" };
    }
  } catch (fout) {
    eersteMelding = noem(fout);
  }

  let zonderBrowser;
  try {
    const reactie = await verzoek("GET");
    if (gelukt(reactie.status)) {
      return { url, status: reactie.status, eind: reactie.url, methode: "GET" };
    }
    zonderBrowser = { url, status: reactie.status, eind: reactie.url, methode: "GET" };
  } catch (fout) {
    zonderBrowser = { url, status: 0, methode: "GET", melding: eersteMelding || noem(fout) };
  }

  return viaBrowser ? await metEchteBrowser(url, viaBrowser, zonderBrowser) : zonderBrowser;
}

/**
 * Het laatste woord bij een adres dat ons weigert: een echte browser.
 *
 * Waarom dit nodig bleek. Na de HEAD-reparatie hielden we elf adressen over die
 * "kapot" heetten. Van vier daarvan staat de pagina gewoon in de zoekindex,
 * met precies de URL die wij aanroepen: bluetti.com/product/balco-500,
 * volt-shop.nl (SMA 5.0), memodo.nl (SMA 5.0). Die winkels antwoorden een
 * kaal verzoek met 404 of 400 in plaats van met 403 - botbescherming die zich
 * voordoet als een verdwenen pagina. Wie daarop afgaat haalt aanbiedingen weg
 * die het gewoon doen.
 *
 * Een browser kan dat onderscheid wel maken, en die staat in deze job al klaar
 * voor de prijzen. haalMetBrowser gooit bij een echte foutcode; komt er HTML
 * terug, dan heeft de browser een gewone pagina gekregen.
 *
 * Alleen voor adressen die er al doorheen gevallen zijn - dat zijn er een
 * handvol per site, en zonder browser verandert er niets.
 */
async function metEchteBrowser(url, viaBrowser, zonderBrowser) {
  try {
    const html = await viaBrowser(url);
    if (html) return { url, status: 200, methode: "browser" };
  } catch (fout) {
    const code = /HTTP (\d{3})/.exec(String(fout && fout.message));
    if (code) return { url, status: Number(code[1]), methode: "browser" };
  }
  return zonderBrowser;
}

/** Niet meer dan één verzoek per anderhalve seconde per host. */
function hostklok(pauzeMs = PAUZE_PER_HOST_MS) {
  const laatste = new Map();
  return async (host) => {
    const wachten = pauzeMs - (Date.now() - (laatste.get(host) || 0));
    if (wachten > 0) await new Promise((r) => setTimeout(r, wachten));
    laatste.set(host, Date.now());
  };
}

export async function controleerExtern(bronnen, opties = {}) {
  const lijst = [...bronnen.keys()];
  const uitkomsten = [];
  const wachtVoorHost = hostklok(opties.pauzeMs);
  let volgende = 0;

  async function werker() {
    while (volgende < lijst.length) {
      const url = lijst[volgende++];
      await wachtVoorHost(new URL(url).host);
      const uitkomst = await bereikbaarheid(url, opties);
      uitkomst.herkomst = bronnen.get(url);
      uitkomsten.push(uitkomst);
      process.stdout.write(gelukt(uitkomst.status) ? "." : "x");
    }
  }

  await Promise.all(Array.from({ length: opties.gelijktijdig || GELIJKTIJDIG }, werker));
  process.stdout.write("\n");
  return uitkomsten;
}

/** Kapot, geweerd, of in orde. */
export function deelUitkomsten(uitkomsten) {
  const stuk = uitkomsten.filter((u) => u.status === 0 || (u.status >= 400 && !GEWEERD.includes(u.status)));
  const geweerd = uitkomsten.filter((u) => GEWEERD.includes(u.status));
  return { stuk, geweerd, goed: uitkomsten.length - stuk.length - geweerd.length };
}

/** Het rapport op het scherm en in de samenvatting van de workflow. */
export function meldUitkomsten(uitkomsten, samenvatting) {
  const { stuk, geweerd, goed } = deelUitkomsten(uitkomsten);

  console.log(`\n${goed} in orde, ${stuk.length} kapot, ${geweerd.length} niet te controleren (server weert bots)`);

  if (stuk.length) {
    console.log("\nKapotte links:");
    for (const u of [...stuk].sort((a, b) => a.herkomst.localeCompare(b.herkomst))) {
      console.log(`  ${u.status || "geen antwoord"}  ${u.herkomst}\n     ${u.url}${u.melding ? `  (${u.melding})` : ""}`);
    }
  }

  const regels = [`### Linkcontrole: ${goed} in orde, ${stuk.length} kapot`];
  if (stuk.length) {
    regels.push(
      "",
      "Een bezoeker die hierop klikt komt op een foutpagina terwijl wij nog een prijs tonen.",
      "",
      "| Waar | Status | Link |",
      "| --- | --- | --- |",
      ...stuk.map((u) => `| ${u.herkomst} | ${u.status || u.melding} | ${u.url} |`),
    );
  }
  if (geweerd.length) {
    regels.push("", `${geweerd.length} adres(sen) konden niet gecontroleerd worden omdat de server geautomatiseerde verzoeken weert.`);
  }
  if (samenvatting) samenvatting(regels);

  return { stuk, geweerd, goed };
}
