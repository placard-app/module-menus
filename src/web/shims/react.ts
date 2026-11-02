const bridge = (
  globalThis as unknown as {
    __PLACARD_PLUGIN__: { React: typeof import("react") }
  }
).__PLACARD_PLUGIN__

if (!bridge?.React) {
  throw new Error("Placard plugin host bridge missing (React). Rebuild/redeploy the web app.")
}

const R = bridge.React
export default R
export const {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useId,
  useLayoutEffect,
  createElement,
  Fragment,
  Children,
  cloneElement,
  isValidElement,
  createContext,
  useContext,
  useReducer,
  memo,
  forwardRef,
  StrictMode,
} = R
