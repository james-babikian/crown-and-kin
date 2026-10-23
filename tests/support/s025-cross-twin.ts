// A made-up tree for the crossing tests (0.2.5, WP-A2, D142). Not a test file: vitest does not run it.
// Arne has two partners: berit, the blood wife, first, and edda, a married-in root, second.
export const CROSS_TWIN = `
houses:
  - id: ash
    name: House Ash
    color: "#b8860b"
  - id: fir
    name: House Fir
    color: "#2f7f8f"

people:
  - {id: cato, name: Cato Ash, house: ash, sex: m, born: 700}
  - {id: dagny, name: Dagny Moor, sex: f, born: 704}
  - {id: sigrun, name: Sigrun Ash, house: ash, sex: f, born: 726, parents: [cato, dagny]}
  - {id: berit, name: Berit Ash, house: ash, sex: f, born: 730, parents: [cato, dagny]}
  - {id: tor, name: Tor Reed, sex: m, born: 724}
  - {id: leif, name: Leif Reed, sex: m, born: 750, parents: [sigrun, tor]}
  - {id: mette, name: Mette Reed, sex: f, born: 752, parents: [sigrun, tor]}
  - {id: nils, name: Nils Reed, sex: m, born: 754, parents: [sigrun, tor]}
  - {id: odd, name: Odd Reed, sex: m, born: 756, parents: [sigrun, tor]}
  - {id: jorun, name: Jorun Reed, sex: f, born: 758, parents: [sigrun, tor]}
  - {id: arne, name: Arne Fir, house: fir, sex: m, born: 725}
  - {id: edda, name: Edda Lund, sex: f, born: 735}
  - {id: finn, name: Finn Fir, house: fir, sex: m, born: 752, parents: [arne, berit]}
  - {id: gerd, name: Gerd Fir, house: fir, sex: f, born: 758, parents: [arne, edda]}
  - {id: pia, name: Pia Holt, sex: f, born: 752}
  - {id: mari, name: Mari Reed, sex: f, born: 776, parents: [leif, pia]}
  - {id: ingrid, name: Ingrid Reed, sex: f, born: 800, parents: [mari]}
  - {id: hakon, name: Hakon Dahl, sex: m, born: 780, parents: [gerd]}

unions:
  - {partners: [cato, dagny], type: marriage}
  - {partners: [sigrun, tor], type: marriage}
  - {partners: [arne, berit], type: marriage}
  - {partners: [arne, edda], type: marriage}
  - {partners: [jorun, finn], type: marriage}
  - {partners: [leif, pia], type: marriage}
  - {partners: [hakon, ingrid], type: marriage}
`;
