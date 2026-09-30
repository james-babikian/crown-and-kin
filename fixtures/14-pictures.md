# Fixture 14 — Pictures

Coats of arms and portraits of spec §13.6 and §13.7 (decisions D67–D78), and the pictures that Save as picture (§13.8) embeds. All pictures are fictional; they are in `fixtures/pictures/` and are made by `scripts/generate-pictures.ts` (`npm run fixtures`). Do not edit them by hand.

- Arms for three houses: House Valmont a PNG (a filled shield on a transparent ground), House Orsini an SVG (with a long text before `<svg`), House Castellane a transparent PNG with black lines only. House Thorne has no arms: its cards do not change.
- Arms that cannot show, one for each warning: House Harrow names a file that is not in the vault, House Drakemoor a web address, House Veyle a HEIC photo, House Ashby a PDF (not a picture) and House Greymane a PNG of 9000 × 6000 px (54 million pixels, more than the 40 million the plugin decodes).
- Portraits: square JPEG and PNG photos, an SVG, the tall portrait photo for the crop (Roderick, 400 × 600), an iPhone-style photo stored on its side with EXIF orientation 6 (Edmund), a 4000 × 4000 px photo (Hugo), a JPEG with the name of a PNG (Lisette: it shows) and a HEIC photo with the name of a JPEG (Wren: it does not).
- Portraits that cannot show: a missing file (Oswin, deceased: a dashed empty frame), a web address (Darian), a HEIC photo (Felicia), a PDF (Cedric) and the picture of 54 million pixels (Adela).
- Every link form: `[[…]]`, `![[…]]`, `[[…|alias]]`, a Markdown link, an unquoted `[[…]]` (read like `link`), a web address. The second block also has an unquoted `![[…]]` (contract amendment A3).
- Bastien is illegitimate with no parents listed, so his card has the D14 sign beside the arms.
- The first block has a "This is me" mark (Roderick), so its cards have a relation text line; the second block has no mark (D77: the title and the dates are beside the portrait).

The comments in the first block give the expected results (read by `tests/acceptance/m9-*.test.ts`):

- `# picture: <file> | format=…; width=…; height=…` — what the header reader finds in each file of `fixtures/pictures/` (`orientation=` when the JPEG has one).
- `# colours: <file> | …` — the colours from the arms of the PNG arms, largest share first, computed with the decided method (§13.6) from a 64 × 64 px copy made with resvg (contract amendment A5). A test accepts each colour within ΔE (OKLab) 0.03.
- `# warning: <code> | <param>=<value>; …` — every picture warning of the block, and no others: houses in list order, then people in list order. `ids=` gives the house or the person.

```dynasty
# Sample tree 14: coats of arms and portraits (spec §13.6, §13.7).
#
# picture: valmont-arms.png | format=png; width=250; height=300
# picture: orsini-arms.svg | format=svg; width=500; height=600
# picture: castellane-arms-lineart.png | format=png; width=250; height=300
# picture: veyle-arms.heic | format=heic; width=4032; height=3024
# picture: ashby-charter.pdf | format=unknown
# picture: huge-banner.png | format=png; width=9000; height=6000
# picture: aldric.jpg | format=jpeg; width=300; height=300
# picture: isolde.png | format=png; width=240; height=240
# picture: roderick-tall.jpg | format=jpeg; width=400; height=600
# picture: edmund-rotated.jpg | format=jpeg; width=450; height=300; orientation=6
# picture: matteo.png | format=png; width=240; height=240
# picture: beatrice.jpg | format=jpeg; width=300; height=300
# picture: giselle.png | format=png; width=240; height=240
# picture: tomas.svg | format=svg; width=600; height=600
# picture: piers.png | format=png; width=240; height=240
# picture: felicia.heic | format=heic; width=3024; height=4032
# picture: wren-photo.jpg | format=heic; width=4032; height=3024
# picture: lisette.png | format=jpeg; width=240; height=240
# picture: photo-4000.jpg | format=jpeg; width=4000; height=4000
#
# colours: valmont-arms.png | #c8102e, #f0c030, #221c1c
# colours: castellane-arms-lineart.png | #000000
#
# warning: missing-picture | owner=arms; house=House Harrow; file=harrow-arms.png; ids=harrow
# warning: picture-web | owner=arms; house=House Drakemoor; ids=drakemoor
# warning: picture-not-image | owner=arms; house=House Veyle; file=veyle-arms.heic; format=HEIC; ids=veyle
# warning: picture-not-image | owner=arms; house=House Ashby; file=ashby-charter.pdf; ids=ashby
# warning: picture-too-large | owner=arms; house=House Greymane; file=huge-banner.png; pixels=54; ids=greymane
# warning: picture-not-image | owner=portrait; person=Wren; file=wren-photo.jpg; format=HEIC; ids=wren
# warning: missing-picture | owner=portrait; person=Oswin Valmont; file=oswin.jpg; ids=oswin
# warning: picture-web | owner=portrait; person=Darian Drakemoor; ids=darian
# warning: picture-not-image | owner=portrait; person=Felicia Veyle; file=felicia.heic; format=HEIC; ids=felicia
# warning: picture-not-image | owner=portrait; person=Cedric Ashby; file=ashby-charter.pdf; ids=cedric
# warning: picture-too-large | owner=portrait; person=Adela Greymane; file=huge-banner.png; pixels=54; ids=adela
options:
  start: roderick
  me: roderick

houses:
  - id: valmont
    name: House Valmont
    color: "#8b1e3f"
    arms: "[[valmont-arms.png]]"
  - id: orsini
    name: House Orsini
    color: "#1e4f8b"
    arms: "![[orsini-arms.svg]]"
  - id: castellane
    name: House Castellane
    color: "#b8860b"
    arms: "[Castellane arms](pictures/castellane-arms-lineart.png)"
  - id: harrow
    name: House Harrow
    color: "#2e7d4f"
    # The file is not in the vault.
    arms: "[[harrow-arms.png]]"
  - id: drakemoor
    name: House Drakemoor
    color: "#5b3f8c"
    arms: "https://example.com/drakemoor-arms.png"
  - id: veyle
    name: House Veyle
    color: "#2f7f8f"
    arms: "[[veyle-arms.heic]]"
  - id: ashby
    name: House Ashby
    color: "#6b4f2a"
    arms: "[[ashby-charter.pdf]]"
  - id: greymane
    name: House Greymane
    color: "#44546a"
    arms: "[[huge-banner.png]]"
  - id: thorne
    name: House Thorne
    color: "#7a2e6b"

people:
  - id: aldric
    name: Aldric Valmont
    title: Duke of Valmont
    house: valmont
    sex: m
    born: 1102
    died: 1161
    link: "[[Aldric Valmont]]"
    portrait: "[[aldric.jpg]]"
  - id: isolde
    name: Isolde Orsini
    house: orsini
    sex: f
    born: 1110
    died: 1170
    portrait: "[[isolde.png]]"
  - id: roderick
    name: Roderick Valmont
    title: Duke of Valmont
    house: valmont
    sex: m
    born: 1131
    parents: [aldric, isolde]
    # The tall portrait photo: the card shows its upper-centre square.
    portrait: "![[roderick-tall.jpg]]"
  - id: beatrice
    name: Beatrice Castellane
    house: castellane
    sex: f
    born: 1133
    portrait: "[[beatrice.jpg]]"
  - id: bastien
    name: Bastien Valmont
    house: valmont
    sex: m
    born: 1136
    illegitimate: true
  - id: wren
    name: Wren
    house: valmont
    sex: f
    born: 1137
    parents: [aldric]
    illegitimate: true
    portrait: "[[wren-photo.jpg]]"
  - id: edmund
    name: Edmund Valmont
    house: valmont
    sex: m
    born: 1155
    parents: [roderick, beatrice]
    portrait: "[[edmund-rotated.jpg]]"
  - id: oswin
    name: Oswin Valmont
    house: valmont
    sex: m
    born: 1157
    died: 1190
    parents: [roderick, beatrice]
    portrait: "[[oswin.jpg]]"
  - id: clarice
    name: Clarice Castellane
    house: castellane
    sex: f
    born: 1160
    parents: [roderick, beatrice]
  - id: matteo
    name: Matteo Orsini
    house: orsini
    sex: m
    born: 1128
    # Unquoted: YAML reads a list in a list, and the plugin reads it like `link`.
    portrait: [[matteo.png]]
  - id: giselle
    name: Giselle Harrow
    house: harrow
    sex: f
    born: 1130
    portrait: "[Giselle](pictures/giselle.png)"
  - id: tomas
    name: Tomas Orsini
    house: orsini
    sex: m
    born: 1152
    parents: [matteo, giselle]
    portrait: "[[tomas.svg]]"
  - id: lisette
    name: Lisette Orsini
    house: orsini
    sex: f
    born: 1156
    parents: [matteo, giselle]
    portrait: "[[lisette.png]]"
  - id: darian
    name: Darian Drakemoor
    house: drakemoor
    sex: m
    born: 1129
    portrait: "https://example.com/darian.jpg"
  - id: felicia
    name: Felicia Veyle
    house: veyle
    sex: f
    born: 1105
    died: 1180
    portrait: "[[felicia.heic]]"
  - id: cedric
    name: Cedric Ashby
    house: ashby
    sex: m
    born: 1140
    portrait: "[[ashby-charter.pdf]]"
  - id: adela
    name: Adela Greymane
    house: greymane
    sex: f
    born: 1138
    portrait: "[[huge-banner.png]]"
  - id: hugo
    name: Hugo Thorne
    house: thorne
    sex: m
    born: 1100
    died: 1165
    portrait: "[[photo-4000.jpg]]"
  - id: piers
    name: Piers Thorne
    house: thorne
    sex: m
    born: 1134
    parents: [hugo]
    portrait: "[[piers.png|Piers at twenty]]"

unions:
  - partners: [aldric, isolde]
    start: 1129
  - partners: [roderick, beatrice]
    start: 1153
  - partners: [matteo, giselle]
    start: 1150
```

The second block has no "This is me" mark, so its cards have no relation text line (D77). Isolde's title and the dates of Aldric and Isolde are beside the portrait. Roderick's portrait is written as an unquoted `![[…]]` (contract amendment A3). The plugin reads that form like the quoted form, so this block shows, with Roderick's portrait.

```dynasty
houses:
  - id: valmont
    name: House Valmont
    color: "#8b1e3f"
    arms: "[[valmont-arms.png]]"
  - id: orsini
    name: House Orsini
    color: "#1e4f8b"
    arms: "![[orsini-arms.svg]]"

people:
  - id: aldric
    name: Aldric Valmont
    title: Duke of Valmont
    house: valmont
    sex: m
    born: 1102
    died: 1161
    portrait: "[[aldric.jpg]]"
  - id: isolde
    name: Isolde Orsini
    title: Duchess of Valmont
    house: orsini
    sex: f
    born: 1110
    died: 1170
    portrait: "[[isolde.png]]"
  - id: roderick
    name: Roderick Valmont
    title: Heir of Valmont
    house: valmont
    sex: m
    born: 1131
    parents: [aldric, isolde]
    portrait: ![[roderick-tall.jpg]]

unions:
  - partners: [aldric, isolde]
    start: 1129
```

The third block is for the portrait crop of spec §13.13 (decisions D79 and D91). It adds `portrait-crop` to the tall portrait photo (`roderick-tall.jpg`, 400 × 600 px) and to other portraits. It has no arms, so all cards are plain. The comments give the expected results (read by `tests/acceptance/m10-crop.test.ts`):

- `# crop: <id> | read=…; square=<sx>,<sy>,<size>; warning=<yes|no>` — what the value reads as (`ok`, `bad` or `absent`), the square in picture px that the card shows (`cropSquare` of the clamped part; for a bad value or a missing portrait, the automatic upper-centre square of §13.7), and whether `bad-portrait-crop` is expected.
- Roderick has a good part: left 0.1, top 0.4, side 0.5 of the shorter side (200 px), so the square is (40, 240) and 200 px wide. Odette's square leaves the picture, so it is moved and made smaller until it fits: side 0.8 (320 px), left at most 1 − 320 / 400 = 0.2, top at most 1 − 320 / 600 = 0.4667. Piers' side is under 0.1, so it is read as 0.1 (40 px). Bertrand writes commas, Hilda a side of 0: both are bad, with a warning, and show the automatic part. Gunnar has a `portrait-crop` but no `portrait`: it does nothing and gives no warning.

```dynasty
# Sample tree 14, block 3: the portrait crop (spec §13.13, D79, D91).
#
# crop: roderick | read=ok; square=40,240,200; warning=no
# crop: odette | read=ok; square=80,280,320; warning=no
# crop: piers | read=ok; square=200,300,40; warning=no
# crop: bertrand | read=bad; square=0,0,300; warning=yes
# crop: hilda | read=bad; square=0,0,240; warning=yes
# crop: gunnar | read=ok; warning=no
#
# warning: bad-portrait-crop | person=Bertrand Valmont; ids=bertrand
# warning: bad-portrait-crop | person=Hilda Valmont; ids=hilda
houses:
  - id: valmont
    name: House Valmont
    color: "#8b1e3f"

people:
  - id: roderick
    name: Roderick Valmont
    house: valmont
    sex: m
    born: 1131
    # The tall portrait photo (400 x 600 px) with a selected part.
    portrait: "![[roderick-tall.jpg]]"
    portrait-crop: "0.1 0.4 0.5"
  - id: odette
    name: Odette Valmont
    house: valmont
    sex: f
    born: 1133
    # A square that leaves the picture: moved and made smaller until it fits, with no warning.
    portrait: "![[roderick-tall.jpg]]"
    portrait-crop: "0.9 0.9 0.8"
  - id: piers
    name: Piers Valmont
    house: valmont
    sex: m
    born: 1135
    # A side under 0.1 is read as 0.1.
    portrait: "![[roderick-tall.jpg]]"
    portrait-crop: "0.5 0.5 0.05"
  - id: bertrand
    name: Bertrand Valmont
    house: valmont
    sex: m
    born: 1137
    # A comma is not a separator: bad.
    portrait: "[[aldric.jpg]]"
    portrait-crop: "0.1, 0.4, 0.5"
  - id: hilda
    name: Hilda Valmont
    house: valmont
    sex: f
    born: 1139
    # A side of 0: bad.
    portrait: "[[isolde.png]]"
    portrait-crop: "0.2 0.2 0"
  - id: gunnar
    name: Gunnar Valmont
    house: valmont
    sex: m
    born: 1141
    # A crop with no portrait does nothing and gives no warning.
    portrait-crop: "0.1 0.4 0.5"
```
