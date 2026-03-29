---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---
# TypeScript Coding Style — AI Firewall

## Types and Interfaces

- Add parameter and return types to exported functions
- Let TypeScript infer obvious local variable types
- Use `interface` for object shapes, `type` for unions/intersections/utilities
- Prefer string literal unions over `enum`
- Avoid `any` — use `unknown` and narrow safely
- Use generics when a value's type depends on the caller

## Immutability (CRITICAL)

ALWAYS create new objects, NEVER mutate existing ones:

```typescript
// WRONG: Mutation
user.name = name
results.push(user)

// CORRECT: Immutability
const updated = { ...user, name }
const newResults = [...results, updated]
```

## Input Validation

Use Zod for schema-based validation (especially on proxy routes):

```typescript
import { z } from 'zod'

const schema = z.object({
  email: z.string().email(),
  age: z.number().int().min(0).max(150)
})

type Input = z.infer<typeof schema>
```

## Error Handling

```typescript
async function doWork(): Promise<Result> {
  try {
    return await riskyOperation()
  } catch (error: unknown) {
    if (error instanceof Error) {
      logger.error('Operation failed', error)
      throw new Error(error.message)
    }
    throw new Error('Unexpected error')
  }
}
```

## File Organization

- 200-400 lines typical, 800 max
- Organize by feature/domain, not by type
- High cohesion, low coupling

## Console.log

- No `console.log` in production code
- Use the structured logger (proxy/src/logger/)
