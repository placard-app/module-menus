# Placard Menus

Read and edit structured restaurant menus directly on Placard place details.
Organize menus into sections and items, add prices, variants and item photos, or
use an MCP assistant to enter information from a menu source.

Menus contributes a **Menus** place section rather than a separate navigation
page. The section appears for restaurants, cafés and bars. Existing menus remain
visible if a place's category changes.

## Requirements and permissions

- A Placard **SDK 1** host (`sdkVersion: 1.0.0`) with the `place-sections` and
  `persistent-data` capabilities.
- Manifest permission: `places.read`.
- Only the place owner can create, edit or delete menus and upload item images.
  Anyone with access to the place can read its menus and images.

The module runs inside the host, bundles its server dependencies and uses the
host's React web bridge. No separate server or core database migration is needed.

## Install

In **Settings → Module marketplace → Install from GitHub**, paste:

```text
https://github.com/JobiJoba/plugins#places.menus
```

Enable the module and make it visible for your account. Open a restaurant, café
or bar to find the Menus section. Keep the `#places.menus` selector so the installer
selects Menus releases in this multi-module repository.

Alternatively, upload Menus' `.placard-module` or `.zip` from
[Releases](https://github.com/JobiJoba/plugins/releases). To build locally, run
from the repository root:

```sh
pnpm install
pnpm --filter @placard-official/places.menus build
```

Upload `plugins/places.menus/dist/places.menus-<version>.zip` or the equivalent
`.placard-module`. The version comes from `placard.module.json`; both archives
contain the same package. Local installation does not require a GitHub Release.

## Edit a menu

1. Open a place you own and select **Add menu** in its Menus section.
2. Name the menu and, if known, enter its currency and source URL.
3. Add sections, then items with names, descriptions, prices, notes and any
   explicitly stated dietary labels.
4. Add variants for alternatives such as glass/bottle or small/large pricing.
5. Optionally upload an item photo, then select **Save menu**.

Multiple menus can represent lunch, dinner, drinks or other offerings. Menus,
sections and items can be reordered in the editor. Save applies the draft;
canceling keeps the previously saved menu.

### Prices and fields

- Prices are optional **strings** such as `"26.00"`. Use a non-negative amount
  with up to nine digits before the decimal point and up to four after it. Omit
  unreadable prices; do not use currency symbols, commas or negative amounts.
- Currency is optional and uses three uppercase letters, for example `EUR`.
- Each variant requires a name and a price. An item may have variants without a
  base price.
- Names are required and limited to 200 characters; descriptions and notes allow
  up to 4,000 characters.
- A menu supports up to 100 sections; each section supports up to 1,000 items.
  Each item supports up to 100 variants and 50 dietary labels.
- Source URLs must use HTTP or HTTPS. They are reference links; the module does
  not fetch them.

### Item photos

Upload JPEG, PNG or WebP images up to 5 MiB (5 × 1,024 × 1,024 bytes). The editor
supports preview, replacement and removal. Uploading stores the image immediately;
saving the menu applies its attachment to the item. Canceling a draft leaves the
previous attachment unchanged.

Removing or replacing an attachment does not delete the underlying file. Uploaded
files, including unused uploads, are retained; there is no automatic image cleanup.
Images are served only to users who can access the place.

## MCP

Connect an assistant through Placard's MCP settings. Ask it to interpret a photo,
PDF, text or webpage externally, locate the place through core search, then use
the module's tools:

| Tool exposed by Placard | Purpose |
| --- | --- |
| `places_menus__get_menus` | Read complete menus, stable IDs and current revisions |
| `places_menus__save_menu` | Create a menu or replace one complete menu |
| `places_menus__upsert_menu_items` | Add or replace items in existing sections |
| `places_menus__delete_menu_items` | Remove specified items atomically |
| `places_menus__delete_menu` | Delete one complete menu |

The module itself does not accept source documents or perform AI/OCR. Assistants
should omit uncertain information and unreadable prices, and include dietary
labels only when explicitly stated in the source.

### Create a menu

Call `places_menus__save_menu` with the following arguments, replacing `placeId`
with a real place UUID and `requestId` with a fresh UUID:

```json
{
  "placeId": "00000000-0000-4000-8000-000000000001",
  "requestId": "00000000-0000-4000-8000-000000000002",
  "menu": {
    "name": "Dinner",
    "currency": "EUR",
    "sections": [
      {
        "name": "Mains",
        "items": [
          { "name": "Sea bass", "price": "26.00" }
        ]
      }
    ]
  }
}
```

New menus, sections and items receive IDs when omitted. A save returns the stored
menu, including its ID, revision, timestamps and generated section/item IDs.

### Read and update safely

1. Call `places_menus__get_menus` with `{ "placeId": "<place UUID>" }`.
2. For an existing menu, pass its `menuId`, current `expectedRevision`, and a new
   `requestId` with each mutation.
3. To replace a complete menu, use `save_menu` with both `menuId` and
   `expectedRevision`. Preserve IDs for existing sections/items and include every
   field and entry you want to keep. Omitted content is removed by replacement.
4. To change only selected items, use `upsert_menu_items`. Existing item IDs
   replace the item in the specified section; omitted IDs create appended items.
   An upsert replaces the item's fields, so include existing fields you want to
   retain. It does not create sections.
5. On a revision conflict, read the menus again and reconcile before retrying with
   the current revision and a new request ID.

Mutation argument shapes, in addition to `placeId`:

| Operation | Arguments |
| --- | --- |
| `save_menu` | `requestId`, `menu`; add `menuId` and `expectedRevision` together for replacement |
| `upsert_menu_items` | `requestId`, `menuId`, `expectedRevision`, `items: [{ sectionId, item }]` |
| `delete_menu_items` | `requestId`, `menuId`, `expectedRevision`, `itemIds: ["<item UUID>"]` |
| `delete_menu` | `requestId`, `menuId`, `expectedRevision` |

Reuse a request ID only for an identical retry; reusing it with different input
causes a conflict. Batches are atomic: a failed batch does not partially apply.
Item upsert/delete batches contain 1–1,000 entries. Inputs reject unknown fields.

`sortOrder` is an optional zero-based menu position. New menus append when omitted;
existing menus keep their position. Section and item order follows array order.
Moving or deleting a menu can change the revisions of other menus whose positions
shift, so reread before subsequent edits to those menus.

## Persistence and backup

| Path | Contents |
| --- | --- |
| `<ctx.dataDir>/menus.sqlite` | Menus, schema migrations and mutation retry records |
| `<ctx.dataDir>/images/<placeId>/` | Item image files, including detached uploads |

The host supplies a persistent data directory, typically under its modules volume
at `.data/places.menus`. SQLite migrations run transactionally and connections
close after each operation.

Updates, disabling and uninstalling preserve the persistent data; reinstalling
restores access. Back up the **entire module data directory**, with writers
stopped, alongside the core database. Backing up only SQLite omits item photos.
Personal library exports do not include menus.

Menus for deleted or inaccessible places cannot be accessed. Restoring a
soft-deleted place restores access to its menus. There is no automatic orphan-data
purge in v1. Retained image files do not provide a menu revision-history interface.

## Develop

Requires Node.js 24+ and pnpm 12.4.1. Run from the repository root:

```sh
pnpm install
pnpm --filter @placard-official/places.menus typecheck
pnpm --filter @placard-official/places.menus test
pnpm --filter @placard-official/places.menus build
```

Unit tests cover validation, revision conflicts, retry protection, permission
checks, atomic mutations and SQLite backup/restore. The build recreates this
module's `pack/` directory and emits both installable archives under `dist/`.

| Path | Purpose |
| --- | --- |
| `placard.module.json` | SDK capabilities, permissions, place section and tool declarations |
| `src/shared/menu.ts` | Shared validation schemas and types |
| `src/server/service.ts` | Access checks, menu mutations, ordering and retry handling |
| `src/server/storage.ts` | SQLite storage and schema migrations |
| `src/server/http.ts`, `images.ts`, `mcp.ts` | HTTP operations, image storage and MCP tools |
| `src/web/MenuSection.tsx` | Place section and menu editor |
| `tests/` | Unit tests and optional browser tests |
| `scripts/build.mjs` | Server/web bundling and archive creation |

For HTTP integrations, POST the same tool arguments to
`/api/m/places.menus/<operation>`, using the unprefixed operation name such as
`get_menus` or `save_menu`. Image upload uses a raw-body POST to
`/api/m/places.menus/images/<placeId>` and returns an `imageId`; images are read
with GET `/api/m/places.menus/images/<placeId>/<imageId>`. Host authentication and
place access checks apply to these routes.

### Browser tests against core

The optional Playwright suite needs Docker running and a compatible Placard core
checkout with its dependencies installed. By default, it expects a sibling
`Placard` directory beside this repository. From the repository root:

```sh
pnpm --dir ../Placard --filter @placard/web build
pnpm --filter @placard-official/places.menus build
pnpm --filter @placard-official/places.menus exec playwright install chromium
pnpm --filter @placard-official/places.menus test:e2e
```

For another checkout, set `PLACARD_CORE_DIR` to its absolute path when running the
suite, and build that checkout's web package first:

```sh
PLACARD_CORE_DIR=/absolute/path/to/Placard pnpm --filter @placard-official/places.menus test:e2e
```

The suite starts a real host on port 3100 using the core's test server and a
disposable PostGIS database. It installs the ZIP and exercises desktop/mobile
editing, item photos, MCP import, update/uninstall retention and module visibility.
It writes host module/media data under this module's `test-results/` directory.
Browser tests are not part of the root `pnpm test` or release workflow.

See the [workspace release instructions](../../README.md#release-one-module) for
tags such as `places.menus@0.1.0`.

## Troubleshooting

- **No Menus section:** check SDK/capability support, module enablement and account
  visibility. Places outside restaurant/café/bar only show the section if menus
  already exist.
- **Editing unavailable:** confirm you own the place; read access does not grant
  menu editing rights.
- **Menu changed:** another edit or menu reorder changed the revision. Reload,
  reconcile your changes and save against the current revision.
- **Image rejected:** use JPEG, PNG or WebP within the size limit, then save the
  menu to attach it.
- **Wrong GitHub release selected:** use the full URL with `#places.menus`, or
  upload the Menus release asset directly.

## License

[GNU Affero General Public License v3 only](LICENSE) (`AGPL-3.0-only`).
