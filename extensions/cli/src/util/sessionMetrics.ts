import chalk from "chalk";

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Thinking / reasoning tokens (Claude extended thinking, o1,
   *  Gemini Flash Thinking). Displayed in magenta when present. */
  reasoningTokens?: number;
}

export interface CostBreakdown {
  cost: number;
  inputCostPer1k?: number;
  outputCostPer1k?: number;
}

export interface PlanTask {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface SessionStats {
  totalTokens: number;
  totalCost: number;
  contextUtilization?: number;
  maxContextTokens?: number;
  activePlan?: {
    title: string;
    tasks: PlanTask[];
    completed: number;
    total: number;
  };
}

const COST_DECIMAL_PLACES =
  process.env.AI_FIREWALL_COST_DECIMAL_PLACES === "2" ? 2 : 4;

export function formatCost(cost: number): string {
  if (cost === 0) return "$0.0000";
  return cost < 0.01
    ? `$${cost.toFixed(COST_DECIMAL_PLACES)}`
    : `$${cost.toFixed(2)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return tokens.toString();
}

function formatUtilizationBar(percent: number, width: number = 20): string {
  const filled = Math.min(Math.round((percent / 100) * width), width);
  const empty = width - filled;
  const fillColor = percent > 90 ? "red" : percent > 75 ? "yellow" : "green";
  const fillChar = "█";
  const emptyChar = "░";
  return (
    chalk[fillColor](fillChar.repeat(filled)) +
    chalk.dim(emptyChar.repeat(empty))
  );
}

export function formatTokenUsage(
  usage: TokenUsage,
  cost?: CostBreakdown,
): string {
  const hasAny =
    usage.promptTokens ||
    usage.completionTokens ||
    usage.cacheReadTokens ||
    usage.cacheWriteTokens ||
    usage.reasoningTokens;
  if (!hasAny) return "";

  // Kilocode-parity: in/out/total inline, then cache (green cache-read,
  // cyan cache-write) and reasoning (magenta) as separate columns so
  // a user skimming the line can spot which tokens were billable vs
  // cached.
  const parts: string[] = [];

  if (usage.promptTokens) {
    parts.push(`in: ${formatTokens(usage.promptTokens)}`);
  }
  if (usage.completionTokens) {
    parts.push(`out: ${formatTokens(usage.completionTokens)}`);
  }
  if (usage.totalTokens) {
    parts.push(`total: ${formatTokens(usage.totalTokens)}`);
  }

  const base = chalk.dim(parts.join(" · "));
  const extras: string[] = [];
  if (usage.cacheReadTokens) {
    extras.push(chalk.green(`cache↓ ${formatTokens(usage.cacheReadTokens)}`));
  }
  if (usage.cacheWriteTokens) {
    extras.push(chalk.cyan(`cache↑ ${formatTokens(usage.cacheWriteTokens)}`));
  }
  if (usage.reasoningTokens) {
    extras.push(chalk.magenta(`think ${formatTokens(usage.reasoningTokens)}`));
  }

  const line =
    base && extras.length > 0
      ? `${base} · ${extras.join(" · ")}`
      : base || extras.join(" · ");

  if (cost && cost.cost > 0) {
    return `${line} · ${formatCost(cost.cost)}`;
  }
  return line;
}

export function formatContextUtilization(
  usedTokens: number,
  maxTokens: number,
): string | null {
  if (maxTokens <= 0) return null;

  const percent = Math.round((usedTokens / maxTokens) * 100);
  const bar = formatUtilizationBar(percent, 15);
  const percentColor = percent > 90 ? "red" : percent > 75 ? "yellow" : "green";

  return chalk.dim("context ") + bar + " " + chalk[percentColor](`${percent}%`);
}

export function formatSessionStats(stats: SessionStats): string[] {
  const lines: string[] = [];

  if (stats.totalTokens > 0) {
    const parts: string[] = [`${formatTokens(stats.totalTokens)} tok`];
    if (stats.totalCost > 0) {
      parts.push(formatCost(stats.totalCost));
    }
    lines.push(chalk.dim("session: ") + parts.join(" · "));
  }

  if (stats.contextUtilization !== undefined && stats.maxContextTokens) {
    const contextLine = formatContextUtilization(
      Math.round((stats.contextUtilization / 100) * stats.maxContextTokens),
      stats.maxContextTokens,
    );
    if (contextLine) {
      lines.push(contextLine);
    }
  }

  if (stats.activePlan && stats.activePlan.tasks.length > 0) {
    lines.push("");
    lines.push(chalk.bold(`${stats.activePlan.title}`));
    lines.push(
      chalk.dim(
        `${stats.activePlan.completed}/${stats.activePlan.total} completed`,
      ),
    );
    for (const task of stats.activePlan.tasks.slice(0, 10)) {
      const statusIcon =
        task.status === "completed"
          ? chalk.green("✓")
          : task.status === "in_progress"
            ? chalk.yellow("◐")
            : chalk.dim("○");
      const style =
        task.status === "completed"
          ? chalk.dim
          : task.status === "in_progress"
            ? chalk
            : chalk;
      lines.push(`  ${statusIcon} ${style(task.content.slice(0, 80))}`);
    }
    if (stats.activePlan.tasks.length > 10) {
      lines.push(
        chalk.dim(`  ... and ${stats.activePlan.tasks.length - 10} more tasks`),
      );
    }
  }

  return lines;
}

export function formatUsageFooter(
  usage: TokenUsage,
  cost?: CostBreakdown,
  contextUsed?: number,
  contextMax?: number,
): string[] {
  const lines: string[] = [];

  if (usage.totalTokens) {
    lines.push(formatTokenUsage(usage, cost));
  }

  if (contextUsed !== undefined && contextMax && contextMax > 0) {
    const contextLine = formatContextUtilization(contextUsed, contextMax);
    if (contextLine) {
      lines.push(contextLine);
    }
  }

  return lines.filter(Boolean);
}
