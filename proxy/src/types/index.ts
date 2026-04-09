export type Severity = "critical" | "high" | "medium";

export type SecretType =
  | "AWS_KEY"
  | "PRIVATE_KEY"
  | "JWT"
  | "BEARER_TOKEN"
  | "GENERIC_API_KEY"
  | "DATABASE_URL"
  | "GITHUB_TOKEN"
  | "SLACK_TOKEN"
  | "GOOGLE_API_KEY"
  | "AZURE_KEY"
  | "HARDCODED_PASSWORD"
  | "ENV_VARIABLE"
  | "HIGH_ENTROPY";

export type PiiType =
  | "EMAIL"
  | "PHONE"
  | "AADHAAR"
  | "PAN"
  | "SSN"
  | "CREDIT_CARD"
  | "IP_ADDRESS";

export type SecretMatch = {
  type: SecretType;
  value: string;
  position: number;
  length: number;
  severity: Severity;
};

export type PiiMatch = {
  type: PiiType;
  value: string;
  position: number;
  length: number;
  severity: Severity;
};

export type SecretScanResult = {
  hasSecrets: boolean;
  secrets: SecretMatch[];
};

export type PiiScanResult = {
  hasPII: boolean;
  pii: PiiMatch[];
};

export type PolicyRules = {
  block_private_keys: boolean;
  block_aws_keys: boolean;
  block_db_urls: boolean;
  block_github_tokens: boolean;
  redact_emails: boolean;
  redact_phone: boolean;
  redact_jwt: boolean;
  redact_generic_api_keys: boolean;
  allow_source_code: boolean;
  log_all_requests: boolean;
};

export type FileScopeMode = "blocklist" | "allowlist";

export type FileScopeConfig = {
  mode: FileScopeMode;
  blocklist: string[];
  allowlist: string[];
  max_file_size_kb: number;
  scan_on_open: boolean;
  scan_on_send: boolean;
};

export type SeverityThreshold = "critical" | "high" | "medium";

export type AuditConfig = {
  enabled: boolean;
  privacyRiskThreshold?: number;
  githubHitThreshold?: number;
  useSurrogateModel?: boolean;
};

export type PromptInjectionConfig = {
  enabled: boolean;
  threshold?: number;
};

export type ModelPolicyRule = {
  allowed_paths: string[];
  blocked_paths: string[];
};

export type ApprovalPolicyConfig = {
  enabled: boolean;
  /** Risk score threshold to trigger approval (default: 50) */
  riskThreshold?: number;
  /** Timeout in ms before default-deny (default: 60000) */
  timeoutMs?: number;
  /** Action types that always require approval */
  alwaysRequireFor?: string[];
};

export type PermissionMode = "off" | "auto" | "turbo";

export type ResponseScanningConfig = {
  enabled: boolean;
  scan_secrets?: boolean;
  scan_pii?: boolean;
  redact_on_detection?: boolean;
  stream_buffer_size?: number;
};

export type UnicodeNormalizationConfig = {
  enabled: boolean;
  block_on_anomaly?: boolean;
};

export type PolicyConfig = {
  version: string;
  rules: PolicyRules;
  file_scope: FileScopeConfig;
  blocked_paths: string[];
  severity_threshold: SeverityThreshold;
  smart_routing?: SmartRoutingConfig;
  strict_local?: boolean;
  model_policies?: Record<string, ModelPolicyRule>;
  prompt_injection?: PromptInjectionConfig;
  /**
   * Scan LLM RESPONSES (not just inputs) for leaked secrets or PII.
   * Persisted in policy.json under the key of the same name.
   */
  response_scanning?: ResponseScanningConfig;
  /** Unicode homoglyph / zero-width normalisation (policy.json). */
  unicode_normalization?: UnicodeNormalizationConfig;
  audit?: AuditConfig;
  approval?: ApprovalPolicyConfig;
  /** Permission mode: off (ask all), auto (default), turbo (skip low-risk) */
  permission_mode?: PermissionMode;
  /** Risk threshold for turbo mode — skip approval below this score (default: 70) */
  turbo_threshold?: number;
};

export type PolicyAction = "ALLOW" | "BLOCK" | "REDACT" | "REQUIRE_APPROVAL";

export type PolicyDecision = {
  action: PolicyAction;
  reasons: string[];
  riskScore: number;
  filesBlocked: string[];
};

export type FileScopeResult = {
  allowed: boolean;
  path: string;
  reason?: string;
};

export type LogEntry = {
  timestamp: number;
  model: string;
  provider: string;
  originalHash: string;
  sanitizedText: string;
  secretsFound: number;
  piiFound: number;
  entropyFound: number;
  filesBlocked: number;
  riskScore: number;
  action: "ALLOW" | "BLOCK" | "REDACT";
  reasons: string[];
  responseTimeMs: number;
  userId?: number;
  teamId?: number;
};

export type ChatCompletionMessage = {
  role: string;
  content: string;
};

export type ChatCompletionRequest = {
  model: string;
  messages: ChatCompletionMessage[];
  metadata?: {
    filePaths?: string[];
  };
};

// --- Phase 2 types ---

export type SmartRoutingTarget =
  | "local_llm"
  | "cloud_redacted"
  | "cloud_direct";

export type SmartRoutingRoute = {
  condition: string;
  target: SmartRoutingTarget;
};

export type LocalLlmConfig = {
  provider: string;
  model: string;
  endpoint: string;
};

export type CostRoutingRule = {
  condition: string;
  target: SmartRoutingTarget;
  preferModel?: string;
};

export type CostRoutingConfig = {
  enabled: boolean;
  maxCostPerRequest?: number | null;
  preferCheaper: boolean;
  rules: CostRoutingRule[];
};

export type SmartRoutingConfig = {
  enabled: boolean;
  routes: SmartRoutingRoute[];
  local_llm: LocalLlmConfig;
  cost_routing?: CostRoutingConfig;
};

export type RouteDecision = {
  target: SmartRoutingTarget;
  providerUrl: string;
  model: string;
  requiresRedaction: boolean;
  isLocal: boolean;
};

export type LeakFinding = {
  severity: Severity;
  category: string;
  detail: string;
  filePath: string;
  line?: number;
};

export type LeakSimulationReport = {
  timestamp: number;
  filesAnalyzed: number;
  filesExcluded: number;
  overallRisk: Severity | "low";
  findings: LeakFinding[];
  recommendations: string[];
};

export type StatsResponse = {
  totalRequests: number;
  blocked: number;
  redacted: number;
  allowed: number;
  avgRiskScore: number;
  totalEntropyFindings: number;
  secretsByType: Record<string, number>;
  requestsByDay: Array<{ date: string; count: number }>;
};

// --- Phase 3 types ---

export type Role = "admin" | "security_lead" | "developer" | "auditor";

export type User = {
  id: number;
  email: string;
  name: string;
  role: Role;
  orgId: number | null;
  /**
   * Whether the user has finished the post-signup onboarding wizard.
   * Mirrors `users.onboarding_complete` (0/1) but typed as boolean.
   */
  onboardingComplete: boolean;
  /**
   * IANA timezone string captured in the onboarding wizard's Step 2.
   * Nullable — SSO users and legacy rows may not have one.
   */
  timezone: string | null;
  createdAt: number;
  updatedAt: number;
};

export type Organization = {
  id: number;
  name: string;
  slug: string;
  /** Free-text industry label from onboarding Step 2. */
  industry?: string | null;
  createdAt: number;
};

export type TokenScope =
  | "chat:write"
  | "chat:read"
  | "logs:read"
  | "logs:export"
  | "policy:read"
  | "policy:write"
  | "providers:read"
  | "providers:write"
  | "teams:read"
  | "teams:write"
  | "users:read"
  | "users:write"
  | "approvals:read"
  | "approvals:write"
  | "mcp:read"
  | "mcp:write"
  | "*";

export type ApiToken = {
  id: number;
  userId: number;
  tokenHash: string;
  name: string;
  scopes: TokenScope[] | null;
  orgId: number | null;
  teamId: number | null;
  lastUsedAt: number | null;
  createdAt: number;
  expiresAt: number | null;
  rotatedFromId: number | null;
};

export type AuthContext = {
  user: User;
  token: ApiToken;
  /**
   * The raw `afw_...` bearer string that came in on the Authorization header.
   * Preserved so the handoff endpoint can write it to the shared auth file
   * without forcing a second login. Never serialised, never logged.
   */
  rawToken: string;
};

export type ExportFormat = "csv" | "json";

export type ExportFilter = {
  startDate?: number;
  endDate?: number;
  action?: "ALLOW" | "BLOCK" | "REDACT";
  minRiskScore?: number;
};

// --- Phase 4 types ---

export type Provider = {
  id: number;
  name: string;
  slug: string;
  baseUrl: string;
  apiKeyEncrypted: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

export type Model = {
  id: number;
  providerId: number;
  modelName: string;
  displayName: string;
  inputCostPer1k: number;
  outputCostPer1k: number;
  maxContextTokens: number;
  enabled: boolean;
};

export type LimitType = "requests" | "tokens" | "dollars";
export type ResetPeriod = "daily" | "weekly" | "monthly";

export type CreditConfig = {
  id: number;
  providerId: number | null;
  modelId: number | null;
  limitType: LimitType;
  totalLimit: number;
  usedAmount: number;
  resetPeriod: ResetPeriod;
  resetDate: number;
  hardLimit: boolean;
  createdAt: number;
};

export type CreditCheck = {
  allowed: boolean;
  remaining: number;
  limitType: LimitType;
  message?: string;
};

export type UsageRecord = {
  id?: number;
  logId: number | null;
  providerId: number;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  timestamp: number;
};

export type GatewayRouteDecision = {
  provider: Provider;
  model: Model;
  decryptedKey: string;
  providerUrl: string;
  creditCheck: CreditCheck;
  isLocal: boolean;
};

// --- Prompt Injection types ---

export type PromptInjectionMatch = {
  pattern: string;
  matched: string;
  position: number;
  weight: number;
};

export type PromptInjectionResult = {
  score: number;
  isInjection: boolean;
  matches: PromptInjectionMatch[];
};

// --- Phase 2: File Scan types ---

export type FileScanResult = {
  filePath: string;
  fileHash: string;
  fileSize: number;
  action: "ALLOW" | "BLOCK" | "REDACT";
  riskScore: number;
  reasons: string[];
  secretsFound: number;
  piiFound: number;
  entropyFound: number;
  secrets: Array<{
    type: string;
    severity: string;
    position: number;
    length: number;
  }>;
  pii: Array<{
    type: string;
    severity: string;
    position: number;
    length: number;
  }>;
  redactedContent?: string;
  cached: boolean;
  scanDurationMs: number;
};

// --- Phase 4: Control Plane types ---

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";
export type ApprovalDecision =
  | "allow_once"
  | "allow_always"
  | "deny"
  | "deny_always";

export type ApprovalRequest = {
  id: number;
  userId: number | null;
  actionType: string;
  resource: string;
  contextJson: string | null;
  status: ApprovalStatus;
  resolvedByDevice: string | null;
  resolvedAt: number | null;
  createdAt: number;
};

export type ApprovalRule = {
  id: number;
  userId: number | null;
  resourcePattern: string;
  actionType: string;
  decision: "allow_always" | "deny_always";
  createdAt: number;
};

export type NotificationChannelType = "webpush" | "slack" | "email" | "webhook";

export type NotificationChannel = {
  id: number;
  userId: number | null;
  channelType: NotificationChannelType;
  configJson: string;
  enabled: boolean;
  createdAt: number;
};

export type WsEventType =
  | "approval_needed"
  | "approval_resolved"
  | "scan_blocked"
  | "credit_exceeded"
  | "session_started"
  | "session_ended"
  | "tool_called"
  | "scan_result"
  | "task_event";

export type WsEvent = {
  type: WsEventType;
  payload: Record<string, unknown>;
  timestamp: number;
};

export type ActiveSession = {
  id: string;
  userId: number | null;
  deviceId: string;
  deviceType: string;
  model: string | null;
  startedAt: number;
  lastActivityAt: number;
};

export type BatchScanResult = {
  totalFiles: number;
  scanned: number;
  cached: number;
  blocked: number;
  redacted: number;
  allowed: number;
  totalRiskScore: number;
  results: FileScanResult[];
};
