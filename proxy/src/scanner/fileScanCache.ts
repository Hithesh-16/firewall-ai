import { db } from "../db/index";
import { fileScanCache } from "../db/schema";
import type { FileScanResult } from "../types";
import { eq, and, sql } from "drizzle-orm";

export function getCachedScan(
  filePath: string,
  fileHash: string
): FileScanResult | null {
  const row = db.select({ scanResult: fileScanCache.scanResult })
    .from(fileScanCache)
    .where(and(eq(fileScanCache.filePath, filePath), eq(fileScanCache.fileHash, fileHash)))
    .get();

  if (!row) return null;

  try {
    const result = JSON.parse(row.scanResult) as FileScanResult;
    return { ...result, cached: true };
  } catch {
    return null;
  }
}

export function cacheScanResult(
  filePath: string,
  fileHash: string,
  fileSize: number,
  result: FileScanResult
): void {
  db.insert(fileScanCache).values({
    filePath,
    fileHash,
    fileSize,
    action: result.action,
    riskScore: result.riskScore,
    secretsFound: result.secretsFound,
    piiFound: result.piiFound,
    entropyFound: result.entropyFound,
    scanResult: JSON.stringify(result),
    scannedAt: Date.now()
  }).onConflictDoUpdate({
    target: [fileScanCache.filePath, fileScanCache.fileHash],
    set: {
      fileSize,
      action: result.action,
      riskScore: result.riskScore,
      secretsFound: result.secretsFound,
      piiFound: result.piiFound,
      entropyFound: result.entropyFound,
      scanResult: JSON.stringify(result),
      scannedAt: Date.now()
    }
  }).run();
}

export function invalidateCache(filePath?: string): number {
  if (filePath) {
    const result = db.delete(fileScanCache).where(eq(fileScanCache.filePath, filePath)).run();
    return result.changes;
  }
  const result = db.delete(fileScanCache).run();
  return result.changes;
}

export function getCacheStats(): { totalEntries: number; totalSizeBytes: number } {
  const row = db.select({
    total: sql<number>`COUNT(*)`,
    totalSize: sql<number>`COALESCE(SUM(${fileScanCache.fileSize}), 0)`
  }).from(fileScanCache).get();

  return {
    totalEntries: row?.total ?? 0,
    totalSizeBytes: row?.totalSize ?? 0,
  };
}
