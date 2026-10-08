import { test } from "node:test";
import assert from "node:assert/strict";
import { controleerAanbieding, controleerBestand } from "./dataschema.mjs";

const goed = { winkel: "Voorbeeld", url: "https://example.nl/p", prijs_eur: 1000, datum: "2026-10-08" };

test("een gewone aanbieding is in orde", () => {
  assert.deepEqual(controleerAanbieding(goed, "batterijmaatje"), []);
  assert.deepEqual(controleerAanbieding({ ...goed, datum: null, btw_inbegrepen: false }, "zonnestroommaatje"), []);
});

test("de tikfouten die stil niets doen worden gevonden", () => {
  // Als tekst is "false" waar, en dan telt een prijs excl. btw als inclusief.
  assert.match(controleerAanbieding({ ...goed, btw_inbegrepen: "false" }, "batterijmaatje").join(), /btw_inbegrepen/);
  // De prijsupdate zoekt "pagina weg" en haalt deze markering dus nooit weg.
  assert.match(controleerAanbieding({ ...goed, niet_leverbaar: true, niet_leverbaar_door: "pagina-weg" }, "batterijmaatje").join(), /niet_leverbaar_door/);
  assert.match(controleerAanbieding({ ...goed, "prijs-route": "meta-tag" }, "batterijmaatje").join(), /onbekend veld/);
  assert.match(controleerAanbieding({ ...goed, prijs_eur: 1000.5 }, "batterijmaatje").join(), /prijs_eur/);
  assert.match(controleerAanbieding({ ...goed, url: "http://example.nl" }, "batterijmaatje").join(), /url/);
});

test("prijs_route alleen op batterijmaatje, en bij variant met prijs_variant", () => {
  assert.match(controleerAanbieding({ ...goed, prijs_route: "meta-tag" }, "warmtepompmaatje").join(), /alleen op batterijmaatje/);
  assert.match(controleerAanbieding({ ...goed, prijs_route: "bij variant" }, "batterijmaatje").join(), /prijs_variant/);
  assert.deepEqual(controleerAanbieding({ ...goed, prijs_route: "bij variant", prijs_variant: "9,2 kWh" }, "batterijmaatje"), []);
});

test("een bestand met een dubbel id, een dubbele winkel en een onbekende conditie", () => {
  const data = {
    laatst_bijgewerkt: "2026-10-08",
    batterijen: [
      { id: "a-1", merk: "A", model: "Een", vermogen_conditie: "piek", aanbiedingen: [goed, goed] },
      { id: "a-1", merk: "A", model: "Twee" },
      { id: "Fout_Id", merk: "B", model: "Drie" },
    ],
  };
  const uit = controleerBestand(data, { site: "batterijmaatje", lijst: "batterijen" }).join("\n");
  assert.match(uit, /vermogen_conditie/);
  assert.match(uit, /twee keer/);
  assert.match(uit, /id komt twee keer voor/);
  assert.match(uit, /kleine letters/);
});
