const bridge = (
  globalThis as unknown as {
    __PLACARD_PLUGIN__: {
      jsxRuntime: {
        jsx: typeof import("react/jsx-runtime").jsx
        jsxs: typeof import("react/jsx-runtime").jsxs
        Fragment: typeof import("react/jsx-runtime").Fragment
      }
    }
  }
).__PLACARD_PLUGIN__

if (!bridge?.jsxRuntime) {
  throw new Error("Placard plugin host bridge missing (jsx-runtime). Rebuild/redeploy the web app.")
}

export const { jsx, jsxs, Fragment } = bridge.jsxRuntime
