import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { type Context, imageId, MenuError } from "../shared/menu.ts"
import { requirePlaceAccess } from "./service.ts"

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export async function imageHttp(request: Request, ctx: Context & { pathSuffix: string }) {
  const parts = ctx.pathSuffix.replace(/^\//, "").split("/")
  const placeId = z.uuid().safeParse(parts[1])
  if (!placeId.success || parts.length < 2 || parts.length > 3)
    throw new MenuError(404, "Image not found")
  const uploading = parts.length === 2
  if (request.method !== (uploading ? "POST" : "GET"))
    throw new MenuError(405, uploading ? "Use POST" : "Use GET")
  await requirePlaceAccess(placeId.data, ctx, uploading)
  const directory = join(ctx.dataDir, "images", placeId.data)
  if (!uploading) {
    const parsed = imageId.safeParse(parts[2])
    if (!parsed.success) throw new MenuError(404, "Image not found")
    let bytes: Buffer
    try {
      bytes = await readFile(join(directory, parsed.data))
    } catch {
      throw new MenuError(404, "Image not found")
    }
    const extension = parsed.data.split(".")[1]
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": `image/${extension === "jpg" ? "jpeg" : extension}`,
        "cache-control": "private, no-cache",
        "x-content-type-options": "nosniff",
      },
    })
  }
  const reader = request.body?.getReader()
  if (!reader) throw new MenuError(400, "Image is empty")
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_IMAGE_BYTES) {
      await reader.cancel()
      throw new MenuError(413, "Image is too large (max 5 MB)")
    }
    chunks.push(value)
  }
  const bytes = Buffer.concat(chunks)
  const extension = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? "png"
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      ? "jpg"
      : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP"
        ? "webp"
        : null
  if (!extension) throw new MenuError(400, "Choose a JPEG, PNG or WebP image")
  const id = `${createHash("sha256").update(bytes).digest("hex")}.${extension}`
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, id), bytes)
  return Response.json({ imageId: id })
}
