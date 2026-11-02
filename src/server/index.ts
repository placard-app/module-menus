import { http } from "./http.ts"
import { mcpTools } from "./mcp.ts"
export const createModule = () => ({ createHttpApp: http, mcpTools })
