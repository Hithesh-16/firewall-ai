/**
 * Screenshot Service
 *
 * Captures and compresses screenshots for LLM consumption.
 * Default: WebP quality 80, max 1280px wide.
 *
 * SOLID:
 * - SRP: Only captures and compresses. No browser management.
 */

export interface ScreenshotOptions {
  /** Max width in pixels (default: 1280) */
  maxWidth?: number;
  /** WebP quality 0-100 (default: 80) */
  quality?: number;
  /** Capture full page or viewport only (default: false) */
  fullPage?: boolean;
  /** CSS selector to capture specific element */
  selector?: string;
}

export interface ScreenshotResult {
  /** Base64-encoded image data */
  base64: string;
  /** MIME type */
  mimeType: string;
  /** Original dimensions */
  originalWidth: number;
  originalHeight: number;
  /** Final dimensions after resize */
  finalWidth: number;
  finalHeight: number;
  /** File size in bytes */
  sizeBytes: number;
}

const DEFAULT_MAX_WIDTH = 1280;
const DEFAULT_QUALITY = 80;

/**
 * Capture a screenshot from a Playwright page.
 *
 * @param page - Playwright Page instance
 * @param options - Screenshot options
 */
export async function captureScreenshot(
  page: any,
  options?: ScreenshotOptions,
): Promise<ScreenshotResult> {
  const maxWidth = options?.maxWidth ?? DEFAULT_MAX_WIDTH;
  const quality = options?.quality ?? DEFAULT_QUALITY;

  // Get viewport size for dimension tracking
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };

  let target = page;
  if (options?.selector) {
    target = page.locator(options.selector);
  }

  // Capture as PNG first (lossless source)
  const pngBuffer: Buffer = await target.screenshot({
    fullPage: options?.fullPage ?? false,
    type: "png",
  });

  // Resize and convert to WebP using Sharp (if available) or return PNG
  try {
    const sharp = (await import("sharp")).default;

    const metadata = await sharp(pngBuffer).metadata();
    const originalWidth = metadata.width ?? viewport.width;
    const originalHeight = metadata.height ?? viewport.height;

    let pipeline = sharp(pngBuffer);

    // Resize if wider than maxWidth
    if (originalWidth > maxWidth) {
      pipeline = pipeline.resize(maxWidth, undefined, {
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    const webpBuffer = await pipeline
      .webp({ quality })
      .toBuffer();

    const resizedMeta = await sharp(webpBuffer).metadata();

    return {
      base64: webpBuffer.toString("base64"),
      mimeType: "image/webp",
      originalWidth,
      originalHeight,
      finalWidth: resizedMeta.width ?? originalWidth,
      finalHeight: resizedMeta.height ?? originalHeight,
      sizeBytes: webpBuffer.length,
    };
  } catch {
    // Sharp not available — return raw PNG
    return {
      base64: pngBuffer.toString("base64"),
      mimeType: "image/png",
      originalWidth: viewport.width,
      originalHeight: viewport.height,
      finalWidth: viewport.width,
      finalHeight: viewport.height,
      sizeBytes: pngBuffer.length,
    };
  }
}
