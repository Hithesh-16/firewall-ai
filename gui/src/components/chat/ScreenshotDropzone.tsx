import { useCallback, useRef } from "react";

interface ScreenshotDropzoneProps {
  onImageReady: (base64: string, mimeType: string) => void;
  className?: string;
}

const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_WIDTH = 1280;
const MAX_SIZE_MB = 10;

/**
 * Strip EXIF metadata from an image using Canvas.
 * Screenshots embed GPS, device model, OS version — the LLM reads and may echo this.
 * Canvas re-render strips all metadata at zero cost (no deps needed).
 *
 * Also resizes to max 1280px wide to keep LLM token cost reasonable.
 */
function stripExifAndResize(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      // Calculate resize dimensions
      let width = img.width;
      let height = img.height;
      if (width > MAX_WIDTH) {
        height = Math.round((height * MAX_WIDTH) / width);
        width = MAX_WIDTH;
      }

      // Canvas re-render strips all EXIF metadata
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas 2D context unavailable"));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      // Output as WebP (smaller than PNG, no JPEG text artifacts)
      const dataUrl = canvas.toDataURL("image/webp", 0.85);
      const base64 = dataUrl.split(",")[1];
      resolve({ base64, mimeType: "image/webp" });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };

    img.src = url;
  });
}

/**
 * Drag-and-drop + paste + file-pick zone for screenshots.
 *
 * - Strips EXIF metadata (GPS, device info)
 * - Resizes to max 1280px wide
 * - Rejects SVG (XSS vector in multimodal context)
 * - Accepts PNG, JPEG, WebP only
 */
export function ScreenshotDropzone({ onImageReady, className }: ScreenshotDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    async (file: File) => {
      if (!ACCEPTED_TYPES.has(file.type)) {
        return; // Reject SVG and unsupported types
      }
      if (file.size / 1024 / 1024 > MAX_SIZE_MB) {
        return;
      }

      try {
        const { base64, mimeType } = await stripExifAndResize(file);
        onImageReady(base64, mimeType);
      } catch {
        // Silently fail — user can try again
      }
    },
    [onImageReady],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) processFile(file);
          break;
        }
      }
    },
    [processFile],
  );

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      onPaste={handlePaste}
      onClick={() => inputRef.current?.click()}
      className={`flex items-center justify-center border-2 border-dashed border-border rounded-lg
        p-4 cursor-pointer hover:border-border-focus hover:bg-list-hover/50 transition-colors
        ${className ?? ""}`}
    >
      <div className="text-center">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mx-auto text-description mb-1"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <p className="text-xs text-description">
          Drop screenshot, paste, or click
        </p>
        <p className="text-2xs text-description-muted mt-0.5">
          PNG, JPEG, WebP (max 10MB)
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) processFile(file);
        }}
      />
    </div>
  );
}
