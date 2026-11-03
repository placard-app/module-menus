import { test, expect } from "@playwright/test"
import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

for (const mobile of [false, true]) {
  test(`installed menu: manual editing, MCP import and update retention (${mobile ? "mobile" : "desktop"})`, async ({
    page,
    baseURL,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    const headers = { origin: baseURL! }
    const setup = await page.request.get("/api/setup")
    const account = {
      name: "Menu tester",
      email: "menus@example.com",
      password: "correct horse battery",
    }
    if ((await setup.json()).signupOpen) {
      expect(
        (await page.request.post("/api/auth/sign-up/email", { data: account, headers })).ok(),
      ).toBeTruthy()
    } else {
      expect(
        (await page.request.post("/api/auth/sign-in/email", { data: account, headers })).ok(),
      ).toBeTruthy()
    }
    const upload = () =>
      page.request.post("/api/modules/upload", {
        headers,
        data: {
          filename: "places.menus.zip",
          contentBase64: readFileSync("dist/places.menus-0.2.0.zip").toString("base64"),
        },
      })
    expect((await upload()).ok()).toBeTruthy()
    const added = await page.request.post("/api/places/manual", {
      headers,
      data: {
        name: `Menu restaurant ${mobile}`,
        category: "restaurant",
        location: { lat: 50.85, lng: 4.35 },
        address: null,
      },
    })
    expect(added.ok()).toBeTruthy()
    const placeId = (await added.json()).place.id
    async function openPlace() {
      await page.goto("/")
      await page
        .getByRole("navigation", { name: mobile ? "Primary" : "Main", exact: true })
        .waitFor({ state: "attached" })
      await page.evaluate((id) => {
        history.pushState({}, "", `/places/${id}`)
        dispatchEvent(new PopStateEvent("popstate"))
      }, placeId)
    }
    await openPlace()
    const section = page.getByRole("region", { name: "Menus", exact: true })
    await section.getByRole("button", { name: "+ Add menu", exact: true }).click()
    await section.getByLabel("Menu name", { exact: true }).fill("Dinner")
    await section.getByLabel("Currency (e.g. EUR)").fill("EUR")
    await section.getByRole("button", { name: "Add section", exact: true }).click()
    await section.getByLabel("Section name", { exact: true }).fill("Mains")
    await section.getByRole("button", { name: "Add item", exact: true }).click()
    await section.getByLabel("Item name", { exact: true }).fill("Sea bass")
    await section.getByLabel("Price", { exact: true }).fill("26.00")
    await section.getByLabel("Item image", { exact: true }).setInputFiles({
      name: "soup.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=",
        "base64",
      ),
    })
    await expect(section.getByRole("button", { name: "Remove image", exact: true })).toBeVisible()
    await section.getByRole("button", { name: "Add variant", exact: true }).click()
    await section.getByLabel("Variant name", { exact: true }).fill("Large")
    await section.getByLabel("Variant price", { exact: true }).fill("30.00")
    const priceBox = await section.getByLabel("Variant price", { exact: true }).boundingBox()
    const removeBox = await section
      .getByRole("button", { name: "Remove variant", exact: true })
      .boundingBox()
    if (!mobile)
      expect(
        Math.abs(priceBox!.y + priceBox!.height - removeBox!.y - removeBox!.height),
      ).toBeLessThan(2)
    await section.getByRole("button", { name: "Save menu", exact: true }).click()
    await expect(section.getByRole("img", { name: "Sea bass", exact: true })).toBeVisible()
    await expect(section.getByText("Sea bass", { exact: true })).toBeVisible()
    await expect(section.getByText("26.00 EUR", { exact: true })).toBeVisible()
    await section.getByRole("button", { name: "Edit menu", exact: true }).click()
    await expect(section.getByLabel("Replace item image", { exact: true })).toBeVisible()
    await section.getByRole("button", { name: "Remove image", exact: true }).click()
    await expect(section.getByRole("img")).toHaveCount(0)
    await section.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(section.getByRole("img", { name: "Sea bass", exact: true })).toBeVisible()
    await expect
      .poll(() =>
        section
          .getByRole("img", { name: "Sea bass", exact: true })
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0)
    await section.getByRole("button", { name: "Edit menu", exact: true }).click()
    await section.getByLabel("Price", { exact: true }).fill("27.00")
    await section.getByRole("button", { name: "Save menu", exact: true }).click()
    await expect(section.getByText("27.00 EUR", { exact: true })).toBeVisible()
    await expect(section.getByRole("img", { name: "Sea bass", exact: true })).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy()

    const token = await page.request.post("/api/tokens", { headers, data: { name: "Menus test" } })
    const secret = (await token.json()).secret
    const client = new Client({ name: "menus-test", version: "1.0.0" })
    await client.connect(
      new StreamableHTTPClientTransport(new URL("/mcp", baseURL), {
        requestInit: { headers: { authorization: `Bearer ${secret}` } },
      }),
    )
    try {
      const tools = await client.listTools()
      const save = tools.tools.find((t) => t.name === "places_menus__save_menu")!
      expect(JSON.stringify(save.inputSchema)).toContain("sections")
      const result = await client.callTool({
        name: save.name,
        arguments: {
          placeId,
          requestId: randomUUID(),
          menu: {
            name: "Drinks",
            currency: "EUR",
            sections: [
              {
                name: "Wine",
                items: [{ name: "House red", variants: [{ name: "Glass", price: "6.00" }] }],
              },
            ],
          },
        },
      })
      expect(result.isError, JSON.stringify(result)).not.toBeTruthy()
      const read = await client.callTool({
        name: "places_menus__get_menus",
        arguments: { placeId },
      })
      expect(read.isError, JSON.stringify(read)).not.toBeTruthy()
      expect(JSON.stringify(read)).toContain("House red")
    } finally {
      await client.close()
    }
    expect((await upload()).ok()).toBeTruthy()
    expect(
      (await page.request.delete("/api/modules/installed/places.menus", { headers })).ok(),
    ).toBeTruthy()
    expect((await upload()).ok()).toBeTruthy()
    await openPlace()
    await section.getByRole("button", { name: "Drinks", exact: true }).click()
    await expect(section.getByText("House red", { exact: true })).toBeVisible()
    await section.getByRole("button", { name: "Dinner", exact: true }).click()
    await expect(section.getByText("27.00 EUR", { exact: true })).toBeVisible()
    await expect(section.getByRole("img", { name: "Sea bass", exact: true })).toBeVisible()

    expect(
      (
        await page.request.patch("/api/modules/me/places.menus", {
          headers,
          data: { visible: false },
        })
      ).ok(),
    ).toBeTruthy()
    await openPlace()
    await expect(section).toHaveCount(0)
    await page.request.patch("/api/modules/me/places.menus", { headers, data: { visible: true } })
    await page.request.patch("/api/modules/installed/places.menus", {
      headers,
      data: { enabled: false },
    })
    expect(
      (
        await page.request.post("/api/m/places.menus/get_menus", { headers, data: { placeId } })
      ).status(),
    ).toBe(404)
    await page.request.patch("/api/modules/installed/places.menus", {
      headers,
      data: { enabled: true },
    })
  })
}
