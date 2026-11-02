import { randomUUID } from "node:crypto"
import {
  type Context,
  type Menu,
  MenuError,
  MenuInput,
  type Operation,
  schemas,
} from "../shared/menu.ts"
import { withDatabase } from "./storage.ts"

function ensureUnique(menu: Menu) {
  const { id, placeId, revision, updatedAt, ...body } = menu
  const valid = MenuInput.safeParse(body)
  if (!valid.success) throw new MenuError(400, valid.error.message)
  const seen = new Set<string>()
  for (const section of menu.sections) {
    for (const entry of [section, ...section.items]) {
      if (seen.has(entry.id))
        throw new MenuError(400, "Section and item IDs must be unique within a menu")
      seen.add(entry.id)
    }
  }
}

export async function requirePlaceAccess(placeId: string, ctx: Context, write = false) {
  if (!ctx.hostFetch) throw new MenuError(503, "Host place access is unavailable")
  const response = await ctx.hostFetch(`/api/places/${encodeURIComponent(placeId)}`)
  if (!response.ok) throw new MenuError(response.status === 404 ? 404 : 403, "Place is unavailable")
  const place = (await response.json()) as { owner: { id: string }; deletedAt?: string | null }
  if (place.deletedAt) throw new MenuError(404, "Place is unavailable")
  if (write && place.owner.id !== ctx.ownerId)
    throw new MenuError(403, "Only the place owner can edit menus")
}

export async function execute(operation: Operation, raw: unknown, ctx: Context): Promise<unknown> {
  const parsed = schemas[operation].safeParse(raw)
  if (!parsed.success) throw new MenuError(400, parsed.error.message)
  const args = parsed.data
  await requirePlaceAccess(args.placeId, ctx, operation !== "get_menus")
  return withDatabase(ctx.dataDir, (db) => {
    if (operation === "get_menus") {
      return (
        db.prepare("SELECT body FROM menus WHERE place_id = ?").all(args.placeId) as {
          body: string
        }[]
      )
        .map((row) => JSON.parse(row.body) as Menu)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    }
    // Parse the discriminated operation again for strongly typed mutation inputs.
    const input = schemas[operation].parse(raw)
    if (!("requestId" in input)) throw new MenuError(400, "Missing request ID")
    const payload = JSON.stringify({ operation, input })
    const retry = db
      .prepare("SELECT payload, result FROM requests WHERE actor_id = ? AND request_id = ?")
      .get(ctx.ownerId, input.requestId) as { payload: string; result: string } | undefined
    if (retry) {
      if (retry.payload !== payload)
        throw new MenuError(409, "Request ID was already used with different input")
      return JSON.parse(retry.result)
    }
    let menu: Menu | undefined
    if ("menuId" in input && input.menuId) {
      const row = db
        .prepare("SELECT body FROM menus WHERE id = ? AND place_id = ?")
        .get(input.menuId, input.placeId) as { body: string } | undefined
      if (!row) throw new MenuError(404, "Menu not found")
      menu = JSON.parse(row.body) as Menu
      if (menu.revision !== input.expectedRevision)
        throw new MenuError(409, "Menu changed; read it again before editing")
    }
    let result: unknown
    if (operation === "save_menu") {
      const value = schemas.save_menu.parse(raw)
      menu = {
        ...value.menu,
        id: value.menuId ?? randomUUID(),
        placeId: value.placeId,
        sortOrder:
          value.menu.sortOrder ??
          menu?.sortOrder ??
          (
            db
              .prepare("SELECT count(*) AS count FROM menus WHERE place_id = ?")
              .get(value.placeId) as { count: number }
          ).count,
        revision: (menu?.revision ?? 0) + 1,
        updatedAt: new Date().toISOString(),
        sections: value.menu.sections.map((section) => ({
          ...section,
          id: section.id ?? randomUUID(),
          items: section.items.map((item) => ({ ...item, id: item.id ?? randomUUID() })),
        })),
      }
    } else if (operation === "delete_menu") {
      db.prepare("DELETE FROM menus WHERE id = ? AND place_id = ?").run(menu!.id, args.placeId)
      result = { deleted: true, menuId: menu!.id }
      const remaining = (
        db.prepare("SELECT body FROM menus WHERE place_id = ?").all(args.placeId) as {
          body: string
        }[]
      )
        .map((row) => JSON.parse(row.body) as Menu)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
      for (const [index, other] of remaining.entries()) {
        if (other.sortOrder === index) continue
        other.sortOrder = index
        other.revision++
        other.updatedAt = new Date().toISOString()
        db.prepare("UPDATE menus SET body = ? WHERE id = ?").run(JSON.stringify(other), other.id)
      }
    } else {
      if (!menu) throw new MenuError(404, "Menu not found")
      if (operation === "upsert_menu_items") {
        const value = schemas.upsert_menu_items.parse(raw)
        for (const update of value.items) {
          const section = menu.sections.find((s) => s.id === update.sectionId)
          if (!section) throw new MenuError(400, "Section not found")
          const item = { ...update.item, id: update.item.id ?? randomUUID() }
          const index = section.items.findIndex((i) => i.id === item.id)
          if (index < 0) section.items.push(item)
          else section.items[index] = item
        }
      } else {
        const value = schemas.delete_menu_items.parse(raw)
        const available = new Set(menu.sections.flatMap((s) => s.items.map((i) => i.id)))
        if (value.itemIds.some((id) => !available.has(id)))
          throw new MenuError(400, "Item not found")
        for (const section of menu.sections)
          section.items = section.items.filter((i) => !value.itemIds.includes(i.id))
      }
      menu.revision++
      menu.updatedAt = new Date().toISOString()
    }
    if (operation !== "delete_menu" && menu) {
      ensureUnique(menu)
      if (operation === "save_menu") {
        const ordered = (
          db
            .prepare("SELECT body FROM menus WHERE place_id = ? AND id != ?")
            .all(menu.placeId, menu.id) as { body: string }[]
        )
          .map((row) => JSON.parse(row.body) as Menu)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
        ordered.splice(Math.min(menu.sortOrder, ordered.length), 0, menu)
        for (const [index, other] of ordered.entries()) {
          if (other.sortOrder === index) continue
          other.sortOrder = index
          if (other.id !== menu.id) {
            other.revision++
            other.updatedAt = menu.updatedAt
            db.prepare("UPDATE menus SET body = ? WHERE id = ?").run(
              JSON.stringify(other),
              other.id,
            )
          }
        }
      }
      db.prepare(
        "INSERT INTO menus (id, place_id, body) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body",
      ).run(menu.id, menu.placeId, JSON.stringify(menu))
      result = menu
    }
    db.prepare("INSERT INTO requests VALUES (?, ?, ?, ?)").run(
      ctx.ownerId,
      input.requestId,
      payload,
      JSON.stringify(result),
    )
    return result
  })
}
