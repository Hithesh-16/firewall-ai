/**
 * Provider Catalog — Type Definitions
 */

export interface CatalogModel {
  id: string;
  name: string;
  contextLength: number;
  inputCostPer1k?: number;
  outputCostPer1k?: number;
}

export interface CatalogProvider {
  id: string;
  name: string;
  icon: string;
  description: string;
  baseUrl: string;
  apiKeyUrl?: string;
  requiresApiKey: boolean;
  isLocal?: boolean;
  models: CatalogModel[];
  tags: string[];
}
