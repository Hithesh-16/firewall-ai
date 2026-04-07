/**
 * Provider Catalog — barrel file
 *
 * Combines popular, cloud, and local providers into a single catalog.
 */

export type { CatalogModel, CatalogProvider } from "./types";

import { POPULAR_PROVIDERS } from "./popular";
import { CLOUD_PROVIDERS } from "./cloud";
import { LOCAL_PROVIDERS } from "./local";

export const PROVIDER_CATALOG = [...POPULAR_PROVIDERS, ...CLOUD_PROVIDERS, ...LOCAL_PROVIDERS];

/** Subset of popular providers shown first in the UI */
export const POPULAR_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "gemini",
  "mistral",
  "openrouter",
  "ollama",
];
