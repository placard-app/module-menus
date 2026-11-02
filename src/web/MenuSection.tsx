import { useEffect, useState } from "react"
import type { Item, Menu, Section } from "../shared/menu.ts"

type Props = { placeId: string; category: string; isOwner: boolean }
const styles = `
.pm{border-top:1px solid color-mix(in srgb,currentColor 18%,transparent);padding-top:24px;display:grid;gap:16px}.pm *{box-sizing:border-box}.pm header,.pm .row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.pm header h2{flex:1;font-size:1.2rem;font-weight:600}.pm button{min-height:44px;padding:8px 12px;border:1px solid color-mix(in srgb,currentColor 24%,transparent);border-radius:6px;background:transparent;color:inherit;cursor:pointer}.pm button:disabled{opacity:.45;cursor:default}.pm button[aria-pressed=true]{background:color-mix(in srgb,currentColor 14%,transparent)}.pm label{display:grid;gap:4px;font-size:.875rem;flex:1;min-width:130px}.pm input,.pm textarea{width:100%;min-height:44px;padding:8px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:4px;background:transparent;color:inherit}.pm form,.pm fieldset{display:grid;gap:12px;min-width:0}.pm fieldset{border:1px solid color-mix(in srgb,currentColor 20%,transparent);padding:12px;border-radius:6px}.pm legend{padding:0 6px}.pm .item{padding:12px 0;border-bottom:1px solid color-mix(in srgb,currentColor 12%,transparent)}.pm .item-title{display:flex;justify-content:space-between;gap:16px;font-weight:500}.pm small,.pm .muted{opacity:.7}.pm [role=alert]{color:#c65b45}.pm a{text-decoration:underline}.pm h3{font-weight:600;margin:16px 0 8px}.pm .item p{white-space:pre-wrap}.pm .row.variant{align-items:flex-end}.pm .item-image{display:block;width:180px;max-width:100%;height:130px;object-fit:cover;border-radius:6px;margin:8px 0}.pm input[type=file]{min-width:0}.pm .actions{display:flex;gap:8px;flex-wrap:wrap}
`
async function call<T>(operation: string, input: unknown): Promise<T> {
  const response = await fetch(`/api/m/places.menus/${operation}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? "Could not save menu")
  return data as T
}
function menuInput(menu: Menu) {
  const { id, placeId, revision, updatedAt, ...input } = menu
  return input
}
function move<T>(items: T[], index: number, delta: number): T[] {
  const next = [...items]
  const to = index + delta
  if (to < 0 || to >= next.length) return next
  ;[next[index], next[to]] = [next[to], next[index]]
  return next
}
function Order({
  index,
  length,
  change,
}: {
  index: number
  length: number
  change: (delta: number) => void
}) {
  return (
    <>
      <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => change(-1)}>
        ↑
      </button>
      <button
        type="button"
        aria-label="Move down"
        disabled={index === length - 1}
        onClick={() => change(1)}
      >
        ↓
      </button>
    </>
  )
}
function Field({
  label,
  value,
  change,
  required = false,
}: {
  label: string
  value?: string
  change: (value: string) => void
  required?: boolean
}) {
  return (
    <label>
      {label}
      <input
        required={required}
        value={value ?? ""}
        onChange={(event) => change(event.target.value)}
      />
    </label>
  )
}
function imageUrl(placeId: string, imageId: string) {
  return `/api/m/places.menus/images/${placeId}/${imageId}`
}
function ItemImage({
  placeId,
  item,
  change,
  setBusy,
}: {
  placeId: string
  item: Item
  change: (imageId: string | undefined) => void
  setBusy: (busy: boolean) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  async function upload(file: File) {
    setError(null)
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Choose a JPEG, PNG or WebP image")
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Image is too large (max 5 MB)")
      return
    }
    setUploading(true)
    setBusy(true)
    try {
      const response = await fetch(`/api/m/places.menus/images/${placeId}`, {
        method: "POST",
        headers: { "content-type": file.type },
        body: file,
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Could not upload image")
      change(data.imageId)
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not upload image")
    } finally {
      setUploading(false)
      setBusy(false)
    }
  }
  return (
    <div>
      <label>
        {item.imageId ? "Replace item image" : "Item image"}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ""
            if (file) void upload(file)
          }}
        />
      </label>
      <small>JPEG, PNG or WebP, up to 5 MB. Save the menu to keep your changes.</small>
      {uploading && <p role="status">Uploading image…</p>}
      {error && <p role="alert">{error}</p>}
      {item.imageId && (
        <>
          <img
            className="item-image"
            src={imageUrl(placeId, item.imageId)}
            alt={item.name || "Item image preview"}
          />
          <button type="button" onClick={() => change(undefined)}>
            Remove image
          </button>
        </>
      )}
    </div>
  )
}
const optional = (value: string) => value || undefined

export function MenuSection({ placeId, category, isOwner }: Props) {
  const [menus, setMenus] = useState<Menu[] | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [draft, setDraft] = useState<Menu | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Retain the exact request ID after a transport failure, so retrying cannot duplicate a create.
  const [pending, setPending] = useState<{ fingerprint: string; requestId: string } | null>(null)
  useEffect(() => {
    let current = true
    setMenus(null)
    setDraft(null)
    setError(null)
    setActive(null)
    call<Menu[]>("get_menus", { placeId })
      .then((value) => {
        if (current) setMenus(value)
      })
      .catch((error) => {
        if (current) setError(error.message)
      })
    return () => {
      current = false
    }
  }, [placeId])
  async function mutate(operation: string, input: Record<string, unknown>) {
    const fingerprint = JSON.stringify({ operation, input })
    const requestId = pending?.fingerprint === fingerprint ? pending.requestId : crypto.randomUUID()
    setPending({ fingerprint, requestId })
    setBusy(true)
    setError(null)
    try {
      const result = await call<Menu>(operation, { ...input, requestId })
      const next = await call<Menu[]>("get_menus", { placeId })
      setMenus(next)
      setActive(result.id ?? null)
      setDraft(null)
      setConfirmDelete(false)
      setPending(null)
    } catch (error) {
      setError(error instanceof Error ? error.message : "Operation failed")
    } finally {
      setBusy(false)
    }
  }
  const selected = menus?.find((menu) => menu.id === active) ?? menus?.[0]
  if (menus?.length === 0 && !["restaurant", "cafe", "bar"].includes(category)) return null
  function create() {
    setDraft({
      id: crypto.randomUUID(),
      placeId,
      name: "",
      revision: 0,
      updatedAt: "",
      sortOrder: menus?.length ?? 0,
      sections: [],
    })
    setError(null)
  }
  function updateSection(index: number, section: Section) {
    if (draft)
      setDraft({
        ...draft,
        sections: draft.sections.map((old, i) => (i === index ? section : old)),
      })
  }
  function save(menu: Menu) {
    return mutate("save_menu", {
      placeId,
      ...(menu.revision ? { menuId: menu.id, expectedRevision: menu.revision } : {}),
      menu: menuInput(menu),
    })
  }
  return (
    <section className="pm" aria-label="Menus">
      <style>{styles}</style>
      <header>
        <h2>Menus</h2>
        {isOwner && !draft && (
          <button onClick={create} disabled={busy}>
            + Add menu
          </button>
        )}
      </header>
      {error && (
        <p role="alert">
          {error}{" "}
          <button
            disabled={busy}
            onClick={() => {
              void call<Menu[]>("get_menus", { placeId })
                .then((value) => {
                  setMenus(value)
                  setDraft(null)
                  setError(null)
                })
                .catch((e) => setError(e.message))
            }}
          >
            Reload menus
          </button>
        </p>
      )}
      {!menus && !error && <p role="status">Loading menus…</p>}
      {menus?.length === 0 && !draft && (
        <p className="muted">
          No menu yet. Add one manually or ask your connected AI assistant to import one through
          MCP.
        </p>
      )}
      {!draft && (
        <>
          <div className="row" aria-label="Choose menu">
            {menus?.map((menu) => (
              <button
                key={menu.id}
                aria-pressed={selected?.id === menu.id}
                onClick={() => {
                  setActive(menu.id)
                  setConfirmDelete(false)
                }}
              >
                {menu.name}
              </button>
            ))}
          </div>
          {selected && (
            <>
              {selected.notes && <p>{selected.notes}</p>}
              {selected.sections.map((section) => (
                <div key={section.id}>
                  <h3>{section.name}</h3>
                  {section.notes && <p>{section.notes}</p>}
                  {section.items.map((item) => (
                    <div className="item" key={item.id}>
                      <div className="item-title">
                        <span>{item.name}</span>
                        <span>{item.price ? `${item.price} ${selected.currency ?? ""}` : ""}</span>
                      </div>
                      {item.imageId && (
                        <img
                          className="item-image"
                          src={imageUrl(placeId, item.imageId)}
                          alt={item.name}
                          loading="lazy"
                        />
                      )}
                      {item.description && <p>{item.description}</p>}
                      {item.variants.map((variant, i) => (
                        <p key={i}>
                          {variant.name}: {variant.price} {selected.currency}
                        </p>
                      ))}
                      {item.dietaryLabels.length > 0 && (
                        <small>{item.dietaryLabels.join(" · ")}</small>
                      )}
                      {item.notes && (
                        <p>
                          <small>{item.notes}</small>
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ))}
              <small>
                Updated {new Date(selected.updatedAt).toLocaleDateString()}
                {selected.sourceUrl && (
                  <>
                    {" "}
                    ·{" "}
                    <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">
                      View source
                    </a>
                  </>
                )}
              </small>
              {isOwner && (
                <div className="actions">
                  <button disabled={busy} onClick={() => setDraft(structuredClone(selected))}>
                    Edit menu
                  </button>
                  <Order
                    index={menus!.indexOf(selected)}
                    length={menus!.length}
                    change={(delta) => {
                      const index = menus!.indexOf(selected) + delta
                      void save({ ...selected, sortOrder: index })
                    }}
                  />
                  <button disabled={busy} onClick={() => setConfirmDelete(true)}>
                    Delete menu
                  </button>
                  {confirmDelete && (
                    <>
                      <span>Delete {selected.name}?</span>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void mutate("delete_menu", {
                            placeId,
                            menuId: selected.id,
                            expectedRevision: selected.revision,
                          })
                        }
                      >
                        Confirm delete
                      </button>
                      <button onClick={() => setConfirmDelete(false)}>Keep menu</button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
      {draft && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void save(draft)
          }}
        >
          <fieldset disabled={busy}>
            <legend>{draft.revision ? "Edit menu" : "New menu"}</legend>
            <div className="row">
              <Field
                label="Menu name"
                required
                value={draft.name}
                change={(name) => setDraft({ ...draft, name })}
              />
              <Field
                label="Currency (e.g. EUR)"
                value={draft.currency}
                change={(currency) =>
                  setDraft({ ...draft, currency: optional(currency.toUpperCase()) })
                }
              />
            </div>
            <Field
              label="Source URL"
              value={draft.sourceUrl}
              change={(sourceUrl) => setDraft({ ...draft, sourceUrl: optional(sourceUrl) })}
            />
            <Field
              label="Menu notes"
              value={draft.notes}
              change={(notes) => setDraft({ ...draft, notes: optional(notes) })}
            />
            {draft.sections.map((section, sectionIndex) => (
              <fieldset key={section.id}>
                <legend>Section {sectionIndex + 1}</legend>
                <Field
                  label="Section name"
                  required
                  value={section.name}
                  change={(name) => updateSection(sectionIndex, { ...section, name })}
                />
                <Field
                  label="Section notes"
                  value={section.notes}
                  change={(notes) =>
                    updateSection(sectionIndex, { ...section, notes: optional(notes) })
                  }
                />
                <div className="actions">
                  <Order
                    index={sectionIndex}
                    length={draft.sections.length}
                    change={(delta) =>
                      setDraft({ ...draft, sections: move(draft.sections, sectionIndex, delta) })
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        sections: draft.sections.filter((_, i) => i !== sectionIndex),
                      })
                    }
                  >
                    Remove section
                  </button>
                </div>
                {section.items.map((item, itemIndex) => {
                  const change = (patch: Partial<Item>) =>
                    updateSection(sectionIndex, {
                      ...section,
                      items: section.items.map((old, i) =>
                        i === itemIndex ? { ...old, ...patch } : old,
                      ),
                    })
                  return (
                    <fieldset key={item.id}>
                      <legend>Item {itemIndex + 1}</legend>
                      <div className="row">
                        <Field
                          label="Item name"
                          required
                          value={item.name}
                          change={(name) => change({ name })}
                        />
                        <Field
                          label="Price"
                          value={item.price}
                          change={(price) => change({ price: optional(price) })}
                        />
                      </div>
                      <ItemImage
                        placeId={placeId}
                        item={item}
                        setBusy={setBusy}
                        change={(imageId) =>
                          setDraft(
                            (current) =>
                              current && {
                                ...current,
                                sections: current.sections.map((entry) =>
                                  entry.id !== section.id
                                    ? entry
                                    : {
                                        ...entry,
                                        items: entry.items.map((old) =>
                                          old.id !== item.id ? old : { ...old, imageId },
                                        ),
                                      },
                                ),
                              },
                          )
                        }
                      />
                      <Field
                        label="Description"
                        value={item.description}
                        change={(description) => change({ description: optional(description) })}
                      />
                      <Field
                        label="Item notes"
                        value={item.notes}
                        change={(notes) => change({ notes: optional(notes) })}
                      />
                      <Field
                        label="Dietary labels (comma separated, only if stated)"
                        value={item.dietaryLabels.join(", ")}
                        change={(value) =>
                          change({
                            dietaryLabels: value ? value.split(",").map((v) => v.trim()) : [],
                          })
                        }
                      />
                      {item.variants.map((variant, vi) => (
                        <div className="row variant" key={vi}>
                          <Field
                            label="Variant name"
                            required
                            value={variant.name}
                            change={(name) =>
                              change({
                                variants: item.variants.map((v, i) =>
                                  i === vi ? { ...v, name } : v,
                                ),
                              })
                            }
                          />
                          <Field
                            label="Variant price"
                            required
                            value={variant.price}
                            change={(price) =>
                              change({
                                variants: item.variants.map((v, i) =>
                                  i === vi ? { ...v, price } : v,
                                ),
                              })
                            }
                          />
                          <button
                            type="button"
                            onClick={() =>
                              change({ variants: item.variants.filter((_, i) => i !== vi) })
                            }
                          >
                            Remove variant
                          </button>
                        </div>
                      ))}
                      <div className="actions">
                        <button
                          type="button"
                          onClick={() =>
                            change({ variants: [...item.variants, { name: "", price: "" }] })
                          }
                        >
                          Add variant
                        </button>
                        <Order
                          index={itemIndex}
                          length={section.items.length}
                          change={(delta) =>
                            updateSection(sectionIndex, {
                              ...section,
                              items: move(section.items, itemIndex, delta),
                            })
                          }
                        />
                        <button
                          type="button"
                          onClick={() =>
                            updateSection(sectionIndex, {
                              ...section,
                              items: section.items.filter((_, i) => i !== itemIndex),
                            })
                          }
                        >
                          Remove item
                        </button>
                      </div>
                    </fieldset>
                  )
                })}
                <button
                  type="button"
                  onClick={() =>
                    updateSection(sectionIndex, {
                      ...section,
                      items: [
                        ...section.items,
                        { id: crypto.randomUUID(), name: "", variants: [], dietaryLabels: [] },
                      ],
                    })
                  }
                >
                  Add item
                </button>
              </fieldset>
            ))}
            <button
              type="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  sections: [...draft.sections, { id: crypto.randomUUID(), name: "", items: [] }],
                })
              }
            >
              Add section
            </button>
            <div className="actions">
              <button type="submit">{busy ? "Saving…" : "Save menu"}</button>
              <button
                type="button"
                onClick={() => {
                  setDraft(null)
                  setError(null)
                }}
              >
                Cancel
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  )
}
