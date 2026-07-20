export const body = document.body;

const colorPalette = {
  light:{
    color:             "#24251f",
    background:        "#f5f3ec",
    muted:             "#74766d",
    surface:           "#ffffff",
    line:              "#d8d9d1",
    accent:            "#627d22",
    accentSoft:        "#627d2218",
    dangerSoft:        "#c84f4014",
    red:               "rgb(242, 55, 55)",
    green:             "rgb(57, 214, 39)",
    blue:              "rgb(5, 28, 141)",
    gray:              "#888",
    lightgray:         "#e5e5e5",
  },
  dark:{
    color:             "#f4f2eb",
    background:        "#11120f",
    muted:             "#9d9b94",
    surface:           "#1c1d1a",
    line:              "#34352f",
    accent:            "#c5e478",
    accentSoft:        "#c5e47816",
    dangerSoft:        "#e5837612",
    red:               "rgb(198, 20, 0)",
    blue:              "rgb(95, 100, 255)",
    green:             "rgb(0, 185, 19)",
    gray:              "#565656",
    lightgray:         "#414141",
  }
}

export const color = {
  color: "var(--color)",
  ink: "var(--color)",
  background: "var(--background)",
  muted: "var(--muted)",
  surface: "var(--surface)",
  line: "var(--line)",
  accent: "var(--accent)",
  accentSoft: "var(--accent-soft)",
  dangerSoft: "var(--danger-soft)",
  blue: "var(--blue)",
  red: "var(--red)",
  green: "var(--green)",
  gray: "var(--gray)",
  lightgray: "var(--lightgray)"
}


let styl = document.createElement("style")
styl.innerHTML = `
:root {
  --color: ${colorPalette.dark.color};
  --background: ${colorPalette.dark.background};
  --muted: ${colorPalette.dark.muted};
  --surface: ${colorPalette.dark.surface};
  --line: ${colorPalette.dark.line};
  --accent: ${colorPalette.dark.accent};
  --accent-soft: ${colorPalette.dark.accentSoft};
  --danger-soft: ${colorPalette.dark.dangerSoft};
  --red: ${colorPalette.dark.red};
  --green: ${colorPalette.dark.green};
  --blue: ${colorPalette.dark.blue};
  --gray: ${colorPalette.dark.gray};
  --lightgray: ${colorPalette.dark.lightgray};
  color: var(--color);
  background: var(--background);
  font-family: sans-serif;
}
@media (prefers-color-scheme: light) {
  :root {
    --color: ${colorPalette.light.color};
    --background: ${colorPalette.light.background};
    --muted: ${colorPalette.light.muted};
    --surface: ${colorPalette.light.surface};
    --line: ${colorPalette.light.line};
    --accent: ${colorPalette.light.accent};
    --accent-soft: ${colorPalette.light.accentSoft};
    --danger-soft: ${colorPalette.light.dangerSoft};
    --red: ${colorPalette.light.red};
    --green: ${colorPalette.light.green};
    --blue: ${colorPalette.light.blue};
    --gray: ${colorPalette.light.gray};
    --lightgray: ${colorPalette.light.lightgray};
  }
}
`
document.head.appendChild(styl)

type StyleRules = { [property: string]: string | StyleRules }
type htmlKey = 'innerText'|'onclick' | 'oninput' | 'onkeydown'|'children'|'id'|'contentEditable'|'eventListeners'|'style'|'placeholder'|'tabIndex'|'type'

let styleID = 0
const cssName = (name: string) => name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)
const applyStyle = (element: HTMLElement, rules: StyleRules) => {
  const nested = Object.entries(rules).filter(([, value]) => typeof value !== "string") as [string, StyleRules][]
  for (const [property, value] of Object.entries(rules)) {
    if (typeof value === "string") element.style.setProperty(cssName(property), value)
  }
  if (!nested.length) return

  const className = `html-style-${styleID++}`
  element.classList.add(className)
  for (const [selector, declarations] of nested) {
    const body = Object.entries(declarations).map(([property, value]) => {
      if (typeof value !== "string") throw new Error("Style selectors cannot be nested more than once")
      return `${cssName(property)}:${value}`
    }).join(";")
    styl.sheet?.insertRule(`.${className}${selector}{${body}}`)
  }
}

const htmlElement = (tag:string, text:string, args?:Partial<Record<htmlKey, any>>):HTMLElement =>{

  const _element = document.createElement(tag)
  _element.textContent = text
  let st = _element.style
  if (tag == "button"){
    _element.innerText = text
    st.color = color.color
    st.backgroundColor = color.lightgray
    st.border = "1px solid "+color.gray
    st.borderRadius = ".2em"
    st.padding = ".1em .4em"
    st.margin = ".2em"
  }
  if (args) Object.entries(args).forEach(([key, value])=>{
    if (key === 'parent'){
      (value as HTMLElement).appendChild(_element)
    }
    if (key==='children'){
      (value as HTMLElement[]).forEach(c=>_element.appendChild(c))
    }else if (key==='eventListeners'){
      Object.entries(value as Record<string, (e:Event)=>void>).forEach(([event, listener])=>{
        _element.addEventListener(event, listener)
      })
    }else if (key === 'style'){
      applyStyle(_element, value as StyleRules)
    }else{
      _element[(key as 'innerText' | 'onclick' | 'oninput' | 'id' | 'contentEditable')] = value
    }
  })
  return _element
}

type HTMLArg = string | number | HTMLElement | Partial<Record<htmlKey, any>> | Promise<HTMLArg> | HTMLArg[] | Function
const html = (tag:string, ...cs:HTMLArg[]):HTMLElement=>{
  let children: HTMLElement[] = []
  let args: Partial<Record<htmlKey, any>> = {}

  const add_arg = (arg:HTMLArg)=>{
    if (typeof arg === 'string') children.push(htmlElement("span", arg))
    else if (typeof arg === 'number') children.push(htmlElement("span", arg.toString()))
    else if (arg instanceof Promise){
      const el = span("...")
      arg.then((value)=>{
        el.innerHTML = ""
        el.appendChild(span(value))
      })
      children.push(el)
    }
    else if (arg instanceof HTMLElement) children.push(arg)
    else if (Array.isArray(arg)) arg.forEach(x=>add_arg(x))
    else if (typeof arg == "function"){
      if (arg.name == "oninput") args.oninput = arg
      else if (arg.name == "onclick" || arg.length < 2) args.onclick = arg
      else console.warn("Function argument without name or with more than one parameter is ignored in html generator")
    }
    else {
      const next = arg as Partial<Record<htmlKey, any>>
      args = {
        ...args,
        ...next,
        ...(next.style ? { style: { ...(args.style ?? {}), ...next.style } } : {}),
      }
    }
  }
  cs.forEach(add_arg)
  return htmlElement(tag, "", {...args, children})
}

type HTMLGenerator<T extends HTMLElement = HTMLElement> = (...cs:HTMLArg[]) => T
const newHtmlGenerator = <T extends HTMLElement>(tag:string)=>(...cs:HTMLArg[]):T=>html(tag, ...cs) as T

export const p:HTMLGenerator<HTMLParagraphElement> = newHtmlGenerator("p")
export const h1:HTMLGenerator<HTMLHeadingElement> = newHtmlGenerator("h1")
export const div:HTMLGenerator<HTMLDivElement> = newHtmlGenerator("div")
export const span:HTMLGenerator<HTMLSpanElement> = newHtmlGenerator("span")
export const button:HTMLGenerator<HTMLButtonElement> = newHtmlGenerator("button")

export const style = (...rules: StyleRules[]) => ({style: Object.assign({}, ...rules)})

export const input:HTMLGenerator<HTMLInputElement> = (...cs)=>{
  const content = cs.filter(c=>typeof c == 'string').join(' ')
  const el = html("input", ...cs) as HTMLInputElement
  el.value = content
  return el
}
