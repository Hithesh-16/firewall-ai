export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: { total: number; page: number; limit: number };
}

export interface ScanResult {
  action: "ALLOW" | "BLOCK" | "REDACT";
  riskScore: number;
  secretsFound: number;
  piiFound: number;
  entropyFound: number;
  model?: string;
  timestamp: number;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "security_lead" | "developer" | "auditor";
  orgId?: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface Provider {
  id: string;
  name: string;
  slug: string;
  baseUrl: string;
  enabled: boolean;
}

export interface Model {
  id: string;
  providerId: string;
  modelName: string;
  displayName: string;
  inputCostPer1k: number;
  outputCostPer1k: number;
  maxContextTokens: number;
  enabled: boolean;
}

export interface Task {
  id: string;
  type: string;
  status: "pending" | "running" | "completed" | "failed" | "killed";
  description: string;
  model?: string;
  progress?: {
    toolUseCount: number;
    inputTokens: number;
    outputTokens: number;
  };
  error?: string;
  resultSummary?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface Memory {
  fileName: string;
  name: string;
  description: string;
  type: "user" | "feedback" | "project" | "reference";
  body: string;
}

export interface AuditLog {
  id: number;
  timestamp: string;
  model: string;
  action: "ALLOW" | "BLOCK" | "REDACT";
  riskScore: number;
  secretsFound: number;
  piiFound: number;
}

export interface SecurityAuditResult {
  projectPath: string;
  scanStarted: string;
  scanDuration: number;
  filesScanned: number;
  filesSkipped: number;
  findings: readonly SecurityAuditFinding[];
  summary: SecurityAuditSummary;
  techStack: readonly string[];
}

export interface SecurityAuditFinding {
  category: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  description: string;
  filePath: string;
  lineNumber?: number;
  matchedText?: string;
  recommendation: string;
  cweName?: string;
}

export interface SecurityAuditSummary {
  totalFindings: number;
  bySeverity: Record<string, number>;
  byCategory: Record<string, number>;
  riskScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
}
