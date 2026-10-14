<!-- Old sample tree: a copy of fixtures/01-three-generations.md at the tag v0.1.0. Do not edit. -->
# Fixture 1 — Simple three-generation line

```dynasty
houses:
  - id: valmont
    name: House Valmont
    color: "#8b1e3f"

people:
  - id: aldric
    name: Aldric Valmont
    title: Duke of Valmont
    house: valmont
    sex: m
    born: 1102
    died: 1161
  - id: isolde
    name: Isolde Orsini
    sex: f
    born: 1110
    died: 1170
  - id: roderick
    name: Roderick Valmont
    title: Duke of Valmont
    house: valmont
    sex: m
    born: 1131
    parents: [aldric, isolde]
  - id: mathilde
    name: Mathilde Harrow
    sex: f
    born: 1136
  - id: edric
    name: Edric Valmont
    house: valmont
    sex: m
    born: 1158
    parents: [roderick, mathilde]
  - id: alys
    name: Alys Valmont
    house: valmont
    sex: f
    born: 1161
    parents: [roderick, mathilde]

unions:
  - partners: [aldric, isolde]
    start: 1129
  - partners: [roderick, mathilde]
    start: 1156
```
