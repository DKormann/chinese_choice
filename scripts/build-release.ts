import { mkdir } from "node:fs/promises"

const releaseDirectory = "build/release"
const entrypoint = "scripts/start-server.ts"
const builds = [
  ["bun-darwin-arm64", "app-darwin-arm64"],
  ["bun-darwin-x64", "app-darwin-x64"],
  ["bun-linux-x64-baseline", "app-linux-x64"],
  ["bun-windows-x64-baseline", "app-windows-x64.exe"],
] as const

await mkdir(releaseDirectory, { recursive: true })

for (const [target, output] of builds) {
  console.log(`Building ${target} -> ${output}`)
  const process = Bun.spawnSync({
    cmd: ["bun", "build", "--compile", `--target=${target}`, entrypoint, "--outfile", `${releaseDirectory}/${output}`],
    stdout: "inherit",
    stderr: "inherit",
  })
  if (process.exitCode !== 0) globalThis.process.exit(process.exitCode)
}
