/**
 * Staat onze waarde in deze zin van de bronpagina?
 *
 * Apart van bronnen-nakijken.mjs om dezelfde reden als linkcontrole.mjs naast
 * controleer-links.mjs staat: dat script haalt pagina's op en kan daarom niet
 * in een proef draaien, terwijl juist het vergelijken precies moet kloppen. Een
 * vergelijking die te makkelijk "bevestigd" zegt maakt de hele controle
 * waardeloos, en dat is niet aan de uitvoer te zien - die is dan juist mooi
 * groen.
 */

/* Hoe een getal op een fabrikantpagina geschreven kan staan.
 *
 * Nederlandse fabrikanten schrijven 4,5 en Engelse 4.5; een tabel schrijft
 * 4,50 waar de lopende tekst 4,5 zegt. Alle drie zijn hetzelfde getal.
 *
 * Afrondingen gaan tot twee decimalen mee: de Stiebel WPL 09 ICS staat bij ons
 * op 4,525 omdat de fabrikant dat zo opgeeft, en een tabel die 4,53 schrijft
 * zegt niets anders. Iemand daarvoor laten opdraven is precies de ruis waar
 * deze controle niet aan kapot mag gaan.
 */
export function schrijfwijzen(waarde) {
  if (!Number.isFinite(waarde)) return [];
  const vormen = new Set();
  // Als tekst en niet als getal, want juist de opvulling doet het werk: Number
  // maakt van 4.50 weer 4.5, en dan vindt onze 4,5 de 4,50 van de pagina niet.
  // Dat ging hier eerst mis, en de proef op de echte Stiebel-zin ving het.
  // De grenzen in staatErin wijzen "4,5" in "4,50" namelijk af - terecht, want
  // dezelfde regel houdt "4,5" buiten "14,52" - dus de opgevulde vorm moet er
  // zelf bij staan.
  for (const vorm of [String(waarde), waarde.toFixed(1), waarde.toFixed(2)]) {
    vormen.add(vorm);
    vormen.add(vorm.replace(".", ","));
  }
  return [...vormen];
}

/** Het koudemiddel staat bij ons als "R410A (GWP 2088)"; op de pagina als "R410A". */
export function koudemiddelCode(waarde) {
  const m = /\b(R\s?-?\d{3,4}[A-Z]?)\b/i.exec(String(waarde));
  return m ? m[1].replace(/[\s-]/g, "").toUpperCase() : String(waarde).split(" ")[0];
}

/**
 * Komt een van deze schrijfwijzen in de zin voor, als eigen getal?
 *
 * De woordgrenzen staan er met de hand in en niet met \b, want \b kijkt niet
 * naar komma's en punten: dan slaat "4,5" aan op "14,52" en bevestigt deze
 * controle een getal dat er niet staat. Dat is het ene geval dat echt kwaad
 * kan, want een valse bevestiging ziet niemand meer terug.
 */
export function staatErin(context, vormen) {
  const tekst = String(context);
  return vormen.some((vorm) => {
    if (!vorm) return false;
    let i = tekst.indexOf(vorm);
    while (i >= 0) {
      const voor = tekst[i - 1] || " ";
      const na = tekst[i + vorm.length] || " ";
      if (!/[\d,.]/.test(voor) && !/[\d,.]/.test(na)) return true;
      i = tekst.indexOf(vorm, i + 1);
    }
    return false;
  });
}
