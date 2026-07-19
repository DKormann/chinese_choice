import { databaseServer } from "../src/backend/server"
import { defaultPort } from "../src/config"
import index from "../src/index.html"

const requestedPort = Number(process.env.PORT ?? defaultPort)

function startOnAvailablePort(): Bun.Server<undefined> {
  for (let port = requestedPort; port < requestedPort + 100; port++) {
    try {
      return Bun.serve({
        hostname: "0.0.0.0",
        port,
        development: process.env.NODE_ENV !== "production",
        routes: { "/": index },
        fetch(request) {
          const path = new URL(request.url).pathname.split("/").filter(Boolean)
          if (path[0] === "api" && path[1] === "db") return databaseServer(path.slice(2), request)
          return new Response("Not found", { status: 404 })
        },
      })
    } catch (error) {
      if ((error as { code?: string }).code !== "EADDRINUSE") throw error
    }
  }
  throw new Error(`No port available from ${requestedPort} to ${requestedPort + 99}`)
}

export const server = startOnAvailablePort()
console.log(`Server running at ${server.url}`)
