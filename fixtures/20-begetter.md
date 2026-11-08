# Fixture 20 — A begetter outside the family

Sample tree for version 0.5.3 (spec §0 D332). It shows the parent link "begetter": a parent by blood who is not a parent in the family where the child grows up. All people are made up. The expected results are written by hand from the spec and the genealogy study of the begetter, not by code.

- **Isaut Merrow and Brisen Hale** are two women, married in 1120. Isaut is the birth mother of Ada, Ivo and Corin; Brisen adopted them. Brisen is the birth mother of Linnet; Isaut adopted her.
- **Oswin Thorne** is the begetter of Ada, Ivo and Linnet. He is married to Maud Ashby and is the father of Bram. Ada and Ivo are full brother and sister by blood; Bram is their half-brother.
- **Hugo Wyld** is the begetter of Corin. Corin is a half-brother of Ada by blood and her adoptive brother through Brisen.
- **A woman as begetter:** Esme Lark is the begetter of Rafe. Rafe is the son of Alard Vey and the adoptive son of Teodor Vey, who married Alard in 1125.
- **No couple:** Oswin, Hugo and Esme share no partnership with the parents of their begotten children. The tree draws each begetter with a side line of its own.
- **Below and around:** Ada married Hugh Corbet; their daughter is Lys. Elfa (Oswin's sister) and Tristan (Isaut's brother) are the parents of Wynn, a double first cousin of Ada. Ned is Maud's son by another man. Bram and Joan are the parents of Tam.
- **Two titles:** the Barony of Thorne passes from Gerold to Oswin; a begotten child never inherits it. The Lady of Merrow is Isaut; her children by birth inherit.
- The tree has no warning. The latest year in the tree is 1145.

```kin
# Sample tree 20: a begetter outside the family (D332). Made-up people.
# warnings: none
titles:
  - id: thorne
    name: Barony of Thorne
    male-name: Baron of Thorne
    female-name: Baroness of Thorne
    succession: eldest-child
    inherit: men-first
    year: 1145
    holders:
      - {person: gerold, from: 1085, to: 1120}
      - {person: oswin, from: 1120}
  - id: merrow
    name: Lady of Merrow
    male-name: Lord of Merrow
    female-name: Lady of Merrow
    succession: eldest-child
    year: 1145
    holders:
      - {person: isaut, from: 1125}
people:
  - {id: gerold, name: Gerold Thorne, sex: m, born: 1060, died: 1120}
  - {id: hild, name: Hild Thorne, sex: f, born: 1064}
  - {id: aldo, name: Aldo Merrow, sex: m, born: 1062}
  - {id: bertha, name: Bertha Merrow, sex: f, born: 1066}
  - {id: oswin, name: Oswin Thorne, sex: m, born: 1090, parents: [gerold, hild]}
  - {id: elfa, name: Elfa Thorne, sex: f, born: 1093, parents: [gerold, hild]}
  - {id: maud, name: Maud Ashby, sex: f, born: 1092}
  - {id: ned, name: Ned Ashby, sex: m, born: 1110, parents: [maud]}
  - {id: bram, name: Bram Thorne, sex: m, born: 1118, parents: [oswin, maud]}
  - {id: joan, name: Joan Thorne, sex: f, born: 1120}
  - {id: tam, name: Tam Thorne, sex: m, born: 1142, parents: [bram, joan]}
  - {id: isaut, name: Isaut Merrow, sex: f, born: 1095, parents: [aldo, bertha]}
  - {id: tristan, name: Tristan Merrow, sex: m, born: 1097, parents: [aldo, bertha]}
  - {id: wynn, name: Wynn Merrow, sex: f, born: 1124, parents: [tristan, elfa]}
  - {id: brisen, name: Brisen Hale, sex: f, born: 1098}
  - {id: hugo, name: Hugo Wyld, sex: m, born: 1094}
  - {id: ada, name: Ada Merrow, sex: f, born: 1122, parents: [isaut, {id: brisen, type: adoptive}, {id: oswin, type: begetter}]}
  - {id: ivo, name: Ivo Merrow, sex: m, born: 1125, parents: [isaut, {id: brisen, type: adoptive}, {id: oswin, type: begetter}]}
  - {id: linnet, name: Linnet Hale, sex: f, born: 1127, parents: [brisen, {id: isaut, type: adoptive}, {id: oswin, type: begetter}]}
  - {id: corin, name: Corin Merrow, sex: m, born: 1129, parents: [isaut, {id: brisen, type: adoptive}, {id: hugo, type: begetter}]}
  - {id: hugh, name: Hugh Corbet, sex: m, born: 1118}
  - {id: lys, name: Lys Corbet, sex: f, born: 1142, parents: [ada, hugh]}
  - {id: alard, name: Alard Vey, sex: m, born: 1100}
  - {id: teodor, name: Teodor Vey, sex: m, born: 1101}
  - {id: esme, name: Esme Lark, sex: f, born: 1105}
  - {id: rafe, name: Rafe Vey, sex: m, born: 1130, parents: [alard, {id: teodor, type: adoptive}, {id: esme, type: begetter}]}
unions:
  - partners: [gerold, hild]
  - partners: [aldo, bertha]
  - partners: [oswin, maud]
    start: 1115
  - partners: [tristan, elfa]
  - partners: [bram, joan]
  - partners: [isaut, brisen]
    start: 1120
  - partners: [ada, hugh]
    start: 1140
  - partners: [alard, teodor]
    start: 1125
```
