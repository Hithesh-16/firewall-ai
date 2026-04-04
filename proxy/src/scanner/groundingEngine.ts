/**
 * Hallucination Grounding Engine
 *
 * Cross-references LLM outputs against source documents to detect unsupported
 * claims.  Uses term overlap (Jaccard), bigram overlap, exact substring match,
 * and entity overlap to score each extracted claim.
 *
 * Single Responsibility: compute grounding scores.  Does NOT make policy
 * decisions — the caller interprets the scores.
 */

// ── Types ────────────────────────────────────────────────────────────────

export interface SourceDocument {
  readonly id: string;
  readonly content: string;
  readonly title?: string;
  readonly url?: string;
}

export interface SourceMatch {
  readonly id: string;
  readonly similarity: number;
  readonly matchedTerms: readonly string[];
}

export interface ClaimScore {
  readonly claim: string;
  readonly groundingScore: number;
  readonly bestSource?: SourceMatch;
  readonly isGrounded: boolean;
  readonly evidence?: string;
}

export interface GroundingResult {
  readonly overallScore: number;
  readonly claims: readonly ClaimScore[];
  readonly groundedCount: number;
  readonly ungroundedCount: number;
  readonly totalClaims: number;
  readonly sources: readonly string[];
}

// ── Stopwords ────────────────────────────────────────────────────────────

const STOPWORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "is",
  "it",
  "as",
  "was",
  "are",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "shall",
  "can",
  "this",
  "that",
  "these",
  "those",
  "i",
  "you",
  "he",
  "she",
  "we",
  "they",
  "me",
  "him",
  "her",
  "us",
  "them",
  "my",
  "your",
  "his",
  "its",
  "our",
  "their",
  "what",
  "which",
  "who",
  "whom",
  "when",
  "where",
  "how",
  "not",
  "no",
  "nor",
  "if",
  "then",
  "than",
  "too",
  "very",
  "just",
  "about",
  "above",
  "after",
  "before",
  "between",
  "into",
  "through",
  "during",
  "each",
  "all",
  "both",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "only",
  "own",
  "same",
  "so",
  "also",
]);

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Extract individual claims (sentences) from text.
 *
 * Splits on sentence-ending punctuation followed by whitespace and a capital
 * letter.  Filters out questions and very short sentences (< 5 words).
 */
export function extractClaims(text: string): readonly string[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  // Split on sentence boundaries: . ! ? followed by whitespace + capital letter
  const raw = text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return raw.filter((sentence) => {
    // Skip questions
    if (sentence.endsWith("?")) return false;
    // Skip very short sentences (< 5 words)
    const wordCount = sentence.split(/\s+/).length;
    return wordCount >= 5;
  });
}

/**
 * Score how well a single claim is grounded in the provided sources.
 *
 * Scoring components (weighted sum):
 *   - Term overlap (Jaccard):      40%
 *   - Bigram overlap:              25%
 *   - Exact substring match:       20% bonus
 *   - Entity overlap:              15%
 */
export function scoreClaimGrounding(
  claim: string,
  sources: readonly SourceDocument[],
  threshold: number = 0.3,
): ClaimScore {
  if (!claim || claim.trim().length === 0 || sources.length === 0) {
    return {
      claim,
      groundingScore: 0,
      isGrounded: false,
    };
  }

  const claimTerms = extractTerms(claim);
  const claimBigrams = extractBigrams(claimTerms);
  const claimEntities = extractEntities(claim);

  let bestScore = 0;
  let bestMatch: SourceMatch | undefined;
  let bestEvidence: string | undefined;

  for (const source of sources) {
    const sourceTerms = extractTerms(source.content);
    const sourceBigrams = extractBigrams(sourceTerms);
    const sourceEntities = extractEntities(source.content);

    // 1. Term overlap (Jaccard similarity)
    const termOverlap = jaccardSimilarity(claimTerms, sourceTerms);

    // 2. Bigram overlap
    const bigramOverlap = overlapRatio(claimBigrams, sourceBigrams);

    // 3. Exact substring match bonus
    const substringBonus = hasSubstringMatch(claim, source.content) ? 1.0 : 0.0;

    // 4. Entity overlap
    const entityOverlap =
      claimEntities.length > 0
        ? overlapRatio(claimEntities, sourceEntities)
        : 0;

    const score =
      termOverlap * 0.4 +
      bigramOverlap * 0.25 +
      substringBonus * 0.2 +
      entityOverlap * 0.15;

    if (score > bestScore) {
      bestScore = score;
      const matched = claimTerms.filter((t) => sourceTerms.includes(t));
      bestMatch = {
        id: source.id,
        similarity: Math.round(score * 1000) / 1000,
        matchedTerms: matched,
      };
      bestEvidence = findBestSnippet(claim, source.content);
    }
  }

  return {
    claim,
    groundingScore: Math.round(bestScore * 1000) / 1000,
    bestSource: bestMatch,
    isGrounded: bestScore >= threshold,
    evidence: bestEvidence,
  };
}

/**
 * Compute grounding for an entire LLM output against source documents.
 *
 * Extracts claims, scores each against all sources, and returns aggregate
 * statistics with per-claim breakdowns.
 */
export function computeGrounding(
  output: string,
  sources: readonly SourceDocument[],
  threshold: number = 0.3,
): GroundingResult {
  if (!output || output.trim().length === 0) {
    return {
      overallScore: 0,
      claims: [],
      groundedCount: 0,
      ungroundedCount: 0,
      totalClaims: 0,
      sources: sources.map((s) => s.id),
    };
  }

  if (sources.length === 0) {
    const claims = extractClaims(output);
    return {
      overallScore: 0,
      claims: claims.map((c) => ({
        claim: c,
        groundingScore: 0,
        isGrounded: false,
      })),
      groundedCount: 0,
      ungroundedCount: claims.length,
      totalClaims: claims.length,
      sources: [],
    };
  }

  const claims = extractClaims(output);

  if (claims.length === 0) {
    return {
      overallScore: 0,
      claims: [],
      groundedCount: 0,
      ungroundedCount: 0,
      totalClaims: 0,
      sources: sources.map((s) => s.id),
    };
  }

  const scoredClaims = claims.map((c) =>
    scoreClaimGrounding(c, sources, threshold),
  );

  const groundedCount = scoredClaims.filter((c) => c.isGrounded).length;
  const ungroundedCount = scoredClaims.length - groundedCount;

  const totalScore = scoredClaims.reduce((acc, c) => acc + c.groundingScore, 0);
  const overallScore =
    Math.round((totalScore / scoredClaims.length) * 1000) / 1000;

  return {
    overallScore,
    claims: scoredClaims,
    groundedCount,
    ungroundedCount,
    totalClaims: scoredClaims.length,
    sources: sources.map((s) => s.id),
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────

/**
 * Extract non-stopword terms from text, lowercased and deduplicated.
 */
function extractTerms(text: string): readonly string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
  return [...new Set(words)];
}

/**
 * Generate bigrams (consecutive word pairs) from a term list.
 */
function extractBigrams(terms: readonly string[]): readonly string[] {
  if (terms.length < 2) return [];
  const bigrams: string[] = [];
  for (let i = 0; i < terms.length - 1; i++) {
    bigrams.push(`${terms[i]} ${terms[i + 1]}`);
  }
  return bigrams;
}

/**
 * Extract potential entities: capitalised words and number sequences.
 */
function extractEntities(text: string): readonly string[] {
  const capitalised = text.match(/\b[A-Z][a-z]{2,}\b/g) ?? [];
  const numbers = text.match(/\b\d{2,}\b/g) ?? [];
  const entities = [...capitalised.map((e) => e.toLowerCase()), ...numbers];
  return [...new Set(entities)];
}

/**
 * Jaccard similarity: |A ∩ B| / |A ∪ B|.
 */
function jaccardSimilarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Overlap ratio: fraction of items in `a` that also appear in `b`.
 */
function overlapRatio(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0) return 0;
  const setB = new Set(b);
  let overlap = 0;
  for (const item of a) {
    if (setB.has(item)) overlap++;
  }
  return overlap / a.length;
}

/**
 * Check whether any meaningful substring of the claim appears verbatim in source.
 * Uses 5+ word windows.
 */
function hasSubstringMatch(claim: string, source: string): boolean {
  const claimLower = claim.toLowerCase();
  const sourceLower = source.toLowerCase();

  const words = claimLower.split(/\s+/);
  if (words.length < 5) {
    return sourceLower.includes(claimLower);
  }

  // Slide a 5-word window and check for substring presence
  for (let i = 0; i <= words.length - 5; i++) {
    const window = words.slice(i, i + 5).join(" ");
    if (sourceLower.includes(window)) return true;
  }
  return false;
}

/**
 * Find the best matching snippet from the source for evidence display.
 * Returns a ~120-char window around the highest-overlap region.
 */
function findBestSnippet(claim: string, source: string): string | undefined {
  const claimTerms = new Set(extractTerms(claim));
  const words = source.split(/\s+/);
  if (words.length === 0) return undefined;

  let bestStart = 0;
  let bestCount = 0;
  const windowSize = Math.min(20, words.length);

  for (let i = 0; i <= words.length - windowSize; i++) {
    let count = 0;
    for (let j = i; j < i + windowSize; j++) {
      const w = words[j].toLowerCase().replace(/[^a-z0-9'-]/g, "");
      if (claimTerms.has(w)) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      bestStart = i;
    }
  }

  if (bestCount === 0) return undefined;

  const snippet = words.slice(bestStart, bestStart + windowSize).join(" ");
  return snippet.length > 120 ? snippet.substring(0, 117) + "..." : snippet;
}
