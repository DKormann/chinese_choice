import { createClient } from "../client"
import { array, type Infer } from "../schema"
import type { UUID } from "../sql"
import { stored } from "../store"
import { UserRow } from "../tables"
import { body, button, color, div, h1, input, p, span, style } from "./html"

const client = createClient()
const users = stored("users-dot-v1", array(UserRow), [])
type User = Infer<typeof UserRow>
type LessonState = { chain: UUID | null; options: UUID[]; known: UUID[] }
let lessonView = 0
let historyResize: ResizeObserver | null = null
let activeChoiceTrail: SVGSVGElement | null = null
let activeChoiceTrailResize: ResizeObserver | null = null

const ink = color.ink
const muted = color.muted
const surface = color.surface
const line = color.line
const accent = color.accent

Object.assign(body.style, { margin: "0", minHeight: "100vh", background: color.background })

const pageStyle = style({
  position: "fixed",
  inset: "0",
  overflow: "auto",
  boxSizing: "border-box",
  color: ink,
  background: "radial-gradient(circle at 50% 0, var(--surface) 0, var(--background) 46%)",
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
})

const brand = () => div("字间", style({ color: accent, fontSize: "1.35rem", fontWeight: "800", letterSpacing: ".12em" }))

function showError(error: unknown): void {
  const retry = button("Try again", style({ padding: ".8rem 1.2rem", background: accent, color: "#171810", border: "0", borderRadius: ".6rem" }))
  retry.onclick = renderProfiles
  body.replaceChildren(div(
    pageStyle,
    style({ display: "grid", placeContent: "center", justifyItems: "center", gap: "1rem", padding: "2rem", textAlign: "center" }),
    brand(),
    h1("Couldn’t load the lesson"),
    p(error instanceof Error ? error.message : String(error), style({ color: muted })),
    retry,
  ))
}

function renderProfiles(): void {
  lessonView++
  const grid = div(style({ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "2rem", marginTop: "4rem" }))

  users.get().forEach((user, index) => {
    const avatarColors = [accent, "#edac72", "#86b9b1", "#c49bc8", "#d9cb82"]
    const card = button(
      span(user.username.slice(0, 1).toUpperCase(), style({
        display: "grid", placeItems: "center", width: "9rem", aspectRatio: "1", borderRadius: "1rem",
        color: "#151610", background: avatarColors[index % avatarColors.length]!, fontSize: "3.4rem", fontWeight: "750",
      })),
      span(user.username, style({ display: "block", marginTop: ".9rem", color: muted })),
      style({ width: "9rem", padding: "0", border: "0", background: "none", cursor: "pointer" }),
      function onclick(){
        openLesson(user)
      }
    )

    grid.append(card)
  })

  const add = button(
    span("+", style({
      display: "grid", placeItems: "center", width: "9rem", aspectRatio: "1", border: "1px dashed #4c4d46",
      borderRadius: "1rem", color: muted, background: surface, fontSize: "3.4rem",
    })),
    span("New learner", style({ display: "block", marginTop: ".9rem", color: muted })),
    style({ width: "9rem", padding: "0", border: "0", background: "none", cursor: "pointer" }),
  )
  add.onclick = () => {
    const name = input({ placeholder: "Your name" }, style({
      width: "100%", padding: ".8rem .9rem", border: `1px solid ${line}`, borderRadius: ".6rem",
      outline: "0", color: ink, background: surface,
    }))
    const save = button("Continue", style({ padding: ".8rem", border: "0", borderRadius: ".6rem", background: accent, color: "#171810", fontWeight: "700" }))
    const create = async () => {
      const username = name.value.trim()
      if (!username) return name.focus()
      save.disabled = true
      try {
        const user = await client.funcs.newUser({ name: username })
        users.update(current => [...current, user])
        renderProfiles()
      } catch (error) { showError(error) }
    }
    name.addEventListener("keydown", event => { if (event.key === "Enter") void create() })
    save.onclick = () => void create()
    add.replaceWith(div(style({ display: "grid", alignContent: "center", gap: ".75rem", width: "12rem", minHeight: "9rem" }), name, save))
    name.focus()
  }
  grid.append(add)

  const explore = button("Explore sentence tree", style({
    marginTop: "2.5rem", padding: ".75rem 1rem", border: `1px solid ${line}`, borderRadius: "999px",
    color: muted, background: surface, cursor: "pointer",
  }))
  explore.onclick = () => { location.hash = "tree" }

  body.replaceChildren(div(
    pageStyle,
    style({ display: "grid", placeContent: "center", justifyItems: "center", padding: "3rem 1.5rem", textAlign: "center" }),
    brand(),
    h1("Who’s learning?", style({ margin: "3.5rem 0 .5rem", fontSize: "clamp(2.2rem, 5vw, 4.5rem)", letterSpacing: "-.05em" })),
    grid, explore,
  ))
}

async function renderTree(): Promise<void> {
  lessonView++
  body.replaceChildren(div(pageStyle, style({ display: "grid", placeContent: "center", color: muted }), "Loading sentence tree…"))
  try {
    const roots = await client.tables.Chain.where("prev", null)
    const symbolById = new Map<UUID, Awaited<ReturnType<typeof client.tables.Symbol.get>>>()
    const loadSymbols = async (chains: typeof roots) => {
      const ids = [...new Set(chains.map(chain => chain.symbolID))].filter(id => !symbolById.has(id))
      const symbols = await Promise.all(ids.map(id => client.tables.Symbol.get(id)))
      ids.forEach((id, index) => symbolById.set(id, symbols[index] ?? null))
    }
    await loadSymbols(roots)
    const children = new Map<UUID, Awaited<ReturnType<typeof client.tables.Chain.where>>>()
    const branch = (chain: typeof roots[number], prefix: string): HTMLElement => {
      const symbol = symbolById.get(chain.symbolID)
      const character = symbol?.mandarin_character ?? "?"
      const text = prefix + character
      const complete = character === "。"
      const marker = span(complete ? "✓" : "›", style({
        display: "grid", placeItems: "center", width: "1.6rem", height: "1.6rem", borderRadius: "999px",
        color: complete ? accent : muted, background: color.background, fontSize: complete ? ".7rem" : "1.2rem",
        transition: ".16s",
      }))
      const summary = button(
        marker,
        span(character, style({ fontFamily: "Songti SC, serif", color: ink, fontSize: "1.65rem" })),
        div(
          div(text, style({ color: ink, fontSize: ".95rem", fontWeight: "650" })),
          div(chain.pinyin || "Not annotated", style({ marginTop: ".12rem", color: muted, fontSize: ".72rem" })),
          style({ minWidth: "0", textAlign: "left" }),
        ),
        div(chain.meaning || (complete ? "Sentence complete" : "Expand this branch"), style({
          color: chain.meaning ? muted : accent, fontSize: ".76rem", textAlign: "right",
        })),
        style({
          display: "grid", gridTemplateColumns: "auto auto minmax(8rem, 1fr) minmax(10rem, 1.5fr)",
          alignItems: "center", gap: ".8rem", width: "100%", margin: "0", padding: ".65rem .8rem",
          border: `1px solid ${line}`, borderRadius: ".7rem", color: ink, background: surface,
          cursor: complete ? "default" : "pointer", transition: ".16s",
          ":hover": { borderColor: complete ? line : accent },
        }),
      )
      const descendants = div(style({
        display: "none", gap: ".4rem", margin: ".4rem 0 0 1.2rem", paddingLeft: "1rem",
        borderLeft: `1px solid ${line}`,
      }))
      let expanded = false
      let loaded = false
      summary.setAttribute("aria-expanded", "false")
      summary.onclick = async () => {
        if (complete) return
        expanded = !expanded
        summary.setAttribute("aria-expanded", String(expanded))
        marker.style.transform = expanded ? "rotate(90deg)" : ""
        descendants.style.display = expanded ? "grid" : "none"
        if (!expanded || loaded) return
        summary.disabled = true
        const oldMeaning = summary.lastElementChild?.textContent
        if (summary.lastElementChild) summary.lastElementChild.textContent = "Loading…"
        try {
          const rows = children.get(chain.id) ?? await client.tables.Chain.where("prev", chain.id)
          children.set(chain.id, rows)
          await loadSymbols(rows)
          loaded = true
          if (rows.length) descendants.append(...rows.map(child => branch(child, text)))
          else descendants.append(p("No continuations stored", style({ margin: ".3rem 0", color: muted, fontSize: ".78rem" })))
        } catch (error) {
          descendants.append(p(error instanceof Error ? error.message : String(error), style({ margin: ".3rem 0", color: color.red, fontSize: ".78rem" })))
        } finally {
          summary.disabled = false
          if (summary.lastElementChild) summary.lastElementChild.textContent = oldMeaning ?? ""
        }
      }
      return div(summary, descendants)
    }
    const rows = div(
      roots.map(root => branch(root, "")),
      style({ display: "grid", gap: ".55rem", paddingBottom: "4rem" }),
    )

    const back = button("← Learners", style({ padding: ".65rem 1rem", border: `1px solid ${line}`, borderRadius: "999px", color: muted, background: surface }))
    back.onclick = () => { location.hash = "" }
    body.replaceChildren(div(
      pageStyle,
      div(style({ width: "min(1100px, calc(100% - 3rem))", margin: "auto", padding: "2rem 0" }),
        div(style({ display: "flex", alignItems: "center", justifyContent: "space-between" }), brand(), back),
        h1("Sentence tree", style({ margin: "3rem 0 .5rem" })),
        p(`${roots.length} roots · expand a branch to explore`, style({ margin: "0 0 2rem", color: muted })),
        rows,
      ),
    ))
  } catch (error) { showError(error) }
}

async function readChain(id: UUID) {
  const chain = []
  let current: UUID | null = id
  while (current) {
    const row = await client.tables.Chain.get(current)
    if (!row) throw new Error(`Missing chain row ${current}`)
    chain.unshift(row)
    current = row.prev
  }
  return chain
}

async function isComplete(id: UUID): Promise<boolean> {
  const current = await client.tables.Chain.get(id)
  if (!current) throw new Error(`Missing chain row ${id}`)
  const symbol = await client.tables.Symbol.get(current.symbolID)
  if (symbol?.mandarin_character === "。") return true
  const children = await client.tables.Chain.where("prev", id)
  const childSymbols = await Promise.all(children.map(child => client.tables.Symbol.get(child.symbolID)))
  return childSymbols.some(child => child?.mandarin_character === "。")
}

function character(value: string, pinyin: string, meaning: string, baseColor = ink, tooltipBelow = false): HTMLElement {
  const tip = span(
    span(pinyin || "Annotating…", style({ display: "block", color: ink, fontWeight: "700" })),
    span(meaning || "Translation is being prepared", style({ display: "block", marginTop: ".25rem", color: muted })),
    style({
      position: "absolute", left: "50%", ...(tooltipBelow ? { top: "calc(100% + 1rem)" } : { bottom: "calc(100% + 1rem)" }),
      zIndex: "2", minWidth: "8rem",
      padding: ".75rem 1rem", border: `1px solid ${line}`, borderRadius: ".7rem", background: surface,
      boxShadow: "0 12px 35px #0008", fontFamily: "Inter, sans-serif", fontSize: ".75rem", lineHeight: "1.25",
      opacity: "0", pointerEvents: "none", transform: `translate(-50%, ${tooltipBelow ? "-.4rem" : ".4rem"})`, transition: ".16s ease",
    }),
  )
  const el = span(value, tip, style({ position: "relative", padding: "0 .04em", color: baseColor, cursor: "help", borderRadius: ".1em", transition: ".18s" }))
  el.tabIndex = 0
  const show = () => { tip.style.opacity = "1"; tip.style.transform = "translate(-50%, 0)"; el.style.color = accent }
  const hide = () => {
    tip.style.opacity = "0"
    tip.style.transform = `translate(-50%, ${tooltipBelow ? "-.4rem" : ".4rem"})`
    el.style.color = baseColor
  }
  el.addEventListener("mouseenter", show); el.addEventListener("focus", show)
  el.addEventListener("mouseleave", hide); el.addEventListener("blur", hide)
  return el
}

async function lessonContext(chainID: UUID | null) {
  if (!chainID) return { chainID, current: null, complete: false, ended: false, symbols: [] }
  const chain = await readChain(chainID)
  const current = chain.at(-1)
  if (!current) throw new Error("Backend returned an empty chain")
  const [complete, symbols] = await Promise.all([
    isComplete(chainID),
    Promise.all(chain.map(item => client.tables.Symbol.get(item.symbolID))),
  ])
  if (symbols.some(symbol => !symbol)) throw new Error("Chain contains a missing symbol")
  const resolved = symbols.map(symbol => symbol!)
  return { chainID, current, complete, ended: resolved.at(-1)?.mandarin_character === "。", symbols: resolved }
}

function sentenceHelper(user: User, chain: UUID): HTMLElement {
  const conversation = div(style({ display: "grid", gap: ".7rem", textAlign: "left", fontSize: "1.05rem", lineHeight: "1.45" }))
  const panel = div(style({
    position: "fixed", right: "1rem", bottom: "1rem", zIndex: "3", width: "min(26rem, calc(100vw - 2rem))",
    padding: "1rem", border: `1px solid ${line}`, borderRadius: ".85rem", background: surface,
    boxShadow: "0 16px 45px #0004", display: "none",
  }))
  const toggle = button("Ask about this sentence", style({
    position: "fixed", right: "0", top: "50%", zIndex: "3", padding: ".75rem .8rem", border: `1px solid ${line}`,
    borderRight: "0", borderRadius: ".7rem 0 0 .7rem", color: ink, background: surface,
    fontSize: ".8rem", fontWeight: "700", cursor: "pointer", transform: "translateY(-50%)",
  }))
  const close = button("Close", style({
    padding: ".35rem .55rem", border: `1px solid ${line}`, borderRadius: ".45rem", color: muted, background: surface,
    fontSize: ".72rem", cursor: "pointer",
  }))
  const question = input({ placeholder: "Ask about this sentence…" }, style({
    minWidth: "0", padding: ".75rem .85rem", border: `1px solid ${line}`, borderRadius: ".6rem",
    outline: "0", color: ink, background: surface, fontSize: "1rem",
  }))
  const send = button("Ask", style({
    padding: ".7rem .9rem", border: "0", borderRadius: ".6rem", color: "#171810", background: accent,
    fontWeight: "700", cursor: "pointer", fontSize: ".9rem",
  }))
  send.disabled = true
  const syncSend = () => { send.disabled = !question.value.trim() }
  question.addEventListener("input", syncSend)
  const ask = async () => {
    const value = question.value.trim()
    if (!value || question.disabled) return
    question.value = ""
    syncSend()
    question.disabled = true
    send.disabled = true
    conversation.append(p(value, style({ margin: "0", color: muted })))
    const reply = p("Thinking…", style({ margin: "0", color: muted }))
    conversation.append(reply)
    try {
      const result = await client.funcs.askSentence({ user: user.id, chain, question: value })
      reply.textContent = result.answer
      reply.style.color = ink
    } catch (error) {
      reply.textContent = error instanceof Error ? error.message : String(error)
      reply.style.color = color.red
    } finally {
      question.disabled = false
      syncSend()
      question.focus()
    }
  }
  send.onclick = () => void ask()
  question.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); void ask() }
  })
  const hide = () => { panel.style.display = "none"; toggle.style.display = "block" }
  toggle.onclick = () => { panel.style.display = "block"; toggle.style.display = "none"; question.focus() }
  close.onclick = hide
  panel.append(
    div(
      p("Sentence helper", style({ margin: "0", color: accent, fontSize: ".72rem", fontWeight: "750", letterSpacing: ".12em", textTransform: "uppercase" })),
      close,
      style({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }),
    ),
    p("Ask about the Chinese currently shown. It won’t reveal what comes next.", style({ margin: ".35rem 0 .8rem", color: muted, fontSize: ".82rem" })),
    conversation,
    div(question, send, style({ display: "grid", gridTemplateColumns: "1fr auto", gap: ".5rem", marginTop: ".85rem" })),
  )
  return div(toggle, panel)
}

function readAloud(user: User, chain: UUID): HTMLElement {
  const control = button("Read aloud", style({
    padding: ".5rem .75rem", border: `1px solid ${line}`, borderRadius: "999px", color: muted, background: surface,
    fontSize: ".75rem", cursor: "pointer",
  }))
  control.onclick = async () => {
    control.textContent = "Loading audio…"
    control.disabled = true
    try {
      const { audio } = await client.funcs.speakSentence({ user: user.id, chain })
      const binary = atob(audio)
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }))
      const player = new Audio(url)
      player.onended = player.onerror = () => { URL.revokeObjectURL(url); control.textContent = "Read aloud"; control.disabled = false }
      await player.play()
      control.textContent = "Reading…"
    } catch (error) {
      control.textContent = error instanceof Error ? error.message : String(error)
      control.style.color = color.red
      control.disabled = false
    }
  }
  return control
}

async function choiceHistory(user: User, currentChain: UUID | null): Promise<HTMLElement> {
  historyResize?.disconnect()
  historyResize = null
  const [{ steps: storedSteps }, path] = await Promise.all([
    client.funcs.lessonHistory({ user: user.id }),
    currentChain ? readChain(currentChain) : Promise.resolve([]),
  ])
  const currentPath = new Set<UUID | null>([null, ...path.slice(0, -1).map(chain => chain.id)])
  const steps = storedSteps.filter(step => currentPath.has(step.chain))
  if (!steps.length) return div()
  const ids = [...new Set(steps.flatMap(step => step.options.map(option => option.symbol)))]
  const symbols = await Promise.all(ids.map(id => client.tables.Symbol.get(id)))
  const symbolById = new Map(ids.map((id, index) => [id, symbols[index]]))
  const rows = div(style({ position: "relative", isolation: "isolate", display: "grid", gap: "2rem", minWidth: "27rem" }))
  const taken: { card: HTMLElement; position: number }[] = []

  steps.forEach((step, index) => {
    const options = div(style({
      position: "relative", display: "grid", gridTemplateColumns: "repeat(5, 4rem)",
      justifyContent: "center", gap: "1.5rem",
    }))
    step.options.forEach((option, position) => {
      const symbol = symbolById.get(option.symbol)
      const correct = option.outcome === "correct"
      const textColor = correct ? color.green : muted
      const card = div(
        span(
          character(symbol?.mandarin_character ?? "?", symbol?.pinyin ?? "", symbol?.meaning ?? "", textColor, index === 0),
          style({ fontFamily: "Songti SC, serif", fontSize: "1.55rem", color: textColor }),
        ),
        span(symbol?.pinyin ?? "…", style({ color: textColor, fontSize: ".68rem" })),
        style({
          position: "relative", display: "grid", placeItems: "center", gap: "0", minHeight: "3rem", padding: "0",
          border: option.taken ? `2px solid ${color.green}` : "2px solid transparent",
          borderRadius: ".65rem",
          background: option.taken ? "color-mix(in srgb, var(--green) 18%, var(--surface))" : "transparent",
          boxShadow: option.taken ? "0 0 0 2px color-mix(in srgb, var(--green) 16%, transparent)" : "none",
        }),
      )
      if (option.taken) {
        card.setAttribute("data-history-taken", "")
        taken.push({ card, position })
      }
      options.append(card)
    })
    rows.append(options)
  })

  if (taken.length) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
    Object.assign(svg.style, { position: "absolute", inset: "0", zIndex: "-1", width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" })
    path.setAttribute("fill", "none")
    path.setAttribute("stroke", color.green)
    path.setAttribute("stroke-width", "4")
    path.setAttribute("stroke-linecap", "round")
    path.setAttribute("opacity", ".45")
    svg.append(path)
    const edgeCurls = taken.filter(item => item.position === 0 || item.position === 4).map(item => {
      const curl = document.createElementNS("http://www.w3.org/2000/svg", "path")
      curl.setAttribute("fill", "none")
      curl.setAttribute("stroke", color.green)
      curl.setAttribute("stroke-width", "3.5")
      curl.setAttribute("stroke-linecap", "round")
      curl.setAttribute("opacity", ".55")
      svg.append(curl)
      return { ...item, curl }
    })
    rows.prepend(svg)
    const drawTrail = () => {
      const bounds = rows.getBoundingClientRect()
      const points = taken.map(({ card }) => {
        const cardBounds = card.getBoundingClientRect()
        return {
          x: cardBounds.left - bounds.left + cardBounds.width / 2,
          top: cardBounds.top - bounds.top,
          bottom: cardBounds.bottom - bounds.top,
        }
      })
      const route = points.slice(1).map((lower, index) => {
        const upper = points[index]!
        const middle = (upper.bottom + lower.top) / 2
        return `M ${upper.x} ${upper.bottom} C ${upper.x} ${middle}, ${lower.x} ${middle}, ${lower.x} ${lower.top}`
      }).join(" ")
      svg.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`)
      path.setAttribute("d", route)
      edgeCurls.forEach(({ card, position, curl }) => {
        const cardBounds = card.getBoundingClientRect()
        const direction = position === 0 ? -1 : 1
        const x = (direction < 0 ? cardBounds.left : cardBounds.right) - bounds.left
        const y = cardBounds.top - bounds.top + cardBounds.height / 2
        curl.setAttribute(
          "d",
          `M ${x} ${y} C ${x + direction * 10} ${y}, ${x + direction * 18} ${y - 6}, ${x + direction * 18} ${y - 14} C ${x + direction * 18} ${y - 24}, ${x + direction * 4} ${y - 24}, ${x + direction * 4} ${y - 14} C ${x + direction * 4} ${y - 7}, ${x + direction * 12} ${y - 7}, ${x + direction * 12} ${y - 13}`,
        )
      })
    }
    requestAnimationFrame(drawTrail)
    historyResize = new ResizeObserver(drawTrail)
    historyResize.observe(rows)
  }

  return div(
    div(
      p("Past choices", style({ margin: "0", color: ink, fontSize: ".85rem", fontWeight: "750" })),
      style({ marginBottom: ".75rem" }),
    ),
    div(rows, style({ overflowX: "auto", padding: ".15rem 0 .5rem" })),
    style({
      width: "100%", marginTop: "2.25rem", textAlign: "left",
    }),
  )
}

function hideChoiceTrail(): void {
  activeChoiceTrailResize?.disconnect()
  activeChoiceTrail?.remove()
  activeChoiceTrail = null
  activeChoiceTrailResize = null
}

function showChoiceTrail(history: HTMLElement, choice: HTMLElement): void {
  hideChoiceTrail()
  const taken = history.querySelector<HTMLElement>("[data-history-taken]")
  const flow = choice.closest<HTMLElement>("[data-lesson-flow]")
  if (!taken || !flow) return
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
  Object.assign(svg.style, {
    position: "absolute", inset: "0", zIndex: "2", width: "100%", height: "100%",
    overflow: "visible", pointerEvents: "none",
  })
  path.setAttribute("fill", "none")
  path.setAttribute("stroke", color.green)
  path.setAttribute("stroke-width", "4")
  path.setAttribute("stroke-linecap", "round")
  path.setAttribute("opacity", ".45")
  svg.append(path)
  flow.append(svg)
  activeChoiceTrail = svg
  const draw = () => {
    const bounds = flow.getBoundingClientRect()
    const lower = taken.getBoundingClientRect()
    const upper = choice.getBoundingClientRect()
    const start = { x: lower.left - bounds.left + lower.width / 2, y: lower.top - bounds.top }
    const end = { x: upper.left - bounds.left + upper.width / 2, y: upper.bottom - bounds.top }
    const middle = (start.y + end.y) / 2
    path.setAttribute("d", `M ${start.x} ${start.y} C ${start.x} ${middle}, ${end.x} ${middle}, ${end.x} ${end.y}`)
  }
  draw()
  activeChoiceTrailResize = new ResizeObserver(draw)
  activeChoiceTrailResize.observe(flow)
}

function showLesson(
  user: User,
  context: Awaited<ReturnType<typeof lessonContext>>,
  choices: HTMLElement,
  status: HTMLElement,
  history: HTMLElement,
): void {
  const flow = div(choices, status, history, style({ position: "relative" }))
  flow.setAttribute("data-lesson-flow", "")
  const sentence = div(style({
    display: "flex", justifyContent: "center", margin: "2.2rem 0 4.8rem", color: ink,
    fontFamily: "Songti SC, Noto Serif CJK SC, serif", fontSize: "clamp(4.5rem, 12vw, 9rem)", lineHeight: "1.05",
  }))
  context.symbols.forEach(symbol => sentence.append(character(symbol.mandarin_character, symbol.pinyin, symbol.meaning)))
  const account = button(user.username, style({ padding: ".65rem 1rem", border: `1px solid ${line}`, borderRadius: "999px", color: muted, background: surface }))
  account.onclick = renderProfiles
  body.replaceChildren(div(
    pageStyle,
    div(style({ display: "flex", alignItems: "center", justifyContent: "space-between", width: "min(1120px, calc(100% - 3rem))", margin: "auto", padding: "2rem 0" }), brand(), account),
    div(
      style({ width: "min(1050px, calc(100% - 3rem))", margin: "7vh auto 0", textAlign: "center" }),
      p(context.ended ? "Sentence complete" : context.current ? "Continue the sentence" : "Begin a sentence", style({ margin: "0 0 2.8rem", color: accent, fontSize: ".75rem", fontWeight: "750", letterSpacing: ".18em", textTransform: "uppercase" })),
      p(context.ended ? "Review before continuing" : context.complete ? "Complete sentence" : context.current ? "Incomplete prefix" : "Choose the first character", style({ margin: "0 0 .7rem", color: muted, fontSize: ".72rem", letterSpacing: ".1em", textTransform: "uppercase" })),
      ...(context.current ? [
        p(context.current.meaning || "Translation is being prepared…", style({ margin: "0", color: ink, fontSize: "clamp(1rem, 2vw, 1.35rem)" })),
        div(
          p(context.current.pinyin || "Pinyin is being prepared…", style({ margin: "0", color: muted, fontSize: ".9rem", letterSpacing: ".08em" })),
          readAloud(user, context.chainID!),
          style({ display: "flex", alignItems: "center", justifyContent: "center", gap: ".75rem", marginTop: ".55rem" }),
        ),
      ] : []),
      sentence, flow,
    ),
    ...(context.chainID ? [sentenceHelper(user, context.chainID)] : []),
  ))
}

async function renderLesson(user: User, state: LessonState): Promise<void> {
  const view = ++lessonView
  if (state.options.length !== 5) throw new Error(`Backend returned ${state.options.length} choices; expected 5`)
  if (!Array.isArray(state.known)) throw new Error("Backend returned an outdated lesson state; restart the server and reload this page")
  const [context, choices, history] = await Promise.all([
    lessonContext(state.chain),
    Promise.all(state.options.map(id => client.tables.Symbol.get(id))),
    choiceHistory(user, state.chain),
  ])
  if (choices.some(choice => !choice)) throw new Error("Backend returned a missing symbol")

  const status = p("Choose what comes next", style({ minHeight: "1.5rem", margin: "1.5rem 0", color: muted, fontSize: ".85rem" }))
  const choicesRow = div(style({
    display: "grid", gridTemplateColumns: "repeat(5, minmax(90px, 1fr))", gap: ".8rem",
    padding: ".25rem 1px 1px", overflowX: "auto",
  }))
  choices.forEach((choice, index) => {
    const symbol = choice!
    const known = state.known.includes(symbol.id)
    const meaning = span(symbol.meaning || "…", style({ color: muted, fontSize: ".72rem", lineHeight: "1.25", textAlign: "center" }))
    const choiceButton = button(
      span(String(index + 1), style({ position: "absolute", top: ".65rem", left: ".75rem", color: "#686a61", fontSize: ".7rem" })),
      span(symbol.mandarin_character, style({ fontFamily: "Songti SC, serif", fontSize: "3rem" })),
      span(symbol.pinyin || "…", style({ color: muted, fontSize: ".78rem" })),
      ...(known ? [] : [meaning]),
      style({
        position: "relative", display: "grid", placeItems: "center", minHeight: "9rem", padding: "1rem",
        margin: "0", border: `1px solid ${line}`, borderRadius: "1rem", color: ink, background: surface,
        cursor: "pointer", transition: ".18s",
        ":enabled:hover": { borderColor: accent, transform: "translateY(-3px)" },
      }),
    )
    choiceButton.addEventListener("mouseenter", () => showChoiceTrail(history, choiceButton))
    choiceButton.addEventListener("mouseleave", hideChoiceTrail)
    choiceButton.onclick = async () => {
      hideChoiceTrail()
      lessonView++
      for (const candidate of choicesRow.querySelectorAll("button")) candidate.disabled = true
      status.textContent = "Checking… generating the next challenge may take a moment."
      try {
        const result = await client.funcs.tryOption({ user: user.id, option: symbol.id })
        if (result.outcome !== "correct") {
          const possible = result.outcome === "possible"
          if (!possible && known) choiceButton.append(meaning)
          choiceButton.style.borderColor = possible ? accent : color.red
          choiceButton.style.background = possible ? color.accentSoft : color.dangerSoft
          status.textContent = possible
            ? "Technically possible, but not the intended continuation. Keep looking."
            : "Not this one — have another look."
          for (const candidate of choicesRow.querySelectorAll("button")) candidate.disabled = false
          return
        }
        choiceButton.style.borderColor = accent
        choiceButton.style.background = color.accentSoft
        status.textContent = "Correct. Loading choices…"
        await renderLoadingOptions(user, result.nextChain)
      } catch (error) { showError(error) }
    }
    choicesRow.append(choiceButton)
  })

  showLesson(user, context, choicesRow, status, history)
  const annotationsPending = Boolean(context.current && (!context.current.pinyin || !context.current.meaning))
    || choices.some(choice => !choice!.pinyin || !choice!.meaning)
  if (annotationsPending) setTimeout(() => {
    if (lessonView === view) void renderLesson(user, state).catch(showError)
  }, 1500)
}

async function renderLoadingOptions(user: User, chainID: UUID): Promise<void> {
  const view = ++lessonView
  const [context, history] = await Promise.all([lessonContext(chainID), choiceHistory(user, chainID)])
  if (context.ended) {
    const next = button("Next sentence", style({
      padding: ".9rem 1.4rem", border: "0", borderRadius: ".7rem",
      color: "#171810", background: accent, fontWeight: "750", cursor: "pointer",
    }))
    const status = p("Sentence complete", style({ margin: "1.5rem 0", color: accent, fontSize: ".85rem" }))
    next.onclick = async () => {
      next.disabled = true
      status.textContent = "Loading the next sentence…"
      try {
        const state = await client.funcs.requestState({ user: user.id })
        if (lessonView === view) await renderLesson(user, state)
      } catch (error) { showError(error) }
    }
    showLesson(user, context, next, status, history)
    return
  }
  const placeholders = div(style({ display: "grid", gridTemplateColumns: "repeat(5, minmax(90px, 1fr))", gap: ".8rem", overflowX: "auto" }))
  for (let index = 0; index < 5; index++) placeholders.append(div(
    "…",
    style({ display: "grid", placeItems: "center", minHeight: "9rem", border: `1px solid ${line}`, borderRadius: "1rem", color: muted, background: surface, fontSize: "2rem" }),
  ))
  showLesson(
    user,
    context,
    placeholders,
    p("Generating the next choices…", style({ margin: "1.5rem 0", color: muted, fontSize: ".85rem" })),
    history,
  )

  const next = await client.funcs.requestState({ user: user.id })
  if (lessonView === view) await renderLesson(user, next)
}

async function openLesson(user: User): Promise<void> {
  body.replaceChildren(div(pageStyle, style({ display: "grid", placeContent: "center", color: muted }), "Loading your lesson…"))
  try { await renderLesson(user, await client.funcs.requestState({ user: user.id })) }
  catch (error) { showError(error) }
}

function renderRoute(): void {
  if (location.hash === "#tree") void renderTree()
  else renderProfiles()
}

window.addEventListener("hashchange", renderRoute)
renderRoute()
