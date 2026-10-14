<!-- Old sample tree: a copy of fixtures/05-malformed.md at the tag v0.2.0. Do not edit. -->
# Fixture 5 — Malformed

House Ashford's records were copied by a careless scribe. The tree must still render, with a warning badge and the edit-blocking banner (spec §8). Each fault is marked with a comment in the block.

- Two people share the id `hal`, and two unions share the id `spring-wedding` (these block editing).
- Missing references: a parent, a partner, a house, a `union`, `options.start` and `options.focus`.
- Arn, Bram and Col Marsh are each other's ancestors (a cycle through birth and adoptive links).
- Joss has three birth parents. One union has three partners, and one lists Tilda twice.
- Piers is placed under ward parents he does not have.
- Unknown values: a union type, a placement and a parent type.
- House Brennock's colour is not quoted, so YAML reads it as a comment.

```dynasty
options:
  start: aldous               # missing: there is no aldous
  focus: lost-heir            # missing

houses:
  - id: ashford
    name: House Ashford
    color: "#6b4226"
  - id: brennock
    name: House Brennock
    color: #2e7d4f

people:
  - id: osmund
    name: Osmund Ashford
    title: Lord of Ashford
    house: ashford
    sex: m
    born: 1050
  - id: berta
    name: Berta Brennock
    house: brennock
    sex: f
    born: 1054
  - id: ranulf
    name: Ranulf Brennock
    house: brennock
    sex: m
    born: 1049
  - id: hal
    name: Hal Ashford
    house: ashford
    sex: m
    born: 1075
    parents: [osmund, berta]
  - id: hal                   # duplicate person id
    name: Hal the Younger
  - id: joss
    name: Joss Ashford
    house: ashford
    sex: x                    # any sex value is valid (D12)
    born: 1077
    parents: [osmund, berta, ranulf]    # three birth parents
  - id: wynn
    name: Wynn Ashford
    house: ashfurd            # missing house (misspelt)
    sex: f
    born: 1079
    parents: [osmund, ghost]  # missing parent
  - id: piers
    name: Piers Ashford
    house: ashford
    sex: m
    born: 1081
    parents: [osmund, berta]
    placement: ward           # he has no ward parents
  - id: tilda
    name: Tilda Ashford
    house: ashford
    sex: f
    born: 1083
    parents: [osmund, berta]
    placement: fostered       # unknown placement
  - id: cole
    name: Cole Ashford
    house: ashford
    sex: m
    born: 1085
    parents: [osmund, berta]
    union: second-wedding     # missing union
  - id: maren
    name: Maren Holt
    sex: f
    born: 1078
  - id: sela
    name: Sela Brennock
    house: brennock
    sex: f
    born: 1060
  - id: edda
    name: Edda Brennock
    house: brennock
    sex: f
    born: 1088
    parents: [{id: ranulf, type: godfather}]   # unknown parent type
  - id: arn
    name: Arn Marsh
    sex: m
    parents: [col]
  - id: bram
    name: Bram Marsh
    sex: m
    parents: [arn]
  - id: col
    name: Col Marsh
    sex: m
    parents: [{id: bram, type: adoptive}]     # closes the cycle

unions:
  - id: spring-wedding
    partners: [osmund, berta]
    start: 1074
  - id: spring-wedding        # duplicate union id
    partners: [hal, maren]
  - partners: [joss, maren, piers]            # three partners
  - partners: [tilda, tilda]                  # the same person twice
  - partners: [piers, nobody]                 # missing partner
  - partners: [ranulf, sela]
    type: handfasting                         # unknown union type
```
