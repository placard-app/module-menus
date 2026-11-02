# Placard Menus

An independent Marketplace module (`places.menus`) for restaurant menus. Requires Node 24+
and a Placard SDK 1 host with `place-sections` and `persistent-data` capabilities.

## Build and install

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Install `https://github.com/JobiJoba/plugins#places.menus` through the GitHub installer, or
upload `dist/places.menus-0.1.0.zip` in Settings → Module marketplace. The module contributes
an editable Menus section to restaurant, café and bar place details, without adding a
navigation page. Existing menus remain visible after a category change. Place owners
can edit; anyone with access to the place can read. No separate server or core database
migration is required. The module bundles its server dependencies and uses the host's React.

The release workflow publishes ZIP and `.placard-module` assets for module tags such as `places.menus@0.1.0`; see the [workspace release instructions](../../README.md#release-one-module).
A GitHub remote/release is not needed for local ZIP installation.

## Manual editing and MCP

Add menus, ordered sections and items through the place detail page. Prices are optional
non-negative decimal strings. Set currency only when known. Variants support glass/bottle
or small/large prices. Items support JPEG, PNG and WebP image uploads up to 5 MB, with
preview, replacement and removal in the editor. Save the menu to apply image changes. Notes and explicitly stated dietary labels are retained.

Connect your assistant through Placard's normal MCP settings. Ask it to interpret an image,
PDF, text or webpage externally, locate the restaurant, then call:

- `places_menus__get_menus`: read menus, IDs and revisions.
- `places_menus__save_menu`: create or explicitly replace a complete menu.
- `places_menus__upsert_menu_items`: add/update items in existing sections.
- `places_menus__delete_menu_items`: remove specified items.
- `places_menus__delete_menu`: delete a menu.

A create example (replace UUIDs with your place and a new request ID):

```json
{
  "placeId": "00000000-0000-4000-8000-000000000001",
  "requestId": "00000000-0000-4000-8000-000000000002",
  "menu": {
    "name": "Dinner",
    "currency": "EUR",
    "sections": [{
      "name": "Mains",
      "items": [{ "name": "Sea bass", "price": "26.00" }]
    }]
  }
}
```

Replacing requires `menuId` and `expectedRevision`. Get the current menu first and preserve
IDs for existing sections/items. Reuse a request ID only for an identical retry. All mutation
batches are atomic; conflicts require rereading before editing. `sortOrder` is an optional
zero-based menu position; omitted positions append new menus. Moving a menu updates revisions
of other menus whose positions change. Section/item order follows array order.

The module never fetches source URLs, accepts source files, or runs AI/OCR. Source URLs are
optional links. AI callers should omit uncertain information and never infer dietary labels.

## Persistence and backup

The SQLite database is `<ctx.dataDir>/menus.sqlite`, under the host's persistent modules
volume (`.data/places.menus`). It uses transactional schema migrations and closes connections
after each operation. Item images are stored in `<ctx.dataDir>/images/<placeId>/` and
served only to users with access to the place. Removing/replacing an image detaches it from
the item; files are retained for backup and existing revisions. Updates, disabling and uninstall preserve it; reinstall restores access.
Back up the entire modules volume with writers stopped, alongside the core database. Personal
library exports do not include menus. Menus for deleted/inaccessible places are inaccessible;
restoring a soft-deleted place restores access. There is no automatic orphan-data purge in v1.

## Browser tests against core

With Docker running and the core repository at `../../../Placard` (or `PLACARD_CORE_DIR`):

```sh
pnpm --dir ../../../Placard --filter @placard/web build
pnpm build
pnpm test:e2e
```

These launch a disposable PostGIS database and real Placard host, install the ZIP, exercise
desktop/mobile editing and MCP import, then verify update/uninstall retention and visibility.
Unit tests cover validation, revision conflicts, retry protection, permission checks,
atomic mutations and SQLite backup/restore.
