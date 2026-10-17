/**
 * Alles wat een productpagina nodig heeft om goed gedeeld te worden: het eigen
 * deelplaatje (gemaakt door scripts/deelkaarten.mjs in de hoofdmap) en de
 * deelknoppen eronder (assets/delen.js).
 *
 * Gedeeld met de zustersites via kern/.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Geeft een functie die bij een product-id de og-tags van het plaatje maakt.
 * Is er (nog) geen eigen plaatje, dan het algemene van de site. De
 * vingerafdruk gaat als ?v= mee: WhatsApp en Facebook bewaren een voorbeeld
 * per adres, en zo krijgt een gewijzigd plaatje een nieuw adres.
 */
export function deelbeeldMaker(root, site) {
  let lijst = {};
  try { lijst = JSON.parse(readFileSync(join(root, "assets/deel/kaarten.json"), "utf8")); } catch { /* nog geen plaatjes */ }
  return (id, alt) => {
    const eigen = lijst[id] && existsSync(join(root, "assets/deel", `${id}.jpg`));
    const tags = eigen
      ? [`<meta property="og:image" content="${site}/assets/deel/${esc(id)}.jpg?v=${lijst[id]}">`,
        `<meta property="og:image:type" content="image/jpeg">`]
      : [`<meta property="og:image" content="${site}/assets/og-image.png">`];
    tags.push(`<meta property="og:image:width" content="1200">`,
      `<meta property="og:image:height" content="630">`);
    if (alt) tags.push(`<meta property="og:image:alt" content="${esc(alt)}">`);
    return tags.join("\n  ");
  };
}

/**
 * De deelknoppen. De WhatsApp-link werkt zonder JavaScript; "Kopieer link" en
 * het deelmenu van de telefoon zet assets/delen.js aan.
 *
 * `bericht` is de zin die in het WhatsApp-bericht komt, vóór de link.
 */
export function delenHtml({ url, bericht, vraag = "Ken je iemand die hier ook over twijfelt?" }) {
  const wa = `https://wa.me/?text=${encodeURIComponent(`${bericht} ${url}`)}`;
  return `<div class="delen" data-delen data-tekst="${esc(bericht)}">
    <span class="delen-vraag">${esc(vraag)}</span>
    <span class="delen-knoppen">
      <a class="knop knop-secundair delen-whatsapp" href="${esc(wa)}" target="_blank" rel="noopener">Stuur via WhatsApp</a>
      <button type="button" class="knop knop-secundair delen-systeem" hidden>Delen</button>
      <button type="button" class="knop knop-secundair delen-kopieer" hidden>Kopieer link</button>
    </span>
  </div>`;
}
