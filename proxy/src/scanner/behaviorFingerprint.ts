/**
 * Behavior Fingerprint Scanner
 *
 * Per-user behavioral fingerprinting that flags statistically anomalous
 * prompt patterns. Builds a rolling profile of each user's typical behavior
 * and detects deviations using z-score analysis.
 * Single Responsibility: Only detects behavioral anomalies. No policy decisions.
 *
 * Profile dimensions:
 *   - Prompt length (characters)
 *   - Word count
 *   - Vocabulary diversity (unique words / total words)
 *   - Request frequency (requests per minute)
 *   - Time-of-day bucket (0-23)
 */

// ── Types ────────────────────────────────────────────────────────────────

export interface BehaviorMeta {
  readonly timestamp?: number;
  readonly categories?: readonly string[];
}

export interface BehaviorResult {
  readonly isAnomalous: boolean;
  readonly anomalyScore: number;
  readonly deviations: readonly string[];
  readonly profileMaturity: number;
}

export interface BehaviorProfile {
  readonly sampleCount: number;
  readonly avgLength: number;
  readonly stdLength: number;
  readonly avgWordCount: number;
  readonly stdWordCount: number;
  readonly avgVocabDiversity: number;
  readonly stdVocabDiversity: number;
  readonly avgFrequency: number;
  readonly stdFrequency: number;
  readonly typicalHours: readonly number[];
  readonly lastSeen: number;
}

interface ProfileAccumulator {
  lengths: number[];
  wordCounts: number[];
  vocabDiversities: number[];
  timestamps: number[];
  hours: number[];
}

// ── Configuration ────────────────────────────────────────────────────────

const MIN_SAMPLES = 10;
const Z_SCORE_THRESHOLD = 2.0;
const MAX_PROFILE_SAMPLES = 500;

// ── Store ────────────────────────────────────────────────────────────────

const profileStore = new Map<string, ProfileAccumulator>();

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Compute mean of a numeric array.
 */
function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Compute population standard deviation.
 */
function stdDev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const squaredDiffs = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0);
  return Math.sqrt(squaredDiffs / values.length);
}

/**
 * Compute z-score of a value against a distribution.
 * Returns 0 if std deviation is 0 (no variance).
 */
function zScore(value: number, avg: number, std: number): number {
  if (std === 0) return 0;
  return Math.abs((value - avg) / std);
}

/**
 * Extract text metrics from a prompt.
 */
function extractMetrics(text: string): {
  length: number;
  wordCount: number;
  vocabDiversity: number;
} {
  const length = text.length;
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 0);
  const wordCount = words.length;
  const uniqueWords = new Set(words).size;
  const vocabDiversity = wordCount > 0 ? uniqueWords / wordCount : 0;

  return { length, wordCount, vocabDiversity };
}

/**
 * Compute request frequency as requests per minute over the last N timestamps.
 */
function computeFrequency(timestamps: readonly number[]): number {
  if (timestamps.length < 2) return 0;
  const sorted = [...timestamps].sort((a, b) => a - b);
  const spanMs = sorted[sorted.length - 1] - sorted[0];
  if (spanMs === 0) return 0;
  const spanMinutes = spanMs / 60000;
  return (timestamps.length - 1) / spanMinutes;
}

/**
 * Get the most common hours (top 5) from the hour distribution.
 */
function typicalHours(hours: readonly number[]): readonly number[] {
  const counts = new Map<number, number>();
  for (const h of hours) {
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([hour]) => hour);
}

/**
 * Build a readonly profile snapshot from the accumulator.
 */
function buildProfile(acc: ProfileAccumulator): BehaviorProfile {
  return {
    sampleCount: acc.lengths.length,
    avgLength: Math.round(mean(acc.lengths)),
    stdLength: Math.round(stdDev(acc.lengths) * 100) / 100,
    avgWordCount: Math.round(mean(acc.wordCounts) * 100) / 100,
    stdWordCount: Math.round(stdDev(acc.wordCounts) * 100) / 100,
    avgVocabDiversity: Math.round(mean(acc.vocabDiversities) * 1000) / 1000,
    stdVocabDiversity: Math.round(stdDev(acc.vocabDiversities) * 1000) / 1000,
    avgFrequency: Math.round(computeFrequency(acc.timestamps) * 100) / 100,
    stdFrequency: 0, // Frequency std requires windowed computation
    lastSeen:
      acc.timestamps.length > 0 ? acc.timestamps[acc.timestamps.length - 1] : 0,
    typicalHours: typicalHours(acc.hours),
  };
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Record a user's prompt behavior and check for anomalies.
 *
 * @param userId - Unique user identifier
 * @param text - The user's prompt text
 * @param metadata - Optional metadata (timestamp, categories)
 * @returns Behavior analysis result with anomaly flags
 */
export function recordBehavior(
  userId: string,
  text: string,
  metadata?: BehaviorMeta,
): BehaviorResult {
  const now = metadata?.timestamp ?? Date.now();
  const hour = new Date(now).getUTCHours();
  const metrics = extractMetrics(text);

  let acc = profileStore.get(userId);
  if (!acc) {
    acc = {
      lengths: [],
      wordCounts: [],
      vocabDiversities: [],
      timestamps: [],
      hours: [],
    };
    profileStore.set(userId, acc);
  }

  const deviations: string[] = [];
  let anomalyScore = 0;

  // Only flag anomalies after minimum samples collected
  if (acc.lengths.length >= MIN_SAMPLES) {
    const avgLen = mean(acc.lengths);
    const stdLen = stdDev(acc.lengths);
    const lenZ = zScore(metrics.length, avgLen, stdLen);
    if (lenZ > Z_SCORE_THRESHOLD) {
      deviations.push(`prompt_length (z=${lenZ.toFixed(2)})`);
      anomalyScore += lenZ;
    }

    const avgWc = mean(acc.wordCounts);
    const stdWc = stdDev(acc.wordCounts);
    const wcZ = zScore(metrics.wordCount, avgWc, stdWc);
    if (wcZ > Z_SCORE_THRESHOLD) {
      deviations.push(`word_count (z=${wcZ.toFixed(2)})`);
      anomalyScore += wcZ;
    }

    const avgVd = mean(acc.vocabDiversities);
    const stdVd = stdDev(acc.vocabDiversities);
    const vdZ = zScore(metrics.vocabDiversity, avgVd, stdVd);
    if (vdZ > Z_SCORE_THRESHOLD) {
      deviations.push(`vocab_diversity (z=${vdZ.toFixed(2)})`);
      anomalyScore += vdZ;
    }

    // Frequency anomaly: check if current request rate is unusual
    if (acc.timestamps.length >= MIN_SAMPLES) {
      const recentWindow = acc.timestamps.slice(-20);
      const currentFreq = computeFrequency([...recentWindow, now]);
      const historicalFreq = computeFrequency(acc.timestamps);
      if (historicalFreq > 0 && currentFreq > 0) {
        // Simple ratio-based check: current freq much higher than historical
        const freqRatio = currentFreq / historicalFreq;
        if (freqRatio > 3) {
          deviations.push(
            `request_frequency (${freqRatio.toFixed(1)}x normal)`,
          );
          anomalyScore += freqRatio;
        }
      }
    }

    // Unusual hour check
    const typical = typicalHours(acc.hours);
    if (typical.length >= 3 && !typical.includes(hour)) {
      deviations.push(`unusual_hour (${hour}:00 UTC)`);
      anomalyScore += 1;
    }
  }

  // Update accumulator (immutable arrays, trim to max size)
  const updatedLengths =
    acc.lengths.length >= MAX_PROFILE_SAMPLES
      ? [...acc.lengths.slice(1), metrics.length]
      : [...acc.lengths, metrics.length];
  const updatedWordCounts =
    acc.wordCounts.length >= MAX_PROFILE_SAMPLES
      ? [...acc.wordCounts.slice(1), metrics.wordCount]
      : [...acc.wordCounts, metrics.wordCount];
  const updatedVocabDiv =
    acc.vocabDiversities.length >= MAX_PROFILE_SAMPLES
      ? [...acc.vocabDiversities.slice(1), metrics.vocabDiversity]
      : [...acc.vocabDiversities, metrics.vocabDiversity];
  const updatedTimestamps =
    acc.timestamps.length >= MAX_PROFILE_SAMPLES
      ? [...acc.timestamps.slice(1), now]
      : [...acc.timestamps, now];
  const updatedHours =
    acc.hours.length >= MAX_PROFILE_SAMPLES
      ? [...acc.hours.slice(1), hour]
      : [...acc.hours, hour];

  profileStore.set(userId, {
    lengths: updatedLengths,
    wordCounts: updatedWordCounts,
    vocabDiversities: updatedVocabDiv,
    timestamps: updatedTimestamps,
    hours: updatedHours,
  });

  // Normalize anomaly score to 0-100
  const normalizedScore = Math.min(Math.round(anomalyScore * 10), 100);

  return {
    isAnomalous: deviations.length > 0,
    anomalyScore: normalizedScore,
    deviations,
    profileMaturity: Math.min(updatedLengths.length, MAX_PROFILE_SAMPLES),
  };
}

/**
 * Get the current behavioral profile for a user.
 *
 * @param userId - Unique user identifier
 * @returns Profile snapshot, or undefined if no data exists
 */
export function getUserProfile(userId: string): BehaviorProfile | undefined {
  const acc = profileStore.get(userId);
  if (!acc || acc.lengths.length === 0) return undefined;
  return buildProfile(acc);
}

/**
 * Clear a user's behavioral profile.
 *
 * @param userId - Unique user identifier
 */
export function clearProfile(userId: string): void {
  profileStore.delete(userId);
}

/**
 * Clear all profiles. Useful for testing.
 */
export function clearAllProfiles(): void {
  profileStore.clear();
}
