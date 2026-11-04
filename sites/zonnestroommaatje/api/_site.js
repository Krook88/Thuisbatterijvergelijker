/* Wat de gedeelde vergelijkingslink (api/v.js, api/vergelijkkaart.js) per
   site moet weten. Die twee komen uit kern/; dit bestand niet. */
"use strict";

module.exports = {
  naam: "Zonnestroommaatje.nl",
  domein: "https://zonnestroommaatje.nl",
  kleur: "#0369a1",
  inkt: "#0b3a5c",
  Prijs: require("../assets/prijs.js"),
  soorten: {
    standaard: { pagina: "/", woord: "zonnepanelen", lijst: () => require("../data/site/panelen.json").panelen },
    omvormers: { pagina: "/omvormers.html", woord: "omvormers", lijst: () => require("../data/site/omvormers.json").omvormers },
  },
};
