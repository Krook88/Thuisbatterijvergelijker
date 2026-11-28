// Test: Batterijmaatje-adviseur op Claude Haiku 5.5 met 20 echte vragen.
// Gebruik: npm i --no-save @anthropic-ai/sdk && ANTHROPIC_API_KEY=... node scripts/adviseur-test.mjs [uitvoermap]
// Leest docs/adviseur-prompt.md en schrijft resultaten.md en resultaten.json naar de uitvoermap (standaard: de huidige map).
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "node:fs";

const promptPad = new URL("../docs/adviseur-prompt.md", import.meta.url);
const uitMap = process.argv[2] || ".";
const volledig = readFileSync(promptPad, "utf8");
// Alleen het deel na de wijzigingslijst is de echte systeemprompt.
const system = volledig.split("\n---\n").slice(1).join("\n---\n").trim();

const MODEL = "claude-haiku-5-5";
const PRIJS_IN = 0.10 / 1e6, PRIJS_UIT = 0.50 / 1e6, PRIJS_CACHE_LEES = 0.01 / 1e6, PRIJS_CACHE_SCHRIJF = 0.125 / 1e6;

// Een vraag is een string (één beurt) of een lijst (meerdere beurten van de bezoeker).
const vragen = [
  "Is een thuisbatterij interessant voor mij?",
  "Ik heb 12 zonnepanelen, verbruik 3.200 kWh per jaar, ben overdag meestal weg en heb een vast contract. Koophuis met garage. Loont een batterij?",
  "Verdien ik een thuisbatterij terug na 2027?",
  "Wat kost een thuisbatterij van 10 kWh?",
  "Komt er een btw-nultarief op thuisbatterijen?",
  "Moet ik snel een batterij kopen voor 1 januari, voordat salderen stopt?",
  "Wat is de beste thuisbatterij?",
  "Ik heb geen zonnepanelen. Heeft een thuisbatterij dan zin?",
  "Moet ik mijn stekkerbatterij ergens aanmelden?",
  "Kan ik mijn inductiekookplaat op de batterij laten draaien?",
  "Ik heb een warmtepomp. Werkt een thuisbatterij in de winter?",
  "Hoe lang gaat een thuisbatterij mee?",
  "Mag ik de batterij in de gang bij de voordeur zetten? Daar zit de meterkast.",
  "Ik huur mijn huis. Kan ik toch een thuisbatterij nemen?",
  "Een verkoper zegt dat ik de btw terugkrijg en dat hij zich in 4 jaar terugverdient. Klopt dat?",
  "Wat is het verschil tussen een stekkerbatterij en een vaste batterij?",
  "Is een dynamisch contract slim met een batterij?",
  "Is mijn thuisbatterij verzekerd?",
  [
    "Ik twijfel over een batterij.",
    "16 panelen, ongeveer 5.000 kWh opwek. Verbruik 4.000 kWh, vooral 's avonds. Dynamisch contract bij Zonneplan. Elektrische auto, geen warmtepomp. Koopwoning, berging is beschikbaar. Budget tot 4.000 euro.",
  ],
  "Schrijf een FAQ-blok voor de site over de vraag: Hoeveel kWh thuisbatterij heb ik nodig?",
];

const client = new Anthropic();
const uit = [];
let totaal = 0;

for (const [i, v] of vragen.entries()) {
  const beurten = Array.isArray(v) ? v : [v];
  const messages = [];
  const log = { nr: i + 1, beurten: [] };
  for (const tekst of beurten) {
    messages.push({ role: "user", content: tekst });
    const t0 = Date.now();
    const r = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages,
    });
    const antwoord = r.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    messages.push({ role: "assistant", content: r.content });
    const u = r.usage;
    const kosten = (u.input_tokens * PRIJS_IN) + (u.output_tokens * PRIJS_UIT)
      + ((u.cache_read_input_tokens || 0) * PRIJS_CACHE_LEES) + ((u.cache_creation_input_tokens || 0) * PRIJS_CACHE_SCHRIJF);
    totaal += kosten;
    log.beurten.push({ vraag: tekst, antwoord, stop: r.stop_reason, ms: Date.now() - t0, usage: u, kosten_usd: kosten });
    console.error(`${i + 1}: ${r.stop_reason}, ${u.output_tokens} uit, $${kosten.toFixed(4)}, ${Date.now() - t0} ms`);
  }
  uit.push(log);
}

writeFileSync(`${uitMap}/resultaten.json`, JSON.stringify({ model: MODEL, totaal_usd: totaal, uit }, null, 2));
let md = `# Test Batterijmaatje-adviseur op ${MODEL}\n\nTotale kosten: $${totaal.toFixed(4)} voor ${vragen.length} gesprekken.\n\n`;
for (const g of uit) for (const b of g.beurten) {
  md += `## ${g.nr}. ${b.vraag}\n\n${b.antwoord}\n\n*${b.usage.output_tokens} tokens uit, ${(b.ms / 1000).toFixed(1)} s, $${b.kosten_usd.toFixed(4)}*\n\n`;
}
writeFileSync(`${uitMap}/resultaten.md`, md);
console.error(`Totaal: $${totaal.toFixed(4)}`);
