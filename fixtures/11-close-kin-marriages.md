# Fixture 11 — Close-kin marriages

- Varian marries his sister Yseult (sibling marriage).
- Corwin marries his daughter Alys after his first wife's death (parent–child marriage).
- Each person must appear once, with no warnings.

```dynasty
houses:
  - id: veyle
    name: House Veyle
    color: "#2f7f8f"

people:
  - id: aurel
    name: Aurel Veyle
    title: King of Veyle
    house: veyle
    sex: m
    born: 1000
    died: 1060
  - id: viviane
    name: Viviane Holt
    sex: f
    born: 1004
    died: 1058
  - id: varian
    name: Varian Veyle
    title: King of Veyle
    house: veyle
    sex: m
    born: 1022
    parents: [aurel, viviane]
  - id: yseult
    name: Yseult Veyle
    title: Queen of Veyle
    house: veyle
    sex: f
    born: 1024
    parents: [aurel, viviane]
  - id: corwin
    name: Corwin Veyle
    house: veyle
    sex: m
    born: 1027
    parents: [aurel, viviane]
  - id: maud
    name: Maud Thorne
    sex: f
    born: 1029
    died: 1051
  - id: valen
    name: Valen Veyle
    house: veyle
    sex: m
    born: 1045
    parents: [varian, yseult]
  - id: sybil
    name: Sybil Veyle
    house: veyle
    sex: f
    born: 1047
    parents: [varian, yseult]
  - id: alys
    name: Alys Veyle
    house: veyle
    sex: f
    born: 1049
    parents: [corwin, maud]
  - id: osric
    name: Osric Veyle
    house: veyle
    sex: m
    born: 1068
    parents: [corwin, alys]

unions:
  - partners: [aurel, viviane]
  - partners: [varian, yseult]
    start: 1042
  - partners: [corwin, maud]
    start: 1048
    end: 1051
  - partners: [corwin, alys]
    start: 1066
```
