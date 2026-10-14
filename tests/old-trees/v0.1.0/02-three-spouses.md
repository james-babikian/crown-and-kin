<!-- Old sample tree: a copy of fixtures/02-three-spouses.md at the tag v0.1.0. Do not edit. -->
# Fixture 2 — One person, three successive spouses

Edmund marries three times and has children with each wife.

```dynasty
houses:
  - id: harrow
    name: House Harrow
    color: "#2e7d4f"

people:
  - id: godric
    name: Godric Harrow
    title: Earl of Harrow
    house: harrow
    sex: m
    born: 1080
    died: 1139
  - id: elinor
    name: Elinor Marlowe
    sex: f
    born: 1086
    died: 1130
  - id: edmund
    name: Edmund Harrow
    title: Earl of Harrow
    house: harrow
    sex: m
    born: 1105
    died: 1170
    parents: [godric, elinor]
  - id: cecily
    name: Cecily Harrow
    house: harrow
    sex: f
    born: 1108
    parents: [godric, elinor]
  - id: agnes
    name: Agnes Thorne
    sex: f
    born: 1107
    died: 1131
  - id: beatrix
    name: Beatrix Kestrel
    sex: f
    born: 1112
    died: 1142
  - id: clarice
    name: Clarice Redfern
    sex: f
    born: 1125
  - id: hugo
    name: Hugo Harrow
    house: harrow
    sex: m
    born: 1127
    parents: [edmund, agnes]
  - id: maud
    name: Maud Harrow
    house: harrow
    sex: f
    born: 1130
    parents: [edmund, agnes]
  - id: piers
    name: Piers Harrow
    house: harrow
    sex: m
    born: 1135
    parents: [edmund, beatrix]
  - id: sybil
    name: Sybil Harrow
    house: harrow
    sex: f
    born: 1145
    parents: [edmund, clarice]
  - id: osric
    name: Osric Harrow
    house: harrow
    sex: m
    born: 1148
    parents: [edmund, clarice]

unions:
  - partners: [godric, elinor]
  - partners: [edmund, agnes]
    start: 1126
    end: 1131
  - partners: [edmund, beatrix]
    start: 1133
    end: 1142
  - partners: [edmund, clarice]
    start: 1144
```
