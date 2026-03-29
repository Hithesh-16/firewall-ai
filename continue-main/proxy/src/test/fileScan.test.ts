/**
 * File Scan Tests
 *
 * Tests the file scan service, cache, and pipeline integration.
 * Uses real files in the proxy directory for testing.
 */

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { scanFileContent, isScanError } from "../scanner/fileScanService";
import { getCachedScan, cacheScanResult, invalidateCache } from "../scanner/fileScanCache";
import type { PolicyConfig, FileScanResult } from "../types";

function makeTestPolicy(): PolicyConfig {
  return {
    version: "1.2",
    rules: {
      block_private_keys: true,
      block_aws_keys: true,
      block_db_urls: true,
      block_github_tokens: true,
      redact_emails: true,
      redact_phone: true,
      redact_jwt: true,
      redact_generic_api_keys: true,
      allow_source_code: true,
      log_all_requests: true,
    },
    file_scope: {
      mode: "blocklist",
      blocklist: [".env", "**/*.pem"],
      allowlist: [],
      max_file_size_kb: 10, // Small limit for testing
      scan_on_open: false,
      scan_on_send: true,
    },
    blocked_paths: [],
    severity_threshold: "medium",
  };
}

// Create a temp file with given content, return its path
function createTempFile(content: string, filename: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "af-test-"));
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

function cleanupTempFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
    fs.rmdirSync(path.dirname(filePath));
  } catch {
    // ignore cleanup errors
  }
}

// --- scanFileContent tests ---

export function testScanCleanFile() {
  const filePath = createTempFile(
    "function add(a, b) { return a + b; }",
    "clean.ts"
  );
  try {
    const result = scanFileContent(filePath, makeTestPolicy());
    assert.ok(!isScanError(result), "Clean file should not produce an error");
    const scan = result as FileScanResult;
    assert.strictEqual(scan.action, "ALLOW", "Clean file should be ALLOW");
    assert.strictEqual(scan.secretsFound, 0);
    assert.strictEqual(scan.piiFound, 0);
    assert.ok(scan.fileHash.length === 64, "Should produce SHA-256 hash");
    assert.ok(scan.scanDurationMs >= 0, "Should track scan duration");
    assert.strictEqual(scan.cached, false, "Fresh scan should not be cached");
  } finally {
    cleanupTempFile(filePath);
  }
}

export function testScanFileWithSecrets() {
  const filePath = createTempFile(
    'const key = "AKIAIOSFODNN7EXAMPLE";\nconst db = "postgres://user:pass@host/db";',
    "secrets.ts"
  );
  try {
    const result = scanFileContent(filePath, makeTestPolicy());
    assert.ok(!isScanError(result), "Should scan successfully");
    const scan = result as FileScanResult;
    assert.strictEqual(scan.action, "BLOCK", "File with critical secrets should be BLOCK");
    assert.ok(scan.secretsFound > 0, "Should find secrets");
    assert.ok(scan.riskScore > 0, "Risk score should be > 0");
  } finally {
    cleanupTempFile(filePath);
  }
}

export function testScanFileWithPII() {
  const filePath = createTempFile(
    "Contact us at admin@example.com or call +12025551234",
    "contact.txt"
  );
  try {
    const result = scanFileContent(filePath, makeTestPolicy(), { includeRedacted: true });
    assert.ok(!isScanError(result), "Should scan successfully");
    const scan = result as FileScanResult;
    assert.ok(scan.piiFound > 0, "Should find PII (email, phone)");
    if (scan.action === "REDACT" && scan.redactedContent) {
      assert.ok(
        scan.redactedContent.includes("[REDACTED_"),
        "Redacted content should contain redaction tokens"
      );
    }
  } finally {
    cleanupTempFile(filePath);
  }
}

export function testScanFileNotFound() {
  const result = scanFileContent("/nonexistent/path/file.ts", makeTestPolicy());
  assert.ok(isScanError(result), "Should return error for missing file");
  assert.strictEqual(result.code, "FILE_NOT_FOUND");
}

export function testScanFileTooLarge() {
  // Policy has max_file_size_kb: 10 (10KB)
  const bigContent = "x".repeat(11 * 1024); // 11KB
  const filePath = createTempFile(bigContent, "big.txt");
  try {
    const result = scanFileContent(filePath, makeTestPolicy());
    assert.ok(isScanError(result), "Should return error for oversized file");
    assert.strictEqual(result.code, "FILE_TOO_LARGE");
  } finally {
    cleanupTempFile(filePath);
  }
}

export function testScanFileBlockedByScope() {
  const filePath = createTempFile("SECRET=value", "secrets.pem");
  // Use a policy that blocks *.pem files with a glob that matches any path
  const policy = makeTestPolicy();
  policy.file_scope.blocklist = ["**/*.pem", "**/.env"];
  try {
    const result = scanFileContent(filePath, policy);
    assert.ok(isScanError(result), "Should return error for blocked path");
    assert.strictEqual(result.code, "FILE_BLOCKED");
  } finally {
    cleanupTempFile(filePath);
  }
}

// --- Cache tests ---

export function testCacheMissReturnsNull() {
  const result = getCachedScan("/nonexistent/path.ts", "fakehash123");
  assert.strictEqual(result, null, "Cache miss should return null");
}

export function testCacheWriteAndRead() {
  const testPath = "/tmp/af-cache-test-file.ts";
  const testHash = "abc123def456";
  const testResult: FileScanResult = {
    filePath: testPath,
    fileHash: testHash,
    fileSize: 100,
    action: "ALLOW",
    riskScore: 0,
    reasons: [],
    secretsFound: 0,
    piiFound: 0,
    entropyFound: 0,
    secrets: [],
    pii: [],
    cached: false,
    scanDurationMs: 5,
  };

  // Write to cache
  cacheScanResult(testPath, testHash, 100, testResult);

  // Read from cache
  const cached = getCachedScan(testPath, testHash);
  assert.ok(cached !== null, "Should find cached result");
  assert.strictEqual(cached!.action, "ALLOW");
  assert.strictEqual(cached!.cached, true, "Cached result should have cached=true");
  assert.strictEqual(cached!.filePath, testPath);

  // Different hash should miss
  const missed = getCachedScan(testPath, "differenthash");
  assert.strictEqual(missed, null, "Different hash should miss cache");

  // Cleanup
  invalidateCache(testPath);
}

export function testCacheInvalidate() {
  const testPath = "/tmp/af-cache-invalidate-test.ts";
  const testResult: FileScanResult = {
    filePath: testPath,
    fileHash: "hash123",
    fileSize: 50,
    action: "ALLOW",
    riskScore: 0,
    reasons: [],
    secretsFound: 0,
    piiFound: 0,
    entropyFound: 0,
    secrets: [],
    pii: [],
    cached: false,
    scanDurationMs: 1,
  };

  cacheScanResult(testPath, "hash123", 50, testResult);
  assert.ok(getCachedScan(testPath, "hash123") !== null, "Should be cached");

  const cleared = invalidateCache(testPath);
  assert.ok(cleared > 0, "Should clear at least 1 entry");
  assert.strictEqual(getCachedScan(testPath, "hash123"), null, "Should be cleared");
}
