import { mkWritable, validate, type JsonData, type Schema, type Writable } from "./schema"

let getItem = (key:string) => localStorage.getItem(key)
let setItem = (key:string, value:string) => localStorage.setItem(key, value)

if (typeof document === "undefined") {
  let store = new Map<string,string>()

  getItem = (key:string) => store.get(key) ?? null
  setItem = (key:string, value:string) => store.set(key, value)
}


export function stored <T extends JsonData>(key: string, schema: Schema<T>, defaultValue: T) : Writable<T>{
  let value = defaultValue
  let raw = getItem(key)
  if (raw != null) {
    try{
      value = validate(schema, JSON.parse(raw))
    }catch(e){
      try{
        value = validate(schema, raw)
        setItem(key, JSON.stringify(value))
      }catch{
        console.error("Error reading stored value for key", key, e)
      }
    }
  }
  let writable = mkWritable(value)
  writable.subscribe((x:T)=> setItem(key, JSON.stringify(validate(schema, x))))
  return writable
}

