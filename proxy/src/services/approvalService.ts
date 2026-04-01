import { db } from "../db/index";
import { approvalRequests, approvalRules } from "../db/schema";
import { broadcast } from "../ws/wsManager";
import type {
  ApprovalRequest,
  ApprovalRule,
  ApprovalDecision,
  ApprovalStatus,
  WsEvent,
} from "../types";
import { eq, and, desc } from "drizzle-orm";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_ON_TIMEOUT: "deny" | "allow" = "deny";

const pendingWaiters = new Map<
  number,
  { resolve: (decision: ApprovalDecision) => void; timer: ReturnType<typeof setTimeout> }
>();

export async function requestApproval(
  userId: number | null,
  actionType: string,
  resource: string,
  context?: Record<string, unknown>,
  timeoutMs?: number
): Promise<{ decision: ApprovalDecision; requestId: number; source: "rule" | "user" | "timeout" }> {
  const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (userId != null) {
    const rule = findMatchingRule(userId, actionType, resource);
    if (rule) {
      return {
        decision: rule.decision === "allow_always" ? "allow_once" : "deny",
        requestId: -1,
        source: "rule",
      };
    }
  }

  const result = db.insert(approvalRequests).values({
    userId,
    actionType,
    resource,
    contextJson: context ? JSON.stringify(context) : null,
    status: "pending",
    createdAt: Date.now()
  }).run();

  const requestId = Number(result.lastInsertRowid);

  const event: WsEvent = {
    type: "approval_needed",
    payload: {
      requestId,
      actionType,
      resource,
      context: context ?? {},
      timeoutMs: timeout,
    },
    timestamp: Date.now(),
  };

  broadcast(userId ?? 0, event);

  return new Promise<{ decision: ApprovalDecision; requestId: number; source: "rule" | "user" | "timeout" }>((resolve) => {
    const timer = setTimeout(() => {
      pendingWaiters.delete(requestId);
      db.update(approvalRequests).set({ status: "expired" }).where(eq(approvalRequests.id, requestId)).run();

      const defaultDecision: ApprovalDecision = DEFAULT_ON_TIMEOUT === "deny" ? "deny" : "allow_once";
      resolve({ decision: defaultDecision, requestId, source: "timeout" });
    }, timeout);

    pendingWaiters.set(requestId, {
      resolve: (decision: ApprovalDecision) => {
        clearTimeout(timer);
        pendingWaiters.delete(requestId);
        resolve({ decision, requestId, source: "user" });
      },
      timer,
    });
  });
}

export function resolveApproval(
  requestId: number,
  decision: ApprovalDecision,
  deviceId?: string
): boolean {
  const status: ApprovalStatus = decision === "allow_once" || decision === "allow_always" ? "approved" : "denied";

  const result = db.update(approvalRequests)
    .set({
      status,
      resolvedByDevice: deviceId ?? null,
      resolvedAt: Date.now()
    })
    .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.status, "pending")))
    .run();

  if (result.changes === 0) return false;

  if (decision === "allow_always" || decision === "deny_always") {
    const request = getApprovalById(requestId);
    if (request && request.userId != null) {
      saveRule(request.userId, request.actionType, request.resource, decision);
    }
  }

  const waiter = pendingWaiters.get(requestId);
  if (waiter) {
    waiter.resolve(decision);
  }

  const request = getApprovalById(requestId);
  if (request) {
    const event: WsEvent = {
      type: "approval_resolved",
      payload: { requestId, decision, status },
      timestamp: Date.now(),
    };
    broadcast(request.userId ?? 0, event);
  }

  return true;
}

export function getPendingApprovals(userId: number): ApprovalRequest[] {
  const rows = db.select().from(approvalRequests)
    .where(and(eq(approvalRequests.userId, userId), eq(approvalRequests.status, "pending")))
    .orderBy(desc(approvalRequests.createdAt))
    .all();
  return rows.map(mapApprovalRow);
}

export function getApprovalHistory(userId: number, limit = 50): ApprovalRequest[] {
  const rows = db.select().from(approvalRequests)
    .where(eq(approvalRequests.userId, userId))
    .orderBy(desc(approvalRequests.createdAt))
    .limit(limit)
    .all();
  return rows.map(mapApprovalRow);
}

export function getApprovalById(id: number): ApprovalRequest | null {
  const row = db.select().from(approvalRequests).where(eq(approvalRequests.id, id)).get();
  return row ? mapApprovalRow(row) : null;
}

export function getUserRules(userId: number): ApprovalRule[] {
  const rows = db.select().from(approvalRules)
    .where(eq(approvalRules.userId, userId))
    .orderBy(desc(approvalRules.createdAt))
    .all();
  return rows.map(mapApprovalRuleRow);
}

export function deleteRule(ruleId: number): boolean {
  const result = db.delete(approvalRules).where(eq(approvalRules.id, ruleId)).run();
  return result.changes > 0;
}

function saveRule(
  userId: number,
  actionType: string,
  resource: string,
  decision: "allow_always" | "deny_always"
): void {
  db.insert(approvalRules).values({
    userId,
    resourcePattern: resource,
    actionType,
    decision,
    createdAt: Date.now()
  }).onConflictDoUpdate({
    target: [approvalRules.userId, approvalRules.resourcePattern, approvalRules.actionType],
    set: {
      decision,
      createdAt: Date.now()
    }
  }).run();
}

function findMatchingRule(
  userId: number,
  actionType: string,
  resource: string
): ApprovalRule | null {
  const row = db.select().from(approvalRules)
    .where(and(
      eq(approvalRules.userId, userId),
      eq(approvalRules.actionType, actionType),
      eq(approvalRules.resourcePattern, resource)
    ))
    .get();

  return row ? mapApprovalRuleRow(row) : null;
}

function mapApprovalRow(row: any): ApprovalRequest {
  return {
    id: row.id,
    userId: row.userId,
    actionType: row.actionType,
    resource: row.resource,
    contextJson: row.contextJson,
    status: row.status as ApprovalStatus,
    resolvedByDevice: row.resolvedByDevice,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
  };
}

function mapApprovalRuleRow(row: any): ApprovalRule {
  return {
    id: row.id,
    userId: row.userId,
    resourcePattern: row.resourcePattern,
    actionType: row.actionType,
    decision: row.decision as "allow_always" | "deny_always",
    createdAt: row.createdAt,
  };
}
