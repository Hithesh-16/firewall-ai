/**
 * Security Audit Scanner
 *
 * Technology-agnostic full-repository security audit. Walks a project directory,
 * scans every text file for hardcoded secrets, OWASP vulnerability patterns,
 * weak crypto, insecure configuration, dependency risks, and attack surface.
 *
 * Single Responsibility: Collects audit findings. No policy decisions, no blocking.
 *
 * Integrates with @ai-firewall/scanner for secret and PII detection while adding
 * vulnerability pattern matching, config analysis, and tech-stack detection.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { scanSecrets, scanPII } from "@ai-firewall/scanner";

// ── Types ────────────────────────────────────────────────────────────────

export type AuditSeverity = "critical" | "high" | "medium" | "low" | "info";
export type AuditCategory =
  | "hardcoded_secret"
  | "vulnerability_pattern"
  | "weak_crypto"
  | "insecure_config"
  | "dependency_risk"
  | "attack_surface"
  | "pii_exposure"
  | "debug_artifact";

export interface AuditFinding {
  readonly category: AuditCategory;
  readonly severity: AuditSeverity;
  readonly title: string;
  readonly description: string;
  readonly filePath: string;
  readonly lineNumber?: number;
  readonly matchedText?: string;
  readonly recommendation: string;
  readonly cweName?: string;
}

export interface AuditSummary {
  readonly totalFindings: number;
  readonly bySeverity: Record<AuditSeverity, number>;
  readonly byCategory: Record<AuditCategory, number>;
  readonly riskScore: number;
  readonly grade: "A" | "B" | "C" | "D" | "F";
}

export interface SecurityAuditResult {
  readonly projectPath: string;
  readonly scanStarted: string;
  readonly scanDuration: number;
  readonly filesScanned: number;
  readonly filesSkipped: number;
  readonly findings: readonly AuditFinding[];
  readonly summary: AuditSummary;
  readonly techStack: readonly string[];
}

export interface AuditOptions {
  readonly maxFiles?: number;
  readonly maxFileSize?: number;
  readonly includeInfoFindings?: boolean;
  readonly skipDirs?: readonly string[];
}

// ── Constants ────────────────────────────────────────────────────────────

const DEFAULT_MAX_FILES = 5000;
const DEFAULT_MAX_FILE_SIZE = 1_048_576; // 1 MB

const DEFAULT_SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "vendor",
  "__pycache__",
  ".next",
  ".nuxt",
  ".venv",
  "venv",
  "env",
  ".env",
  ".tox",
  "target",
  "out",
  "bin",
  "obj",
  ".gradle",
  ".idea",
  ".vscode",
  "coverage",
  ".nyc_output",
  ".pytest_cache",
  ".mypy_cache",
  "eggs",
  "*.egg-info",
  ".cache",
  "bower_components",
]);

const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".7z",
  ".rar",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".o",
  ".a",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".mp3",
  ".mp4",
  ".avi",
  ".mov",
  ".wav",
  ".flac",
  ".wasm",
  ".pyc",
  ".pyo",
  ".class",
  ".jar",
  ".db",
  ".sqlite",
  ".sqlite3",
  ".lock",
  ".min.js",
  ".min.css",
  ".map",
]);

const SEVERITY_WEIGHTS: Record<AuditSeverity, number> = {
  critical: 25,
  high: 10,
  medium: 3,
  low: 1,
  info: 0,
};

// ── Vulnerability Patterns ───────────────────────────────────────────────

interface VulnPattern {
  readonly regex: RegExp;
  readonly title: string;
  readonly description: string;
  readonly severity: AuditSeverity;
  readonly category: AuditCategory;
  readonly recommendation: string;
  readonly cweName: string;
  readonly fileGlobs?: readonly string[];
}

const VULN_PATTERNS: readonly VulnPattern[] = [
  // ── SQL Injection ──
  {
    regex:
      /(?:query|execute|exec|raw|prepare)\s*\(\s*["'`](?:SELECT|INSERT|UPDATE|DELETE|DROP)\b[^"'`]*["'`]\s*\+/i,
    title: "SQL Injection via string concatenation",
    description:
      "SQL query built with string concatenation allows injection attacks",
    severity: "critical",
    category: "vulnerability_pattern",
    recommendation: "Use parameterized queries or prepared statements",
    cweName: "CWE-89: SQL Injection",
  },
  {
    regex: /(?:execute|cursor\.execute)\s*\(\s*(?:f["']|["'].*%[sd])/i,
    title: "SQL Injection via format string (Python)",
    description: "SQL query uses f-string or %-formatting with user data",
    severity: "critical",
    category: "vulnerability_pattern",
    recommendation:
      "Use parameterized queries: cursor.execute('SELECT * FROM t WHERE id = ?', (id,))",
    cweName: "CWE-89: SQL Injection",
  },
  {
    regex: /\$\{.*\}\s*(?:FROM|WHERE|AND|OR|INSERT|UPDATE|DELETE|DROP)\b/i,
    title: "SQL Injection via template literal",
    description: "SQL query uses template literal interpolation",
    severity: "critical",
    category: "vulnerability_pattern",
    recommendation:
      "Use parameterized queries instead of template literals in SQL",
    cweName: "CWE-89: SQL Injection",
  },

  // ── XSS ──
  {
    regex: /\.innerHTML\s*=\s*(?!["'`]\s*["'`])/,
    title: "Potential XSS via innerHTML",
    description:
      "Setting innerHTML with dynamic content enables cross-site scripting",
    severity: "high",
    category: "vulnerability_pattern",
    recommendation: "Use textContent or a sanitization library like DOMPurify",
    cweName: "CWE-79: Cross-site Scripting",
  },
  {
    regex: /dangerouslySetInnerHTML/,
    title: "React dangerouslySetInnerHTML usage",
    description: "dangerouslySetInnerHTML bypasses React XSS protection",
    severity: "high",
    category: "vulnerability_pattern",
    recommendation:
      "Sanitize HTML with DOMPurify before passing to dangerouslySetInnerHTML",
    cweName: "CWE-79: Cross-site Scripting",
  },
  {
    regex: /document\.write\s*\(/,
    title: "document.write usage",
    description: "document.write can introduce XSS vulnerabilities",
    severity: "high",
    category: "vulnerability_pattern",
    recommendation: "Use DOM manipulation methods instead of document.write",
    cweName: "CWE-79: Cross-site Scripting",
  },
  {
    regex: /v-html\s*=/,
    title: "Vue v-html directive",
    description: "v-html renders raw HTML and is vulnerable to XSS",
    severity: "high",
    category: "vulnerability_pattern",
    recommendation: "Use v-text or sanitize content before v-html",
    cweName: "CWE-79: Cross-site Scripting",
  },
  {
    regex: /\[innerHTML\]\s*=/,
    title: "Angular innerHTML binding",
    description: "Angular innerHTML binding can introduce XSS if not sanitized",
    severity: "medium",
    category: "vulnerability_pattern",
    recommendation: "Use Angular DomSanitizer or text interpolation",
    cweName: "CWE-79: Cross-site Scripting",
  },
  {
    regex: /\{!!\s*\$.*!!}/,
    title: "Laravel Blade unescaped output",
    description: "Blade {!! !!} outputs raw HTML without escaping",
    severity: "high",
    category: "vulnerability_pattern",
    recommendation: "Use {{ }} for escaped output or sanitize before {!! !!}",
    cweName: "CWE-79: Cross-site Scripting",
  },
  {
    regex: /\|\s*safe\b/,
    title: "Jinja/Django |safe filter",
    description: "The |safe filter disables HTML escaping in templates",
    severity: "medium",
    category: "vulnerability_pattern",
    recommendation: "Remove |safe filter or ensure content is pre-sanitized",
    cweName: "CWE-79: Cross-site Scripting",
  },

  // ── Command Injection ──
  {
    regex:
      /(?:child_process|exec|execSync|spawn|spawnSync)\s*\(\s*(?:[^)]*\+|`[^`]*\$\{)/,
    title: "Command injection via child_process",
    description:
      "Shell command built with dynamic input enables command injection",
    severity: "critical",
    category: "vulnerability_pattern",
    recommendation:
      "Use execFile/spawnSync with argument arrays, never shell string interpolation",
    cweName: "CWE-78: OS Command Injection",
  },
  {
    regex: /os\.system\s*\(|subprocess\.call\s*\([^)]*shell\s*=\s*True/i,
    title: "Command injection (Python)",
    description:
      "os.system or subprocess with shell=True enables command injection",
    severity: "critical",
    category: "vulnerability_pattern",
    recommendation: "Use subprocess.run with shell=False and argument lists",
    cweName: "CWE-78: OS Command Injection",
  },
  {
    regex: /Runtime\.getRuntime\(\)\.exec\s*\(/,
    title: "Command injection (Java Runtime.exec)",
    description:
      "Runtime.exec with unsanitized input enables command injection",
    severity: "high",
    category: "vulnerability_pattern",
    recommendation:
      "Use ProcessBuilder with argument arrays and input validation",
    cweName: "CWE-78: OS Command Injection",
  },
  {
    regex: /`[^`]*\$[({]/,
    title: "Backtick command execution with interpolation",
    description: "Shell backtick execution with variable interpolation",
    severity: "medium",
    category: "vulnerability_pattern",
    recommendation: "Avoid backtick execution; use safe API calls instead",
    cweName: "CWE-78: OS Command Injection",
  },

  // ── Path Traversal ──
  {
    regex:
      /(?:readFile|readFileSync|createReadStream|open)\s*\([^)]*(?:req\.|params\.|query\.|input|args)/,
    title: "Path traversal via unsanitized input",
    description:
      "File operation uses request parameters without path validation",
    severity: "high",
    category: "vulnerability_pattern",
    recommendation:
      "Validate and resolve paths; use path.resolve and ensure result is within allowed directory",
    cweName: "CWE-22: Path Traversal",
  },
  {
    regex: /\.\.\/.*(?:password|secret|key|token|credential|config)/i,
    title: "Suspicious path traversal pattern",
    description: "Path traversal sequence targeting sensitive files",
    severity: "medium",
    category: "vulnerability_pattern",
    recommendation: "Sanitize file paths and restrict to allowed directories",
    cweName: "CWE-22: Path Traversal",
  },

  // ── SSRF ──
  {
    regex:
      /(?:fetch|axios|request|http\.get|urllib)\s*\([^)]*(?:req\.|params\.|query\.|body\.|input)/,
    title: "Potential SSRF via user-controlled URL",
    description: "HTTP request uses user-supplied URL without validation",
    severity: "high",
    category: "vulnerability_pattern",
    recommendation:
      "Validate and allowlist URLs; block internal/private IP ranges",
    cweName: "CWE-918: Server-Side Request Forgery",
  },

  // ── XXE ──
  {
    regex: /(?:parseXML|XMLParser|DocumentBuilder|SAXParser|etree\.parse)\s*\(/,
    title: "XML parsing without entity restriction",
    description:
      "XML parser may be vulnerable to XXE if external entities are not disabled",
    severity: "medium",
    category: "vulnerability_pattern",
    recommendation:
      "Disable external entity processing in XML parser configuration",
    cweName: "CWE-611: XML External Entity",
  },

  // ── Insecure Deserialization ──
  {
    regex:
      /(?:pickle\.loads?|yaml\.load\s*\([^)]*(?!\s*Loader)|unserialize|Marshal\.load|ObjectInputStream)/,
    title: "Insecure deserialization",
    description:
      "Deserializing untrusted data can lead to remote code execution",
    severity: "critical",
    category: "vulnerability_pattern",
    recommendation:
      "Use safe deserialization (yaml.safe_load, JSON, validated schemas)",
    cweName: "CWE-502: Insecure Deserialization",
  },

  // ── Weak Crypto ──
  {
    regex: /(?:createHash|hashlib\.md5|MD5\.Create|Digest::MD5|md5\.New)\s*\(/,
    title: "MD5 hash usage",
    description:
      "MD5 is cryptographically broken; unsuitable for security purposes",
    severity: "medium",
    category: "weak_crypto",
    recommendation:
      "Use SHA-256 or better; for passwords, use bcrypt/scrypt/argon2",
    cweName: "CWE-328: Weak Hash",
  },
  {
    regex:
      /(?:createHash|hashlib\.sha1|SHA1\.Create|Digest::SHA1)\s*\(\s*["']sha1["']\s*\)/,
    title: "SHA-1 hash usage",
    description:
      "SHA-1 is deprecated for security; collision attacks are practical",
    severity: "medium",
    category: "weak_crypto",
    recommendation: "Upgrade to SHA-256 or SHA-3",
    cweName: "CWE-328: Weak Hash",
  },
  {
    regex: /Math\.random\s*\(\s*\)/,
    title: "Math.random for security-sensitive value",
    description: "Math.random is not cryptographically secure",
    severity: "medium",
    category: "weak_crypto",
    recommendation:
      "Use crypto.randomBytes or crypto.getRandomValues for security tokens",
    cweName: "CWE-338: Weak PRNG",
  },
  {
    regex: /(?:random\.random|random\.randint|rand\(\)|srand\()/,
    title: "Weak random number generator",
    description:
      "Standard random is predictable; unsuitable for security tokens",
    severity: "medium",
    category: "weak_crypto",
    recommendation:
      "Use secrets module (Python), SecureRandom (Java/Ruby), or crypto/rand (Go)",
    cweName: "CWE-338: Weak PRNG",
  },
  {
    regex: /(?:DES|RC4|RC2|Blowfish)(?:\.|::|-|_)/i,
    title: "Deprecated cipher algorithm",
    description: "DES/RC4/RC2/Blowfish are cryptographically weak",
    severity: "high",
    category: "weak_crypto",
    recommendation: "Use AES-256-GCM or ChaCha20-Poly1305",
    cweName: "CWE-327: Broken Crypto Algorithm",
  },
  {
    regex: /(?:ECB|["']ecb["'])/i,
    title: "ECB cipher mode",
    description:
      "ECB mode does not provide semantic security (identical blocks produce identical ciphertext)",
    severity: "high",
    category: "weak_crypto",
    recommendation: "Use GCM or CBC with HMAC for authenticated encryption",
    cweName: "CWE-327: Broken Crypto Algorithm",
  },
  {
    regex: /(?:iv|nonce)\s*[:=]\s*["'][^"']{8,}["']/i,
    title: "Hardcoded IV/nonce",
    description: "Hardcoded initialization vectors weaken encryption",
    severity: "high",
    category: "weak_crypto",
    recommendation: "Generate a random IV/nonce for each encryption operation",
    cweName: "CWE-329: Not Using Unpredictable IV",
  },

  // ── Eval/Exec ──
  {
    regex: /\beval\s*\(\s*(?!["'`]\s*["'`])/,
    title: "eval() usage with dynamic input",
    description:
      "eval executes arbitrary code and is a common injection vector",
    severity: "high",
    category: "vulnerability_pattern",
    recommendation:
      "Replace eval with safe alternatives (JSON.parse, Function constructor with validation)",
    cweName: "CWE-95: Code Injection",
  },
  {
    regex: /new\s+Function\s*\([^)]*\+/,
    title: "Dynamic Function constructor",
    description: "new Function with dynamic input is equivalent to eval",
    severity: "high",
    category: "vulnerability_pattern",
    recommendation:
      "Avoid dynamic code generation; use safe parsing or lookup tables",
    cweName: "CWE-95: Code Injection",
  },

  // ── Insecure Configuration ──
  {
    regex: /(?:cors|CORS)\s*\(\s*\{[^}]*origin\s*:\s*(?:true|["']\*["'])/,
    title: "CORS wildcard origin",
    description:
      "CORS configured to allow all origins, enabling cross-origin attacks",
    severity: "high",
    category: "insecure_config",
    recommendation: "Restrict CORS to specific trusted origins",
    cweName: "CWE-942: Overly Permissive CORS",
  },
  {
    regex: /Access-Control-Allow-Origin['":\s]*\*/,
    title: "CORS Allow-Origin wildcard header",
    description: "Access-Control-Allow-Origin set to *, allowing any origin",
    severity: "high",
    category: "insecure_config",
    recommendation: "Set specific allowed origins instead of wildcard",
    cweName: "CWE-942: Overly Permissive CORS",
  },
  {
    regex:
      /verify\s*[:=]\s*False|rejectUnauthorized\s*[:=]\s*false|InsecureSkipVerify\s*[:=]\s*true|CURLOPT_SSL_VERIFYPEER\s*,\s*(?:false|0)/i,
    title: "SSL/TLS verification disabled",
    description: "Disabling SSL verification allows man-in-the-middle attacks",
    severity: "critical",
    category: "insecure_config",
    recommendation:
      "Never disable SSL verification in production; use proper certificates",
    cweName: "CWE-295: Improper Certificate Validation",
  },
  {
    regex: /DEBUG\s*[:=]\s*(?:True|true|1|"true"|'true')\b/,
    title: "Debug mode enabled",
    description:
      "Debug mode may expose stack traces, internal paths, and sensitive data",
    severity: "medium",
    category: "insecure_config",
    recommendation: "Ensure DEBUG is disabled in production configuration",
    cweName: "CWE-489: Active Debug Code",
  },
  {
    regex:
      /(?:password|passwd|pwd)\s*[:=]\s*["'](?:admin|root|password|123456|default|test|changeme)["']/i,
    title: "Default/weak credentials",
    description: "Hardcoded default or weak credentials found",
    severity: "critical",
    category: "insecure_config",
    recommendation:
      "Remove default credentials; use environment variables and strong passwords",
    cweName: "CWE-798: Hardcoded Credentials",
  },

  // ── Debug Artifacts ──
  {
    regex:
      /(?:console\.log|console\.debug|print|fmt\.Println|System\.out\.println)\s*\(\s*["'`].*(?:password|secret|token|key|credential)/i,
    title: "Sensitive data in debug output",
    description: "Logging sensitive values may expose them in production logs",
    severity: "high",
    category: "debug_artifact",
    recommendation:
      "Remove debug logging of sensitive values before production",
    cweName: "CWE-532: Information Exposure Through Log Files",
  },
  {
    regex: /TODO|FIXME|HACK|XXX|TEMP/,
    title: "Development TODO/FIXME marker",
    description:
      "Unresolved development note may indicate incomplete security work",
    severity: "info",
    category: "debug_artifact",
    recommendation: "Review and resolve all TODO/FIXME markers before release",
    cweName: "CWE-546: Suspicious Comment",
  },

  // ── Attack Surface ──
  {
    regex:
      /(?:app|router)\s*\.(?:get|post|put|patch|delete)\s*\(\s*["'`]\/admin/i,
    title: "Admin endpoint exposed",
    description: "Admin route may be accessible without proper authorization",
    severity: "medium",
    category: "attack_surface",
    recommendation:
      "Protect admin routes with authentication and role-based access control",
    cweName: "CWE-284: Improper Access Control",
  },
  {
    regex:
      /(?:app|router)\s*\.(?:get|post|put|patch|delete)\s*\(\s*["'`]\/debug/i,
    title: "Debug endpoint exposed",
    description: "Debug routes should never be accessible in production",
    severity: "high",
    category: "attack_surface",
    recommendation: "Remove or disable debug endpoints in production builds",
    cweName: "CWE-489: Active Debug Code",
  },
  {
    regex: /(?:multer|upload|formidable|busboy|multipart)\s*[.(]/i,
    title: "File upload handler detected",
    description:
      "File upload endpoints are a common attack vector (malware, path traversal, DoS)",
    severity: "medium",
    category: "attack_surface",
    recommendation:
      "Validate file type, size, and name; store outside webroot; scan for malware",
    cweName: "CWE-434: Unrestricted File Upload",
  },
  {
    regex: /(?:graphql|GraphQL|gql)\s*[.(]/i,
    title: "GraphQL endpoint detected",
    description:
      "GraphQL endpoints may be vulnerable to introspection, batching, or depth attacks",
    severity: "info",
    category: "attack_surface",
    recommendation:
      "Disable introspection in production; add query depth/complexity limits",
    cweName: "CWE-200: Information Exposure",
  },
  {
    regex: /(?:WebSocket|ws\.Server|socket\.io|sockjs)\s*[.(]/i,
    title: "WebSocket endpoint detected",
    description:
      "WebSocket connections need authentication and input validation",
    severity: "info",
    category: "attack_surface",
    recommendation:
      "Authenticate WebSocket connections; validate all messages; implement rate limiting",
    cweName: "CWE-306: Missing Authentication",
  },
  {
    regex:
      /(?:app|router)\s*\.(?:get|post|put|patch|delete)\s*\(\s*["'`]\/api\//i,
    title: "API endpoint detected",
    description: "API endpoint identified for attack surface mapping",
    severity: "info",
    category: "attack_surface",
    recommendation:
      "Ensure authentication, rate limiting, and input validation on all API endpoints",
    cweName: "CWE-284: Improper Access Control",
  },
];

// ── Dependency Risk Patterns ─────────────────────────────────────────────

interface DepPattern {
  readonly regex: RegExp;
  readonly title: string;
  readonly description: string;
  readonly severity: AuditSeverity;
  readonly recommendation: string;
}

const DEP_PATTERNS: readonly DepPattern[] = [
  {
    regex: /["']\*["']|["']latest["']/,
    title: "Wildcard or 'latest' version range",
    description:
      "Unpinned dependency versions can introduce breaking changes or vulnerabilities",
    severity: "medium",
    recommendation:
      "Pin dependencies to specific versions or use locked ranges (^, ~)",
  },
  {
    regex:
      /["'](?:event-stream|ua-parser-js|coa|rc|colors|faker|node-ipc)["']/i,
    title: "Previously compromised package",
    description: "This package has a history of supply chain compromise",
    severity: "high",
    recommendation:
      "Verify package integrity; consider alternatives; check for known compromised versions",
  },
  {
    regex: /["'](?:request|merge|underscore\.string|nomnom|dateformat)["']\s*:/,
    title: "Deprecated package in use",
    description:
      "This package is deprecated and may contain unfixed vulnerabilities",
    severity: "low",
    recommendation: "Migrate to a maintained alternative",
  },
];

// ── Config File Patterns ─────────────────────────────────────────────────

const CONFIG_FILE_NAMES: ReadonlySet<string> = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.staging",
  ".env.development",
  ".env.test",
]);

const DEP_FILE_NAMES: ReadonlySet<string> = new Set([
  "package.json",
  "requirements.txt",
  "Pipfile",
  "pyproject.toml",
  "go.mod",
  "go.sum",
  "Cargo.toml",
  "Cargo.lock",
  "Gemfile",
  "Gemfile.lock",
  "composer.json",
  "composer.lock",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
]);

// ── Tech Stack Detection ─────────────────────────────────────────────────

interface TechIndicator {
  readonly file: string;
  readonly label: string;
}

const TECH_INDICATORS: readonly TechIndicator[] = [
  { file: "package.json", label: "Node.js/JavaScript" },
  { file: "tsconfig.json", label: "TypeScript" },
  { file: "requirements.txt", label: "Python" },
  { file: "pyproject.toml", label: "Python" },
  { file: "Pipfile", label: "Python" },
  { file: "go.mod", label: "Go" },
  { file: "Cargo.toml", label: "Rust" },
  { file: "pom.xml", label: "Java (Maven)" },
  { file: "build.gradle", label: "Java (Gradle)" },
  { file: "build.gradle.kts", label: "Kotlin (Gradle)" },
  { file: "Gemfile", label: "Ruby" },
  { file: "composer.json", label: "PHP" },
  { file: "Dockerfile", label: "Docker" },
  { file: "docker-compose.yml", label: "Docker Compose" },
  { file: "docker-compose.yaml", label: "Docker Compose" },
  { file: ".terraform", label: "Terraform" },
];

const TECH_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  [".swift", "Swift"],
  [".kt", "Kotlin"],
  [".cs", "C#/.NET"],
  [".go", "Go"],
  [".rs", "Rust"],
  [".rb", "Ruby"],
  [".php", "PHP"],
  [".java", "Java"],
  [".py", "Python"],
  [".ts", "TypeScript"],
  [".tsx", "TypeScript (React)"],
  [".jsx", "JavaScript (React)"],
  [".vue", "Vue.js"],
  [".svelte", "Svelte"],
  [".tf", "Terraform"],
]);

// ── Helpers ──────────────────────────────────────────────────────────────

function redactSecret(value: string): string {
  if (value.length <= 6) return "****";
  return `${value.slice(0, 4)}...${value.slice(-2)}`;
}

function isBinaryExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

function shouldSkipDir(
  dirName: string,
  extraSkips: ReadonlySet<string>,
): boolean {
  return (
    DEFAULT_SKIP_DIRS.has(dirName) ||
    extraSkips.has(dirName) ||
    dirName.startsWith(".")
  );
}

function computeGrade(weightedScore: number): "A" | "B" | "C" | "D" | "F" {
  if (weightedScore <= 5) return "A";
  if (weightedScore <= 15) return "B";
  if (weightedScore <= 30) return "C";
  if (weightedScore <= 50) return "D";
  return "F";
}

function computeRiskScore(findings: readonly AuditFinding[]): number {
  let total = 0;
  for (const f of findings) {
    total += SEVERITY_WEIGHTS[f.severity];
  }
  return Math.min(total, 100);
}

function computeWeightedScore(findings: readonly AuditFinding[]): number {
  let total = 0;
  for (const f of findings) {
    total +=
      SEVERITY_WEIGHTS[f.severity] > 0 ? SEVERITY_WEIGHTS[f.severity] : 0;
  }
  return total;
}

function buildSummary(findings: readonly AuditFinding[]): AuditSummary {
  const bySeverity: Record<AuditSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  const byCategory: Record<AuditCategory, number> = {
    hardcoded_secret: 0,
    vulnerability_pattern: 0,
    weak_crypto: 0,
    insecure_config: 0,
    dependency_risk: 0,
    attack_surface: 0,
    pii_exposure: 0,
    debug_artifact: 0,
  };

  for (const f of findings) {
    bySeverity[f.severity] += 1;
    byCategory[f.category] += 1;
  }

  const weightedScore = computeWeightedScore(findings);

  return {
    totalFindings: findings.length,
    bySeverity,
    byCategory,
    riskScore: computeRiskScore(findings),
    grade: computeGrade(weightedScore),
  };
}

// ── File Walker ──────────────────────────────────────────────────────────

interface WalkResult {
  readonly files: readonly string[];
  readonly skipped: number;
}

function walkDirectory(
  rootPath: string,
  maxFiles: number,
  maxFileSize: number,
  extraSkips: ReadonlySet<string>,
): WalkResult {
  const files: string[] = [];
  let skipped = 0;
  const stack: string[] = [rootPath];

  while (stack.length > 0 && files.length < maxFiles) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];

    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      skipped += 1;
      continue;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) break;

      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name, extraSkips)) {
          stack.push(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (isBinaryExtension(fullPath)) {
        skipped += 1;
        continue;
      }

      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > maxFileSize || stat.size === 0) {
          skipped += 1;
          continue;
        }
      } catch {
        skipped += 1;
        continue;
      }

      files.push(fullPath);
    }
  }

  return { files, skipped };
}

// ── Per-File Scanners ────────────────────────────────────────────────────

function scanFileForSecrets(
  content: string,
  filePath: string,
  relativePath: string,
): readonly AuditFinding[] {
  const result = scanSecrets(content);
  if (!result.hasSecrets) return [];

  return result.secrets.map((s) => ({
    category: "hardcoded_secret" as const,
    severity:
      s.severity === "critical"
        ? ("critical" as const)
        : s.severity === "high"
          ? ("high" as const)
          : ("medium" as const),
    title: `Hardcoded ${s.type} detected`,
    description: `Found ${s.type} in source file`,
    filePath: relativePath,
    lineNumber: content.substring(0, s.position).split("\n").length,
    matchedText: redactSecret(s.value),
    recommendation:
      "Move secrets to environment variables or a secrets manager",
    cweName: "CWE-798: Hardcoded Credentials",
  }));
}

function scanFileForPII(
  content: string,
  filePath: string,
  relativePath: string,
): readonly AuditFinding[] {
  const result = scanPII(content);
  if (!result.hasPII) return [];

  return result.pii.map((p) => ({
    category: "pii_exposure" as const,
    severity:
      p.severity === "critical"
        ? ("high" as const)
        : p.severity === "high"
          ? ("medium" as const)
          : ("low" as const),
    title: `PII exposure: ${p.type}`,
    description: `Found ${p.type} in source file that may be committed to version control`,
    filePath: relativePath,
    lineNumber: content.substring(0, p.position).split("\n").length,
    matchedText: redactSecret(p.value),
    recommendation:
      "Remove PII from source code; use environment variables or configuration",
    cweName: "CWE-359: Privacy Violation",
  }));
}

function scanFileForVulnPatterns(
  content: string,
  relativePath: string,
  includeInfo: boolean,
): readonly AuditFinding[] {
  const findings: AuditFinding[] = [];
  const lines = content.split("\n");

  for (const pattern of VULN_PATTERNS) {
    if (!includeInfo && pattern.severity === "info") continue;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = pattern.regex.exec(line);
      if (match) {
        findings.push({
          category: pattern.category,
          severity: pattern.severity,
          title: pattern.title,
          description: pattern.description,
          filePath: relativePath,
          lineNumber: i + 1,
          matchedText:
            match[0].length > 80 ? `${match[0].slice(0, 77)}...` : match[0],
          recommendation: pattern.recommendation,
          cweName: pattern.cweName,
        });
        // One finding per pattern per file to avoid noise
        break;
      }
    }
  }

  return findings;
}

function scanConfigFile(
  content: string,
  fileName: string,
  relativePath: string,
): readonly AuditFinding[] {
  const findings: AuditFinding[] = [];

  if (CONFIG_FILE_NAMES.has(fileName)) {
    // Check if .env contains real values (not placeholders)
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("#") || line === "" || !line.includes("=")) continue;

      const eqIndex = line.indexOf("=");
      const value = line
        .slice(eqIndex + 1)
        .trim()
        .replace(/^["']|["']$/g, "");

      if (
        value.length > 5 &&
        value !== "your_key_here" &&
        value !== "changeme" &&
        value !== "xxx" &&
        !value.startsWith("${") &&
        !value.startsWith("<")
      ) {
        const key = line.slice(0, eqIndex).trim();
        if (/(?:key|secret|token|password|api|auth|credential)/i.test(key)) {
          findings.push({
            category: "insecure_config",
            severity: "critical",
            title: "Secret in committed .env file",
            description: `Environment file contains real secret for ${key}`,
            filePath: relativePath,
            lineNumber: i + 1,
            matchedText: `${key}=${redactSecret(value)}`,
            recommendation:
              "Add .env to .gitignore; use .env.example with placeholders",
            cweName: "CWE-798: Hardcoded Credentials",
          });
        }
      }
    }
  }

  return findings;
}

function scanDependencyFile(
  content: string,
  fileName: string,
  relativePath: string,
): readonly AuditFinding[] {
  const findings: AuditFinding[] = [];

  if (!DEP_FILE_NAMES.has(fileName)) return findings;

  const lines = content.split("\n");

  for (const pattern of DEP_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      const match = pattern.regex.exec(lines[i]);
      if (match) {
        findings.push({
          category: "dependency_risk",
          severity: pattern.severity,
          title: pattern.title,
          description: pattern.description,
          filePath: relativePath,
          lineNumber: i + 1,
          matchedText: match[0],
          recommendation: pattern.recommendation,
          cweName: "CWE-1357: Reliance on Uncontrolled Component",
        });
      }
    }
  }

  return findings;
}

// ── Tech Stack Detection ─────────────────────────────────────────────────

function detectTechStack(
  projectPath: string,
  scannedFiles: readonly string[],
): readonly string[] {
  const detected = new Set<string>();

  // Check for indicator files in project root
  for (const indicator of TECH_INDICATORS) {
    const checkPath = path.join(projectPath, indicator.file);
    try {
      fs.accessSync(checkPath, fs.constants.R_OK);
      detected.add(indicator.label);
    } catch {
      // File does not exist — skip
    }
  }

  // Check extensions from scanned files (sample first 500)
  const sample = scannedFiles.slice(0, 500);
  for (const filePath of sample) {
    const ext = path.extname(filePath).toLowerCase();
    const label = TECH_EXTENSIONS.get(ext);
    if (label) {
      detected.add(label);
    }
  }

  return Array.from(detected).sort();
}

// ── Main Export ───────────────────────────────────────────────────────────

export async function runSecurityAudit(
  projectPath: string,
  options?: AuditOptions,
): Promise<SecurityAuditResult> {
  const scanStarted = new Date().toISOString();
  const startTime = Date.now();

  const maxFiles = options?.maxFiles ?? DEFAULT_MAX_FILES;
  const maxFileSize = options?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const includeInfo = options?.includeInfoFindings ?? false;
  const extraSkips = new Set(options?.skipDirs ?? []);

  // Resolve and validate project path
  const resolvedPath = path.resolve(projectPath);
  try {
    fs.accessSync(resolvedPath, fs.constants.R_OK);
  } catch {
    return {
      projectPath: resolvedPath,
      scanStarted,
      scanDuration: Date.now() - startTime,
      filesScanned: 0,
      filesSkipped: 0,
      findings: [],
      summary: buildSummary([]),
      techStack: [],
    };
  }

  // Walk directory
  const { files, skipped } = walkDirectory(
    resolvedPath,
    maxFiles,
    maxFileSize,
    extraSkips,
  );

  // Detect tech stack
  const techStack = detectTechStack(resolvedPath, files);

  // Scan all files
  const allFindings: AuditFinding[] = [];

  for (const filePath of files) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const relativePath = path.relative(resolvedPath, filePath);
    const fileName = path.basename(filePath);

    // Secret detection (via @ai-firewall/scanner)
    const secretFindings = scanFileForSecrets(content, filePath, relativePath);
    for (const f of secretFindings) allFindings.push(f);

    // PII detection (via @ai-firewall/scanner)
    const piiFindings = scanFileForPII(content, filePath, relativePath);
    for (const f of piiFindings) allFindings.push(f);

    // Vulnerability patterns
    const vulnFindings = scanFileForVulnPatterns(
      content,
      relativePath,
      includeInfo,
    );
    for (const f of vulnFindings) allFindings.push(f);

    // Config file analysis
    const configFindings = scanConfigFile(content, fileName, relativePath);
    for (const f of configFindings) allFindings.push(f);

    // Dependency file analysis
    const depFindings = scanDependencyFile(content, fileName, relativePath);
    for (const f of depFindings) allFindings.push(f);
  }

  // Filter info findings if not requested
  const filteredFindings = includeInfo
    ? allFindings
    : allFindings.filter((f) => f.severity !== "info");

  const scanDuration = Date.now() - startTime;

  return {
    projectPath: resolvedPath,
    scanStarted,
    scanDuration,
    filesScanned: files.length,
    filesSkipped: skipped,
    findings: filteredFindings,
    summary: buildSummary(filteredFindings),
    techStack,
  };
}
