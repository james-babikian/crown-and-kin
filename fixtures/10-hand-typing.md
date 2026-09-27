# Fixture 10 — Hand-typing tolerance

A small tree typed quickly by hand, without quotes (spec §8 "Tolerated silently"):

- Wren's link is written as `[[Wren of the Marches]]` without quotes.
- Isolde and her son Tomas have numeric ids (`42` and `43`), and other entries refer to them by number. The tree opens on Tomas: `start: 43`.
- Ser Gareth's id is `0042`, with a leading zero. It must stay `0042`: it is not the same id as Isolde's `42`. His son Piers refers to him as `0042`.
- Aldric's birth date is written `1102-03-04`. It must stay exactly that text, never a date.
- Wren's single parent is written as `parents: aldric`, not as a list.
- House Valmont's colour is not quoted. This is the only fault the tree reports: YAML reads it as a comment, so the plugin suggests quotes.

```dynasty
options:
  start: 43

houses:
  - id: valmont
    name: House Valmont
    color: #8b1e3f

people:
  - id: aldric
    name: Aldric Valmont
    title: Duke of Valmont
    house: valmont
    sex: m
    born: 1102-03-04
    died: 1161
  - id: 42
    name: Isolde Orsini
    sex: f
    born: 1110
  - id: 43
    name: Tomas Valmont
    house: valmont
    sex: m
    born: 1131
    parents: [aldric, 42]
  - id: wren
    name: Wren
    sex: f
    born: 1135
    parents: aldric
    illegitimate: true
    link: [[Wren of the Marches]]
  - id: 0042
    name: Ser Gareth Orsini
    sex: m
    born: 1104
  - id: piers
    name: Piers
    sex: m
    born: 1130
    parents: [0042]

unions:
  - partners: [aldric, 42]
    start: 1129
```
