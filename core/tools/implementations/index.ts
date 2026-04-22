import type { ContextItem, ToolExtras } from "../../index.js";

export type ToolImpl = (
  parameters: any,
  extras: ToolExtras,
) => Promise<ContextItem[]>;
