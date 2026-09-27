# Fixture 9 — Formatting preservation

The archivist of Greyfen keeps the Harrow line in this note, typed by hand in several styles. A visual edit must change only the lines it needs to change (spec §6.2, §10 item 9). The note has:

- Comments on their own lines and at the ends of lines: in options, houses, people, a parents list and unions.
- Flow lists (`parents: [aldous, "0017"]`) and block lists, and one person (Joan) written as a flow map.
- Mixed quoting: plain, single quotes, double quotes, a quoted date and a quoted id (`"0017"`).
- Unknown keys at every level: the top level, `options`, a house, a person, a union and an object-form parent entry.
- Six `dynasty` blocks: the main tree, one in a callout, one in a callout inside a callout, one in a list item, a second plain block, and one with a `~~~` fence.
- A `dynasty` example inside a longer fence. It is only text, not a tree.

## The main tree

```dynasty
# The Harrow line, as kept by the archivist of Greyfen.
options:
  start: edric                # open on the heir
  archive-shelf: B-12         # unknown key in options

houses:
  - id: harrow
    name: House Harrow
    color: "#5b2a86"          # quoted, or YAML reads a comment
    motto: 'Root and branch'  # unknown key in a house
  - id: quill
    name: 'House Quill'
    color: '#2a6f86'

people:
  # First generation
  - id: aldous
    name: Aldous Harrow
    title: Lord of Greyfen    # an end-of-line comment on a title
    house: harrow
    sex: m
    born: 1102
    died: 1161
    epithet: the Patient      # unknown key in a person
  - id: "0017"                # a quoted id; it stays text
    name: "Maud Quill"
    house: quill
    sex: f
    born: "1104-03-09"        # a quoted date

  # Second generation
  - id: edric
    name: Edric Harrow
    house: harrow
    sex: m
    born: 1131
    parents: [aldous, "0017"]
  - id: rosamund
    name: 'Rosamund Harrow'
    nickname: Ros
    sex: f
    born: 1133
    parents:
      - aldous                # a block-style parents list
      - "0017"
  - id: piers
    name: Piers Harrow
    sex: m
    born: 1136
    parents: [aldous]
  # Wards and married-in
  - id: tamsin
    name: Tamsin
    title: Keeper of the Rolls
    sex: f
    parents:
      - id: aldous
        type: ward
        since: 1140           # unknown key in a parent entry
  - {id: joan, name: Joan Marsh, sex: f, born: 1135}   # a flow-map person

unions:
  - id: harrow-quill
    partners: [aldous, "0017"]
    type: marriage
    start: 1129
    witnessed-by: the Abbot   # unknown key in a union
  # Edric is promised to Joan.
  - partners: [edric, joan]
    type: betrothal

chronicle: Greyfen Rolls, vol. 2   # unknown top-level key
# End of the Harrow line.
```

## An example that is not a tree

The archivist's guide shows what a block looks like. The example sits inside a longer fence, so it is only text:

````markdown
```dynasty
people:
  - id: example
    name: Example Person
```
````

## A tree in a callout

> [!note] The Quill cadets
> Maud's brother and his son, kept apart from the main tree.
>
> ```dynasty
> people:
>   - id: osric
>     name: Osric Quill         # an end-of-line comment
>     sex: m
>
>   - id: hugh
>     name: Hugh Quill
>     parents: [osric]
> ```

## A tree in a callout inside a callout

> [!info] From the rolls
> > [!quote] A letter
> > ```dynasty
> > people:
> >   - id: wat
> >     name: "Wat the Elder"
> >     born: 1120   # the year he took service
> > ```

## A tree in a list item

Other branches:

- The Marsh branch:

  ```dynasty
  options:
    height: 400

  people:
    - id: joan-marsh
      name: Joan Marsh
      sex: f
  ```
- The Fenn branch is below.

## A second tree

```dynasty
people:
  - id: bertram
    name: Bertram Fenn
    sex: m
  - id: ysolde
    name: Ysolde Fenn
    sex: f
    parents: [bertram]
```

## A tree with a tilde fence

~~~dynasty
people:
  - id: cedric
    name: Cedric Vane
~~~
