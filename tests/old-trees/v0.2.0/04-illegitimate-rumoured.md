<!-- Old sample tree: a copy of fixtures/04-illegitimate-rumoured.md at the tag v0.2.0. Do not edit. -->
# Fixture 4 — Illegitimate child and a rumoured father

Wren has only one listed parent. Roderick's true father is rumoured to be Ser Gareth.

```dynasty
houses:
  - id: valmont
    name: House Valmont
    color: "#8b1e3f"
  - id: orsini
    name: House Orsini
    color: "#1e4f8b"

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
    house: orsini
    sex: f
    born: 1110
  - id: gareth
    name: Ser Gareth Orsini
    house: orsini
    sex: m
    born: 1104
  - id: roderick
    name: Roderick Valmont
    house: valmont
    sex: m
    born: 1131
    parents: [aldric, isolde, {id: gareth, type: rumoured}]
  - id: helena
    name: Helena Valmont
    house: valmont
    sex: f
    born: 1133
    parents: [aldric, isolde]
  - id: wren
    name: Wren
    sex: f
    born: 1135
    parents: [aldric]
    illegitimate: true
    link: "[[Wren of the Marches]]"

unions:
  - partners: [aldric, isolde]
    type: marriage
    start: 1129
```
