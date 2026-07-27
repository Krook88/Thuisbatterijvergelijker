# Deployen naar Vercel + domein koppelen

Deze site is statisch (geen build-stap). Vercel serveert de bestanden precies zoals ze in
de repository staan; `vercel.json` regelt alleen cache- en beveiligingsheaders.

Dezelfde aanpak geldt voor de zustersites (Zonnemaatje → zonnestroommaatje.nl,
Warmtepompmaatje → warmtepompmaatje.nl): één Vercel-project per repository, één domein
per project.

---

## 1. Project aanmaken in Vercel

1. Ga naar <https://vercel.com/new> en kies het team **TheRook**.
2. Kies **Import Git Repository** → `Krook88/Thuisbatterijvergelijker`.
   (De eerste keer moet je de Vercel GitHub-app toegang geven tot de repository.)
3. Instellingen bij het importeren:
   - **Framework Preset**: `Other`
   - **Root Directory**: `./`
   - **Build Command**: leeg laten (staat al uit via `vercel.json`)
   - **Output Directory**: leeg laten
   - **Install Command**: leeg laten
4. **Deploy**. Na ±30 seconden staat de site op `https://<projectnaam>.vercel.app`.

### Let op: productiebranch

De standaardbranch van deze repository is nu `claude/home-battery-comparison-nl-qxolhe`.
Vercel gebruikt de standaardbranch als **productiebranch**. Controleer dit onder
**Settings → Git → Production Branch** en zet hem op de branch die je live wilt hebben.

Aanbevolen opruimactie: hernoem de standaardbranch op GitHub naar `main` en zet daarna de
productiebranch in Vercel op `main`. Pas dan ook de branchnamen in
`.github/workflows/update-prijzen.yml` en `deploy-pages.yml` aan.

### Automatisch opnieuw publiceren

Met de Git-integratie deployt Vercel bij elke push naar de productiebranch. De dagelijkse
prijsupdate (`update-prijzen.yml`) commit naar de repository en zet daarmee automatisch een
nieuwe versie live. Er is geen extra workflow of API-token nodig.

---

## 2. Domein koppelen

**Belangrijk: doe stap 2a vóór je de DNS omzet.** Zolang het domein nog als custom domain
aan GitHub Pages hangt, kan Vercel geen SSL-certificaat aanvragen.

### 2a. Domein losmaken van GitHub Pages

1. GitHub → repository → **Settings → Pages**.
2. Maak het veld **Custom domain** leeg en sla op.
3. Verwijder daarna het bestand `CNAME` uit de repository (die is alleen voor Pages).

### 2b. Domein toevoegen in Vercel

1. Vercel → project → **Settings → Domains**.
2. Voeg `batterijmaatje.nl` toe.
3. Voeg ook `www.batterijmaatje.nl` toe en kies **Redirect to batterijmaatje.nl** (308).

**Controleer de richting van de redirect.** Vercel stelt standaard het omgekeerde voor: het
kale domein dat naar `www` doorstuurt, met `www` als productiedomein. Dat botst met de site:
alle pagina's hebben een `<link rel="canonical">` naar de kale domeinnaam en `sitemap.xml`
bevat alleen kale URL's. Staat er bij het kale domein een pijl `↳ 308 www.…`, dan klopt het
niet. Corrigeren:

- bij `www.batterijmaatje.nl` → **Edit** → **Redirect to** `batterijmaatje.nl`, status 308;
- bij `batterijmaatje.nl` → **Edit** → redirect eraf en koppelen aan **Production**.

De vereiste DNS-records veranderen hier niet van.

### 2c. DNS-records bij de registrar zetten

Vercel toont per domein de exacte records die je moet zetten — **neem die waarden letterlijk
over**, ze verschillen per account en per domein. Het patroon is:

| Type  | Naam  | Waarde                                    |
| ----- | ----- | ----------------------------------------- |
| A     | `@`   | het IP-adres dat Vercel toont (bij batterijmaatje.nl: `216.198.79.1`) |
| CNAME | `www` | de hostnaam die Vercel toont, per domein uniek (bijv. `2a491db5428b0710.vercel-dns-017.com.`) |

Verwijder de oude GitHub Pages-records (de vier A-records `185.199.108–111.153` en het
`www`-CNAME naar `krook88.github.io`).

DNS-wijzigingen zijn meestal binnen enkele minuten actief; reken op maximaal 24 uur.
Vercel vraagt automatisch een Let's Encrypt-certificaat aan zodra de records kloppen.
Controleren kan in **Settings → Domains** (moet "Valid Configuration" tonen).

#### Bij TransIP

1. Bedieningspaneel → **Domein & hosting** → klik op de domeinnaam → tabblad **DNS**.
2. **Laat de MX-records en de bijbehorende TXT-records (SPF, DKIM, DMARC) staan.** Die
   regelen de e-mail op het domein (bijvoorbeeld `info@batterijmaatje.nl`). Raak alleen de
   records aan die naar de website wijzen.
3. Verwijder de oude GitHub Pages-records:
   - de vier A-records op `@` met `185.199.108.153`, `185.199.109.153`, `185.199.110.153`
     en `185.199.111.153`;
   - het CNAME-record `www` naar `krook88.github.io`.
4. Voeg toe wat Vercel toont:
   - **A** · naam `@` · TTL `300` · waarde: het IP-adres uit het Vercel-dashboard;
   - **CNAME** · naam `www` · TTL `300` · waarde: de hostnaam uit het Vercel-dashboard.
5. **Let op de punt.** TransIP plakt er anders je eigen domein achter. Vul de CNAME-waarde
   in als `cname.vercel-dns-0.com.` — mét de punt op het eind. Zonder punt wordt het
   `cname.vercel-dns-0.com.batterijmaatje.nl` en werkt het niet.
6. Opslaan. TTL op 300 houdt de omzetting snel; die kun je later terugzetten naar de
   standaardwaarde.

Draait het domein op een TransIP-webhostingpakket, dan staan de DNS-velden mogelijk op
slot. Ontkoppel dan eerst het hostingpakket van het domein (of zet de DNS op
"eigen instellingen") voordat je de records aanpast.

---

## 3. Dev-omgeving

Gebruik hiervoor de **preview-deployments van Vercel**, niet GitHub Pages.

Reden: de site linkt overal naar rootpaden (`/assets/style.css`, `/index.html`,
`/uitleg.html` — 60 van de 63 HTML-bestanden). Zonder eigen domein staat Pages op
`krook88.github.io/Thuisbatterijvergelijker/`, dus onder een submap. Daar breken de
stylesheet, `nav.js` en vrijwel alle interne links. Pages is alleen bruikbaar op een
domein dat in de root staat.

Met Vercel krijg je dat gratis:

- Elke push naar een niet-productiebranch krijgt een eigen preview-URL op de root van een
  `*.vercel.app`-hostnaam. Alles werkt daar identiek aan productie.
- Wil je een vaste dev-URL: voeg in **Settings → Domains** bijvoorbeeld
  `dev.batterijmaatje.nl` toe en koppel die aan een branch (`dev`). DNS: `CNAME dev` naar
  de waarde die Vercel toont.
- `vercel.json` zet op zowel `*.vercel.app` als `dev.*` de header `X-Robots-Tag: noindex`,
  zodat Google alleen het echte domein indexeert.

## 4. Na de overstap

- Controleer: `https://batterijmaatje.nl/`, een batterijpagina, de rekenmodule, de
  keuzehulp en een niet-bestaande URL (moet `404.html` tonen).
- Zet daarna GitHub Pages uit: GitHub **Settings → Pages** bron op *None*, en verwijder
  `.github/workflows/deploy-pages.yml`. Laat je Pages aan staan, dan blijft er een tweede,
  half werkende kopie op `krook88.github.io` staan die Google kan indexeren.

---

## 5. Zustersites

Kopieer `vercel.json` ongewijzigd naar `Krook88/Zonnemaatje` en `Krook88/Warmtepompmaatje`
en doorloop stap 1 en 2 per repository met het bijbehorende domein
(`zonnestroommaatje.nl`, `warmtepompmaatje.nl`).
