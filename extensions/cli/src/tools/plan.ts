import {
  createPlanImpl,
  proposePlanImpl,
  updatePlanImpl,
} from "core/tools/implementations/planTool.js";
import { Tool } from "./types.js";

export const createPlanTool: Tool = {
  name: "create_plan",
  displayName: "Create Plan",
  description:
    "Create a structured execution plan. Use this to outline steps before taking action.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "The title of the plan" },
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            content: { type: "string", description: "The task description" },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "completed", "cancelled"],
            },
            phase: { type: "string", description: "Optional phase name" },
          },
          required: ["content", "status"],
        },
      },
    },
    required: ["title", "tasks"],
  },
  run: createPlanImpl,
};

export const proposePlanTool: Tool = {
  name: "propose_plan",
  displayName: "Propose Plan",
  description:
    "Propose a plan for user approval. The agent will wait for approval before continuing.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "The title of the proposal" },
      summary: {
        type: "string",
        description: "High-level summary of the plan",
      },
      risk: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "Potential risk level",
      },
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            content: { type: "string", description: "The task description" },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "completed", "cancelled"],
            },
            phase: { type: "string", description: "Optional phase name" },
          },
          required: ["content", "status"],
        },
      },
    },
    required: ["title", "tasks"],
  },
  run: proposePlanImpl,
};

export const updatePlanTool: Tool = {
  name: "update_plan",
  displayName: "Update Plan",
  description: "Update the status of a task in the current plan.",
  parameters: {
    type: "object",
    properties: {
      task_index: {
        type: "number",
        description: "The 0-based index of the task to update",
      },
      status: {
        type: "string",
        enum: ["pending", "in_progress", "completed", "cancelled"],
      },
    },
    required: ["task_index", "status"],
  },
  run: updatePlanImpl,
};
