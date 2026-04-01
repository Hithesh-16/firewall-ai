---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---
# Architecture Patterns — AI Firewall

## API Response Format (proxy/)

```typescript
interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  meta?: { total: number; page: number; limit: number }
}
```

## Scanner Pattern (proxy/src/scanner/)

```typescript
interface ScannerResult {
  type: string        // e.g., 'AWS_ACCESS_KEY', 'EMAIL'
  severity: 'critical' | 'high' | 'medium' | 'low'
  value: string       // redacted/hashed version
  location: { start: number; end: number }
}

// All scanners follow this interface
interface Scanner {
  scan(input: string, context?: ScanContext): ScannerResult[]
}
```

## Provider Adapter Pattern (proxy/src/gateway/adapters/)

```typescript
interface ProviderAdapter {
  name: string
  convertRequest(openaiRequest: OpenAIRequest): ProviderRequest
  convertResponse(providerResponse: ProviderResponse): OpenAIResponse
  handleStream(stream: ReadableStream): AsyncIterable<string>
}
```

## Repository Pattern (proxy/src/db/)

```typescript
// SQLite operations use parameterized queries
const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
const logs = db.prepare('SELECT * FROM logs WHERE created_at > ? LIMIT ?').all(since, limit)
```

## React Hooks Pattern (gui/)

```typescript
// Custom hooks for proxy API calls
function useProxyApi<T>(endpoint: string): { data: T | null; loading: boolean; error: string | null }

// Redux for state management
const dispatch = useAppDispatch()
dispatch(chatSlice.actions.addMessage(message))
```

## Context Provider Pattern (core/context/)

```typescript
// All context providers follow this interface
interface ContextProvider {
  name: string
  getContextItems(query: string): Promise<ContextItem[]>
}
```
