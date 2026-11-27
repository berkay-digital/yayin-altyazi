import path from "node:path"
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js"
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import * as schema from "./schema"

const migrationsFolder = process.env.DRIZZLE_DIR ?? path.resolve(process.cwd(), "drizzle")

function createDb() {
  const url = process.env.DATABASE_URL
  if (url) {
    const client = postgres(url, { max: 10 })
    const db = drizzlePg(client, { schema })
    return { db, ready: migratePg(db, { migrationsFolder }) }
  }
  // Local development: in-process Postgres (PGlite) stored on disk.
  return createPglite()
}

function createPglite() {
  // Loaded lazily so production bundles never touch PGlite.
  const ready = (async () => {
    const { PGlite } = await import("@electric-sql/pglite")
    const { drizzle } = await import("drizzle-orm/pglite")
    const { migrate } = await import("drizzle-orm/pglite/migrator")
    const dir = process.env.PGLITE_DIR ?? path.resolve(process.cwd(), ".data/pglite")
    const fs = await import("node:fs")
    fs.mkdirSync(dir, { recursive: true })
    const { pg_trgm } = await import("@electric-sql/pglite/contrib/pg_trgm")
    const client = new PGlite(dir, { extensions: { pg_trgm } })
    const pdb = drizzle(client, { schema })
    await migrate(pdb, { migrationsFolder })
    return pdb
  })()
  // Proxy so callers can use `db` synchronously and await `ready` once at startup.
  let inner: unknown
  void ready.then((d) => (inner = d))
  const db = new Proxy({} as ReturnType<typeof drizzlePg<typeof schema>>, {
    get(_t, prop) {
      if (!inner) throw new Error("Database not ready yet")
      return (inner as Record<string | symbol, unknown>)[prop]
    },
  })
  return { db, ready: ready.then(() => undefined) }
}

type Db = ReturnType<typeof drizzlePg<typeof schema>>

const g = globalThis as unknown as { __db?: { db: Db; ready: Promise<unknown> } }
g.__db ??= createDb() as { db: Db; ready: Promise<unknown> }

export const db = g.__db.db
export const dbReady = g.__db.ready
export { schema }
