/**
 * Vibe Coding Tool
 *
 * Screenshot → code generation via multimodal LLM.
 * Accepts a mode parameter for different system prompts:
 * - ui-to-react (default): Generate React component from UI screenshot
 * - wireframe-to-html: Generate HTML from wireframe/sketch
 * - screenshot-to-css-fix: Fix CSS issues shown in screenshot
 *
 * Generated code is scanned through @ai-firewall/scanner before returning
 * (screenshots of terminals often show visible API keys).
 *
 * SOLID:
 * - SRP: Only generates code from images. No browser management.
 */

import { scanSecrets, scanPII } from "@ai-firewall/scanner";
import type { ContextItem } from "../../";

type VibeMode = "ui-to-react" | "wireframe-to-html" | "screenshot-to-css-fix";

interface VibeCodingArgs {
  /** Base64-encoded image (EXIF should already be stripped by ScreenshotDropzone) */
  imageBase64: string;
  /** MIME type of the image */
  mimeType?: string;
  /** Generation mode — determines the system prompt */
  mode?: VibeMode;
  /** Additional instructions from the user */
  instructions?: string;
}

const MODE_PROMPTS: Record<VibeMode, string> = {
  "ui-to-react": [
    "You are a UI developer. Given this screenshot, generate a React component",
    "that reproduces the visual design as closely as possible.",
    "Use functional components with TypeScript. Use Tailwind CSS for styling.",
    "Output only the code, no explanations.",
  ].join(" "),

  "wireframe-to-html": [
    "You are a web developer. Given this wireframe or sketch, generate clean",
    "semantic HTML with inline CSS that matches the layout and structure shown.",
    "Make it responsive. Output only the code.",
  ].join(" "),

  "screenshot-to-css-fix": [
    "You are a CSS debugger. Given this screenshot showing a UI bug,",
    "identify the CSS issue and provide the corrected CSS/component code.",
    "Explain what was wrong and show the fix. Be concise.",
  ].join(" "),
};

export async function vibeCodingImpl(
  args: VibeCodingArgs,
): Promise<ContextItem[]> {
  const mode = args.mode ?? "ui-to-react";
  const systemPrompt = MODE_PROMPTS[mode];

  const userPrompt = args.instructions
    ? `${systemPrompt}\n\nAdditional instructions: ${args.instructions}`
    : systemPrompt;

  // The actual multimodal LLM call is handled by the agent framework
  // (the tool returns instructions for the LLM to process the image).
  // This tool prepares the prompt and validates the output.

  const content = [
    `## Vibe Coding — ${mode}`,
    "",
    `**Mode:** ${mode}`,
    `**System prompt:** ${systemPrompt}`,
    args.instructions ? `**User instructions:** ${args.instructions}` : "",
    "",
    "The image has been attached to this message for the LLM to process.",
    "Generate code based on the screenshot using the system prompt above.",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    {
      name: "Vibe Coding",
      description: `${mode} — generate code from screenshot`,
      content,
      // The image is passed as a separate context item with the data URI
      uri: {
        type: "file" as const,
        value: `data:${args.mimeType ?? "image/webp"};base64,${args.imageBase64}`,
      },
    },
  ];
}

/**
 * Scan generated code for secrets before returning to the user.
 * Screenshots of terminals often contain visible API keys.
 */
export function scanGeneratedCode(code: string): {
  cleanCode: string;
  findings: Array<{ type: string; severity: string }>;
} {
  const secretResult = scanSecrets(code);
  const piiResult = scanPII(code);

  const findings = [
    ...secretResult.secrets.map((s) => ({ type: s.type, severity: s.severity })),
    ...piiResult.pii.map((p) => ({ type: p.type, severity: p.severity })),
  ];

  if (findings.length === 0) {
    return { cleanCode: code, findings: [] };
  }

  // Redact secrets from generated code
  let cleanCode = code;
  const replacements = [
    ...secretResult.secrets.map((s) => ({
      position: s.position,
      length: s.length,
      type: s.type,
    })),
    ...piiResult.pii.map((p) => ({
      position: p.position,
      length: p.length,
      type: p.type,
    })),
  ].sort((a, b) => b.position - a.position);

  for (const r of replacements) {
    const before = cleanCode.slice(0, r.position);
    const after = cleanCode.slice(r.position + r.length);
    cleanCode = `${before}/* REDACTED: ${r.type} */${after}`;
  }

  return { cleanCode, findings };
}
