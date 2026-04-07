import type { ApiClient } from "../api/client";
import { apiClient } from "../api/client";

export function useApi(): ApiClient {
  return apiClient;
}
