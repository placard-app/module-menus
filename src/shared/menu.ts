import { z } from "zod"

const id = z.string().uuid()
const text = z.string().trim().max(4000)
const name = z.string().trim().min(1).max(200)
const price = z.string().regex(/^\d{1,9}(\.\d{1,4})?$/, "Use a non-negative decimal amount")
export const imageId = z.string().regex(/^[a-f0-9]{64}\.(jpg|png|webp)$/)
export const ItemInput = z
  .object({
    id: id.optional(),
    name,
    description: text.optional(),
    imageId: imageId.optional(),
    price: price.optional(),
    variants: z.array(z.object({ name, price }).strict()).max(100).default([]),
    notes: text.optional(),
    dietaryLabels: z.array(name).max(50).default([]),
  })
  .strict()
export const SectionInput = z
  .object({ id: id.optional(), name, notes: text.optional(), items: z.array(ItemInput).max(1000) })
  .strict()
export const MenuInput = z
  .object({
    name,
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    sourceUrl: z
      .url()
      .refine((v) => /^https?:\/\//.test(v), "Use an HTTP(S) URL")
      .optional(),
    notes: text.optional(),
    sortOrder: z.number().int().nonnegative().optional(),
    sections: z.array(SectionInput).max(100),
  })
  .strict()
const base = { placeId: id }
const mutation = { ...base, requestId: id }
const existing = { ...mutation, menuId: id, expectedRevision: z.number().int().positive() }
export const schemas = {
  get_menus: z.object(base).strict(),
  save_menu: z
    .object({
      ...mutation,
      menuId: id.optional(),
      expectedRevision: z.number().int().positive().optional(),
      menu: MenuInput,
    })
    .strict()
    .refine(
      (v) => !!v.menuId === (v.expectedRevision !== undefined),
      "Replacing a menu requires menuId and expectedRevision",
    ),
  upsert_menu_items: z
    .object({
      ...existing,
      items: z
        .array(z.object({ sectionId: id, item: ItemInput }).strict())
        .min(1)
        .max(1000),
    })
    .strict(),
  delete_menu_items: z.object({ ...existing, itemIds: z.array(id).min(1).max(1000) }).strict(),
  delete_menu: z.object(existing).strict(),
}
export type Operation = keyof typeof schemas
export type Item = z.output<typeof ItemInput> & { id: string }
export type Section = Omit<z.output<typeof SectionInput>, "items"> & { id: string; items: Item[] }
export type Menu = Omit<z.output<typeof MenuInput>, "sections"> & {
  id: string
  placeId: string
  sortOrder: number
  revision: number
  updatedAt: string
  sections: Section[]
}
export class MenuError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
export type Context = {
  ownerId: string
  dataDir: string
  hostFetch?: (path: string, init?: RequestInit) => Promise<Response>
}
