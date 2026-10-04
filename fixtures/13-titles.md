# Fixture 13 — Titles

Titles, holders, reigns and regnal numbers of spec §13.3–§13.5 (decisions D54–D63). The expected card texts are worked out by hand from the §13.3 and §13.5 rules.

- Three titles with holders: Duke of Valmont, Count of Orsini and King of the Vale. King of the Vale has `numbering: auto` and `count-with`; version 0.2 keeps them and does not read them (D59), so King Roderick shows no number.
- Holders who are not in the tree: Aldric I (a name-only holder "Aldric" with number I, before the Aldric Valmont of the tree, Aldric II) and Orso the Old.
- Roderick lost the duchy to his cousin Ser Gareth (a hand-typed block-map holder with `as: Gareth`, styled "Protector": a short written title whose reign fits on one text line) and got it back: two reigns in mixed forms, "(r. 1150–1158, from 1163)". Only his second entry has a number, so his card shows "Roderick I".
- The brothers Matteo and Piero ruled Orsini together (co-rulers). Piero ruled again later: "(r. until 1140, 1145–1160)". Matteo's written title with its reign needs more than two text lines.
- Cosimo seized Orsini, but his `person` id names nobody; he has a `name`, so he shows as a holder who is not in the tree. Beatrix's entry has the typo "beatrice" and no name, so it does not show.
- The younger Aldric Valmont (a second person named Aldric) holds two titles; `card-title` selects the second, King of the Vale. His son Edmund holds both titles too, with a number only on the second, so his card keeps his name. King Roderick has a written `title` that his `card-title` replaces (D63).
- Bertrand has a written `title` that differs from his first title: it shows with the reign of that title. Isolde's `card-title` names a title she does not hold.
- The titles list also has every title warning: holders written as a map, an entry that is not a title, a title with no id, a duplicate title id, a holder that is not a holder, two holders whose person is missing, and a holder with no person and no name. The second block has a `titles` section that is not a list.

The comments in the block give the expected results (read by `tests/acceptance/titles-labels.test.ts` and `titles-read.test.ts`):

- `# warning: <code> | <param>=<value>; …` at the top: every warning of the block, and no others. `ids=` lists the people that the warning names.
- In each person: `# name line:` and `# title line:` (the card's text lines; `none` for no title text line), `# holds:` (the ids of the titles the person holds, in the order of the `titles` list), `# shown:` (the shown title, with `(selected)` when `card-title` selects it), `# search:` (the extra texts that the picker and Find match) and `# picker:` (the picker row suffix).

```dynasty
# Sample tree 13: titles, holders and regnal numbers (spec §13.3–§13.5).
#
# warning: section-wrong-shape | section=holders; title=Warden of the Marches
# warning: entry-not-map | section=titles; index=5
# warning: missing-id | section=titles; index=6; name=Margrave of the Salt Coast
# warning: duplicate-title-id | id=count-of-orsini; title=Count of Orsini
# warning: entry-not-map | section=holders; title=King of the Vale; index=4
# warning: missing-holder | title=Count of Orsini; ref=cosimo; name=Cosimo Orsini
# warning: missing-holder | title=Count of Orsini; ref=beatrice
# warning: holder-empty | title=Count of Orsini; index=9
# warning: card-title-not-held | person=Isolde Orsini; ref=duke-of-valmont; ids=isolde
options:
  start: roderick

houses:
  - id: valmont
    name: House Valmont
    color: "#8b1e3f"
  - id: orsini
    name: House Orsini
    color: "#1e4f8b"
  - id: harrow
    name: House Harrow
    color: "#2f6b3a"

titles:
  - id: duke-of-valmont
    name: Duke of Valmont
    plural: Dukes of Valmont
    seat: Valmont Keep
    holders:
      - {name: Aldric, number: I, from: 1062, to: 1110}
      - {person: aldric, number: II, from: 1110, to: 1150, epithet: the Wise}
      - {person: roderick, from: 1150, to: 1158}
      - person: gareth
        # Hand-typed as a block map: it stays a block map when edited.
        as: Gareth
        number: I
        from: 1158
        to: 1163
      # Roderick came back after the siege of 1163.
      - {person: roderick, number: I, from: 1163}
      - {person: young-aldric, number: III, from: 1175, to: 1210}
      - {person: edmund, from: 1210, to: 1228}
  - id: count-of-orsini
    name: Count of Orsini
    plural: Counts of Orsini
    holders:
      - {name: Orso the Old, to: 1090}
      - {person: bertrand, from: 1090, to: 1128}
      # Co-rulers: the brothers Matteo and Piero.
      - {person: matteo, from: 1128, to: 1140}
      - {person: piero, to: 1140}
      - {person: cosimo, name: Cosimo Orsini, from: 1140, to: 1145}   # no person "cosimo"
      - {person: piero, from: 1145, to: 1160}
      - luca
      - {person: beatrice, from: 1190}   # typo for beatrix
      - {from: 1200}
  - id: king-of-the-vale
    name: King of the Vale
    plural: Kings of the Vale
    numbering: auto
    count-with: [duke-of-valmont]
    holders:
      - {person: young-aldric, number: III, from: 1180, to: 1210}
      - {person: edmund, number: I, from: 1210, to: 1228}
      - {person: king-roderick, from: 1228}
      - [godric, 1250]
  - id: warden-of-the-marches
    name: Warden of the Marches
    holders:
      person: roderick
      from: 1150
  - Baron of Greyfen
  - name: Margrave of the Salt Coast
    plural: Margraves of the Salt Coast
  - id: count-of-orsini
    name: Count of the Salt Coast
    holders:
      - {person: gareth, from: 1165, to: 1170}

people:
  - id: bertrand
    name: Bertrand Orsini
    title: Count Palatine of Orsini
    house: orsini
    sex: m
    born: 1060
    died: 1128
    # name line: Bertrand Orsini
    # title line: Count Palatine of Orsini (r. 1090–1128)
    # holds: count-of-orsini
    # shown: count-of-orsini
    # search: none
    # picker: none
  - id: aldric
    name: Aldric Valmont
    house: valmont
    sex: m
    born: 1085
    died: 1150
    # name line: Aldric II
    # title line: Duke of Valmont (r. 1110–1150)
    # holds: duke-of-valmont
    # shown: duke-of-valmont
    # search: Aldric II
    # picker: (Aldric II)
  - id: isolde
    name: Isolde Orsini
    title: Duchess of Valmont
    card-title: duke-of-valmont
    house: orsini
    sex: f
    born: 1092
    died: 1160
    parents: [bertrand]
    # name line: Isolde Orsini
    # title line: Duchess of Valmont
    # holds: none
    # shown: none
    # search: none
    # picker: none
  - id: matteo
    name: Matteo Orsini
    title: Regent of Orsini, Warden of the Southern Shore and Keeper of the Salt Roads
    house: orsini
    sex: m
    born: 1095
    died: 1140
    parents: [bertrand]
    # name line: Matteo Orsini
    # title line: Regent of Orsini, Warden of the Southern Shore and Keeper of the Salt Roads (r. 1128–1140)
    # holds: count-of-orsini
    # shown: count-of-orsini
    # search: none
    # picker: none
  - id: piero
    name: Piero Orsini
    house: orsini
    sex: m
    born: 1098
    died: 1160
    parents: [bertrand]
    # name line: Piero Orsini
    # title line: Count of Orsini (r. until 1140, 1145–1160)
    # holds: count-of-orsini
    # shown: count-of-orsini
    # search: none
    # picker: none
  - id: gareth
    name: Ser Gareth Orsini
    title: Protector
    house: orsini
    sex: m
    born: 1118
    died: 1170
    parents: [matteo]
    # name line: Gareth I
    # title line: Protector (r. 1158–1163)
    # holds: duke-of-valmont
    # shown: duke-of-valmont
    # search: Gareth I
    # picker: (Gareth I)
  - id: luca
    name: Luca Orsini
    house: orsini
    sex: m
    born: 1125
    died: 1190
    parents: [piero]
    # name line: Luca Orsini
    # title line: Count of Orsini
    # holds: count-of-orsini
    # shown: count-of-orsini
    # search: none
    # picker: none
  - id: roderick
    name: Roderick Valmont
    house: valmont
    sex: m
    born: 1112
    died: 1175
    parents: [aldric, isolde]
    # name line: Roderick I
    # title line: Duke of Valmont (r. 1150–1158, from 1163)
    # holds: duke-of-valmont
    # shown: duke-of-valmont
    # search: Roderick I
    # picker: (Roderick I)
  - id: elinor
    name: Elinor Harrow
    house: harrow
    sex: f
    born: 1118
    died: 1180
    # name line: Elinor Harrow
    # title line: none
    # holds: none
    # shown: none
    # search: none
    # picker: none
  - id: young-aldric
    name: Aldric Valmont
    card-title: king-of-the-vale
    house: valmont
    sex: m
    born: 1140
    died: 1210
    parents: [roderick, elinor]
    # name line: Aldric III
    # title line: King of the Vale (r. 1180–1210)
    # holds: duke-of-valmont, king-of-the-vale
    # shown: king-of-the-vale (selected)
    # search: Aldric III
    # picker: (Aldric III)
  - id: mathilde
    name: Mathilde Harrow
    house: harrow
    sex: f
    born: 1145
    # name line: Mathilde Harrow
    # title line: none
    # holds: none
    # shown: none
    # search: none
    # picker: none
  - id: beatrix
    name: Beatrix Orsini
    house: orsini
    sex: f
    born: 1170
    parents: [luca]
    # name line: Beatrix Orsini
    # title line: none
    # holds: none
    # shown: none
    # search: none
    # picker: none
  - id: edmund
    name: Edmund Valmont
    house: valmont
    sex: m
    born: 1165
    died: 1228
    parents: [young-aldric, mathilde]
    # name line: Edmund Valmont
    # title line: Duke of Valmont (r. 1210–1228)
    # holds: duke-of-valmont, king-of-the-vale
    # shown: duke-of-valmont
    # search: Edmund I
    # picker: (Edmund I)
  - id: king-roderick
    name: Roderick Valmont
    title: Prince of the Vale
    card-title: king-of-the-vale
    house: valmont
    sex: m
    born: 1190
    parents: [edmund, beatrix]
    # name line: Roderick Valmont
    # title line: King of the Vale (r. from 1228)
    # holds: king-of-the-vale
    # shown: king-of-the-vale (selected)
    # search: none
    # picker: none

unions:
  - partners: [aldric, isolde]
    start: 1110
  - partners: [roderick, elinor]
    start: 1138
  - partners: [young-aldric, mathilde]
    start: 1163
  - partners: [edmund, beatrix]
    start: 1188
```

A second tree in the same note. Its `titles` section is a map, not a list, so the tree ignores it; the `card-title` then names no title that Aldric holds.

```dynasty
# warning: section-wrong-shape | section=titles
# warning: card-title-not-held | person=Aldric Valmont; ref=duke-of-valmont; ids=aldric
titles:
  duke-of-valmont: Duke of Valmont
people:
  - id: aldric
    name: Aldric Valmont
    card-title: duke-of-valmont
    # name line: Aldric Valmont
    # title line: none
    # holds: none
    # shown: none
    # search: none
    # picker: none
```
