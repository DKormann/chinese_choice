import type Database from "bun:sqlite"

type RawSymbol = { id: string; mandarin_character: string; pinyin: string; meaning: string }
type RawChain = { id: string; prev: string | null; symbolID: string; pinyin: string; meaning: string }

function hasTable(sqlite: Database, name: string): boolean {
  return Boolean(sqlite.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name))
}

function hasColumn(sqlite: Database, table: string, column: string): boolean {
  if (!hasTable(sqlite, table)) return false
  return (sqlite.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(row => row.name === column)
}

function decodedLength(value: string): number {
  try {
    const decoded = JSON.parse(value)
    return typeof decoded === "string" ? decoded.trim().length : 0
  } catch {
    return 0
  }
}

function richer(left: string, right: string): string {
  return decodedLength(right) > decodedLength(left) ? right : left
}

function replaceReference(sqlite: Database, table: string, column: string, from: string, to: string): void {
  if (hasColumn(sqlite, table, column)) sqlite.query(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(to, from)
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const value = key(row)
    groups.set(value, [...groups.get(value) ?? [], row])
  }
  return groups
}

function mergeSymbols(sqlite: Database): number {
  const rows = sqlite.query("SELECT id, mandarin_character, pinyin, meaning FROM Symbol").all() as RawSymbol[]
  const groups = groupBy(rows, row => row.mandarin_character)
  let merged = 0
  for (const duplicates of groups.values()) {
    if (duplicates.length < 2) continue
    const canonical = duplicates.reduce((best, row) =>
      decodedLength(row.pinyin) + decodedLength(row.meaning) > decodedLength(best.pinyin) + decodedLength(best.meaning) ? row : best
    )
    let pinyin = canonical.pinyin
    let meaning = canonical.meaning
    for (const duplicate of duplicates) {
      if (duplicate.id === canonical.id) continue
      pinyin = richer(pinyin, duplicate.pinyin)
      meaning = richer(meaning, duplicate.meaning)
      replaceReference(sqlite, "Chain", "symbolID", duplicate.id, canonical.id)
      replaceReference(sqlite, "Attempt", "symbol", duplicate.id, canonical.id)
      replaceReference(sqlite, "UserStateOption", "symbol", duplicate.id, canonical.id)
      replaceReference(sqlite, "Knowledge", "symbolID", duplicate.id, canonical.id)
      sqlite.query("DELETE FROM Symbol WHERE id = ?").run(duplicate.id)
      merged++
    }
    sqlite.query("UPDATE Symbol SET pinyin = ?, meaning = ? WHERE id = ?").run(pinyin, meaning, canonical.id)
  }
  return merged
}

function mergeChains(sqlite: Database): number {
  let merged = 0
  while (true) {
    const rows = sqlite.query("SELECT id, prev, symbolID, pinyin, meaning FROM Chain").all() as RawChain[]
    const groups = groupBy(rows, row => `${row.prev ?? "root"}\0${row.symbolID}`)
    const duplicates = [...groups.values()].find(group => group.length > 1)
    if (!duplicates) return merged

    const canonical = duplicates.reduce((best, row) =>
      decodedLength(row.pinyin) + decodedLength(row.meaning) > decodedLength(best.pinyin) + decodedLength(best.meaning) ? row : best
    )
    let pinyin = canonical.pinyin
    let meaning = canonical.meaning
    for (const duplicate of duplicates) {
      if (duplicate.id === canonical.id) continue
      pinyin = richer(pinyin, duplicate.pinyin)
      meaning = richer(meaning, duplicate.meaning)
      replaceReference(sqlite, "Chain", "prev", duplicate.id, canonical.id)
      replaceReference(sqlite, "UserState", "currentChain", duplicate.id, canonical.id)
      replaceReference(sqlite, "UserStateOption", "nextChain", duplicate.id, canonical.id)
      replaceReference(sqlite, "Attempt", "chain", duplicate.id, canonical.id)
      sqlite.query("DELETE FROM Chain WHERE id = ?").run(duplicate.id)
      merged++
    }
    sqlite.query("UPDATE Chain SET pinyin = ?, meaning = ? WHERE id = ?").run(pinyin, meaning, canonical.id)
  }
}

export function migrateDatabase(sqlite: Database): void {
  if (!hasTable(sqlite, "Symbol") || !hasTable(sqlite, "Chain")) return
  sqlite.exec("PRAGMA foreign_keys = OFF")
  let result: { symbols: number; chains: number }
  let addedOptionChain = false
  try {
    result = sqlite.transaction(() => {
      if (hasTable(sqlite, "UserStateOption") && !hasColumn(sqlite, "UserStateOption", "chain")) {
        sqlite.exec("ALTER TABLE UserStateOption ADD COLUMN chain TEXT")
        addedOptionChain = true
      }
      const merged = {
        symbols: mergeSymbols(sqlite),
        chains: mergeChains(sqlite),
      }
      if ((merged.symbols || merged.chains) && hasTable(sqlite, "UserStateOption")) {
        sqlite.exec("DELETE FROM UserStateOption")
      }
      if (addedOptionChain) {
        sqlite.exec(`
          UPDATE UserStateOption
          SET chain = (SELECT currentChain FROM UserState WHERE UserState.user = UserStateOption.user)
          WHERE chain IS NULL
        `)
        sqlite.exec("DELETE FROM UserStateOption WHERE chain IS NULL")
      }
      return merged
    })()
  } finally {
    sqlite.exec("PRAGMA foreign_keys = ON")
  }
  if (result.symbols || result.chains) {
    console.log(JSON.stringify({ scope: "migration", event: "unique_tree", ...result }))
  }
}
