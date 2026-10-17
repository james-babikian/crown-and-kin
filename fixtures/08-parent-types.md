# Fixture 8 — Parent types

- Tomas is born to Marek and Anna Drakemoor but adopted as heir by the childless Duke Aldric and Duchess Isolde; he is drawn under his adoptive parents.
- Piers is a ward of Duke Aldric, drawn under his birth parents.
- Roderick's true father is rumoured to be Ser Gareth.

```kin
houses:
  - id: valmont
    name: House Valmont
    color: "#8b1e3f"
  - id: drakemoor
    name: House Drakemoor
    color: "#5b3f8c"
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
  - id: marek
    name: Marek Drakemoor
    title: Margrave of Drakemoor
    house: drakemoor
    sex: m
    born: 1100
  - id: anna
    name: Anna Stroud
    sex: f
    born: 1108
  - id: gareth
    name: Ser Gareth Orsini
    house: orsini
    sex: m
    born: 1104
  - id: odette
    name: Odette Valmont
    house: valmont
    sex: f
    born: 1112
  - id: jasper
    name: Jasper Drakemoor
    house: drakemoor
    sex: m
    born: 1128
    parents: [marek, anna]
  - id: tomas
    name: Tomas Valmont
    title: Heir of Valmont
    house: valmont
    sex: m
    born: 1131
    parents: [marek, anna, {id: aldric, type: adoptive}, {id: isolde, type: adoptive}]
    placement: adoptive
  - id: piers
    name: Piers Orsini
    house: orsini
    sex: m
    born: 1133
    parents: [gareth, odette, {id: aldric, type: ward}]
  - id: roderick
    name: Roderick Orsini
    house: orsini
    sex: m
    born: 1136
    parents: [gareth, odette, {id: marek, type: rumoured}]
  - id: sabine
    name: Sabine Kestrel
    sex: f
    born: 1135
  - id: lucan
    name: Lucan Valmont
    house: valmont
    sex: m
    born: 1158
    parents: [tomas, sabine]

unions:
  - partners: [aldric, isolde]
    start: 1129
  - partners: [marek, anna]
  - partners: [gareth, odette]
  - partners: [tomas, sabine]
```
