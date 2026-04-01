/**
 * Tour step definitions for the AI Firewall guided walkthrough.
 * Each step points at a DOM element and explains a feature.
 */

export interface TourStepDef {
  id: string;
  title: string;
  description: string;
  /** CSS selector of the target element to highlight */
  targetSelector: string;
  /** Position of the tooltip relative to the target */
  position: "top" | "bottom" | "left" | "right";
}

export const TOUR_STEPS: TourStepDef[] = [
  {
    id: "chat-input",
    title: "Chat with AI",
    description:
      "Type your question here. AI Firewall scans every message for secrets and PII before sending it to the LLM.",
    targetSelector: '[data-testid="continue-input-box"]',
    position: "top",
  },
  {
    id: "shield-status",
    title: "Security Shield",
    description:
      "This shield shows your scan status in real-time. Green = clean, yellow = redacted, red = blocked.",
    targetSelector: '[data-testid="shield-status"]',
    position: "bottom",
  },
  {
    id: "scan-banner",
    title: "Scan Results",
    description:
      "After each message, a banner shows what was found: secrets, PII, risk score. BLOCK and REDACT notifications stay until you acknowledge them.",
    targetSelector: '[data-testid="scan-result-banner"]',
    position: "top",
  },
  {
    id: "tool-permissions",
    title: "Approve AI Actions",
    description:
      "When AI wants to read a file, run a command, or access your code — you see a permission card with the reason. Accept or Reject with keyboard shortcuts.",
    targetSelector: '[data-testid="pending-tool-toolbar"]',
    position: "top",
  },
  {
    id: "model-select",
    title: "Choose Your Model",
    description:
      "Pick from 60+ providers: OpenAI, Anthropic, Gemini, Groq, Ollama. API keys are stored encrypted in the vault — never in config files.",
    targetSelector: '[data-testid="model-select"]',
    position: "bottom",
  },
  {
    id: "settings",
    title: "Configure Security & Models",
    description:
      "Open Settings to configure models, tool permissions, security policies, and more. You can replay this tour from Help.",
    targetSelector: '[data-testid="config-icon"]',
    position: "left",
  },
];

export const TOUR_STORAGE_KEY = "aiFirewallTourCompleted";
