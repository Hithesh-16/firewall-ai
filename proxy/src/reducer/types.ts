/**
 * Context Reducer Types
 *
 * Shared types for the reduction pipeline.
 * ISP: Only reducer-specific types — no scanner/policy/gateway types.
 */

export interface ReducerResult {
  /** Reduced content */
  content: string;
  /** Original token count (estimated) */
  originalTokens: number;
  /** Reduced token count (estimated) */
  reducedTokens: number;
  /** Percentage of tokens saved */
  savingsPercent: number;
  /** Which reduction strategies were applied */
  strategies: string[];
  /** Lines kept from original */
  linesKept: number;
  /** Lines removed from original */
  linesRemoved: number;
}

export interface ReducerOptions {
  /** Keywords to search for (grep stage) */
  query?: string;
  /** Maximum token budget for output */
  maxTokens?: number;
  /** Number of context lines around each match (window stage) */
  windowSize?: number;
  /** Strip comments (default: true) */
  stripComments?: boolean;
  /** Strip blank lines (default: true) */
  stripBlanks?: boolean;
  /** Strip duplicate lines (default: true) */
  stripDuplicates?: boolean;
  /** Language hint for comment detection */
  language?: string;
}
