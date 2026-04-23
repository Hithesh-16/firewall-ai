export enum BuiltInToolNames {
  ReadFile = "read_file",
  ReadFileRange = "read_file_range",
  EditExistingFile = "edit_existing_file",
  SingleFindAndReplace = "single_find_and_replace",
  MultiEdit = "multi_edit",
  ReadCurrentlyOpenFile = "read_currently_open_file",
  CreateNewFile = "create_new_file",
  TaskBoundary = "task_boundary",
  RunTerminalCommand = "run_terminal_command",
  GrepSearch = "grep_search",
  FileGlobSearch = "file_glob_search",
  SearchWeb = "search_web",
  ViewDiff = "view_diff",
  LSTool = "ls",
  CreateRuleBlock = "create_rule_block",
  RequestRule = "request_rule",
  FetchUrlContent = "fetch_url_content",
  CodebaseTool = "codebase",
  ReadSkill = "read_skill",

  // AI Firewall tools
  SaveMemory = "save_memory",
  ReadMemory = "read_memory",
  CreatePlan = "create_plan",
  UpdatePlan = "update_plan",
  ProposePlan = "propose_plan",
  CreateWorktree = "create_worktree",
  RemoveWorktree = "remove_worktree",
  SpawnAgent = "spawn_agent",
  ListAgents = "list_agents",

  // Kilocode-parity power tools — patch application, LSP, session recall.
  ApplyPatch = "apply_patch",
  Lsp = "lsp",
  Recall = "recall",

  // Web research pipeline — search + batch-extract composite.
  ResearchWeb = "research_web",

  // Kilocode-parity todo tools — agent writes a checklist that the
  // TaskHeader > TodoStrip renders live. todoRead is how the agent
  // queries its own progress mid-session without paging back through
  // history.
  TodoWrite = "todo_write",
  TodoRead = "todo_read",

  // excluded from allTools for now
  ViewRepoMap = "view_repo_map",
  ViewSubdirectory = "view_subdirectory",
}

export const BUILT_IN_GROUP_NAME = "Built-In";

export const CLIENT_TOOLS_IMPLS = [
  BuiltInToolNames.EditExistingFile,
  BuiltInToolNames.SingleFindAndReplace,
  BuiltInToolNames.MultiEdit,
];
