/**
 * RAG Injection Scanner
 *
 * Scans documents and chunks before they enter a RAG pipeline for hidden
 * instructions, encoded directives, and delimiter injection.
 * Single Responsibility: Only detects RAG injection vectors. No policy decisions.
 *
 * Patterns covered:
 *   - Instruction injection ("ignore previous", "system:", role hijacking)
 *   - Hidden directives after whitespace padding
 *   - Markdown/HTML comment injection
 *   - Base64-encoded instructions
 *   - Delimiter injection (fenced code blocks with instructions)
 *   - Invisible text techniques (zero-width chars, font-size:0)
 */

// ── Types ────────────────────────────────────────────────────────────────

export interface RagFinding {
  readonly pattern: string;
  readonly matched: string;
  readonly position: number;
  readonly weight: number;
  readonly chunkIndex?: number;
}

export interface RagScanResult {
  readonly isInjection: boolean;
  readonly score: number;
  readonly findings: readonly RagFinding[];
}

export interface RagChunkResult {
  readonly chunkIndex: number;
  readonly text: string;
  readonly result: RagScanResult;
}

export interface RagDocumentResult {
  readonly isInjection: boolean;
  readonly documentScore: number;
  readonly chunks: readonly RagChunkResult[];
  readonly totalFindings: number;
  readonly source?: string;
}

// ── Pattern Definitions ──────────────────────────────────────────────────

interface RagPattern {
  readonly name: string;
  readonly regex: RegExp;
  readonly weight: number;
}

const RAG_PATTERNS: readonly RagPattern[] = [
  // Instruction injection
  {
    name: "instruction_override",
    regex:
      /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|context|rules)/gi,
    weight: 30,
  },
  {
    name: "system_role_inject",
    regex: /(?:^|\n)\s*(?:system|assistant)\s*:\s*.{10,}/gi,
    weight: 25,
  },
  {
    name: "role_hijack",
    regex: /you\s+are\s+(?:now|no\s+longer)\s+(?:a|an|the)\s+/gi,
    weight: 20,
  },
  {
    name: "new_instruction",
    regex: /(?:new|updated|revised)\s+instructions?\s*[:=]\s*/gi,
    weight: 25,
  },
  {
    name: "override_directive",
    regex:
      /(?:IMPORTANT|CRITICAL|URGENT|NOTE\s+TO\s+AI)\s*:\s*(?:ignore|override|disregard|forget)/gi,
    weight: 30,
  },

  // Delimiter injection
  {
    name: "fenced_system_block",
    regex: /```(?:system|instructions?|config|rules?)\s*\n[\s\S]*?```/gi,
    weight: 25,
  },
  {
    name: "chat_delimiter",
    regex: /<\|(?:im_start|im_end|system|user|assistant)\|>/gi,
    weight: 30,
  },
  {
    name: "inst_delimiter",
    regex: /\[(?:INST|\/INST|SYS|\/SYS)\]/gi,
    weight: 30,
  },

  // Hidden text techniques
  {
    name: "html_comment_inject",
    regex:
      /<!--[\s\S]*?(?:instruction|ignore|override|system|inject|execute)[\s\S]*?-->/gi,
    weight: 20,
  },
  {
    name: "css_hidden_text",
    regex:
      /style\s*=\s*["'][^"']*(?:display\s*:\s*none|font-size\s*:\s*0|visibility\s*:\s*hidden|opacity\s*:\s*0)[^"']*["']/gi,
    weight: 20,
  },
  { name: "whitespace_padding", regex: /\n{10,}[\s\S]{10,}/g, weight: 15 },

  // Encoding tricks
  {
    name: "base64_instruction",
    regex:
      /(?:base64|atob|decode)\s*[:(]\s*["']?[A-Za-z0-9+/=]{20,}["']?\s*\)?/gi,
    weight: 20,
  },
  { name: "unicode_escape", regex: /(?:\\u[0-9a-fA-F]{4}){4,}/g, weight: 15 },
  { name: "hex_escape", regex: /(?:\\x[0-9a-fA-F]{2}){4,}/g, weight: 15 },

  // Tool/function manipulation
  {
    name: "tool_call_inject",
    regex:
      /(?:call|invoke|execute|run)\s+(?:the\s+)?(?:function|tool|command)\s+/gi,
    weight: 20,
  },

  // Data exfiltration via RAG context
  {
    name: "exfil_instruction",
    regex:
      /(?:send|post|upload|transmit|exfiltrate)\s+(?:this|the|all)\s+(?:data|content|context|information)\s+to/gi,
    weight: 30,
  },
];

const DEFAULT_THRESHOLD = 40;
const MAX_CHUNK_SIZE = 2000;

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Split text into paragraph-based chunks, respecting max size.
 */
function splitIntoChunks(text: string): readonly string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (
      current.length + para.length + 2 > MAX_CHUNK_SIZE &&
      current.length > 0
    ) {
      chunks.push(current.trim());
      current = "";
    }
    if (para.length > MAX_CHUNK_SIZE) {
      if (current.length > 0) {
        chunks.push(current.trim());
        current = "";
      }
      for (let i = 0; i < para.length; i += MAX_CHUNK_SIZE) {
        chunks.push(para.slice(i, i + MAX_CHUNK_SIZE));
      }
    } else {
      current = current.length > 0 ? `${current}\n\n${para}` : para;
    }
  }

  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }

  return chunks.length > 0 ? chunks : [""];
}

/**
 * Run all RAG patterns against a text chunk.
 */
function scanText(text: string): readonly RagFinding[] {
  const findings: RagFinding[] = [];

  for (const pattern of RAG_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      findings.push({
        pattern: pattern.name,
        matched: match[0].slice(0, 100),
        position: match.index,
        weight: pattern.weight,
      });
    }
  }

  return findings;
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Scan a single RAG chunk for hidden injection attempts.
 *
 * @param chunk - Text chunk to scan
 * @param threshold - Score threshold for flagging as injection (default 40)
 * @returns Scan result with findings and aggregate score
 */
export function scanRagChunk(
  chunk: string,
  threshold: number = DEFAULT_THRESHOLD,
): RagScanResult {
  const findings = scanText(chunk);
  const score = Math.min(
    findings.reduce((sum, f) => sum + f.weight, 0),
    100,
  );

  return {
    isInjection: score >= threshold,
    score,
    findings,
  };
}

/**
 * Scan an entire document by splitting into paragraph-based chunks
 * and scanning each independently.
 *
 * @param text - Full document text
 * @param source - Optional source identifier (filename, URL, etc.)
 * @param threshold - Score threshold per chunk (default 40)
 * @returns Aggregate document result with per-chunk details
 */
export function scanRagDocument(
  text: string,
  source?: string,
  threshold: number = DEFAULT_THRESHOLD,
): RagDocumentResult {
  const chunks = splitIntoChunks(text);
  const chunkResults: RagChunkResult[] = chunks.map((chunkText, index) => {
    const result = scanRagChunk(chunkText, threshold);
    const findings = result.findings.map((f) => ({ ...f, chunkIndex: index }));
    return {
      chunkIndex: index,
      text: chunkText.slice(0, 200),
      result: { ...result, findings },
    };
  });

  const totalFindings = chunkResults.reduce(
    (sum, c) => sum + c.result.findings.length,
    0,
  );

  const maxChunkScore = Math.max(...chunkResults.map((c) => c.result.score), 0);
  const avgChunkScore =
    chunkResults.length > 0
      ? chunkResults.reduce((sum, c) => sum + c.result.score, 0) /
        chunkResults.length
      : 0;

  // Document score: weighted blend of max chunk and average
  const documentScore = Math.min(
    Math.round(maxChunkScore * 0.7 + avgChunkScore * 0.3),
    100,
  );

  return {
    isInjection: documentScore >= threshold,
    documentScore,
    chunks: chunkResults,
    totalFindings,
    source,
  };
}
