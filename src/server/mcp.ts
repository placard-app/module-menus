import { z } from "zod"
import { type Context, type Operation, schemas } from "../shared/menu.ts"
import { execute } from "./service.ts"
const descriptions: Record<Operation, string> = {
  get_menus:
    "Read complete menus, stable section/item IDs and revisions for a place. Find the place using core search first.",
  save_menu:
    "Atomically create a menu, or explicitly replace one with menuId and expectedRevision. Sections and items follow array order. Interpret source files outside Placard; preserve uncertainty, omit unreadable prices and do not invent dietary labels. Reuse requestId only for an identical retry.",
  upsert_menu_items:
    "Batch add or replace items in existing sections. Existing IDs update items; omitted IDs create items. Requires current expectedRevision and a requestId. Preserve uncertainty; only include dietary labels stated in the source.",
  delete_menu_items:
    "Remove specified item IDs atomically. Requires the current expectedRevision and a unique requestId.",
  delete_menu:
    "Delete one complete menu. Requires the current expectedRevision and a unique requestId.",
}
export const mcpTools = (Object.keys(schemas) as Operation[]).map((operation) => ({
  def: {
    name: operation,
    description: descriptions[operation],
    inputSchema: z.toJSONSchema(schemas[operation], { io: "input" }),
  },
  handler: async (args: Record<string, unknown>, ctx: Context) => {
    try {
      return { ok: true as const, data: await execute(operation, args, ctx) }
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : "Menu operation failed",
      }
    }
  },
}))
