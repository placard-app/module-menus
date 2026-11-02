import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

/** Short-lived connections avoid retaining obsolete module code during upgrades. */
export function withDatabase<T>(dataDir: string, action: (db: DatabaseSync) => T): T {
  mkdirSync(dataDir, { recursive: true })
  const db = new DatabaseSync(join(dataDir, "menus.sqlite"))
  try {
    db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;")
    db.exec("BEGIN IMMEDIATE")
    try {
      const version = (db.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version
      if (version > 1) throw new Error("Menu database requires a newer module version")
      if (version === 0)
        db.exec(`
        CREATE TABLE menus (id TEXT PRIMARY KEY, place_id TEXT NOT NULL, body TEXT NOT NULL);
        CREATE INDEX menus_place ON menus(place_id);
        CREATE TABLE requests (actor_id TEXT NOT NULL, request_id TEXT NOT NULL, payload TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(actor_id, request_id));
        PRAGMA user_version = 1;
      `)
      const result = action(db)
      db.exec("COMMIT")
      return result
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }
  } finally {
    db.close()
  }
}
