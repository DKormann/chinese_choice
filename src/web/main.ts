import { createClient } from "../client"
import { array, type Infer } from "../schema"
import type { UUID } from "../sql"
import { stored } from "../store"
import { UserRow } from "../tables"
import { body, button, color, div, h1, input, p, span, style } from "./html"

const client = createClient()
const users = stored("users", array(UserRow), [])
type User = Infer<typeof UserRow>
type LessonState = { chain: UUID; options: UUID[] }
let lessonView = 0

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
    const [chains, symbols] = await Promise.all([client.tables.Chain.all(), client.tables.Symbol.all()])
    const symbolById = new Map(symbols.map(symbol => [symbol.id, symbol]))
    const children = new Map<UUID | null, typeof chains>()
    for (const chain of chains) {
      const siblings = children.get(chain.prev) ?? []
      siblings.push(chain)
      children.set(chain.prev, siblings)
    }
    const rows = div(style({ display: "grid", gap: ".4rem", paddingBottom: "4rem" }))
    const visited = new Set<UUID>()
    const append = (parent: UUID | null, prefix: string, depth: number) => {
      for (const chain of children.get(parent) ?? []) {
        if (visited.has(chain.id)) continue
        visited.add(chain.id)
        const symbol = symbolById.get(chain.symbolID)
        const text = prefix + (symbol?.mandarin_character ?? "?")
        rows.append(div(
          div(text, style({ fontFamily: "Songti SC, serif", fontSize: "1.35rem", color: ink })),
          div(chain.meaning || "Not annotated", style({ color: chain.meaning ? muted : accent, fontSize: ".78rem" })),
          div(`${(children.get(chain.id) ?? []).length} branches`, style({ color: muted, fontSize: ".7rem" })),
          style({
            display: "grid", gridTemplateColumns: "minmax(8rem, 1fr) minmax(12rem, 2fr) auto", gap: "1rem",
            alignItems: "center", marginLeft: `${Math.min(depth, 12) * 1.25}rem`, padding: ".65rem .8rem",
            border: `1px solid ${line}`, borderRadius: ".65rem", background: surface,
          }),
        ))
        append(chain.id, text, depth + 1)
      }
    }
    append(null, "", 0)

    const back = button("← Learners", style({ padding: ".65rem 1rem", border: `1px solid ${line}`, borderRadius: "999px", color: muted, background: surface }))
    back.onclick = () => { location.hash = "" }
    body.replaceChildren(div(
      pageStyle,
      div(style({ width: "min(1100px, calc(100% - 3rem))", margin: "auto", padding: "2rem 0" }),
        div(style({ display: "flex", alignItems: "center", justifyContent: "space-between" }), brand(), back),
        h1("Sentence tree", style({ margin: "3rem 0 .5rem" })),
        p(`${chains.length} chain nodes · ${symbols.length} characters`, style({ margin: "0 0 2rem", color: muted })),
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

function character(value: string, pinyin: string, meaning: string): HTMLElement {
  const tip = span(
    span(pinyin || "Annotating…", style({ display: "block", color: ink, fontWeight: "700" })),
    span(meaning || "Translation is being prepared", style({ display: "block", marginTop: ".25rem", color: muted })),
    style({
      position: "absolute", left: "50%", bottom: "calc(100% + 1rem)", zIndex: "2", minWidth: "8rem",
      padding: ".75rem 1rem", border: `1px solid ${line}`, borderRadius: ".7rem", background: surface,
      boxShadow: "0 12px 35px #0008", fontFamily: "Inter, sans-serif", fontSize: ".75rem", lineHeight: "1.25",
      opacity: "0", pointerEvents: "none", transform: "translate(-50%, .4rem)", transition: ".16s ease",
    }),
  )
  const el = span(value, tip, style({ position: "relative", padding: "0 .04em", cursor: "help", borderRadius: ".1em", transition: ".18s" }))
  el.tabIndex = 0
  const show = () => { tip.style.opacity = "1"; tip.style.transform = "translate(-50%, 0)"; el.style.color = accent }
  const hide = () => { tip.style.opacity = "0"; tip.style.transform = "translate(-50%, .4rem)"; el.style.color = ink }
  el.addEventListener("mouseenter", show); el.addEventListener("focus", show)
  el.addEventListener("mouseleave", hide); el.addEventListener("blur", hide)
  return el
}

async function renderLesson(user: User, state: LessonState): Promise<void> {
  const view = ++lessonView
  if (state.options.length !== 5) throw new Error(`Backend returned ${state.options.length} choices; expected 5`)
  const [chain, choices] = await Promise.all([readChain(state.chain), Promise.all(state.options.map(id => client.tables.Symbol.get(id)))])
  if (choices.some(choice => !choice)) throw new Error("Backend returned a missing symbol")
  const currentChain = chain.at(-1)
  if (!currentChain) throw new Error("Backend returned an empty chain")

  const sentence = div(style({
    display: "flex", justifyContent: "center", margin: "2.2rem 0 4.8rem", color: ink,
    fontFamily: "Songti SC, Noto Serif CJK SC, serif", fontSize: "clamp(4.5rem, 12vw, 9rem)", lineHeight: "1.05",
  }))
  for (const item of chain) {
    const symbol = await client.tables.Symbol.get(item.symbolID)
    if (!symbol) throw new Error(`Missing symbol ${item.symbolID}`)
    sentence.append(character(symbol.mandarin_character, symbol.pinyin, symbol.meaning))
  }

  const status = p("Choose what comes next", style({ minHeight: "1.5rem", margin: "1.5rem 0", color: muted, fontSize: ".85rem" }))
  const choicesRow = div(style({
    display: "grid", gridTemplateColumns: "repeat(5, minmax(90px, 1fr))", gap: ".8rem",
    padding: ".25rem 1px 1px", overflowX: "auto",
  }))
  choices.forEach((choice, index) => {
    const symbol = choice!
    const choiceButton = button(
      span(String(index + 1), style({ position: "absolute", top: ".65rem", left: ".75rem", color: "#686a61", fontSize: ".7rem" })),
      span(symbol.mandarin_character, style({ fontFamily: "Songti SC, serif", fontSize: "3rem" })),
      span(symbol.pinyin || "…", style({ color: muted, fontSize: ".78rem" })),
      style({
        position: "relative", display: "grid", placeItems: "center", minHeight: "9rem", padding: "1rem",
        margin: "0", border: `1px solid ${line}`, borderRadius: "1rem", color: ink, background: surface,
        cursor: "pointer", transition: ".18s",
        ":enabled:hover": { borderColor: accent, transform: "translateY(-3px)" },
      }),
    )
    choiceButton.onclick = async () => {
      lessonView++
      for (const candidate of choicesRow.querySelectorAll("button")) candidate.disabled = true
      status.textContent = "Checking… generating the next challenge may take a moment."
      try {
        const result = await client.funcs.tryOption({ user: user.id, option: symbol.id })
        if (!result.correct) {
          const possible = result.outcome === "possible"
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
        status.textContent = "Nice. Keep going."
        await new Promise(resolve => setTimeout(resolve, 420))
        await renderLesson(user, { chain: result.next_chain, options: result.next_options })
      } catch (error) { showError(error) }
    }
    choicesRow.append(choiceButton)
  })

  const account = button(user.username, style({ padding: ".65rem 1rem", border: `1px solid ${line}`, borderRadius: "999px", color: muted, background: surface }))
  account.onclick = renderProfiles
  body.replaceChildren(div(
    pageStyle,
    div(style({ display: "flex", alignItems: "center", justifyContent: "space-between", width: "min(1120px, calc(100% - 3rem))", margin: "auto", padding: "2rem 0" }), brand(), account),
    div(
      style({ width: "min(1050px, calc(100% - 3rem))", margin: "7vh auto 0", textAlign: "center" }),
      p("Continue the sentence", style({ margin: "0 0 2.8rem", color: accent, fontSize: ".75rem", fontWeight: "750", letterSpacing: ".18em", textTransform: "uppercase" })),
      p(currentChain.completion === "complete" ? "Complete sentence" : currentChain.completion === "incomplete" ? "Incomplete prefix" : "Checking completeness…", style({ margin: "0 0 .7rem", color: muted, fontSize: ".72rem", letterSpacing: ".1em", textTransform: "uppercase" })),
      p(currentChain.meaning || "Translation is being prepared…", style({ margin: "0", color: ink, fontSize: "clamp(1rem, 2vw, 1.35rem)" })),
      p(currentChain.pinyin || "Pinyin is being prepared…", style({ margin: ".55rem 0 0", color: muted, fontSize: ".9rem", letterSpacing: ".08em" })),
      sentence, choicesRow, status,
    ),
  ))
  const annotationsPending = !currentChain.pinyin || !currentChain.meaning || choices.some(choice => !choice!.pinyin || !choice!.meaning)
  if (annotationsPending) setTimeout(() => {
    if (lessonView === view) void renderLesson(user, state).catch(showError)
  }, 1500)
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
