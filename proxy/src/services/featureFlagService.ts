/**
 * Feature Flag Service
 *
 * Simple feature flag system for gradual rollouts.
 * Flags can be set globally, per-org, or per-user.
 *
 * No external dependency (no GrowthBook). Flags stored in memory
 * and optionally loaded from policy.json.
 */

export interface FeatureFlag {
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  /** Percentage rollout (0-100). Null = use enabled boolean */
  readonly rolloutPercent: number | null;
  /** Specific user IDs to include/exclude */
  readonly includeUserIds?: readonly number[];
  readonly excludeUserIds?: readonly number[];
}

// ── State ──────────────────────────────────────────────────────

const flags = new Map<string, FeatureFlag>();

// ── CRUD ───────────────────────────────────────────────────────

export function setFlag(flag: FeatureFlag): void {
  flags.set(flag.name, flag);
}

export function removeFlag(name: string): boolean {
  return flags.delete(name);
}

export function getFlag(name: string): FeatureFlag | null {
  return flags.get(name) ?? null;
}

export function listFlags(): FeatureFlag[] {
  return Array.from(flags.values());
}

// ── Evaluation ─────────────────────────────────────────────────

/**
 * Check if a feature is enabled for a specific user.
 *
 * Decision order:
 *   1. Exclude list → false
 *   2. Include list → true
 *   3. Rollout percent → hash-based consistent assignment
 *   4. Enabled boolean → direct
 */
export function isFeatureEnabled(name: string, userId?: number): boolean {
  const flag = flags.get(name);
  if (!flag) return false;

  // Explicit exclude
  if (userId && flag.excludeUserIds?.includes(userId)) {
    return false;
  }

  // Explicit include
  if (userId && flag.includeUserIds?.includes(userId)) {
    return true;
  }

  // Percentage rollout
  if (flag.rolloutPercent !== null && userId) {
    const hash = simpleHash(`${name}:${userId}`);
    const bucket = hash % 100;
    return bucket < flag.rolloutPercent;
  }

  // Default
  return flag.enabled;
}

/**
 * Get the value of a feature flag with a default fallback.
 */
export function getFeatureValue<T>(
  name: string,
  defaultValue: T,
  userId?: number,
): T {
  const enabled = isFeatureEnabled(name, userId);
  // For boolean flags, return the enabled state cast as T
  // For more complex values, extend this with a values map
  return (enabled as unknown as T) ?? defaultValue;
}

// ── Bulk operations ────────────────────────────────────────────

export interface FlagSettings {
  readonly [flagName: string]: {
    readonly enabled: boolean;
    readonly rolloutPercent?: number;
    readonly description?: string;
  };
}

/**
 * Load flags from a settings object (e.g. from policy.json).
 */
export function loadFlagsFromSettings(settings: FlagSettings): number {
  let count = 0;
  for (const [name, config] of Object.entries(settings)) {
    setFlag({
      name,
      description: config.description ?? "",
      enabled: config.enabled,
      rolloutPercent: config.rolloutPercent ?? null,
    });
    count++;
  }
  return count;
}

// ── Reset ──────────────────────────────────────────────────────

export function clearAllFlags(): void {
  flags.clear();
}

// ── Helper ─────────────────────────────────────────────────────

/** Simple deterministic hash for consistent rollout bucketing */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}
