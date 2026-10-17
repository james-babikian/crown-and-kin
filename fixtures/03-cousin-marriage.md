# Fixture 3 — First-cousin marriage

Conrad and Lisette share grandparents (Aurel and Viviane). Each person must appear once.

```kin
houses:
  - id: castellane
    name: House Castellane
    color: "#b8860b"
  - id: veyle
    name: House Veyle
    color: "#2f7f8f"

people:
  - id: aurel
    name: Aurel Castellane
    title: Count of Castellane
    house: castellane
    sex: m
    born: 1040
    died: 1101
  - id: viviane
    name: Viviane Dunmore
    sex: f
    born: 1045
    died: 1098
  - id: bastien
    name: Bastien Castellane
    title: Count of Castellane
    house: castellane
    sex: m
    born: 1066
    parents: [aurel, viviane]
  - id: giselle
    name: Giselle Castellane
    house: castellane
    sex: f
    born: 1069
    parents: [aurel, viviane]
  - id: rosamund
    name: Rosamund Holt
    sex: f
    born: 1070
  - id: stefan
    name: Stefan Veyle
    title: Baron of Veyle
    house: veyle
    sex: m
    born: 1064
  - id: conrad
    name: Conrad Castellane
    house: castellane
    sex: m
    born: 1092
    parents: [bastien, rosamund]
  - id: blanche
    name: Blanche Castellane
    house: castellane
    sex: f
    born: 1095
    parents: [bastien, rosamund]
  - id: lisette
    name: Lisette Veyle
    house: veyle
    sex: f
    born: 1094
    parents: [stefan, giselle]
  - id: ulric
    name: Ulric Veyle
    house: veyle
    sex: m
    born: 1097
    parents: [stefan, giselle]
  - id: tristan
    name: Tristan Castellane
    house: castellane
    sex: m
    born: 1115
    parents: [conrad, lisette]

unions:
  - partners: [aurel, viviane]
  - partners: [bastien, rosamund]
  - partners: [stefan, giselle]
  - partners: [conrad, lisette]
    start: 1113
```
