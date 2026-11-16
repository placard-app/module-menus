import styles from "./menu.css"
import { useEffect, useState } from "react"
import type { Item, Menu, Section } from "../shared/menu.ts"

type Props = { placeId: string; category: string; isOwner: boolean }
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
function RemoveButton({
  label,
  disabled,
  onClick,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      className="remove"
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <svg
        aria-hidden="true"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 7h16M10 11v6m4-6v6M5.5 7l1 12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
      </svg>
    </button>
  )
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
  if (length < 2) return null
  return (
    <span className="order">
      <button
        type="button"
        title="Move up"
        aria-label="Move up"
        disabled={index === 0}
        onClick={() => change(-1)}
      >
        ↑
      </button>
      <button
        type="button"
        title="Move down"
        aria-label="Move down"
        disabled={index === length - 1}
        onClick={() => change(1)}
      >
        ↓
      </button>
    </span>
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
          <button className="primary" onClick={create} disabled={busy}>
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
          <div className="menu-tabs" role="group" aria-label="Choose menu">
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
                <div className="course" key={section.id}>
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
                        <p className="variant-line" key={i}>
                          {variant.name}: {variant.price} {selected.currency}
                        </p>
                      ))}
                      {item.dietaryLabels.length > 0 && (
                        <ul className="dietary">
                          {item.dietaryLabels.map((label, index) => (
                            <li key={index}>{label}</li>
                          ))}
                        </ul>
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
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => setDraft(structuredClone(selected))}
                  >
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
                  {!confirmDelete && (
                    <RemoveButton
                      label="Delete menu"
                      disabled={busy}
                      onClick={() => setConfirmDelete(true)}
                    />
                  )}
                  {confirmDelete && (
                    <div className="confirm">
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
                    </div>
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
                  <RemoveButton
                    label="Remove section"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        sections: draft.sections.filter((_, i) => i !== sectionIndex),
                      })
                    }
                  />
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
                          <RemoveButton
                            label="Remove variant"
                            onClick={() =>
                              change({ variants: item.variants.filter((_, i) => i !== vi) })
                            }
                          />
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
                        <RemoveButton
                          label="Remove item"
                          onClick={() =>
                            updateSection(sectionIndex, {
                              ...section,
                              items: section.items.filter((_, i) => i !== itemIndex),
                            })
                          }
                        />
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
              <button className="primary" type="submit">
                {busy ? "Saving…" : "Save menu"}
              </button>
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
