# Fixture 16 — Succession

The line of succession of version 0.2.7 (spec §13.21, decisions D170 to D188). The expected lines are worked out by hand from the rules of the contract, not by code.

- Four houses, four titles. Each title uses a different rule, so a test can check each rule on a tree that a person can read.
- **Duke of Carrowmere** (House Carrow): the Salic law: `eldest-child` with `men-only` and `inherit-through: men`. A dead elder son passes the claim to his son; a daughter and her son are out; the brother of the duke and his son come last. Cedric was born more than 110 years before the last year in the tree and has no death date, so the line shows the warning `old` for him.
- **Countess of Harrowfen** (House Harrow): `youngest-child` with `women-first` and `inherit-illegitimate: after`, for the year 1215 (a Year field). Edda is born in 1216, so she is not in the line of 1215. Bede is marked illegitimate, so he comes after all the other people. The countess has a sixth person in her line, so the line stops at five and shows "and more people".
- **Margrave of the Salt Coast** (House Saltmarsh): `siblings-first` (the oldest generation first) with `men-first-in-house` (every man of the dynasty before every woman) and `inherit-adopted: true`. Hale is the adopted son of the margrave and has the claim of a child. Hale is born in 1214 and Finn in 1215, so Hale comes before Finn although the note lists Finn first (birth year first, D193).
- **Lord of Wetherby** (House Wether): a matrilineal house: `nearest-relative` with `men-only` and `inherit-through: women`. The sons of the lord and of his brother do not pass the claim; the sons of his sister do. The lord names two heirs (`heir`, the first comes first) and excludes Osric (`exclude`); the sons of an excluded person would keep their claim, but Osric has none.
- Three marriages (Bertram and Cecily, Bram and Wenna, Edith and Pell) are listed in `unions`, so the tree has partnership dots. The other children have one parent in the tree. The second parent of a child never changes a line here.
- The tree has no warning.

The comments under each title give the expected result (read by `tests/acceptance/r027-sample-16.test.ts`), for the setting "Length of the line of succession" at its default of 5 people and the setting "Warn about people older than" at its default of 110 years:

- `# ruler:` the id of the person that the line follows, and `# year:` the year of the line (`now`, or the year with `(field)` for a Year field, or `(reign end)`).
- `# line:` the ids of the heirs, in order (`none` for no heir), and `# more:` `yes` when the line has more people than the setting shows.
- `# named:` each named heir with the state (`first`, `not-alive`, `is-ruler`, `not-in-tree`, `excluded`), or `none`.
- `# old:` the heirs with the warning `old`, or `none`.

```kin
# Sample tree 16: the line of succession (spec §13.21, contract 0.2.7). Worked out by hand.
#
# The tree has no warning. The latest year in the tree is 1240 (the birth of Ronan), the reference year for "now".
options:
  start: bertram-carrow

houses:
  - id: carrow
    name: House Carrow
    color: "#8b1e3f"
  - id: harrow
    name: House Harrow
    color: "#2f6b3a"
  - id: saltmarsh
    name: House Saltmarsh
    color: "#1e4f8b"
  - id: wether
    name: House Wether
    color: "#7a5c1e"

titles:
  - id: duke-of-carrowmere
    name: Duke of Carrowmere
    plural: Dukes of Carrowmere
    succession: eldest-child
    inherit: men-only
    inherit-through: men
    # ruler: bertram-carrow
    # year: now
    # line: fenwick-carrow, jasper-carrow, cedric-carrow, dunstan-carrow
    # more: no
    # named: none
    # old: cedric-carrow
    holders:
      - {person: aldous-carrow, from: 1125, to: 1160}
      - {person: bertram-carrow, from: 1160}
  - id: countess-of-harrowfen
    name: Countess of Harrowfen
    plural: Countesses of Harrowfen
    succession: youngest-child
    inherit: women-first
    inherit-illegitimate: after
    year: 1215
    # ruler: matilda-harrow
    # year: 1215 (field)
    # line: clara-harrow, agnes-harrow, dagmar-harrow, sunniva-harrow, tilde-harrow
    # more: yes
    # named: none
    # old: none
    holders:
      - {person: odette-harrow, from: 1170, to: 1205}
      - {person: matilda-harrow, from: 1205, to: 1230}
  - id: margrave-of-the-salt-coast
    name: Margrave of the Salt Coast
    plural: Margraves of the Salt Coast
    succession: siblings-first
    inherit: men-first-in-house
    inherit-adopted: true
    # ruler: bram-saltmarsh
    # year: now
    # line: dorian-saltmarsh, leif-saltmarsh, hale-saltmarsh, finn-saltmarsh, elowen-saltmarsh
    # more: yes
    # named: none
    # old: none
    holders:
      - {person: ansel-saltmarsh, from: 1190, to: 1220}
      - {person: bram-saltmarsh, from: 1220}
  - id: lord-of-wetherby
    name: Lord of Wetherby
    plural: Lords of Wetherby
    succession: nearest-relative
    inherit: men-only
    inherit-through: women
    heir: [sam-wether, cass-wether]
    exclude: osric-penn
    # ruler: wystan-wether
    # year: now
    # line: sam-wether, cass-wether, bertie-wether, quill-penn, ronan-penn
    # more: no
    # named: sam-wether first, cass-wether first
    # old: none
    holders:
      - {person: wystan-wether, from: 1200}

people:
  # House Carrow: the Salic law. Bertram's children in written order: Edwin (dead), Harriet, Jasper.
  - {id: aldous-carrow, name: Aldous Carrow, house: carrow, sex: m, born: 1100, died: 1160}
  - {id: bertram-carrow, name: Bertram Carrow, house: carrow, sex: m, born: 1125, parents: [aldous-carrow]}
  - {id: cecily-hale, name: Cecily Hale, sex: f, born: 1128}
  - {id: cedric-carrow, name: Cedric Carrow, house: carrow, sex: m, born: 1128, parents: [aldous-carrow]}
  - {id: dunstan-carrow, name: Dunstan Carrow, house: carrow, sex: m, born: 1155, parents: [cedric-carrow]}
  - {id: edwin-carrow, name: Edwin Carrow, house: carrow, sex: m, born: 1150, died: 1185, parents: [bertram-carrow, cecily-hale]}
  - {id: harriet-carrow, name: Harriet Carrow, house: carrow, sex: f, born: 1152, parents: [bertram-carrow, cecily-hale]}
  - {id: jasper-carrow, name: Jasper Carrow, house: carrow, sex: m, born: 1155, parents: [bertram-carrow, cecily-hale]}
  - {id: fenwick-carrow, name: Fenwick Carrow, house: carrow, sex: m, born: 1175, parents: [edwin-carrow]}
  - {id: gwen-carrow, name: Gwen Carrow, house: carrow, sex: f, born: 1178, parents: [edwin-carrow]}
  - {id: ivo-marsh, name: Ivo Marsh, sex: m, born: 1176, parents: [harriet-carrow]}

  # House Harrow: the Year field 1215. Matilda's children in written order: Agnes, Bede (illegitimate), Clara, Dagmar, Edda (born 1216).
  - {id: odette-harrow, name: Odette Harrow, house: harrow, sex: f, born: 1140, died: 1205}
  - {id: matilda-harrow, name: Matilda Harrow, house: harrow, sex: f, born: 1165, parents: [odette-harrow]}
  - {id: sunniva-harrow, name: Sunniva Harrow, house: harrow, sex: f, born: 1168, parents: [odette-harrow]}
  - {id: agnes-harrow, name: Agnes Harrow, house: harrow, sex: f, born: 1188, parents: [matilda-harrow]}
  - {id: bede-harrow, name: Bede Harrow, house: harrow, sex: m, born: 1190, illegitimate: true, parents: [matilda-harrow]}
  - {id: clara-harrow, name: Clara Harrow, house: harrow, sex: f, born: 1194, parents: [matilda-harrow]}
  - {id: dagmar-harrow, name: Dagmar Harrow, house: harrow, sex: m, born: 1200, parents: [matilda-harrow]}
  - {id: edda-harrow, name: Edda Harrow, house: harrow, sex: f, born: 1216, parents: [matilda-harrow]}
  - {id: tilde-harrow, name: Tilde Harrow, house: harrow, sex: f, born: 1195, parents: [sunniva-harrow]}

  # House Saltmarsh: every man of the dynasty before every woman. Bram's children in written order: Finn 1215, Greta 1217, Hale 1214 (adopted). By birth year: Hale, Finn, Greta (D193).
  - {id: corvin-saltmarsh, name: Corvin Saltmarsh, house: saltmarsh, sex: m, born: 1140, died: 1195}
  - {id: ansel-saltmarsh, name: Ansel Saltmarsh, house: saltmarsh, sex: m, born: 1165, died: 1220, parents: [corvin-saltmarsh]}
  - {id: dorian-saltmarsh, name: Dorian Saltmarsh, house: saltmarsh, sex: m, born: 1168, parents: [corvin-saltmarsh]}
  - {id: elowen-saltmarsh, name: Elowen Saltmarsh, house: saltmarsh, sex: f, born: 1170, parents: [corvin-saltmarsh]}
  - {id: bram-saltmarsh, name: Bram Saltmarsh, house: saltmarsh, sex: m, born: 1190, parents: [ansel-saltmarsh]}
  - {id: isolde-saltmarsh, name: Isolde Saltmarsh, house: saltmarsh, sex: f, born: 1192, parents: [ansel-saltmarsh]}
  - {id: wenna-dray, name: Wenna Dray, sex: f, born: 1193}
  - {id: leif-saltmarsh, name: Leif Saltmarsh, house: saltmarsh, sex: m, born: 1195, parents: [dorian-saltmarsh]}
  - {id: finn-saltmarsh, name: Finn Saltmarsh, house: saltmarsh, sex: m, born: 1215, parents: [bram-saltmarsh, wenna-dray]}
  - {id: greta-saltmarsh, name: Greta Saltmarsh, house: saltmarsh, sex: f, born: 1217, parents: [bram-saltmarsh, wenna-dray]}
  - {id: hale-saltmarsh, name: Hale Saltmarsh, house: saltmarsh, sex: m, born: 1214, parents: [{id: bram-saltmarsh, type: adoptive}]}

  # House Wether: the claim passes through women. Maud's children in written order: Wystan, Edith, Bertie, Fay.
  - {id: maud-wether, name: Maud Wether, house: wether, sex: f, born: 1150, died: 1215}
  - {id: wystan-wether, name: Wystan Wether, house: wether, sex: m, born: 1172, parents: [maud-wether]}
  - {id: edith-wether, name: Edith Wether, house: wether, sex: f, born: 1175, parents: [maud-wether]}
  - {id: bertie-wether, name: Bertie Wether, house: wether, sex: m, born: 1178, parents: [maud-wether]}
  - {id: fay-wether, name: Fay Wether, house: wether, sex: f, born: 1180, parents: [maud-wether]}
  - {id: sam-wether, name: Sam Wether, house: wether, sex: m, born: 1196, parents: [wystan-wether]}
  - {id: cass-wether, name: Cass Wether, house: wether, sex: m, born: 1202, parents: [bertie-wether]}
  - {id: pell-penn, name: Pell Penn, sex: m, born: 1170}
  - {id: osric-penn, name: Osric Penn, sex: m, born: 1198, parents: [edith-wether, pell-penn]}
  - {id: petra-penn, name: Petra Penn, sex: f, born: 1200, parents: [edith-wether, pell-penn]}
  - {id: quill-penn, name: Quill Penn, sex: m, born: 1203, parents: [edith-wether, pell-penn]}
  - {id: ronan-penn, name: Ronan Penn, sex: m, born: 1240, parents: [petra-penn]}

unions:
  - partners: [bertram-carrow, cecily-hale]
    type: marriage
    start: 1148
  - partners: [bram-saltmarsh, wenna-dray]
    type: marriage
    start: 1212
  - partners: [edith-wether, pell-penn]
    type: marriage
    start: 1196
```
