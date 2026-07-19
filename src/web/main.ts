import { createClient } from "../client"
import { array } from "../schema"
import type { UUID } from "../sql"
import { stored } from "../store"
import { User, UserRow } from "../tables"
import { body, button, div, h2, mapWritable, p } from "./html"

const client = createClient()


const local_users = stored("users", array(UserRow), [])

body.replaceChildren(
  h2("Chinese by choice"),

  mapWritable(
    local_users,
    (us=>div(
      us.map(x=>button(x.username, function(){

      }))
    ))
  ),

  button("+ new user", function(){
    let name = prompt("Enter a username")
    if (name) client.funcs.newUser({name}).then(u=> local_users.update(s=>[...s, u]))
  })

)

function viewLesson(userid: UUID){
  body.replaceChildren(
    
  )
}



