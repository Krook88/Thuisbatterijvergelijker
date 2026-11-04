/* Wat de gedeelde vergelijkingslink (api/v.js, api/vergelijkkaart.js) per
   site moet weten. Die twee komen uit kern/; dit bestand niet. */
"use strict";

module.exports = {
  naam: "Warmtepompmaatje.nl",
  domein: "https://warmtepompmaatje.nl",
  kleur: "#c2410c",
  inkt: "#431407",
  Prijs: require("../assets/prijs.js"),
  soorten: {
    standaard: { pagina: "/", woord: "warmtepompen", lijst: () => require("../data/site/warmtepompen.json").warmtepompen },
  },
};
