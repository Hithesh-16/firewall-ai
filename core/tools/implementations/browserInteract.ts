/**
 * Browser Interact Tool
 *
 * Click, type, navigate, and scroll in a browser page.
 * Returns a screenshot after each action for visual verification.
 * All requests go through SSRF guard.
 *
 * SOLID:
 * - SRP: Only performs browser interactions. No capture logic.
 */

import type { ContextItem } from "../../";

type InteractionAction =
  | { type: "click"; selector: string }
  | { type: "type"; selector: string; text: string }
  | { type: "navigate"; url: string }
  | { type: "scroll"; direction: "up" | "down"; amount?: number }
  | { type: "wait"; selector: string; timeout?: number };

interface BrowserInteractArgs {
  /** URL to start from (if no existing session) */
  url: string;
  /** Sequence of actions to perform */
  actions: InteractionAction[];
}

export async function browserInteractImpl(
  args: BrowserInteractArgs,
): Promise<ContextItem[]> {
  try {
    const { acquire, release } = await import("@ai-firewall/browser-surface/browserPool");
    const { installSsrfGuard } = await import("@ai-firewall/browser-surface/ssrfGuard");
    const { captureScreenshot } = await import("@ai-firewall/browser-surface/screenshotService");

    const { instanceId, browser } = await acquire();

    try {
      const context = await browser.newContext();
      const page = await context.newPage();

      await installSsrfGuard(page);

      await page.goto(args.url, { waitUntil: "networkidle", timeout: 15000 });

      const results: string[] = [];

      for (const action of args.actions) {
        switch (action.type) {
          case "click":
            await page.click(action.selector, { timeout: 5000 });
            results.push(`Clicked: ${action.selector}`);
            break;

          case "type":
            await page.fill(action.selector, action.text, { timeout: 5000 });
            results.push(`Typed "${action.text}" into ${action.selector}`);
            break;

          case "navigate":
            await page.goto(action.url, { waitUntil: "networkidle", timeout: 15000 });
            results.push(`Navigated to ${action.url}`);
            break;

          case "scroll":
            const delta = action.amount ?? 300;
            await page.mouse.wheel(0, action.direction === "down" ? delta : -delta);
            results.push(`Scrolled ${action.direction} by ${delta}px`);
            break;

          case "wait":
            await page.waitForSelector(action.selector, {
              timeout: action.timeout ?? 10000,
            });
            results.push(`Waited for ${action.selector}`);
            break;
        }
      }

      // Capture final state
      const screenshot = await captureScreenshot(page, {
        maxWidth: 1280,
        quality: 80,
      });

      await context.close();

      return [
        {
          name: "Browser Interaction",
          description: `${results.length} actions on ${args.url}`,
          content: [
            `Browser interaction completed on ${args.url}:`,
            ...results.map((r) => `- ${r}`),
            "",
            `Final screenshot: ${screenshot.finalWidth}x${screenshot.finalHeight} (${Math.round(screenshot.sizeBytes / 1024)}KB)`,
          ].join("\n"),
          uri: {
            type: "file" as const,
            value: `data:${screenshot.mimeType};base64,${screenshot.base64}`,
          },
        },
      ];
    } finally {
      await release(instanceId);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Browser interaction failed";
    return [
      {
        name: "Browser Error",
        description: message,
        content: `Failed to interact with ${args.url}: ${message}`,
      },
    ];
  }
}
