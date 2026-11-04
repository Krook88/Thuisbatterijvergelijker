/* Wat de gedeelde vergelijkingslink (api/v.js, api/vergelijkkaart.js) per
   site moet weten. Die twee komen uit kern/; dit bestand niet. */
"use strict";

module.exports = {
  naam: "Batterijmaatje.nl",
  domein: "https://batterijmaatje.nl",
  kleur: "#0f766e",
  inkt: "#0a3733",
  Prijs: require("../assets/prijs.js"),
  soorten: {
    standaard: { pagina: "/", woord: "thuisbatterijen", lijst: () => require("../data/site/batterijen.json").batterijen },
  },
};
