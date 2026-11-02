import { type Context, MenuError, type Operation, schemas } from "../shared/menu.ts"
import { imageHttp } from "./images.ts"
import { execute } from "./service.ts"
export async function http(
  request: Request,
  ctx: Context & { pathSuffix: string },
): Promise<Response> {
  try {
    if (/^\/?images(?:\/|$)/.test(ctx.pathSuffix)) return await imageHttp(request, ctx)
    const operation = ctx.pathSuffix.replace(/^\//, "") as Operation
    if (!Object.hasOwn(schemas, operation))
      return Response.json({ error: "Not found" }, { status: 404 })
    if (request.method !== "POST") return Response.json({ error: "Use POST" }, { status: 405 })
    const body = await request.text()
    if (body.length > 2_000_000) throw new MenuError(413, "Menu request is too large")
    let input: unknown
    try {
      input = JSON.parse(body)
    } catch {
      throw new MenuError(400, "Invalid JSON")
    }
    return Response.json(await execute(operation, input, ctx))
  } catch (error) {
    return Response.json(
      { error: error instanceof MenuError ? error.message : "Menu operation failed" },
      { status: error instanceof MenuError ? error.status : 500 },
    )
  }
}
