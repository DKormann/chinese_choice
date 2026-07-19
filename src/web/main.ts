import { createClient } from "../client"
import { body, div, h2, p } from "./html"

const client = createClient()


function render(){
  body.replaceChildren(
    h2("Symbols"),
    div(client.tables.Symbol.all().then(symbols=>
      symbols.map(symbol=>p("• ", symbol.mandarin_character, " — ", symbol.pinyin, ": ", symbol.meaning))
    )),
  )
}


render()
