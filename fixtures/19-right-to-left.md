# Fixture 19 — Right-to-left names

Sample tree for version 0.4 (the release plan T10). It shows names in Arabic and Hebrew, names that mix Arabic or Hebrew with Latin letters (the text changes direction inside one name), house names in a right-to-left script, and a relation word next to a right-to-left name. All people are made up. The expected results are written by hand from the spec, not by code.

- **Arabic family:** Yusuf al-Haddad and Fatima have three children: Layla (the name mixes Arabic and Latin), Omar and Muhammad. The name of Muhammad has vowel marks (the marks are separate code points).
- **Hebrew family:** David Levi and Sarah have two children: Miriam and Avi. The name of Sarah has vowel marks. The name of Avi mixes Hebrew and Latin.
- **Marriage across the two houses:** Omar and Miriam married. Their children have a name that ends with a Latin text in brackets and a Roman number.
- **Houses:** "بيت الحداد" and "בית לוי" are right-to-left. "بيت Mansour" mixes both directions.
- **Dates with no calendar:** "١١٢٦" (Arabic-Indic digits), "حوالي 1108" (Arabic "about"), "בערך 1105" (Hebrew "about") and plain years.
- **The marked person:** the tree marks Omar as "This is me" (key `me`). The relation word on the card of every relative stands under a right-to-left name.
- The tree has no warning.

```kin
# Sample tree 19: right-to-left names and mixed text (the release plan T10, version 0.4). Made-up people; worked out by hand.
#
# warnings: none
options:
  start: omar
  me: omar

houses:
  - id: haddad
    name: بيت الحداد
    color: "#8b1e3f"
  - id: levi
    name: בית לוי
    color: "#1e4f8b"
  - id: mansour
    name: بيت Mansour
    color: "#2f6b3a"

people:
  - {id: yusuf, name: يوسف الحداد, sobriquet: الحكيم, title: قاضي القضاة, house: haddad, sex: m, born: 1100, died: 1168}
  - {id: fatima, name: فاطمة بنت خليل, house: haddad, sex: f, born: "حوالي 1108", died: 1170}
  - {id: layla, name: ليلى Haddad, house: haddad, sex: f, born: 1131, parents: [yusuf, fatima]}
  - {id: omar, name: عمر الحداد, house: haddad, sex: m, born: "١١٣٣", parents: [yusuf, fatima]}
  - {id: muhammad, name: مُحَمَّد الحداد, house: haddad, sex: m, born: 1135, parents: [yusuf, fatima]}
  - {id: david, name: דוד לוי, sobriquet: הצעיר, house: levi, sex: m, born: "בערך 1105", died: 1170}
  - {id: sarah, name: שָׁרָה לֵוִי, house: levi, sex: f, born: 1110}
  - {id: miriam, name: מרים לוי, house: levi, sex: f, born: 1136, parents: [david, sarah]}
  - {id: avi, name: Avi אבי Cohen, house: levi, sex: m, born: 1138, parents: [david, sarah]}
  - {id: kareem, name: كريم Mansour, house: mansour, sex: m, born: 1128}
  - {id: salma, name: سلمى Mansour, house: mansour, sex: f, born: 1158, parents: [kareem, layla]}
  - {id: nur, name: نور الدين الثاني (Nur al-Din II), house: haddad, sex: m, born: 1160, parents: [omar, miriam]}
  - {id: rachel, name: רחל (Rachel) לוי-Haddad, house: levi, sex: f, born: 1162, parents: [omar, miriam]}

unions:
  - partners: [yusuf, fatima]
    start: "١١٢٦"
  - partners: [david, sarah]
    start: "בערך 1130"
  - partners: [kareem, layla]
    start: 1155
  - partners: [omar, miriam]
    start: 1158
```
