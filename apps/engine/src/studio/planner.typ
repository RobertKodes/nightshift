// A hyperlinked digital planner, from one spec (sys.inputs.spec, JSON). Every word in it is data:
// the spec never becomes code. A preview (sys.inputs.preview) renders one page by its key, without links.
#let spec = json(bytes(sys.inputs.spec))
#let preview = sys.inputs.at("preview", default: "")
#let full = preview == ""

#let th = spec.theme
#let paper = rgb(th.paper)
#let ink = rgb(th.ink)
#let soft = rgb(th.soft)
#let rule = rgb(th.line)
#let accent = rgb(th.accent)
#let tint = rgb(th.tint)
#let W = spec.page.width * 1pt
#let H = spec.page.height * 1pt
#let u = W / 100
#let serif = "DM Serif Display"
#let sans = "Poppins"
#set page(width: W, height: H, margin: 0pt, fill: paper)
#set text(font: sans, size: 1.9 * u, fill: ink, weight: "regular")
#set par(leading: 0.55em, spacing: 0.8em)

// ---------------------------------------------------------------- the calendar
#let Y = spec.year
#let ws = if spec.weekStart == "sun" { 7 } else { 1 }
#let MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")
#let MON3 = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
#let DAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
#let WD = if ws == 1 { ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun") } else { ("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat") }
#let leap = calc.rem(Y, 4) == 0 and (calc.rem(Y, 100) != 0 or calc.rem(Y, 400) == 0)
#let mdays = (31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
#let ndays = if leap { 366 } else { 365 }
#let jan1 = datetime(year: Y, month: 1, day: 1)
#let doy(m, d) = mdays.slice(0, m - 1).sum(default: 0) + d
#let date-of(n) = jan1 + duration(days: n - 1)
#let off(wd) = calc.rem(wd - ws + 7, 7)
#let w1 = 1 - off(jan1.weekday())
#let week-of(n) = calc.floor((n - w1) / 7) + 1
#let nweeks = week-of(ndays)
#let has-days = spec.days
#let day-target(n) = if has-days { "d-" + str(n) } else { "w-" + str(week-of(n)) }

// ---------------------------------------------------------------- links and pieces
#let go(target, body) = if full { link(label(target), body) } else { body }
#let pill(body, on: false) = box(inset: (x: 1.25 * u, y: 0.62 * u), radius: 0.9 * u, fill: if on { accent } else { tint }, text(size: 1.42 * u, weight: "medium", fill: if on { paper } else { ink }, body))
#let NAV = (("year", "Year"), ("index", "Index")) + (if spec.trackers.len() > 0 { (("trackers", "Trackers"),) } else { () }) + (if spec.notes.pages > 0 { (("notes", "Notes"),) } else { () })
#let writelines(n, gap: 3.4) = stack(dir: ttb, spacing: 0pt, ..range(n).map(_ => block(width: 100%, height: gap * u, below: 0pt, line(start: (0pt, gap * u - 1pt), length: 100%, stroke: 0.75pt + rule))))
#let label-small(body) = text(size: 1.3 * u, weight: "semibold", fill: accent, tracking: 0.12em, upper(body))
#let panel(title, body) = block(width: 100%, inset: (x: 1.4 * u, y: 1.2 * u), radius: 1.2 * u, stroke: 0.8pt + rule, fill: paper)[#label-small(title) #v(0.4 * u) #body]
#let checkbox = box(width: 1.5 * u, height: 1.5 * u, radius: 0.3 * u, stroke: 0.9pt + soft, baseline: 0.2 * u)
#let todo(n) = stack(dir: ttb, spacing: 0pt, ..range(n).map(_ => block(width: 100%, height: 3.4 * u, below: 0pt, grid(columns: (2.6 * u, 1fr), align: (left + horizon, left + bottom), checkbox, line(length: 100%, stroke: 0.6pt + rule)))))

// The month tabs down the right edge, the title and the navigation along the top.
#let tabs(active) = place(right + top, dy: 13 * u, stack(dir: ttb, spacing: 0.55 * u, ..range(1, 13).map(m => go("m-" + str(m), box(width: 6 * u, height: 4.3 * u, fill: if m == active { accent } else { tint }, radius: (top-left: 1.1 * u, bottom-left: 1.1 * u), align(center + horizon, text(size: 1.35 * u, weight: "medium", fill: if m == active { paper } else { ink }, MON3.at(m - 1))))))))
#let topbar(title, sub) = place(top + left, dx: 6 * u, dy: 4 * u, box(width: 85 * u, grid(columns: (1fr, auto), align: (left + bottom, right + bottom),
  [#text(font: serif, size: 5 * u, title)#if sub != "" [#h(1.4 * u)#text(size: 1.7 * u, fill: soft, sub)]],
  NAV.map(((k, n)) => go(k, pill(n))).join(h(0.5 * u)))))

// One page: its anchor (links land here), the top bar, the tabs, and its body in the content area.
#let sheet(key, anchor, month, title, sub, body) = if full or preview == key {
  page({
    if full and anchor != none [#metadata(key)#label(anchor)]
    topbar(title, sub)
    tabs(month)
    place(top + left, dx: 6 * u, dy: 12.5 * u, box(width: 85 * u, height: H - 17 * u, clip: true, body))
    place(bottom + left, dx: 6 * u, dy: -2.2 * u, text(size: 1.15 * u, fill: soft, spec.title + " · " + str(Y)))
  })
}

// ---------------------------------------------------------------- calendars
#let cells(m) = {
  let first = datetime(year: Y, month: m, day: 1)
  let out = range(off(first.weekday())).map(_ => none) + range(1, mdays.at(m - 1) + 1)
  while calc.rem(out.len(), 7) != 0 { out.push(none) }
  out
}
#let mini(m, size) = {
  let cs = cells(m)
  block(width: 100%)[
    #go("m-" + str(m), text(font: serif, size: size * 1.5, MONTHS.at(m - 1)))
    #v(0.2 * size)
    #grid(columns: (1fr,) * 7, row-gutter: 0.45 * size, align: center,
      ..WD.map(w => text(size: size * 0.62, weight: "semibold", fill: soft, w.slice(0, 1))),
      ..cs.map(d => if d == none { [] } else { go(day-target(doy(m, d)), text(size: size * 0.72, str(d))) }))
  ]
}
#let month-calendar(m, height) = {
  let cs = cells(m)
  let rows = calc.div-euclid(cs.len(), 7)
  let ch = (height - 4 * u) / rows
  grid(columns: (1fr,) * 7, column-gutter: 0.5 * u, row-gutter: 0.5 * u,
    ..WD.map(w => align(center, text(size: 1.45 * u, weight: "semibold", fill: soft, upper(w)))),
    ..cs.map(d => if d == none { box(width: 100%, height: ch) } else {
      let n = doy(m, d)
      go(day-target(n), box(width: 100%, height: ch, radius: 0.8 * u, stroke: 0.8pt + rule, fill: if off(date-of(n).weekday()) >= 5 { tint.transparentize(55%) } else { paper }, inset: 0.8 * u, text(size: 1.6 * u, weight: "medium", str(d))))
    }))
}

// ---------------------------------------------------------------- the pages
// Cover
#if full or preview == "cover" {
  page({
    if full [#metadata("cover")#label("cover")]
    place(top + right, dx: 18 * u, dy: -14 * u, circle(radius: 42 * u, fill: tint))
    place(top + right, dx: 4 * u, dy: 18 * u, circle(radius: 16 * u, fill: accent.transparentize(78%)))
    place(bottom + left, dx: -16 * u, dy: 20 * u, circle(radius: 36 * u, fill: tint.transparentize(30%)))
    place(top + left, dx: 9 * u, dy: 30 * u, block(width: 80 * u)[
      #text(size: 1.8 * u, weight: "semibold", fill: accent, tracking: 0.25em, upper(spec.kicker))
      #v(1.6 * u)
      #text(font: serif, size: 10 * u, spec.title)
      #v(1.4 * u)
      #text(size: 2.6 * u, fill: soft, spec.subtitle)
      #v(5 * u)
      #text(font: serif, size: 16 * u, fill: accent, str(Y))
    ])
    place(bottom + left, dx: 9 * u, dy: -7 * u, block(width: 80 * u)[
      #go("index", pill("Open the planner  →", on: true))
      #v(2.4 * u)
      #text(size: 1.5 * u, fill: soft, "by " + spec.brand)
    ])
  })
}

// How to use it
#sheet("guide", "guide", 0, "How to use", "a minute to read", [
  #set text(size: 2 * u)
  #grid(columns: (1fr, 1fr), column-gutter: 3 * u, row-gutter: 3 * u,
    ..spec.guide.map(((t, b)) => panel(t, text(fill: soft, b))))
])

// Index
#sheet("index", "index", 0, "Index", spec.title, [
  #grid(columns: (1fr, 1fr), column-gutter: 3 * u, row-gutter: 2.2 * u,
    panel("Plan", stack(dir: ttb, spacing: 1.4 * u,
      go("year", text(size: 2.2 * u, "Year at a glance  →")),
      go("guide", text(size: 2.2 * u, "How to use  →")),
      go("w-1", text(size: 2.2 * u, "Week 1  →")),
      ..(if has-days { (go("d-1", text(size: 2.2 * u, "Day 1  →")),) } else { () }))),
    panel("Months", grid(columns: (1fr, 1fr, 1fr), row-gutter: 1.4 * u, ..range(1, 13).map(m => go("m-" + str(m), text(size: 2 * u, MONTHS.at(m - 1)))))),
    ..(if spec.trackers.len() > 0 { (panel("Trackers", stack(dir: ttb, spacing: 1.4 * u, ..spec.trackers.enumerate().map(((i, t)) => go("t-" + str(i), text(size: 2.2 * u, t.title + "  →"))))),) } else { () }),
    ..(if spec.pages.len() > 0 { (panel("Pages", stack(dir: ttb, spacing: 1.4 * u, ..spec.pages.enumerate().map(((i, p)) => go("p-" + str(i), text(size: 2.2 * u, p.title + "  →"))))),) } else { () }),
    ..(if spec.notes.pages > 0 { (panel("Notes", go("notes", text(size: 2.2 * u, str(spec.notes.pages) + " pages  →"))),) } else { () }))
])

// Year at a glance
#sheet("year", "year", 0, "Year at a glance", str(Y), [
  #grid(columns: (1fr,) * 3, column-gutter: 4 * u, row-gutter: 3.6 * u, ..range(1, 13).map(m => mini(m, 1.55 * u)))
])

// Months
#for m in range(1, 13) {
  sheet("month-" + str(m), "m-" + str(m), m, MONTHS.at(m - 1), str(Y), [
    #month-calendar(m, (H - 17 * u) * 0.6)
    #v(2.4 * u)
    #grid(columns: (1fr, 1fr, 1fr), column-gutter: 2 * u,
      ..spec.monthPanels.map(t => panel(t, writelines(6, gap: 3))))
    #v(1.6 * u)
    #text(size: 1.4 * u, fill: soft)[Weeks: #range(week-of(doy(m, 1)), week-of(doy(m, mdays.at(m - 1))) + 1).map(w => go("w-" + str(w), pill("W" + str(w)))).join(h(0.4 * u))]
  ])
}

// Weeks
#for w in range(1, nweeks + 1) {
  let first = w1 + (w - 1) * 7
  let days = range(first, first + 7)
  let inyear = days.filter(n => n >= 1 and n <= ndays)
  let m = date-of(calc.max(1, calc.min(ndays, first + 3))).month()
  let range-txt = date-of(inyear.first()).display("[month repr:short] [day padding:none]") + " – " + date-of(inyear.last()).display("[month repr:short] [day padding:none]")
  sheet("week-" + str(w), "w-" + str(w), m, "Week " + str(w), range-txt, [
    #grid(columns: (1fr, 0.42fr), column-gutter: 2.4 * u, [
      #stack(dir: ttb, spacing: 0.9 * u, ..days.map(n => {
        let dd = date-of(calc.max(1, calc.min(ndays, n)))
        let inside = n >= 1 and n <= ndays
        block(width: 100%, height: (H - 17 * u - 6.3 * u) / 7, radius: 1 * u, stroke: 0.8pt + rule, inset: (x: 1.3 * u, y: 1 * u), fill: if inside { paper } else { tint.transparentize(60%) },
          grid(columns: (8 * u, 1fr), column-gutter: 1.2 * u, align: (left + top, left + top),
            if inside { go(day-target(n), [#text(size: 1.3 * u, weight: "semibold", fill: accent, upper(DAYS.at(dd.weekday() - 1).slice(0, 3)))\ #text(font: serif, size: 3.4 * u, str(dd.day()))]) } else { text(size: 1.3 * u, fill: soft, "—") },
            writelines(3, gap: 2.9)))
      }))
    ], [
      #panel(spec.weekPanels.at(0, default: "Priorities"), todo(6))
      #v(1.6 * u)
      #panel(spec.weekPanels.at(1, default: "Notes"), writelines(12, gap: 3))
      #v(1.6 * u)
      #grid(columns: (1fr, 1fr), column-gutter: 1 * u,
        if w > 1 { go("w-" + str(w - 1), pill("← Week " + str(w - 1))) } else { [] },
        align(right, if w < nweeks { go("w-" + str(w + 1), pill("Week " + str(w + 1) + " →")) } else { [] }))
    ])
  ])
}

// Days
#if has-days {
  for n in range(1, ndays + 1) {
    let dd = date-of(n)
    let hours = range(spec.hours.at(0), spec.hours.at(1) + 1)
    sheet("day-" + str(n), "d-" + str(n), dd.month(), DAYS.at(dd.weekday() - 1), dd.display("[month repr:long] [day padding:none], [year]"), [
      #grid(columns: (1fr, 1fr), column-gutter: 2.6 * u, [
        #label-small("Schedule")
        #v(0.6 * u)
        #stack(dir: ttb, spacing: 0pt, ..hours.map(h => block(width: 100%, height: (H - 17 * u - 4 * u) / hours.len(), below: 0pt,
          grid(columns: (6 * u, 1fr), align: (left + horizon, left + bottom),
            text(size: 1.4 * u, fill: soft, (if calc.rem(h, 24) < 10 { "0" } else { "" }) + str(calc.rem(h, 24)) + ":00"),
            line(length: 100%, stroke: 0.6pt + rule)))))
      ], [
        #panel("Top 3", todo(3))
        #v(1.4 * u)
        #for f in spec.dayFields [#panel(f, writelines(1, gap: 3)) #v(1 * u)]
        #panel("To do", todo(7))
        #v(1.4 * u)
        #panel("Notes", writelines(6, gap: 3))
        #v(1.2 * u)
        #grid(columns: (1fr, 1fr),
          if n > 1 { go("d-" + str(n - 1), pill("← Previous")) } else { [] },
          align(right, if n < ndays { go("d-" + str(n + 1), pill("Next →")) } else { [] }))
        #align(right, go("w-" + str(week-of(n)), pill("Week " + str(week-of(n)))))
      ])
    ])
  }
}

// Trackers
#for (i, t) in spec.trackers.enumerate() {
  if t.kind == "habit" {
    for m in range(1, 13) {
      let anchor = if m == 1 { "t-" + str(i) } else { none }
      sheet("tracker-" + str(i) + "-" + str(m), anchor, m, t.title, MONTHS.at(m - 1), [
        #if m == 1 and i == 0 and full [#metadata("trackers")#label("trackers")]
        #let nd = mdays.at(m - 1)
        #let gap = calc.max(1.6, calc.min(4.2, 40 / t.rows.len())) * u
        #block(width: 100%, inset: (x: 1.2 * u, y: 1.4 * u), radius: 1.2 * u, stroke: 0.8pt + rule,
          grid(columns: (15 * u,) + (1fr,) * nd, row-gutter: gap, align: center + horizon,
            [], ..range(1, nd + 1).map(d => go(day-target(doy(m, d)), text(size: 1.1 * u, weight: "medium", fill: if off(date-of(doy(m, d)).weekday()) >= 5 { accent } else { soft }, str(d)))),
            ..t.rows.map(r => (align(left, text(size: 1.55 * u, weight: "medium", r)),) + range(nd).map(_ => circle(radius: 0.95 * u, stroke: 0.9pt + soft.transparentize(35%)))).flatten()))
        #v(2.4 * u)
        #grid(columns: (1fr, 1fr), column-gutter: 2 * u,
          panel("Wins in " + MONTHS.at(m - 1), writelines(7, gap: 3)),
          panel("Next month", writelines(7, gap: 3)))
      ])
    }
  } else if t.kind == "log" {
    sheet("tracker-" + str(i) + "-1", "t-" + str(i), 0, t.title, t.at("note", default: ""), [
      #if i == 0 and full [#metadata("trackers")#label("trackers")]
      #let cols = t.columns
      #table(columns: (1fr,) * cols.len(), stroke: 0.6pt + rule, inset: 1 * u, fill: (_, y) => if y == 0 { tint } else { none },
        ..cols.map(c => text(size: 1.4 * u, weight: "semibold", c)),
        ..range(t.rows * cols.len()).map(_ => box(height: 2.4 * u)))
    ])
  } else {
    // a year in pixels: one square a day, coloured by the key
    sheet("tracker-" + str(i) + "-1", "t-" + str(i), 0, t.title, str(Y), [
      #if i == 0 and full [#metadata("trackers")#label("trackers")]
      #grid(columns: (3 * u,) + (1fr,) * 12, row-gutter: 0.5 * u, column-gutter: 0.5 * u, align: center + horizon,
        [], ..MON3.map(x => text(size: 1.2 * u, weight: "semibold", fill: soft, x)),
        ..range(1, 32).map(d => (text(size: 1.05 * u, fill: soft, str(d)),) + range(1, 13).map(m => if d <= mdays.at(m - 1) { box(width: 100%, height: 1.85 * u, radius: 0.35 * u, stroke: 0.6pt + rule) } else { [] })).flatten())
      #v(2 * u)
      #t.rows.enumerate().map(((k, r)) => box[#box(width: 1.8 * u, height: 1.8 * u, radius: 0.35 * u, fill: accent.transparentize(calc.min(85%, k * 18%)), baseline: 0.3 * u) #h(0.5 * u) #text(size: 1.5 * u, r)]).join(h(2 * u))
    ])
  }
}

// The company's own pages: a title and prompts with room to write
#for (i, p) in spec.pages.enumerate() {
  sheet("page-" + str(i), "p-" + str(i), 0, p.title, p.at("note", default: ""), [
    #for q in p.prompts [
      #label-small(q)
      #writelines(calc.max(2, calc.floor(18 / p.prompts.len())), gap: 3.1)
      #v(1.6 * u)
    ]
  ])
}

// Notes
#for k in range(1, spec.notes.pages + 1) {
  sheet("notes-" + str(k), if k == 1 { "notes" } else { none }, 0, "Notes", str(k) + " / " + str(spec.notes.pages), {
    let s = spec.notes.style
    let h = H - 17 * u
    if s == "dot" {
      grid(columns: (1fr,) * 28, row-gutter: 0pt, ..range(28 * int(h / (3.05 * u))).map(_ => box(height: 3.05 * u, align(center + horizon, circle(radius: 0.18 * u, fill: rule)))))
    } else if s == "grid" {
      box(width: 100%, height: h, stroke: 0.4pt + rule, pattern(size: (3 * u, 3 * u), place(rect(width: 3 * u, height: 3 * u, stroke: 0.4pt + rule))))
    } else { writelines(int(h / (3.2 * u)), gap: 3.2) }
  })
}
