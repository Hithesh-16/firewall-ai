import { SUBAGENT_TOOL_META } from "../subagent/index.js";

import { askQuestionTool } from "./askQuestion.js";
import { editTool } from "./edit.js";
import { exitTool } from "./exit.js";
import { fetchTool } from "./fetch.js";
import { globSearchTool } from "./globSearch.js";
import { listFilesTool } from "./listFiles.js";
import { memoryTool } from "./memory.js";
import { multiEditTool } from "./multiEdit.js";
import { readFileTool } from "./readFile.js";
import { reportFailureTool } from "./reportFailure.js";
import { runTerminalCommandTool } from "./runTerminalCommand.js";
import { searchCodeTool } from "./searchCode.js";
import { SKILLS_TOOL_META } from "./skills.js";
import { statusTool } from "./status.js";
import { uploadArtifactTool } from "./uploadArtifact.js";
import { viewDiffTool } from "./viewDiff.js";
import { writeChecklistTool } from "./writeChecklist.js";
import { writeFileTool } from "./writeFile.js";
import { createPlanTool, proposePlanTool, updatePlanTool } from "./plan.js";

// putting in here for circular import issue
export const ALL_BUILT_IN_TOOLS = [
  askQuestionTool,
  editTool,
  exitTool,
  fetchTool,
  // Phase J.J4 — CLI parity with core/tools/implementations/globSearch.ts
  globSearchTool,
  listFilesTool,
  // Phase J.J4 — CLI parity with core/tools/implementations/memory.ts
  memoryTool,
  multiEditTool,
  readFileTool,
  reportFailureTool,
  runTerminalCommandTool,
  searchCodeTool,
  statusTool,
  SUBAGENT_TOOL_META,
  SKILLS_TOOL_META,
  uploadArtifactTool,
  viewDiffTool,
  writeChecklistTool,
  writeFileTool,
  createPlanTool,
  proposePlanTool,
  updatePlanTool,
];
