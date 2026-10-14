<!-- Old sample tree: a copy of fixtures/12-relations.md at the tag v0.2.0. Do not edit. -->
# Fixture 12 — Relations

Every relation kind of spec §13.1 ("This is me" and relation names) and the relation finder of §13.2. The names are worked out by hand from the §13.1 rules (option A everywhere, D40–D49).

- Double first cousins: the brothers Alan and Brand married the sisters Dana and Edith, so Gwen and Harold are double first cousins of Ivo.
- Half relations: Kester (Alan and Fenna) is the half-brother of Gwen and Harold, the half-uncle of Leo; his daughters Mabel and Nia are Gwen's half-nieces and Leo's half first cousins.
- Two children who each list only one shared parent: Jory and Kit list only Cora, Mabel and Nia list only Kester (full sisters).
- Parent types: Cora adopted Nell; Wat and Pim are wards of Alan, Cai is a ward of Leo; Harold is the rumoured father of Wynn.
- Step relations: Fenna (Alan's second wife) is Gwen's stepmother; Tamsin (Fenna's daughter by Rolf) is Gwen's stepsister and Alan's stepdaughter; Pim is Alan's step-grandson.
- Marriages: Ivo married his first cousin Kit (a betrothal first, then a marriage); Kester married his daughter Mabel; Orla married Kester, then Jory. Alan also had an affair with Yara; Nora and Zed have a child with no recorded partnership.
- Rowan has `sex: x` and Nia has no `sex`, so they get the neutral words. Quill has no relation to anyone.

The comments in the block give the expected names (read by `tests/acceptance/relations.test.ts` and `relation-finder.test.ts`):

- `# <marked person>: <card text>`, then `; also: <the other names, best first>` for the sheet, and `; maybe: <names>` for names that depend on an open question (allowed, not required). `none` means no relation.
- `# pair: <first> > <second> | <sentence> | <number of relations, or chain, or none> | <the people on the line, in order>`.

```dynasty
# Marked people for the expected names: gwen, alan, leo.
#
# Finder pairs (spec §13.2): the second person as a relative of the first.
# pair: leo > wynn | Wynn is Leo's rumoured half-brother. | 1 | leo, harold, wynn
# pair: ivo > kit | Kit is Ivo's wife. | 2 | ivo, kit
# pair: mabel > kester | Kester is Mabel's husband. | 2 | mabel, kester
# pair: gwen > tamsin | Tamsin is Gwen's stepsister. | 1 | gwen, alan, fenna, tamsin
# pair: alan > pim | Pim is Alan's ward. | 2 | alan, pim
# pair: alan > nils | Nils is Alan's wife's first cousin. | 1 | alan, dana, hugo, sigmund, wilma, maud, nils
# pair: nora > zed | Zed is Nora's co-parent. | 1 | nora, zed
# pair: wat > alan | Alan is Wat's guardian. | 1 | wat, alan
# pair: gwen > rolf | Gwen and Rolf have a relation through 2 other people. | chain | gwen, alan, fenna, rolf
# pair: gwen > quill | Gwen and Quill have no relation in this tree. | none | -
options:
  me: gwen

houses:
  - id: ashby
    name: House Ashby
    color: "#8b1e3f"
  - id: harlow
    name: House Harlow
    color: "#1e4f8b"

people:
  - id: sigmund
    name: Sigmund
    house: harlow
    sex: m
    # gwen: Great-grandfather
    # alan: Grandfather-in-law
    # leo: Great-great-grandfather
  - id: wilma
    name: Wilma
    sex: f
    # gwen: Great-grandmother
    # alan: Grandmother-in-law
    # leo: Great-great-grandmother
  - id: thea
    name: Thea
    sex: f
    # gwen: Great-grandfather's wife
    # alan: none
    # leo: Great-great-grandfather's wife
  - id: odo
    name: Odo
    house: ashby
    sex: m
    # gwen: Grandfather
    # alan: Father
    # leo: Great-grandfather
  - id: bertha
    name: Bertha
    sex: f
    # gwen: Grandmother
    # alan: Mother
    # leo: Great-grandmother
  - id: hugo
    name: Hugo
    house: harlow
    sex: m
    parents: [sigmund, wilma]
    # gwen: Grandfather
    # alan: Father-in-law
    # leo: Great-grandfather
  - id: clara
    name: Clara
    sex: f
    # gwen: Grandmother
    # alan: Mother-in-law
    # leo: Great-grandmother
  - id: ysolde
    name: Ysolde
    sex: f
    # gwen: Step-grandmother
    # alan: none
    # leo: Great-grandfather's wife
  - id: maud
    name: Maud
    house: harlow
    sex: f
    parents: [sigmund, wilma]
    # gwen: Great-aunt
    # alan: Wife's aunt
    # leo: Great-great-aunt
  - id: alan
    name: Alan
    house: ashby
    sex: m
    parents: [odo, bertha]
    # gwen: Father
    # alan: You
    # leo: Grandfather
  - id: brand
    name: Brand
    house: ashby
    sex: m
    parents: [odo, bertha]
    # gwen: Uncle
    # alan: Brother
    # leo: Great-uncle
  - id: cora
    name: Cora
    house: ashby
    sex: f
    parents: [odo, bertha]
    # gwen: Aunt
    # alan: Sister
    # leo: Great-aunt
  - id: dana
    name: Dana
    house: harlow
    sex: f
    parents: [hugo, clara]
    # gwen: Mother
    # alan: Wife
    # leo: Grandmother
  - id: edith
    name: Edith
    house: harlow
    sex: f
    parents: [hugo, clara]
    # gwen: Aunt
    # alan: Sister-in-law
    # leo: Great-aunt
  - id: egbert
    name: Egbert
    house: harlow
    sex: m
    parents: [hugo, clara]
    # gwen: Uncle
    # alan: Brother-in-law
    # leo: Great-uncle
  - id: nils
    name: Nils
    sex: m
    parents: [maud]
    illegitimate: true
    # gwen: First cousin once removed
    # alan: Wife's first cousin
    # leo: First cousin twice removed
  - id: fenna
    name: Fenna
    sex: f
    # gwen: Stepmother
    # alan: Wife
    # leo: Step-grandmother
  - id: rolf
    name: Rolf
    sex: m
    # gwen: none
    # alan: none
    # leo: none
  - id: yara
    name: Yara
    sex: f
    # gwen: none
    # alan: Lover
    # leo: none
  - id: gwen
    name: Gwen
    house: ashby
    sex: f
    parents: [alan, dana]
    # gwen: You
    # alan: Daughter
    # leo: Aunt
  - id: harold
    name: Harold
    house: ashby
    sex: m
    parents: [alan, dana]
    # gwen: Brother
    # alan: Son
    # leo: Father
  - id: kester
    name: Kester
    house: ashby
    sex: m
    parents: [alan, fenna]
    # gwen: Half-brother
    # alan: Son
    # leo: Half-uncle
  - id: tamsin
    name: Tamsin
    sex: f
    parents: [rolf, fenna]
    # gwen: Stepsister
    # alan: Stepdaughter
    # leo: none
  - id: wat
    name: Wat
    sex: m
    parents: [{id: alan, type: ward}]
    # gwen: none
    # alan: Ward
    # leo: none
  - id: ivo
    name: Ivo
    house: ashby
    sex: m
    parents: [brand, edith]
    # gwen: Double first cousin
    # alan: Nephew; maybe: wife's nephew
    # leo: Double first cousin once removed
  - id: jory
    name: Jory
    house: ashby
    sex: m
    parents: [cora]
    # gwen: First cousin
    # alan: Nephew
    # leo: First cousin once removed
  - id: kit
    name: Kit
    house: ashby
    sex: f
    parents: [cora]
    # gwen: First cousin
    # alan: Niece
    # leo: First cousin once removed
  - id: nell
    name: Nell
    sex: f
    parents: [{id: cora, type: adoptive}]
    # gwen: Adoptive first cousin
    # alan: Adoptive niece
    # leo: Adoptive first cousin once removed
  - id: rafe
    name: Rafe
    sex: m
    # gwen: First cousin by marriage
    # alan: Nephew by marriage
    # leo: First cousin once removed by marriage
  - id: una
    name: Una
    sex: f
    # gwen: Sister-in-law
    # alan: Daughter-in-law
    # leo: Mother
  - id: orla
    name: Orla
    sex: f
    # gwen: Sister-in-law; also: first cousin by marriage
    # alan: Daughter-in-law; also: niece by marriage
    # leo: Aunt by marriage; also: first cousin once removed by marriage
  - id: leo
    name: Leo
    house: ashby
    sex: m
    parents: [harold, una]
    # gwen: Nephew
    # alan: Grandson; maybe: wife's grandson
    # leo: You
  - id: rowan
    name: Rowan
    house: ashby
    sex: x
    parents: [harold, una]
    # gwen: Sibling's child
    # alan: Grandchild; maybe: wife's grandchild
    # leo: Sibling
  - id: wynn
    name: Wynn
    sex: m
    parents: [{id: harold, type: rumoured}]
    # gwen: Rumoured nephew
    # alan: Rumoured grandson; maybe: wife's rumoured grandson
    # leo: Rumoured half-brother
  - id: vera
    name: Vera
    sex: f
    # gwen: Niece by marriage
    # alan: Granddaughter-in-law
    # leo: Wife
  - id: mabel
    name: Mabel
    house: ashby
    sex: f
    parents: [kester]
    # gwen: Half-niece
    # alan: Granddaughter; maybe: wife's granddaughter
    # leo: Half first cousin
  - id: nia
    name: Nia
    house: ashby
    parents: [kester]
    # gwen: Half-sibling's child
    # alan: Grandchild; maybe: wife's grandchild
    # leo: Half first cousin
  - id: pim
    name: Pim
    sex: m
    parents: [tamsin, {id: alan, type: ward}]
    # gwen: none
    # alan: Ward; also: step-grandson
    # leo: none
  - id: cass
    name: Cass
    house: ashby
    sex: f
    parents: [ivo, kit]
    # gwen: Double first cousin once removed
    # alan: Great-niece; maybe: wife's great-niece
    # leo: Double second cousin
  - id: ansel
    name: Ansel
    house: ashby
    sex: m
    parents: [jory]
    # gwen: First cousin once removed
    # alan: Great-nephew
    # leo: Second cousin
  - id: tobin
    name: Tobin
    house: ashby
    sex: m
    parents: [kester, mabel]
    # gwen: Half-nephew
    # alan: Grandson; maybe: wife's grandson
    # leo: Half first cousin
  - id: nora
    name: Nora
    house: ashby
    sex: f
    parents: [leo, vera]
    # gwen: Great-niece
    # alan: Great-granddaughter; maybe: wife's great-granddaughter
    # leo: Daughter
  - id: bryn
    name: Bryn
    house: ashby
    sex: f
    parents: [ansel]
    # gwen: First cousin twice removed
    # alan: Great-great-niece
    # leo: Second cousin once removed
  - id: zed
    name: Zed
    sex: m
    # gwen: none
    # alan: none
    # leo: none
  - id: otto
    name: Otto
    sex: m
    parents: [nora, zed]
    # gwen: Great-great-nephew
    # alan: Great-great-grandson; maybe: wife's great-great-grandson
    # leo: Grandson; maybe: wife's grandson
  - id: cai
    name: Cai
    sex: m
    parents: [bryn, {id: leo, type: ward}]
    # gwen: First cousin 3 times removed
    # alan: 3rd great-nephew
    # leo: Ward; also: second cousin twice removed
  - id: quill
    name: Quill
    sex: m
    # gwen: none
    # alan: none
    # leo: none

unions:
  - partners: [sigmund, wilma]
  - partners: [sigmund, thea]
  - partners: [odo, bertha]
  - partners: [hugo, clara]
  - partners: [hugo, ysolde]
  - partners: [alan, dana]
  - partners: [alan, fenna]
  - partners: [alan, yara]
    type: affair
  - partners: [rolf, fenna]
  - partners: [brand, edith]
  - partners: [harold, una]
  - partners: [kester, orla]
  - partners: [kester, mabel]
  - partners: [jory, orla]
  - partners: [ivo, kit]
    type: betrothal
  - partners: [ivo, kit]
  - partners: [nell, rafe]
  - partners: [leo, vera]
```
