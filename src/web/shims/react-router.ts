import type { LinkProps } from "react-router"

const bridge = (
  globalThis as unknown as {
    __PLACARD_PLUGIN__: { Link: (props: LinkProps) => unknown }
  }
).__PLACARD_PLUGIN__

if (!bridge?.Link) {
  throw new Error("Placard plugin host bridge missing (Link). Rebuild/redeploy the web app.")
}

export const Link = bridge.Link
