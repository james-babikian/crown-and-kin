# Fixture 18 — Names in many scripts

Sample tree for version 0.4 (the release plan T10). It shows names, house names, nicknames and dates in Greek, Cyrillic, Georgian, Chinese, Japanese, Korean, Devanagari and Thai. All people are made up. The expected results are written by hand from the spec, not by code.

- **Eight houses, eight scripts.** Each house name is in its own script. Three generations marry across the scripts.
- **Combining marks:** the name of Zoë is stored as "Zoe" and a separate mark U+0308 (the decomposed form). The names in Devanagari, Thai and Cyrillic ("й") also hold marks.
- **Long names in a narrow script:** the Thai name of the child of Theodoros has no space in it. The Chinese name of Ouyang is a row of sixteen characters with no space in it. A card must cut or break them.
- **Emoji in a nickname:** Yaroslav has a fox. Zoë has a person with a skin tone and a joiner mark (one picture, four code points).
- **Dates with no calendar:** the dates are plain text in the form of each script: "1150年", "1156년", "११६२" (Devanagari digits), "พ.ศ. 1138", "1128 წ." and "ок. 1133". The tree has no `calendar` key, so the plugin shows the text as written.
- The tree has no warning.

```kin
# Sample tree 18: names, houses, nicknames and dates in many scripts (the release plan T10, version 0.4). Made-up people; worked out by hand.
#
# warnings: none
options:
  start: nikolaos

houses:
  - id: kalligeri
    name: Οίκος Καλλιγέρη
    color: "#8b1e3f"
  - id: zarev
    name: Дом Заревых
    color: "#1e4f8b"
  - id: beridze
    name: ბერიძეთა სახლი
    color: "#2f6b3a"
  - id: shen
    name: 沈家
    color: "#7a5c1e"
  - id: sakurai
    name: 桜井家
    color: "#5b3f8c"
  - id: yun
    name: 윤씨 가문
    color: "#1e7a7a"
  - id: vardhan
    name: वर्धन घराना
    color: "#b5651d"
  - id: suwan
    name: ตระกูลสุวรรณ
    color: "#6b6b1e"

titles:
  - id: archon
    name: Άρχων του Πόρου
    plural: Άρχοντες του Πόρου
    holders:
      - {person: nikolaos, from: 1140, to: 1170}
      - {person: theodoros, from: 1170}

people:
  - {id: nikolaos, name: Νικόλαος Καλλιγέρης, sobriquet: ο Σοφός, house: kalligeri, sex: m, born: "περ. 1102", died: 1170}
  - {id: miroslava, name: Мирослава Заревая, house: zarev, sex: f, born: "ок. 1110", died: 1175}
  - {id: alexandra, name: Αλεξάνδρα Καλλιγέρη, house: kalligeri, sex: f, born: "περ. 1131", parents: [nikolaos, miroslava]}
  - {id: yaroslav, name: Ярослав Зарев, sobriquet: "🦊 Лис", house: zarev, sex: m, born: "ок. 1133", parents: [nikolaos, miroslava]}
  - {id: theodoros, name: Θεόδωρος Καλλιγέρης, house: kalligeri, sex: m, born: 1135, parents: [nikolaos, miroslava]}
  - {id: giorgi, name: გიორგი ბერიძე, house: beridze, sex: m, born: "1128 წ."}
  - {id: mingxia, name: 沈明華, house: shen, sex: f, born: "1136年"}
  - {id: somying, name: สมหญิง สุวรรณ, house: suwan, sex: f, born: "พ.ศ. 1138"}
  - {id: nana, name: ნანა ბერიძე, house: beridze, sex: f, born: "1154 წ.", parents: [giorgi, alexandra]}
  - {id: ruolan, name: 沈若蘭, house: shen, sex: f, born: "1158年", parents: [yaroslav, mingxia]}
  - {id: dmitri, name: Дмитрий Зарев, house: zarev, sex: m, born: "ок. 1160", parents: [yaroslav, mingxia]}
  - {id: ouyang, name: 欧阳慕容诸葛上官东方夏侯司徒令狐, sex: m, born: "1161年", parents: [yaroslav, mingxia]}
  - {id: thai-long, name: สุวรรณภูมิพัฒนาวงศ์เจริญสุขสันต์ศรีสวัสดิ์มงคลชัย, house: suwan, sex: f, born: "พ.ศ. 1162", parents: [theodoros, somying]}
  - {id: ken, name: 桜井健, house: sakurai, sex: m, born: "1150年"}
  - {id: minjun, name: 윤민준, house: yun, sex: m, born: "1156년"}
  - {id: ananya, name: अनन्या वर्धन, house: vardhan, sex: f, born: "११६२"}
  - {id: hinata, name: 桜井ひなた, house: sakurai, sex: f, born: "1178年", parents: [nana, ken]}
  - {id: maria, name: マリア桜井, house: sakurai, sex: f, born: "1180年", parents: [nana, ken]}
  - {id: zoe, name: Zoë Beridze, sobriquet: "🧑🏽‍🌾 the Farmer", house: beridze, sex: f, born: 1182, parents: [nana, ken]}
  - {id: seoyeon, name: 윤서연, house: yun, sex: f, born: "1182년", parents: [minjun, ruolan]}
  - {id: haneul, name: 윤하늘, house: yun, sex: m, born: "1185년", parents: [minjun, ruolan]}
  - {id: aryan, name: आर्यन वर्धन, house: vardhan, sex: m, born: "११८४", parents: [dmitri, ananya]}

unions:
  - partners: [nikolaos, miroslava]
    start: 1129
  - partners: [giorgi, alexandra]
    start: "1152 წ."
  - partners: [yaroslav, mingxia]
    start: "1156年"
  - partners: [theodoros, somying]
    start: "พ.ศ. 1160"
  - partners: [ken, nana]
    start: "1176年"
  - partners: [minjun, ruolan]
    start: "1180년"
  - partners: [dmitri, ananya]
    start: "११८२"
```
