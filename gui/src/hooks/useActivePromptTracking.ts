import { useCallback, useEffect, useRef, useState } from "react";
import { ChatHistoryItemWithMessageId } from "../redux/slices/sessionSlice";

const STICKY_HEADER_HEIGHT = 40;

interface ActivePromptTrackingResult {
  activePromptIndex: number | null;
  isFirstPromptVisible: boolean;
}

/**
 * Tracks which user prompt is currently "active" — the most recent prompt
 * that has scrolled past the sticky header zone in the scroll container.
 * Returns the original Redux history index (not the filtered render index).
 */
export function useActivePromptTracking(
  scrollContainerRef: React.RefObject<HTMLDivElement>,
  history: ChatHistoryItemWithMessageId[],
): ActivePromptTrackingResult {
  const [result, setResult] = useState<ActivePromptTrackingResult>({
    activePromptIndex: null,
    isFirstPromptVisible: true,
  });

  const rafRef = useRef<number | null>(null);

  const computeActivePrompt = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const promptElements = container.querySelectorAll<HTMLElement>(
      "[data-prompt-index]",
    );

    if (promptElements.length === 0) {
      setResult({ activePromptIndex: null, isFirstPromptVisible: true });
      return;
    }

    const scrollTop = container.scrollTop;
    const threshold = scrollTop + STICKY_HEADER_HEIGHT;

    // Check if first prompt is still visible (its top is at or below scroll position)
    const firstPrompt = promptElements[0];
    const firstPromptTop = firstPrompt.offsetTop - container.offsetTop;
    const isFirstPromptVisible = firstPromptTop >= scrollTop;

    // Find the last prompt whose top edge has scrolled past the sticky zone
    let activeIndex: number | null = null;

    for (let i = promptElements.length - 1; i >= 0; i--) {
      const el = promptElements[i];
      const elTop = el.offsetTop - container.offsetTop;

      if (elTop <= threshold) {
        const indexStr = el.getAttribute("data-prompt-index");
        if (indexStr !== null) {
          activeIndex = parseInt(indexStr, 10);
        }
        break;
      }
    }

    setResult((prev) => {
      if (
        prev.activePromptIndex === activeIndex &&
        prev.isFirstPromptVisible === isFirstPromptVisible
      ) {
        return prev; // No change — avoid re-render
      }
      return { activePromptIndex: activeIndex, isFirstPromptVisible };
    });
  }, [scrollContainerRef]);

  // Scroll listener throttled via requestAnimationFrame
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const onScroll = () => {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        computeActivePrompt();
      });
    };

    container.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      container.removeEventListener("scroll", onScroll);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [scrollContainerRef, computeActivePrompt]);

  // Reset when history length changes (new messages added/removed)
  useEffect(() => {
    computeActivePrompt();
  }, [history.length, computeActivePrompt]);

  return result;
}
