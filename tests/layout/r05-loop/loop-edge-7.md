# Loop round the edge (7 people)

Lover has a concubinage with Mother (row 2) and an affair with her daughter (row 3). Daughter stands between her two husbands, so the affair line goes round the left edge of the tree and crosses the line from Daughter and First down to Child.

```kin
people:
  - {id: g, name: Grandmother, sex: f}
  - {id: m, name: Mother, sex: f, parents: [g]}
  - {id: x, name: Lover, sex: m}
  - {id: d, name: Daughter, sex: f, parents: [m]}
  - {id: h1, name: First, sex: m}
  - {id: h2, name: Second, sex: m}
  - {id: c, name: Child, sex: f, parents: [d, h1]}
unions:
  - {partners: [m, x], type: concubinage}
  - {partners: [d, h1]}
  - {partners: [d, h2]}
  - {partners: [d, x], type: affair}
```
