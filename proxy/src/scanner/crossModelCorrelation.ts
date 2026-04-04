/**
 * Cross-Model Correlation Scanner
 *
 * Correlates attacks across multiple model endpoints into unified incidents.
 * Single Responsibility: Only correlates model events. No policy decisions.
 *
 * SimHash fingerprinting + hamming distance < 5 for text similarity.
 * Severity: 2 models = medium, 3+ = high, 3+ models AND 2+ users = critical.
 */

import { createHmac } from "crypto";

// ── Types ────────────────────────────────────────────────────────────────

export interface ModelEvent {
  readonly model: string;
  readonly userId?: string;
  readonly text: string;
  readonly riskScore: number;
  readonly categories: readonly string[];
  readonly timestamp?: number;
}

export type IncidentSeverity = "low" | "medium" | "high" | "critical";

export interface Incident {
  readonly id: string;
  readonly events: readonly StoredEvent[];
  readonly models: readonly string[];
  readonly users: readonly string[];
  readonly severity: IncidentSeverity;
  readonly createdAt: number;
  readonly lastEventAt: number;
}

export interface CorrelationResult {
  readonly isCorrelated: boolean;
  readonly incident?: Incident;
  readonly newIncident: boolean;
}

interface StoredEvent {
  readonly model: string;
  readonly userId: string;
  readonly fingerprint: string;
  readonly riskScore: number;
  readonly categories: readonly string[];
  readonly timestamp: number;
}

// ── Configuration & Store ────────────────────────────────────────────────

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const HAMMING_THRESHOLD = 5;
const SHINGLE_SIZE = 3;
let ttlMs = DEFAULT_TTL_MS;
const incidents: Map<
  string,
  { events: StoredEvent[]; createdAt: number; lastEventAt: number }
> = new Map();
const eventStore: StoredEvent[] = [];

// ── Helpers ──────────────────────────────────────────────────────────────

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function generateShingles(text: string): readonly string[] {
  const words = text.split(" ");
  if (words.length < SHINGLE_SIZE) return [text];
  const shingles: string[] = [];
  for (let i = 0; i <= words.length - SHINGLE_SIZE; i++) {
    shingles.push(words.slice(i, i + SHINGLE_SIZE).join(" "));
  }
  return shingles;
}

function fnv1a32(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash;
}

function computeSimHash(shingles: readonly string[]): string {
  const bits = 64;
  const counts = new Array<number>(bits).fill(0);
  for (const shingle of shingles) {
    const hashLow = fnv1a32(shingle);
    const hashHigh = fnv1a32(`salt:${shingle}`);
    for (let i = 0; i < 32; i++) {
      counts[i] += (hashLow >>> i) & 1 ? 1 : -1;
      counts[32 + i] += (hashHigh >>> i) & 1 ? 1 : -1;
    }
  }
  let hex = "";
  for (let i = 0; i < bits; i += 4) {
    let nibble = 0;
    for (let j = 0; j < 4; j++) {
      if (counts[i + j] > 0) nibble |= 1 << j;
    }
    hex += nibble.toString(16);
  }
  return hex;
}

function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Infinity;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    distance +=
      (diff & 1) + ((diff >> 1) & 1) + ((diff >> 2) & 1) + ((diff >> 3) & 1);
  }
  return distance;
}

function generateIncidentId(fingerprint: string, timestamp: number): string {
  const hmac = createHmac("sha256", "incident-id-seed");
  hmac.update(`${fingerprint}:${timestamp}`);
  return `INC-${hmac.digest("hex").slice(0, 12)}`;
}

function pruneExpiredEvents(now: number): void {
  const cutoff = now - ttlMs;
  let i = 0;
  while (i < eventStore.length && eventStore[i].timestamp < cutoff) i++;
  if (i > 0) eventStore.splice(0, i);
}

function determineSeverity(
  models: readonly string[],
  users: readonly string[],
): IncidentSeverity {
  if (models.length >= 3 && users.length >= 2) return "critical";
  if (models.length >= 3) return "high";
  if (models.length >= 2) return "medium";
  return "low";
}

function findCorrelatedEvents(
  fingerprint: string,
  userId: string,
): StoredEvent[] {
  return eventStore.filter((event) => {
    const textSimilar =
      hammingDistance(event.fingerprint, fingerprint) <= HAMMING_THRESHOLD;
    const sameUser = userId !== "" && event.userId === userId;
    return textSimilar || sameUser;
  });
}

function buildIncident(
  events: readonly StoredEvent[],
  incidentId: string,
): Incident {
  const models = [...new Set(events.map((e) => e.model))];
  const users = [
    ...new Set(events.map((e) => e.userId).filter((u) => u !== "")),
  ];
  const timestamps = events.map((e) => e.timestamp);
  return {
    id: incidentId,
    events,
    models,
    users,
    severity: determineSeverity(models, users),
    createdAt: Math.min(...timestamps),
    lastEventAt: Math.max(...timestamps),
  };
}

// ── Public API ───────────────────────────────────────────────────────────

/** Record a model event and check for cross-model correlation. */
export function recordModelEvent(event: ModelEvent): CorrelationResult {
  const now = event.timestamp ?? Date.now();
  pruneExpiredEvents(now);

  const normalized = normalizeText(event.text);
  const shingles = generateShingles(normalized);
  const fingerprint = computeSimHash(shingles);
  const userId = event.userId ?? "";

  const storedEvent: StoredEvent = {
    model: event.model,
    userId,
    fingerprint,
    riskScore: event.riskScore,
    categories: [...event.categories],
    timestamp: now,
  };

  // Find correlated events BEFORE adding current event
  const correlated = findCorrelatedEvents(fingerprint, userId);

  // Add event to store
  eventStore.push(storedEvent);

  // Need 2+ models for correlation (including current event's model)
  const allEvents = [...correlated, storedEvent];
  const distinctModels = new Set(allEvents.map((e) => e.model));

  if (distinctModels.size < 2) {
    return { isCorrelated: false, newIncident: false };
  }

  // Check if this maps to an existing incident
  for (const [incidentId, data] of incidents) {
    const incidentFingerprints = data.events.map((e) => e.fingerprint);
    const matchesExisting = incidentFingerprints.some(
      (fp) => hammingDistance(fp, fingerprint) <= HAMMING_THRESHOLD,
    );
    const incidentUsers = data.events.map((e) => e.userId);
    const matchesUser = userId !== "" && incidentUsers.includes(userId);

    if (matchesExisting || matchesUser) {
      const updatedEvents = [...data.events, storedEvent];
      const updatedData = {
        events: updatedEvents,
        createdAt: data.createdAt,
        lastEventAt: now,
      };
      incidents.set(incidentId, updatedData);

      return {
        isCorrelated: true,
        incident: buildIncident(updatedEvents, incidentId),
        newIncident: false,
      };
    }
  }

  // Create new incident
  const incidentId = generateIncidentId(fingerprint, now);
  const incidentData = {
    events: allEvents,
    createdAt: Math.min(...allEvents.map((e) => e.timestamp)),
    lastEventAt: now,
  };
  incidents.set(incidentId, incidentData);

  return {
    isCorrelated: true,
    incident: buildIncident(allEvents, incidentId),
    newIncident: true,
  };
}

/** Get all active (non-expired) incidents. */
export function getActiveIncidents(): readonly Incident[] {
  cleanExpiredIncidents();

  const result: Incident[] = [];
  for (const [incidentId, data] of incidents) {
    result.push(buildIncident(data.events, incidentId));
  }
  return result;
}

/** Remove incidents whose latest event is older than the TTL. */
export function cleanExpiredIncidents(): void {
  const cutoff = Date.now() - ttlMs;
  for (const [incidentId, data] of incidents) {
    if (data.lastEventAt < cutoff) {
      incidents.delete(incidentId);
    }
  }
}

/** Clear all state. Useful for testing. */
export function clearAllCorrelations(): void {
  eventStore.length = 0;
  incidents.clear();
}

/** Set the TTL for events and incidents. Useful for testing. */
export function setTtlMs(ms: number): void {
  ttlMs = ms;
}
