/**
 * Shadow AI Detector
 *
 * Detects employees using unapproved LLM APIs by matching outbound network
 * requests against a database of 30+ known LLM endpoints.  Maintains a
 * configurable approved-endpoints list so approved usage is flagged but not
 * alerted.
 *
 * Single Responsibility: classify network requests as shadow AI or not.
 * Does NOT intercept traffic — the caller provides request metadata.
 */

// ── Types ────────────────────────────────────────────────────────────────

export type Confidence = "high" | "medium" | "low";

export interface LlmEndpoint {
  readonly provider: string;
  readonly hostnamePattern: RegExp;
  readonly typicalPaths: readonly string[];
  readonly description: string;
}

export interface ApprovedEndpoint {
  readonly provider: string;
  readonly hostname: string;
}

export interface NetworkRequest {
  readonly hostname: string;
  readonly path?: string;
  readonly method?: string;
  readonly contentType?: string;
  readonly userAgent?: string;
  readonly sourceIp?: string;
  readonly timestamp?: number;
}

export interface ShadowAiResult {
  readonly isShadowAi: boolean;
  readonly provider?: string;
  readonly confidence: Confidence;
  readonly approved: boolean;
  readonly endpoint?: LlmEndpoint;
}

export interface DetectionStats {
  readonly totalRequests: number;
  readonly shadowAiDetected: number;
  readonly byProvider: Readonly<Record<string, number>>;
  readonly byUser: Readonly<Record<string, number>>;
  readonly lastDetection?: number;
}

// ── Known LLM endpoints database (30+) ──────────────────────────────────

const KNOWN_LLM_ENDPOINTS: readonly LlmEndpoint[] = [
  // OpenAI
  {
    provider: "OpenAI",
    hostnamePattern: /^api\.openai\.com$/i,
    typicalPaths: [
      "/v1/chat/completions",
      "/v1/completions",
      "/v1/embeddings",
      "/v1/images",
    ],
    description: "OpenAI API",
  },
  {
    provider: "OpenAI",
    hostnamePattern: /^(.*\.)?oaiusercontent\.com$/i,
    typicalPaths: ["/"],
    description: "OpenAI CDN / file storage",
  },

  // Anthropic
  {
    provider: "Anthropic",
    hostnamePattern: /^api\.anthropic\.com$/i,
    typicalPaths: ["/v1/messages", "/v1/complete"],
    description: "Anthropic Claude API",
  },

  // Google
  {
    provider: "Google AI",
    hostnamePattern: /^generativelanguage\.googleapis\.com$/i,
    typicalPaths: ["/v1beta/models", "/v1/models"],
    description: "Google Gemini API",
  },
  {
    provider: "Google Vertex",
    hostnamePattern: /^(.*-)?aiplatform\.googleapis\.com$/i,
    typicalPaths: ["/v1/projects"],
    description: "Google Vertex AI",
  },
  {
    provider: "Google AI Studio",
    hostnamePattern: /^aistudio\.google\.com$/i,
    typicalPaths: ["/"],
    description: "Google AI Studio web",
  },

  // Cohere
  {
    provider: "Cohere",
    hostnamePattern: /^api\.cohere\.(ai|com)$/i,
    typicalPaths: ["/v1/generate", "/v1/chat", "/v1/embed"],
    description: "Cohere API",
  },

  // Mistral
  {
    provider: "Mistral",
    hostnamePattern: /^api\.mistral\.ai$/i,
    typicalPaths: ["/v1/chat/completions", "/v1/embeddings"],
    description: "Mistral AI API",
  },

  // HuggingFace
  {
    provider: "HuggingFace",
    hostnamePattern: /^api-inference\.huggingface\.co$/i,
    typicalPaths: ["/models"],
    description: "HuggingFace Inference API",
  },
  {
    provider: "HuggingFace",
    hostnamePattern: /^huggingface\.co$/i,
    typicalPaths: ["/api/models"],
    description: "HuggingFace Hub API",
  },

  // Replicate
  {
    provider: "Replicate",
    hostnamePattern: /^api\.replicate\.com$/i,
    typicalPaths: ["/v1/predictions"],
    description: "Replicate API",
  },

  // Together.ai
  {
    provider: "Together",
    hostnamePattern: /^api\.together\.(ai|xyz)$/i,
    typicalPaths: ["/v1/chat/completions", "/inference"],
    description: "Together AI API",
  },

  // Fireworks.ai
  {
    provider: "Fireworks",
    hostnamePattern: /^api\.fireworks\.ai$/i,
    typicalPaths: ["/inference/v1/chat/completions"],
    description: "Fireworks AI API",
  },

  // Groq
  {
    provider: "Groq",
    hostnamePattern: /^api\.groq\.com$/i,
    typicalPaths: ["/openai/v1/chat/completions"],
    description: "Groq API",
  },

  // Perplexity
  {
    provider: "Perplexity",
    hostnamePattern: /^api\.perplexity\.ai$/i,
    typicalPaths: ["/chat/completions"],
    description: "Perplexity API",
  },

  // Anyscale
  {
    provider: "Anyscale",
    hostnamePattern: /^api\.endpoints\.anyscale\.com$/i,
    typicalPaths: ["/v1/chat/completions"],
    description: "Anyscale Endpoints",
  },

  // DeepSeek
  {
    provider: "DeepSeek",
    hostnamePattern: /^api\.deepseek\.com$/i,
    typicalPaths: ["/v1/chat/completions"],
    description: "DeepSeek API",
  },

  // AI21
  {
    provider: "AI21",
    hostnamePattern: /^api\.ai21\.com$/i,
    typicalPaths: ["/studio/v1/chat/completions", "/v1/complete"],
    description: "AI21 Labs API",
  },

  // Amazon Bedrock
  {
    provider: "AWS Bedrock",
    hostnamePattern: /^bedrock-runtime\.[a-z0-9-]+\.amazonaws\.com$/i,
    typicalPaths: ["/model/"],
    description: "Amazon Bedrock",
  },
  {
    provider: "AWS Bedrock",
    hostnamePattern: /^bedrock\.[a-z0-9-]+\.amazonaws\.com$/i,
    typicalPaths: ["/"],
    description: "Amazon Bedrock control plane",
  },

  // Azure OpenAI
  {
    provider: "Azure OpenAI",
    hostnamePattern: /^[a-z0-9-]+\.openai\.azure\.com$/i,
    typicalPaths: ["/openai/deployments"],
    description: "Azure OpenAI Service",
  },

  // Cerebras
  {
    provider: "Cerebras",
    hostnamePattern: /^api\.cerebras\.ai$/i,
    typicalPaths: ["/v1/chat/completions"],
    description: "Cerebras API",
  },

  // Sambanova
  {
    provider: "SambaNova",
    hostnamePattern: /^api\.sambanova\.ai$/i,
    typicalPaths: ["/v1/chat/completions"],
    description: "SambaNova API",
  },

  // xAI / Grok
  {
    provider: "xAI",
    hostnamePattern: /^api\.x\.ai$/i,
    typicalPaths: ["/v1/chat/completions"],
    description: "xAI Grok API",
  },

  // Lepton AI
  {
    provider: "Lepton",
    hostnamePattern: /^[a-z0-9-]+\.lepton\.run$/i,
    typicalPaths: ["/api/v1/chat/completions"],
    description: "Lepton AI",
  },

  // OpenRouter
  {
    provider: "OpenRouter",
    hostnamePattern: /^openrouter\.ai$/i,
    typicalPaths: ["/api/v1/chat/completions"],
    description: "OpenRouter API",
  },

  // Ollama (local but may be exposed)
  {
    provider: "Ollama",
    hostnamePattern: /^(localhost|127\.0\.0\.1)$/i,
    typicalPaths: ["/api/generate", "/api/chat", "/api/embeddings"],
    description: "Ollama local API",
  },

  // LM Studio
  {
    provider: "LM Studio",
    hostnamePattern: /^(localhost|127\.0\.0\.1)$/i,
    typicalPaths: ["/v1/chat/completions"],
    description: "LM Studio local API",
  },

  // Deepinfra
  {
    provider: "Deepinfra",
    hostnamePattern: /^api\.deepinfra\.com$/i,
    typicalPaths: ["/v1/openai/chat/completions", "/v1/inference"],
    description: "Deepinfra API",
  },

  // Zhipu / GLM
  {
    provider: "Zhipu AI",
    hostnamePattern: /^open\.bigmodel\.cn$/i,
    typicalPaths: ["/api/paas/v4/chat/completions"],
    description: "Zhipu AI (GLM) API",
  },

  // Moonshot / Kimi
  {
    provider: "Moonshot",
    hostnamePattern: /^api\.moonshot\.cn$/i,
    typicalPaths: ["/v1/chat/completions"],
    description: "Moonshot (Kimi) API",
  },

  // Baichuan
  {
    provider: "Baichuan",
    hostnamePattern: /^api\.baichuan-ai\.com$/i,
    typicalPaths: ["/v1/chat/completions"],
    description: "Baichuan API",
  },
];

// ── Module state (encapsulated) ──────────────────────────────────────────

let approvedEndpoints: readonly ApprovedEndpoint[] = [];
let stats: {
  totalRequests: number;
  shadowAiDetected: number;
  byProvider: Record<string, number>;
  byUser: Record<string, number>;
  lastDetection?: number;
} = { totalRequests: 0, shadowAiDetected: 0, byProvider: {}, byUser: {} };

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Register the list of approved LLM endpoints for this organization.
 * Replaces the existing list entirely (immutable swap).
 */
export function registerApprovedEndpoints(
  endpoints: readonly ApprovedEndpoint[],
): void {
  approvedEndpoints = [...endpoints];
}

/**
 * Return the full database of known LLM API endpoints.
 */
export function getKnownLlmEndpoints(): readonly LlmEndpoint[] {
  return KNOWN_LLM_ENDPOINTS;
}

/**
 * Analyse a single network request to determine if it targets an LLM API.
 * Updates internal detection stats as a side-effect.
 */
export function analyzeRequest(request: NetworkRequest): ShadowAiResult {
  stats = { ...stats, totalRequests: stats.totalRequests + 1 };

  const hostname = (request.hostname ?? "").toLowerCase().trim();
  if (hostname.length === 0) {
    return { isShadowAi: false, confidence: "low", approved: false };
  }

  // Find matching known endpoint
  const matched = findMatchingEndpoint(hostname, request.path);
  if (!matched) {
    // Heuristic: check content-type + path patterns for unknown hosts
    const heuristicHit = detectByHeuristic(request);
    if (heuristicHit) {
      recordDetection(
        heuristicHit.provider ?? "Unknown LLM",
        request.sourceIp,
        request.timestamp,
      );
      return heuristicHit;
    }
    return { isShadowAi: false, confidence: "low", approved: false };
  }

  const confidence = computeConfidence(request, matched);
  const approved = isApproved(matched.provider, hostname);

  if (!approved) {
    recordDetection(matched.provider, request.sourceIp, request.timestamp);
  }

  return {
    isShadowAi: !approved,
    provider: matched.provider,
    confidence,
    approved,
    endpoint: matched,
  };
}

/**
 * Return a snapshot of detection statistics.
 */
export function getDetectionStats(): DetectionStats {
  return {
    totalRequests: stats.totalRequests,
    shadowAiDetected: stats.shadowAiDetected,
    byProvider: { ...stats.byProvider },
    byUser: { ...stats.byUser },
    lastDetection: stats.lastDetection,
  };
}

/**
 * Reset all detection statistics.
 */
export function clearStats(): void {
  stats = { totalRequests: 0, shadowAiDetected: 0, byProvider: {}, byUser: {} };
}

// ── Internal helpers ─────────────────────────────────────────────────────

function findMatchingEndpoint(
  hostname: string,
  path?: string,
): LlmEndpoint | undefined {
  for (const ep of KNOWN_LLM_ENDPOINTS) {
    if (ep.hostnamePattern.test(hostname)) {
      // If we have path info, check whether it matches typical paths
      // for localhost endpoints that may serve non-AI traffic
      if (isLocalhost(hostname) && path) {
        const pathMatch = ep.typicalPaths.some((tp) => path.startsWith(tp));
        if (pathMatch) return ep;
        continue; // localhost didn't match this endpoint's paths
      }
      return ep;
    }
  }
  return undefined;
}

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function computeConfidence(
  request: NetworkRequest,
  endpoint: LlmEndpoint,
): Confidence {
  let score = 0;

  // Hostname match is strong signal
  score += 2;

  // Path match strengthens confidence
  if (request.path) {
    const pathHit = endpoint.typicalPaths.some((tp) =>
      request.path!.startsWith(tp),
    );
    if (pathHit) score += 2;
  }

  // POST method is typical for LLM API calls
  if (request.method?.toUpperCase() === "POST") score += 1;

  // JSON content type is expected
  if (request.contentType?.includes("application/json")) score += 1;

  if (score >= 5) return "high";
  if (score >= 3) return "medium";
  return "low";
}

function detectByHeuristic(
  request: NetworkRequest,
): ShadowAiResult | undefined {
  // Heuristic: POST + JSON to path containing /chat/completions or /v1/messages
  const isPost = request.method?.toUpperCase() === "POST";
  const isJson = request.contentType?.includes("application/json");
  const aiPath =
    request.path &&
    (/\/chat\/completions/i.test(request.path) ||
      /\/v1\/messages/i.test(request.path) ||
      /\/v1\/generate/i.test(request.path) ||
      /\/inference/i.test(request.path));

  if (isPost && isJson && aiPath) {
    return {
      isShadowAi: true,
      provider: "Unknown LLM",
      confidence: "low",
      approved: false,
    };
  }

  return undefined;
}

function isApproved(provider: string, hostname: string): boolean {
  return approvedEndpoints.some(
    (ep) =>
      ep.provider.toLowerCase() === provider.toLowerCase() ||
      ep.hostname.toLowerCase() === hostname,
  );
}

function recordDetection(
  provider: string,
  sourceIp?: string,
  timestamp?: number,
): void {
  const newByProvider = { ...stats.byProvider };
  newByProvider[provider] = (newByProvider[provider] ?? 0) + 1;

  const newByUser = { ...stats.byUser };
  if (sourceIp) {
    newByUser[sourceIp] = (newByUser[sourceIp] ?? 0) + 1;
  }

  stats = {
    ...stats,
    shadowAiDetected: stats.shadowAiDetected + 1,
    byProvider: newByProvider,
    byUser: newByUser,
    lastDetection: timestamp ?? Date.now(),
  };
}
