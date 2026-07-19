import { createClient } from "../client"

const client = createClient()
const form = document.querySelector<HTMLFormElement>("#item-form")!
const title = document.querySelector<HTMLInputElement>("#item-title")!
const list = document.querySelector<HTMLUListElement>("#items")!

async function render(): Promise<void> {
  const items = await client.tables.items.list()
  list.replaceChildren(...items.map(item => {
    const row = document.createElement("li")
    const label = document.createElement("span")
    const remove = document.createElement("button")
    label.textContent = item.title
    remove.textContent = "Delete"
    remove.addEventListener("click", async () => {
      await client.funcs.deleteItem({ id: item.id })
      await render()
    })
    row.append(label, remove)
    return row
  }))
}

form.addEventListener("submit", async event => {
  event.preventDefault()
  await client.funcs.createItem({ title: title.value })
  form.reset()
  await render()
})

void render()
