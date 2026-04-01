import { db } from "../db/index";
import { credits } from "../db/schema";
import { CreditCheck, CreditConfig, LimitType, ResetPeriod } from "../types";
import { eq, and, or, isNull, asc } from "drizzle-orm";

function toCredit(row: any): CreditConfig {
  return {
    id: row.id,
    providerId: row.providerId,
    modelId: row.modelId,
    limitType: row.limitType as LimitType,
    totalLimit: row.totalLimit,
    usedAmount: row.usedAmount,
    resetPeriod: row.resetPeriod as ResetPeriod,
    resetDate: row.resetDate,
    hardLimit: row.hardLimit === 1,
    createdAt: row.createdAt
  };
}

function computeNextReset(period: ResetPeriod): number {
  const now = new Date();
  switch (period) {
    case "daily":
      now.setDate(now.getDate() + 1);
      now.setHours(0, 0, 0, 0);
      return now.getTime();
    case "weekly":
      now.setDate(now.getDate() + (7 - now.getDay()));
      now.setHours(0, 0, 0, 0);
      return now.getTime();
    case "monthly":
      now.setMonth(now.getMonth() + 1, 1);
      now.setHours(0, 0, 0, 0);
      return now.getTime();
  }
}

export function setCreditLimit(opts: {
  providerId: number | null;
  modelId?: number | null;
  limitType: LimitType;
  totalLimit: number;
  resetPeriod: ResetPeriod;
  hardLimit?: boolean;
}): CreditConfig {
  const now = Date.now();
  const resetDate = computeNextReset(opts.resetPeriod);

  const result = db.insert(credits).values({
    providerId: opts.providerId ?? null,
    modelId: opts.modelId ?? null,
    limitType: opts.limitType,
    totalLimit: opts.totalLimit,
    usedAmount: 0,
    resetPeriod: opts.resetPeriod,
    resetDate: resetDate,
    hardLimit: opts.hardLimit !== false ? 1 : 0,
    createdAt: now
  }).run();

  return getCreditById(Number(result.lastInsertRowid))!;
}

export function getCreditById(id: number): CreditConfig | null {
  const row = db.select().from(credits).where(eq(credits.id, id)).get();
  return row ? toCredit(row) : null;
}

export function listCredits(providerId?: number): CreditConfig[] {
  let query = db.select().from(credits).orderBy(asc(credits.id));
  
  if (providerId !== undefined) {
    const rows = db.select().from(credits).where(eq(credits.providerId, providerId)).orderBy(asc(credits.id)).all();
    return rows.map(toCredit);
  }
  
  return query.all().map(toCredit);
}

function resetIfExpired(creditRow: any): void {
  if (Date.now() >= creditRow.resetDate) {
    const nextReset = computeNextReset(creditRow.resetPeriod as ResetPeriod);
    db.update(credits)
      .set({ usedAmount: 0, resetDate: nextReset })
      .where(eq(credits.id, creditRow.id))
      .run();
    creditRow.usedAmount = 0;
    creditRow.resetDate = nextReset;
  }
}

export function checkCredit(providerId: number, modelId?: number): CreditCheck {
  const rows = db.select().from(credits).where(
    and(
      or(eq(credits.providerId, providerId), isNull(credits.providerId)),
      modelId !== undefined 
        ? or(eq(credits.modelId, modelId), isNull(credits.modelId))
        : isNull(credits.modelId)
    )
  ).all();

  if (rows.length === 0) {
    return { allowed: true, remaining: Infinity, limitType: "requests" };
  }

  for (const row of rows) {
    resetIfExpired(row);

    const used = row.usedAmount ?? 0;
    const remaining = row.totalLimit - used;
    if (remaining <= 0 && row.hardLimit === 1) {
      return {
        allowed: false,
        remaining: 0,
        limitType: row.limitType as LimitType,
        message: `${row.limitType} limit exhausted (${used}/${row.totalLimit})`
      };
    }
  }

  const tightest = rows.reduce((min, row) => {
    const minUsed = min.usedAmount ?? 0;
    const rowUsed = row.usedAmount ?? 0;
    const rem = row.totalLimit - rowUsed;
    const minRem = min.totalLimit - minUsed;
    return rem < minRem ? row : min;
  }, rows[0]);

  return {
    allowed: true,
    remaining: tightest.totalLimit - (tightest.usedAmount ?? 0),
    limitType: tightest.limitType as LimitType
  };
}

export function consumeCredit(
  providerId: number,
  amount: number,
  limitType: LimitType,
  modelId?: number
): void {
  const rows = db.select().from(credits).where(
    and(
      eq(credits.limitType, limitType),
      or(eq(credits.providerId, providerId), isNull(credits.providerId)),
      modelId !== undefined 
        ? or(eq(credits.modelId, modelId), isNull(credits.modelId))
        : isNull(credits.modelId)
    )
  ).all();

  for (const row of rows) {
    resetIfExpired(row);
    // Since Drizzle in SQLite doesn't directly support UPDATE...SET used_amount = used_amount + X cleanly without raw strings sometimes,
    // we can just read the row.usedAmount from memory since we just queried it (or updated it via resetIfExpired).
    const newAmount = (row.usedAmount ?? 0) + amount;
    db.update(credits)
      .set({ usedAmount: newAmount })
      .where(eq(credits.id, row.id))
      .run();
  }
}

export function updateCreditLimit(
  id: number,
  updates: { totalLimit?: number; hardLimit?: boolean; resetPeriod?: ResetPeriod }
): CreditConfig | null {
  const credit = getCreditById(id);
  if (!credit) return null;

  const setObj: Record<string, any> = {};

  if (updates.totalLimit !== undefined) {
    setObj.totalLimit = updates.totalLimit;
  }
  if (updates.hardLimit !== undefined) {
    setObj.hardLimit = updates.hardLimit ? 1 : 0;
  }
  if (updates.resetPeriod !== undefined) {
    setObj.resetPeriod = updates.resetPeriod;
    setObj.resetDate = computeNextReset(updates.resetPeriod);
  }

  if (Object.keys(setObj).length === 0) return credit;

  db.update(credits).set(setObj).where(eq(credits.id, id)).run();

  return getCreditById(id);
}

export function deleteCreditLimit(id: number): boolean {
  const result = db.delete(credits).where(eq(credits.id, id)).run();
  return result.changes > 0;
}
