import { test } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execute } from "../src/server/service.ts"
import { http } from "../src/server/http.ts"
import { mcpTools } from "../src/server/mcp.ts"
import type { Context, Menu } from "../src/shared/menu.ts"

function fixture(t: { after: (fn: () => void) => void }) {
  const dataDir = mkdtempSync(join(tmpdir(), "menus-test-"))
  t.after(() => rmSync(dataDir, { recursive: true, force: true }))
  const placeId = randomUUID(),
    ownerId = randomUUID()
  let visible = true
  const ctx: Context = {
    dataDir,
    ownerId,
    hostFetch: async (path) => {
      assert.equal(path, `/api/places/${placeId}`)
      return visible
        ? Response.json({ owner: { id: ownerId } })
        : new Response(null, { status: 404 })
    },
  }
  const input = {
    placeId,
    requestId: randomUUID(),
    menu: {
      name: "Dinner",
      currency: "EUR",
      sections: [
        {
          name: "Mains",
          items: [{ name: "Soup" }, { name: "Wine", variants: [{ name: "Glass", price: "5.50" }] }],
        },
      ],
    },
  }
  return { ctx, placeId, input, hide: () => (visible = false), show: () => (visible = true) }
}

test("complete import, retry, restart and backup restoration preserve structured menus", async (t) => {
  const { ctx, placeId, input } = fixture(t)
  const menu = (await execute("save_menu", input, ctx)) as Menu
  assert.equal(menu.revision, 1)
  assert.equal(menu.sections[0].items[0].price, undefined)
  assert.equal(menu.sections[0].items[1].variants[0].price, "5.50")
  assert.deepEqual(await execute("save_menu", input, ctx), menu)
  assert.equal(((await execute("get_menus", { placeId }, ctx)) as Menu[]).length, 1)
  const backup = mkdtempSync(join(tmpdir(), "menu-backup-"))
  t.after(() => rmSync(backup, { recursive: true, force: true }))
  cpSync(ctx.dataDir, backup, { recursive: true })
  rmSync(ctx.dataDir, { recursive: true })
  cpSync(backup, ctx.dataDir, { recursive: true })
  assert.deepEqual(await execute("get_menus", { placeId }, { ...ctx }), [menu])
  await assert.rejects(
    execute("save_menu", { ...input, menu: { ...input.menu, name: "Different" } }, ctx),
    /Request ID/,
  )
})

test("replacement preserves IDs, ordering, source and labels; stale writes conflict", async (t) => {
  const { ctx, placeId, input } = fixture(t)
  const menu = (await execute("save_menu", input, ctx)) as Menu
  const { id, revision, updatedAt, placeId: _, ...body } = menu
  body.sections[0].items.reverse()
  body.sections[0].items[0].dietaryLabels = ["Vegan"]
  body.sourceUrl = "https://example.com/menu"
  const update = {
    placeId,
    menuId: id,
    expectedRevision: revision,
    requestId: randomUUID(),
    menu: body,
  }
  const edited = (await execute("save_menu", update, ctx)) as Menu
  assert.equal(edited.sections[0].items[0].id, body.sections[0].items[0].id)
  assert.equal(edited.revision, 2)
  assert.deepEqual(edited.sections[0].items[0].dietaryLabels, ["Vegan"])
  await assert.rejects(
    execute("save_menu", { ...update, requestId: randomUUID() }, ctx),
    /Menu changed/,
  )
})

test("batch mutations are atomic, revisions advance and deleting items/menu works", async (t) => {
  const { ctx, placeId, input } = fixture(t)
  const menu = (await execute("save_menu", input, ctx)) as Menu
  const base = { placeId, menuId: menu.id, expectedRevision: 1, requestId: randomUUID() }
  await assert.rejects(
    execute(
      "upsert_menu_items",
      {
        ...base,
        items: [
          { sectionId: menu.sections[0].id, item: { name: "Should roll back" } },
          { sectionId: randomUUID(), item: { name: "Invalid" } },
        ],
      },
      ctx,
    ),
    /Section not found/,
  )
  assert.deepEqual(await execute("get_menus", { placeId }, ctx), [menu])
  const updated = (await execute(
    "upsert_menu_items",
    {
      ...base,
      items: [
        {
          sectionId: menu.sections[0].id,
          item: { id: menu.sections[0].items[0].id, name: "New soup", price: "8.00" },
        },
      ],
    },
    ctx,
  )) as Menu
  assert.equal(updated.sections[0].items[0].name, "New soup")
  const deleted = (await execute(
    "delete_menu_items",
    {
      ...base,
      requestId: randomUUID(),
      expectedRevision: 2,
      itemIds: [updated.sections[0].items[0].id],
    },
    ctx,
  )) as Menu
  assert.equal(deleted.sections[0].items.length, 1)
  const deletion = { ...base, expectedRevision: 3, requestId: randomUUID() }
  await execute("delete_menu", deletion, ctx)
  await execute("delete_menu", deletion, ctx)
  assert.deepEqual(await execute("get_menus", { placeId }, ctx), [])
})

test("HTTP and MCP enforce owner-only writes, shared reading, and revoked access even for retries", async (t) => {
  const { ctx, placeId, input, hide, show } = fixture(t)
  await execute("save_menu", input, ctx)
  const guest = { ...ctx, ownerId: randomUUID() }
  assert.equal(((await execute("get_menus", { placeId }, guest)) as Menu[]).length, 1)
  const response = await http(
    new Request("http://localhost/save_menu", { method: "POST", body: JSON.stringify(input) }),
    { ...guest, pathSuffix: "/save_menu" },
  )
  assert.equal(response.status, 403)
  const tool = mcpTools.find((t) => t.def.name === "save_menu")!
  assert.equal((await tool.handler(input, guest)).ok, false)
  hide()
  await assert.rejects(execute("get_menus", { placeId }, ctx), /unavailable/)
  assert.equal((await tool.handler(input, ctx)).ok, false)
  show()
  assert.equal((await tool.handler(input, ctx)).ok, true)
})

test("invalid prices, duplicate IDs, unsafe source URLs and malformed HTTP JSON are rejected", async (t) => {
  const { ctx, input } = fixture(t)
  for (const menu of [
    { ...input.menu, sourceUrl: "javascript:alert(1)" },
    { ...input.menu, sections: [{ name: "Mains", items: [{ name: "Soup", price: "guess" }] }] },
    {
      ...input.menu,
      sections: [
        { id: input.placeId, name: "Mains", items: [{ id: input.placeId, name: "Soup" }] },
      ],
    },
  ])
    await assert.rejects(execute("save_menu", { ...input, menu }, ctx))
  const response = await http(
    new Request("http://localhost/save_menu", { method: "POST", body: "{" }),
    { ...ctx, pathSuffix: "/save_menu" },
  )
  assert.equal(response.status, 400)
})

test("MCP publishes nested import schemas and matches HTTP results", async (t) => {
  const { ctx, input } = fixture(t)
  const tool = mcpTools.find((t) => t.def.name === "save_menu")!
  const schema = tool.def.inputSchema as any
  assert.equal(schema.properties.menu.properties.sections.type, "array")
  const result = await tool.handler(input, ctx)
  assert.equal(result.ok, true)
  const response = await http(
    new Request("http://localhost/save_menu", { method: "POST", body: JSON.stringify(input) }),
    { ...ctx, pathSuffix: "/save_menu" },
  )
  assert.deepEqual(await response.json(), result.ok ? result.data : null)
})

test("menu ordering appends imports and moving a menu updates affected revisions", async (t) => {
  const { ctx, placeId, input } = fixture(t)
  const first = (await execute("save_menu", input, ctx)) as Menu
  const second = (await execute(
    "save_menu",
    { ...input, requestId: randomUUID(), menu: { ...input.menu, name: "Lunch" } },
    ctx,
  )) as Menu
  assert.equal(second.sortOrder, 1)
  const { id, placeId: _, revision, updatedAt, ...menu } = second
  await execute(
    "save_menu",
    {
      placeId,
      menuId: id,
      expectedRevision: revision,
      requestId: randomUUID(),
      menu: { ...menu, sortOrder: 0 },
    },
    ctx,
  )
  const reordered = (await execute("get_menus", { placeId }, ctx)) as Menu[]
  assert.deepEqual(
    reordered.map((m) => m.name),
    ["Lunch", "Dinner"],
  )
  assert.equal(reordered[1].revision, first.revision + 1)
})

test("deleting a menu keeps remaining positions dense and edits do not reorder them", async (t) => {
  const { ctx, placeId, input } = fixture(t)
  const first = (await execute("save_menu", input, ctx)) as Menu
  for (const name of ["Lunch", "Drinks"])
    await execute(
      "save_menu",
      { ...input, requestId: randomUUID(), menu: { ...input.menu, name } },
      ctx,
    )
  await execute(
    "delete_menu",
    { placeId, menuId: first.id, expectedRevision: 1, requestId: randomUUID() },
    ctx,
  )
  const remaining = (await execute("get_menus", { placeId }, ctx)) as Menu[]
  assert.deepEqual(
    remaining.map((m) => m.sortOrder),
    [0, 1],
  )
  const { id, placeId: _, revision, updatedAt, ...menu } = remaining[0]
  await execute(
    "save_menu",
    {
      placeId,
      menuId: id,
      expectedRevision: revision,
      requestId: randomUUID(),
      menu: { ...menu, name: "Lunch edited" },
    },
    ctx,
  )
  assert.deepEqual(
    ((await execute("get_menus", { placeId }, ctx)) as Menu[]).map((m) => m.name),
    ["Lunch edited", "Drinks"],
  )
})

test("item images persist, require place access, and reject unsafe uploads and paths", async (t) => {
  const { ctx, placeId, input, hide } = fixture(t)
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=",
    "base64",
  )
  const upload = (body: BodyInit, context = ctx) =>
    http(new Request("http://localhost/images", { method: "POST", body }), {
      ...context,
      pathSuffix: `images/${placeId}`,
    })
  assert.equal((await upload(bytes, { ...ctx, ownerId: randomUUID() })).status, 403)
  assert.equal((await upload("<svg></svg>")).status, 400)
  assert.equal((await upload(new Uint8Array(5 * 1024 * 1024 + 1))).status, 413)
  const uploaded = await upload(bytes)
  assert.equal(uploaded.status, 200)
  const { imageId } = await uploaded.json()
  const withImage = {
    ...input,
    menu: {
      ...input.menu,
      sections: [
        {
          name: "Mains",
          items: [{ name: "Soup", imageId }],
        },
      ],
    },
  }
  const saved = (await execute("save_menu", withImage, ctx)) as Menu
  assert.equal(saved.sections[0].items[0].imageId, imageId)
  assert.deepEqual(await execute("get_menus", { placeId }, ctx), [saved])
  const read = (id: string) =>
    http(new Request("http://localhost/images"), {
      ...ctx,
      ownerId: randomUUID(),
      pathSuffix: `images/${placeId}/${id}`,
    })
  const image = await read(imageId)
  assert.equal(image.headers.get("content-type"), "image/png")
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), bytes)
  assert.equal((await read("..%2Fmenus.sqlite")).status, 404)
  assert.equal((await read(`${"0".repeat(64)}.png`)).status, 404)
  hide()
  assert.equal((await read(imageId)).status, 404)
})
