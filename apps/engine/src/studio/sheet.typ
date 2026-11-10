// A printable pack of sheets (checklists, step-by-step sheets, fill-in templates, logs) from one spec
// (sys.inputs.spec, JSON). Every word in it is data: the spec never becomes code.
// sys.inputs.preview = "cover" renders the cover alone, "first" the first sheet alone (for the listing image).
#let spec = json(bytes(sys.inputs.spec))
#let preview = sys.inputs.at("preview", default: "")

#let th = spec.theme
#let paper = rgb(th.paper)
#let ink = rgb(th.ink)
#let soft = rgb(th.soft)
#let rule = rgb(th.line)
#let accent = rgb(th.accent)
#let tint = rgb(th.tint)
#let serif = "DM Serif Display"
#let sans = "Poppins"
#let n = spec.sections.len()

#set page(paper: "a4", margin: (x: 18mm, top: 20mm, bottom: 20mm), fill: paper)
#set text(font: sans, size: 10.5pt, fill: ink, weight: "regular")
#set par(leading: 0.62em, spacing: 0.9em)

#let small(body) = text(size: 8pt, weight: "semibold", fill: accent, tracking: 0.12em, upper(body))
#let checkbox = box(width: 4mm, height: 4mm, radius: 0.8mm, stroke: 0.8pt + soft, baseline: 0.7mm)
#let writeline = block(width: 100%, height: 8mm, below: 0pt, line(start: (0pt, 7.6mm), length: 100%, stroke: 0.6pt + rule))
#let foot(k) = place(bottom + left, dy: 12mm, box(width: 100%, grid(columns: (1fr, auto), text(size: 8pt, fill: soft, spec.brand + " · " + spec.title), text(size: 8pt, fill: soft, str(k)))))

#let cover = page(margin: 0pt)[
  #place(top + left, rect(width: 100%, height: 42%, fill: tint))
  #place(top + left, dx: 22mm, dy: 34mm, box(width: 166mm)[
    #small(spec.kicker)
    #v(7mm)
    #text(font: serif, size: 36pt, spec.title)
    #v(5mm)
    #text(size: 13pt, fill: soft, spec.subtitle)
  ])
  #place(top + left, dx: 22mm, dy: 138mm, box(width: 166mm)[
    #small("Inside")
    #v(3mm)
    #stack(dir: ttb, spacing: 3.2mm, ..spec.sections.enumerate().map(((i, s)) => grid(columns: (9mm, 1fr), text(size: 11pt, weight: "semibold", fill: accent, str(i + 1)), text(size: 11pt, s.title))))
  ])
  #place(bottom + left, dx: 22mm, dy: -18mm, text(size: 8.5pt, fill: soft, spec.brand + " · made on NIGHTSHIFT with AI-assisted writing"))
]

#let howto = [
  #small("Start here")
  #v(2mm)
  #text(font: serif, size: 24pt, "How to use this pack")
  #v(3mm)
  #text(size: 11pt, spec.intro)
  #v(5mm)
  #stack(dir: ttb, spacing: 4mm, ..spec.howto.enumerate().map(((i, h)) => grid(columns: (9mm, 1fr), text(weight: "semibold", fill: accent, str(i + 1)), h)))
  #foot(2)
]

#let sheet(i, s) = [
  #small("Sheet " + str(i + 1) + " of " + str(n))
  #v(2mm)
  #text(font: serif, size: 22pt, s.title)
  #if s.note != "" [
    #v(1mm)
    #text(size: 10pt, fill: soft, s.note)
  ]
  #v(4mm)
  #if s.kind == "checklist" {
    stack(dir: ttb, spacing: 3.6mm, ..s.items.map(it => grid(columns: (7.5mm, 1fr), checkbox, it)))
  } else if s.kind == "steps" {
    stack(dir: ttb, spacing: 4.2mm, ..s.items.enumerate().map(((k, it)) => grid(columns: (9mm, 1fr), text(weight: "semibold", fill: accent, str(k + 1)), it)))
  } else if s.kind == "fill" {
    stack(dir: ttb, spacing: 3mm, ..s.items.map(it => block(breakable: false, width: 100%)[
      #text(weight: "medium", it)
      #writeline
      #writeline
    ]))
  } else {
    table(
      columns: (1fr,) * s.columns.len(), stroke: 0.6pt + rule, inset: (x: 2.5mm, y: 3mm), fill: (_, y) => if y == 0 { tint } else { none },
      ..s.columns.map(c => text(size: 8.5pt, weight: "semibold", c)),
      ..range(s.rows * s.columns.len()).map(_ => box(height: 4mm)),
    )
  }
  #foot(i + 3)
]

#if preview == "cover" {
  cover
} else if preview == "first" {
  sheet(0, spec.sections.at(0))
} else {
  cover
  howto
  for (i, s) in spec.sections.enumerate() {
    pagebreak()
    sheet(i, s)
  }
}
