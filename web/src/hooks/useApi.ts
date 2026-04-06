import { apiClient, ApiClient } from "../api/client";

export function useApi(): ApiClient {
  return apiClient;
}
