# Fixture 17 — Same-sex couples

Sample tree for version 0.4 (the release plan T10). It shows marriages of two women and of two men, in a family that passes a title. All people are made up. The expected results are written by hand from the spec, not by code.

- **Edda Marrow and Lisbet Orme** are two women. Edda was married before to Anselm Vale (a marriage that ended in 1063). Edda and Lisbet married in 1064.
- **Children by birth, one parent of the couple:** Wren is the birth child of Edda only. Merrin is the birth child of Lisbet only. The note does not name the other parent of either child (a "maybe": Wren could be a full sister of Hale).
- **Adoption by both:** Tobias is the adoptive son of Edda and Lisbet. He has no birth parents in the tree.
- **A remarriage:** Hale (son of Edda and Anselm) first married Ysolt Quill (she died in 1095). In 1098 he married Brenna Cray.
- **Two men:** Tobias married Dario Fenn in 1096. They have no children. Garrick (son of Hale and Ysolt) married Piers Vane in 1112. They adopted Nell.
- **Two women, a second marriage:** Wren married Calla Rooke in 1092. Pia is the birth child of Wren and the adoptive child of Calla. Fenn is the birth child of Calla only.
- **A title:** the Countess (or Count) of Marrowfen passes from Edda to her daughter Wren and then to Wren's daughter Pia.
- The tree has no warning. The latest year in the tree is 1130.

```kin
# Sample tree 17: same-sex couples (the release plan T10, version 0.4). Made-up people; worked out by hand.
#
# warnings: none
options:
  start: edda

houses:
  - id: marrow
    name: House Marrow
    color: "#8b1e3f"
  - id: orme
    name: House Orme
    color: "#1e4f8b"
  - id: fenn
    name: House Fenn
    color: "#2f6b3a"

titles:
  - id: marrowfen
    name: Countess of Marrowfen
    male-name: Count of Marrowfen
    female-name: Countess of Marrowfen
    plural: Counts of Marrowfen
    holders:
      - {person: edda, from: 1070, to: 1101}
      - {person: wren, from: 1101, to: 1128}
      - {person: pia, from: 1128}

people:
  - {id: edda, name: Edda Marrow, house: marrow, sex: f, born: 1040, died: 1101}
  - {id: lisbet, name: Lisbet Orme, house: orme, sex: f, born: 1042, died: 1105}
  - {id: anselm, name: Anselm Vale, sex: m, born: 1036, died: 1090}
  - {id: hale, name: Hale Marrow, house: marrow, sex: m, born: 1060, parents: [edda, anselm]}
  - {id: wren, name: Wren Marrow, house: marrow, sex: f, born: 1066, parents: [edda]}
  - {id: merrin, name: Merrin Orme, house: orme, sex: f, born: 1068, parents: [lisbet]}
  - {id: tobias, name: Tobias Orme, house: orme, sex: m, born: 1070, parents: [{id: edda, type: adoptive}, {id: lisbet, type: adoptive}]}
  - {id: dario, name: Dario Fenn, house: fenn, sex: m, born: 1068}
  - {id: ysolt, name: Ysolt Quill, sex: f, born: 1062, died: 1095}
  - {id: brenna, name: Brenna Cray, sex: f, born: 1070}
  - {id: garrick, name: Garrick Marrow, house: marrow, sex: m, born: 1086, parents: [hale, ysolt]}
  - {id: piers, name: Piers Vane, sex: m, born: 1084}
  - {id: nell, name: Nell Marrow, house: marrow, sex: f, born: 1115, parents: [{id: garrick, type: adoptive}, {id: piers, type: adoptive}]}
  - {id: calla, name: Calla Rooke, sex: f, born: 1068, died: 1130}
  - {id: pia, name: Pia Marrow, house: marrow, sex: f, born: 1095, parents: [wren, {id: calla, type: adoptive}]}
  - {id: fenn-rooke, name: Fenn Rooke, sex: m, born: 1098, parents: [calla]}

unions:
  - partners: [anselm, edda]
    start: 1058
    end: 1063
  - partners: [edda, lisbet]
    type: marriage
    start: 1064
  - partners: [hale, ysolt]
    start: 1084
    end: 1095
  - partners: [hale, brenna]
    start: 1098
  - partners: [wren, calla]
    start: 1092
  - partners: [tobias, dario]
    start: 1096
  - partners: [garrick, piers]
    start: 1112
```
