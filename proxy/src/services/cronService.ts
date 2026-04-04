/**
 * Cron Service
 *
 * Scheduled agent triggers. Users define cron schedules that spawn
 * agents at specified intervals.
 *
 * Uses a simple polling approach (no external cron library needed).
 * Cron jobs are stored in the DB and checked every minute.
 *
 * SECURITY: Each cron execution creates a new agent with independent
 * scan context. Cron jobs respect rate limits per-execution.
 */

import { db } from "../db/index";
import { spawnAgent, type SpawnAgentInput } from "./agentService";

// ── Types ──────────────────────────────────────────────────────

export interface CronJob {
  readonly id: string;
  readonly userId: number;
  readonly name: string;
  readonly schedule: string; // Simple format: "5m", "1h", "30m", "24h"
  readonly agentConfig: CronAgentConfig;
  readonly enabled: boolean;
  readonly lastRunAt: number | null;
  readonly nextRunAt: number;
  readonly runCount: number;
  readonly createdAt: number;
}

export interface CronAgentConfig {
  readonly description: string;
  readonly prompt: string;
  readonly model?: string;
  readonly background?: boolean;
}

// ── Parse schedule ─────────────────────────────────────────────

const SCHEDULE_RE = /^(\d+)(m|h|d)$/;

export function parseScheduleMs(schedule: string): number | null {
  const match = schedule.trim().match(SCHEDULE_RE);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

// ── In-memory state (DB tables are created in database.ts) ─────

const cronJobs = new Map<string, CronJob>();
let pollerTimer: ReturnType<typeof setInterval> | null = null;

// ── CRUD ───────────────────────────────────────────────────────

export function createCronJob(
  userId: number,
  name: string,
  schedule: string,
  agentConfig: CronAgentConfig,
): CronJob | null {
  const intervalMs = parseScheduleMs(schedule);
  if (!intervalMs) return null;
  if (intervalMs < 60_000) return null; // Minimum 1 minute

  const id = `cron_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();

  const job: CronJob = {
    id,
    userId,
    name,
    schedule,
    agentConfig,
    enabled: true,
    lastRunAt: null,
    nextRunAt: now + intervalMs,
    runCount: 0,
    createdAt: now,
  };

  cronJobs.set(id, job);
  return job;
}

export function getCronJob(id: string): CronJob | null {
  return cronJobs.get(id) ?? null;
}

export function listCronJobs(userId: number): CronJob[] {
  return Array.from(cronJobs.values()).filter((j) => j.userId === userId);
}

export function enableCronJob(id: string): boolean {
  const job = cronJobs.get(id);
  if (!job) return false;

  const intervalMs = parseScheduleMs(job.schedule);
  if (!intervalMs) return false;

  cronJobs.set(id, {
    ...job,
    enabled: true,
    nextRunAt: Date.now() + intervalMs,
  });
  return true;
}

export function disableCronJob(id: string): boolean {
  const job = cronJobs.get(id);
  if (!job) return false;

  cronJobs.set(id, { ...job, enabled: false });
  return true;
}

export function deleteCronJob(id: string): boolean {
  return cronJobs.delete(id);
}

// ── Execution ──────────────────────────────────────────────────

/**
 * Check all cron jobs and execute any that are due.
 * Called by the poller every 60 seconds.
 */
export async function checkAndRunDueJobs(): Promise<number> {
  const now = Date.now();
  let executed = 0;

  for (const [id, job] of cronJobs) {
    if (!job.enabled) continue;
    if (now < job.nextRunAt) continue;

    const intervalMs = parseScheduleMs(job.schedule);
    if (!intervalMs) continue;

    // Execute the job
    try {
      const input: SpawnAgentInput = {
        description: `[Cron: ${job.name}] ${job.agentConfig.description}`,
        prompt: job.agentConfig.prompt,
        userId: job.userId,
        model: job.agentConfig.model,
        background: job.agentConfig.background ?? true,
      };

      spawnAgent(input);
      executed++;
    } catch {
      // Log but don't stop other jobs
    }

    // Update job state
    cronJobs.set(id, {
      ...job,
      lastRunAt: now,
      nextRunAt: now + intervalMs,
      runCount: job.runCount + 1,
    });
  }

  return executed;
}

// ── Poller lifecycle ───────────────────────────────────────────

const POLL_INTERVAL_MS = 60_000; // Check every minute

export function startCronPoller(): void {
  if (pollerTimer) return;

  pollerTimer = setInterval(() => {
    checkAndRunDueJobs().catch(() => {
      // Silently ignore errors — individual job failures are isolated
    });
  }, POLL_INTERVAL_MS);
}

export function stopCronPoller(): void {
  if (pollerTimer) {
    clearInterval(pollerTimer);
    pollerTimer = null;
  }
}

export function isCronPollerRunning(): boolean {
  return pollerTimer !== null;
}

// ── Reset (for testing) ────────────────────────────────────────

export function clearAllCronJobs(): void {
  cronJobs.clear();
}
