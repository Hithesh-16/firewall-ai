import { exec } from "node:child_process";
import { promisify } from "node:util";
import { ToolImpl } from ".";
import { getStringArg } from "../parseArgs";

const execAsync = promisify(exec);

/**
 * create_worktree tool — Creates a git worktree for isolated experimentation.
 *
 * The agent can work in a worktree without affecting the main branch.
 * On cleanup, the worktree is removed if no changes were made.
 *
 * Parameters:
 *   - branch_name: Name for the new branch (e.g. "experiment/refactor-auth")
 *   - path: Optional path for the worktree (defaults to /tmp/ai-firewall-worktree-{branch})
 */
export const createWorktreeImpl: ToolImpl = async (args, extras) => {
  const branchName = getStringArg(args, "branch_name");
  const customPath = args.path as string | undefined;

  const workspaceDirs = await extras.ide.getWorkspaceDirs();
  if (workspaceDirs.length === 0) {
    return [
      {
        name: "Error",
        description: "No workspace open",
        content: "Cannot create worktree: no workspace directory is open.",
      },
    ];
  }

  const workspaceRoot = workspaceDirs[0];
  const rootPath = workspaceRoot.startsWith("file://")
    ? workspaceRoot.slice(7)
    : workspaceRoot;

  const slug = branchName.replace(/[^a-zA-Z0-9-_\/]/g, "-");
  const worktreePath =
    customPath || `/tmp/ai-firewall-worktree-${slug.replace(/\//g, "-")}`;

  try {
    // Create the worktree with a new branch
    const { stdout, stderr } = await execAsync(
      `git worktree add -b "${branchName}" "${worktreePath}"`,
      { cwd: rootPath, timeout: 30_000 },
    );

    return [
      {
        name: "Worktree Created",
        description: worktreePath,
        content: `Git worktree created at ${worktreePath} on branch "${branchName}".\n\nYou can now safely make experimental changes in this directory without affecting the main branch.\n\nTo clean up when done, use the remove_worktree tool.\n\n${stdout}${stderr ? `\n${stderr}` : ""}`,
      },
    ];
  } catch (err: any) {
    return [
      {
        name: "Worktree Error",
        description: "Failed to create worktree",
        content: `Error creating worktree: ${err.message}\n\n${err.stderr || ""}`,
      },
    ];
  }
};

/**
 * remove_worktree tool — Removes a git worktree.
 *
 * Parameters:
 *   - path: Path to the worktree to remove
 *   - force: If true, force removal even if there are changes (default false)
 */
export const removeWorktreeImpl: ToolImpl = async (args, extras) => {
  const worktreePath = getStringArg(args, "path");
  const force = args.force === true || args.force === "true";

  const workspaceDirs = await extras.ide.getWorkspaceDirs();
  if (workspaceDirs.length === 0) {
    return [
      {
        name: "Error",
        description: "No workspace open",
        content: "Cannot remove worktree: no workspace directory is open.",
      },
    ];
  }

  const workspaceRoot = workspaceDirs[0];
  const rootPath = workspaceRoot.startsWith("file://")
    ? workspaceRoot.slice(7)
    : workspaceRoot;

  try {
    const forceFlag = force ? " --force" : "";
    const { stdout, stderr } = await execAsync(
      `git worktree remove "${worktreePath}"${forceFlag}`,
      { cwd: rootPath, timeout: 15_000 },
    );

    return [
      {
        name: "Worktree Removed",
        description: worktreePath,
        content: `Worktree at ${worktreePath} has been removed.\n${stdout}${stderr ? `\n${stderr}` : ""}`,
      },
    ];
  } catch (err: any) {
    return [
      {
        name: "Worktree Error",
        description: "Failed to remove worktree",
        content: `Error removing worktree: ${err.message}\n\nTip: Use force=true to remove worktrees with uncommitted changes.`,
      },
    ];
  }
};
