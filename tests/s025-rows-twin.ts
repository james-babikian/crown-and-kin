// A made-up tree for the rows tests (0.2.5, WP-A1): rufus is a lone rumoured father; sven, ulf and vera are a founder whose
// child marries one row lower; ned and quin are cousins that no row can fix; cade and dora are a separate house. Not a
// test file: vitest does not run it.
export const ROWS_TWIN = `
houses:
  - id: alder
    name: House Alder
    color: "#b8860b"
  - id: birch
    name: House Birch
    color: "#2f7f8f"
  - id: cedar
    name: House Cedar
    color: "#8b1e3f"

people:
  - {id: hugo, name: Hugo Alder, house: alder, sex: m, born: 1100}
  - {id: ada, name: Ada Moor, sex: f, born: 1104}
  - {id: bert, name: Bert Alder, house: alder, sex: m, born: 1125, parents: [hugo, ada]}
  - {id: cora, name: Cora Alder, house: alder, sex: f, born: 1128, parents: [hugo, ada]}
  - {id: dan, name: Dan Alder, house: alder, sex: m, born: 1131, parents: [hugo, ada]}
  - {id: enid, name: Enid Vale, sex: f, born: 1127}
  - {id: ivo, name: Ivo Reed, sex: m, born: 1126}
  - {id: fay, name: Fay Alder, house: alder, sex: f, born: 1150, parents: [bert, enid]}
  - {id: gil, name: Gil Alder, house: alder, sex: m, born: 1153, parents: [bert, enid]}
  - {id: hal, name: Hal Reed, sex: m, born: 1180, parents: [cora, ivo]}
  - {id: jon, name: Jon Pike, sex: m, born: 1148}
  - {id: kay, name: Kay Pike, sex: m, born: 1175, parents: [fay, jon]}
  - {id: lena, name: Lena Pike, sex: f, born: 1178, parents: [fay, jon]}
  - {id: pia, name: Pia Marsh, sex: f}
  - {id: rufus, name: Rufus Crane, sex: m, born: 1190}
  - {id: oda, name: Oda Pike, sex: f, born: 1198, parents: [kay, pia, {id: rufus, type: rumoured}]}
  - {id: toren, name: Toren Wick, sex: m, born: 1195}
  - {id: quin, name: Quin Wick, sex: m, born: 1222, parents: [oda, toren]}
  - {id: ned, name: Ned Reed, sex: f, born: 1200, parents: [hal]}
  - {id: sven, name: Sven Birch, house: birch, sex: m, born: 1130}
  - {id: tove, name: Tove Birch, house: birch, sex: f, born: 1152, parents: [sven]}
  - {id: ulf, name: Ulf Birch, house: birch, sex: m, born: 1158, parents: [sven]}
  - {id: vera, name: Vera Alder, house: alder, sex: f, born: 1155, parents: [dan]}
  - {id: wil, name: Wil Birch, house: birch, sex: m, born: 1182, parents: [ulf, vera]}
  - {id: cade, name: Cade Cedar, house: cedar, sex: m, born: 1150}
  - {id: dora, name: Dora Hale, sex: f, born: 1155}
  - {id: eli, name: Eli Cedar, house: cedar, sex: m, born: 1180, parents: [cade, dora]}
  - {id: fern, name: Fern Cedar, house: cedar, sex: f, born: 1183, parents: [cade, dora]}

unions:
  - {partners: [hugo, ada], type: marriage}
  - {partners: [bert, enid], type: marriage}
  - {partners: [cora, ivo], type: marriage}
  - {partners: [fay, jon], type: marriage}
  - {partners: [kay, pia], type: marriage}
  - {partners: [oda, toren], type: marriage}
  - {partners: [ulf, vera], type: marriage}
  - {partners: [cade, dora], type: marriage}
  - {partners: [ned, quin], type: marriage}
`;
