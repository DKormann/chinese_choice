// import type { JsonData, Store } from "../storage";

import type { JsonData, Writable } from "../schema";
export const body = document.body;

const colorPalette = {
  light:{
    color:             "#000",
    background:        "#fff",
    red:               "rgb(242, 55, 55)",
    green:             "rgb(57, 214, 39)",
    blue:              "rgb(5, 28, 141)",
    gray:              "#888",
    lightgray:         "#e5e5e5",
  },
  dark:{
    color:             "#fff",
    background:        "#222",
    red:               "rgb(198, 20, 0)",
    blue:              "rgb(95, 100, 255)",
    green:             "rgb(0, 185, 19)",
    gray:              "#565656",
    lightgray:         "#414141",
  }
}

export const color = {
  color: "var(--color)",
  background: "var(--background)",
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
    --red: ${colorPalette.light.red};
    --green: ${colorPalette.light.green};
    --blue: ${colorPalette.light.blue};
    --gray: ${colorPalette.light.gray};
    --lightgray: ${colorPalette.light.lightgray};
  }
}
`
document.head.appendChild(styl)

export type htmlKey = 'innerText'|'onclick' | 'oninput' | 'onkeydown' |'children'|'class'|'id'|'contentEditable'|'eventListeners'|'color'|'background' | 'style' | 'placeholder' | 'tabIndex' | 'colSpan' | 'type'
export const htmlElement = (tag:string, text:string, args?:Partial<Record<htmlKey, any>>):HTMLElement =>{

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
      Object.assign(_element.style, value as Record<string, string>)
    }else{
      _element[(key as 'innerText' | 'onclick' | 'oninput' | 'id' | 'contentEditable')] = value
    }
  })
  return _element
}

export type HTMLArg = string | number | HTMLElement | Partial<Record<htmlKey, any>>  | Promise<HTMLArg> | HTMLArg[] | Function
export const html = (tag:string, ...cs:HTMLArg[]):HTMLElement=>{
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
    // else if ('get' in arg && typeof arg.get === 'function') {
    //   const el = span()
    //   children.push(el)
    //   if ('onupdate' in arg && typeof arg.onupdate === 'function') arg.onupdate(x=>el.replaceChildren(x))
    // }
    else if (typeof arg == "function"){
      if (arg.name == "oninput") args.oninput = arg
      else if (arg.name == "onclick" || arg.length < 2) args.onclick = arg
      else console.warn("Function argument without name or with more than one parameter is ignored in html generator")
    }
    else args = {...args, ...arg}
  }
  cs.forEach(add_arg)
  return htmlElement(tag, "", {...args, children})
}

export type HTMLGenerator<T extends HTMLElement = HTMLElement> = (...cs:HTMLArg[]) => T
const newHtmlGenerator = <T extends HTMLElement>(tag:string)=>(...cs:HTMLArg[]):T=>html(tag, ...cs) as T

export const p:HTMLGenerator<HTMLParagraphElement> = newHtmlGenerator("p")
export const a:HTMLGenerator<HTMLAnchorElement> = newHtmlGenerator("a")
export const h1:HTMLGenerator<HTMLHeadingElement> = newHtmlGenerator("h1")
export const h2:HTMLGenerator<HTMLHeadingElement> = newHtmlGenerator("h2")
export const h3:HTMLGenerator<HTMLHeadingElement> = newHtmlGenerator("h3")
export const h4:HTMLGenerator<HTMLHeadingElement> = newHtmlGenerator("h4")

export const div:HTMLGenerator<HTMLDivElement> = newHtmlGenerator("div")
export const pre:HTMLGenerator<HTMLPreElement> = newHtmlGenerator("pre")
export const span:HTMLGenerator<HTMLSpanElement> = newHtmlGenerator("span")
export const textarea:HTMLGenerator<HTMLTextAreaElement> = newHtmlGenerator("textarea")

export const button:HTMLGenerator<HTMLButtonElement> = newHtmlGenerator("button")
export const table = (rows: HTMLArg[][], ...args: HTMLArg[]) => newHtmlGenerator("table")( style({borderSpacing: "1em .4em"}) , rows.map(cells=>tr(cells.map(cell=>td(cell)))), ...args)

export const tr:HTMLGenerator<HTMLTableRowElement> = newHtmlGenerator("tr")
export const td:HTMLGenerator<HTMLTableCellElement> = newHtmlGenerator("td")
export const th:HTMLGenerator<HTMLTableCellElement> = newHtmlGenerator("th")
export const canvas:HTMLGenerator<HTMLCanvasElement> = newHtmlGenerator("canvas")

export const style = (...rules: Record<string, string>[]) => ({style: Object.assign({}, ...rules)})
export const margin = (value: string) => style({margin: value})
export const padding = (value: string) => style({padding: value})
export const border = (value: string) => style({border: value})
export const borderRadius = (value: string) => style({borderRadius: value})
export const width = (value: string) => style({width: value})
export const height = (value: string) => style({height: value})
export const display = (value: string) => style({display: value})
export const background = (value: string = "var(--background)") => style({background: value})

export const input:HTMLGenerator<HTMLInputElement> = (...cs)=>{
  const content = cs.filter(c=>typeof c == 'string').join(' ')
  const el = html("input", ...cs) as HTMLInputElement
  el.value = content
  return el
}


export const mapWritable = <T extends JsonData>(wr: Writable<T>, f:(t:T)=>HTMLElement | HTMLElement[]):HTMLElement=>{
  const dv = div()
  let ref = new WeakRef(dv)

  function runner (x:T){
    let el = ref.deref()
    if (!el){
      wr.unsubscribe(runner)
      return
    }
    let news = f(x)
    el.replaceChildren(div(news))
  }
  wr.subscribe(runner)

  return dv
}

export const popup = (...cs:HTMLArg[])=>{
  const dialogfield = div({
    style: {
      background: color.background,
      color: color.color,
      padding: "1em 4em",
      paddingBottom: "2em",
      borderRadius: "1em",
      zIndex: "2000",
      overflowY: "scroll",
      minWidth: "20vw",
      maxHeight: "80vh",
    }},
    ...cs)

  const popupbackground = div(
    {style:{
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      background: "rgba(166, 166, 166, 0.5)",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      zIndex: "2000",
    }}
  )

  popupbackground.appendChild(dialogfield);
  document.body.appendChild(popupbackground);
  popupbackground.onclick = () => {popupbackground.remove(); }
  dialogfield.onclick = (e) => e.stopPropagation();
  return popupbackground

}

export const errorpopup = (e:Error | string) =>{
  popup(div(
    style({
      background:color.background,
      border:"1px solid "+color.gray,
      padding:"1em",
      borderRadius:".4em",
      color:color.red,
    }),
    h2("Error"),
    p(String(e))
  ))
  throw (e instanceof Error) ? e : new Error(String(e))
}

export function writableSpan <T extends string|number> (wr: Writable<T>) : HTMLElement {
  const el = span(wr.get())
  wr.subscribe((v)=>el.innerText = String(v))
  return el
}

export const fatButton = (text:string, onclick:()=>void):HTMLElement=>span(text, {
  style:{
    cursor:"pointer",
    marginLeft:"1em",
    fontSize:"0.8em",
    color:color.gray,
    border:`1px solid ${color.gray}`,
    padding:"0.2em",
    borderRadius:".3em",
    background: color.background,
  },
  onclick})


