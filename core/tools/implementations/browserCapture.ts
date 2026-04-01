/**
 * Browser Capture Tool
 *
 * Captures screenshots from URLs using the browser pool.
 * All navigation goes through SSRF guard to prevent private IP access.
 *
 * SOLID:
 * - SRP: Only captures screenshots. No browser management.
 */

import type { ContextItem } from "../../";

interface BrowserCaptureArgs {
  /** URL to navigate to and capture */
  url: string;
  /** CSS selector to capture (optional — captures full viewport by default) */
  selector?: string;
  /** Capture full page or viewport only (default: false) */
  fullPage?: boolean;
  /** Wait for this selector before capturing */
  waitForSelector?: string;
}

export async function browserCaptureImpl(
  args: BrowserCaptureArgs,
): Promise<ContextItem[]> {
  try {
    const { acquire, release } = await import("@ai-firewall/browser-surface/browserPool");
    const { installSsrfGuard } = await import("@ai-firewall/browser-surface/ssrfGuard");
    const { captureScreenshot } = await import("@ai-firewall/browser-surface/screenshotService");

    const { instanceId, browser } = await acquire();

    try {
      const context = await browser.newContext();
      const page = await context.newPage();

      // Install SSRF protection on all requests
      await installSsrfGuard(page, (url, reason) => {
        // Log blocked SSRF attempts
        console.warn(`[browser-capture] ${reason}: ${url}`);
      });

      await page.goto(args.url, { waitUntil: "networkidle", timeout: 15000 });

      if (args.waitForSelector) {
        await page.waitForSelector(args.waitForSelector, { timeout: 10000 });
      }

      const result = await captureScreenshot(page, {
        selector: args.selector,
        fullPage: args.fullPage,
        maxWidth: 1280,
        quality: 80,
      });

      await context.close();

      return [
        {
          name: "Screenshot",
          description: `${args.url} (${result.finalWidth}x${result.finalHeight}, ${Math.round(result.sizeBytes / 1024)}KB)`,
          content: `Screenshot captured from ${args.url}`,
          uri: {
            type: "file" as const,
            value: `data:${result.mimeType};base64,${result.base64}`,
          },
        },
      ];
    } finally {
      await release(instanceId);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Screenshot capture failed";
    return [
      {
        name: "Screenshot Error",
        description: message,
        content: `Failed to capture screenshot from ${args.url}: ${message}`,
      },
    ];
  }
}
