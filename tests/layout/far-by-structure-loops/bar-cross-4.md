# Leg through the sibling bar (4 people)

Lover has a concubinage with Mother (row 1) and an affair with her daughter (row 2). Lover stands beside Daughter, inside the children of Mother, so the concubinage line goes down through the sibling bar of Mother's children.

```kin
people:
  - {id: e, name: Mother, sex: f}
  - {id: s, name: Son, sex: m, parents: [e]}
  - {id: k, name: Daughter, sex: f, parents: [e]}
  - {id: y, name: Lover, sex: m}
unions:
  - {partners: [e, y], type: concubinage}
  - {partners: [k, y], type: affair}
```
