/**
 * Tour Provider
 *
 * Manages the guided tour state. Shows tour on first visit.
 * Renders a floating tooltip pointing at each highlighted feature.
 * Non-intrusive, skippable, replayable from Help settings.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { TOUR_STEPS, TOUR_STORAGE_KEY, type TourStepDef } from "./tourSteps";

interface TourContextValue {
  isActive: boolean;
  currentStep: number;
  currentStepDef: TourStepDef | null;
  totalSteps: number;
  next: () => void;
  prev: () => void;
  skip: () => void;
  startTour: () => void;
}

const TourContext = createContext<TourContextValue>({
  isActive: false,
  currentStep: 0,
  currentStepDef: null,
  totalSteps: TOUR_STEPS.length,
  next: () => {},
  prev: () => {},
  skip: () => {},
  startTour: () => {},
});

export function useTour() {
  return useContext(TourContext);
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  // Show tour on first visit
  useEffect(() => {
    const completed = localStorage.getItem(TOUR_STORAGE_KEY);
    if (!completed) {
      // Delay to let the UI render first
      const timer = setTimeout(() => setIsActive(true), 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  const next = useCallback(() => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep((s) => s + 1);
    } else {
      // Tour complete
      setIsActive(false);
      setCurrentStep(0);
      localStorage.setItem(TOUR_STORAGE_KEY, "true");
    }
  }, [currentStep]);

  const prev = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((s) => s - 1);
    }
  }, [currentStep]);

  const skip = useCallback(() => {
    setIsActive(false);
    setCurrentStep(0);
    localStorage.setItem(TOUR_STORAGE_KEY, "true");
  }, []);

  const startTour = useCallback(() => {
    setCurrentStep(0);
    setIsActive(true);
    localStorage.removeItem(TOUR_STORAGE_KEY);
  }, []);

  const currentStepDef = isActive ? TOUR_STEPS[currentStep] ?? null : null;

  return (
    <TourContext.Provider
      value={{
        isActive,
        currentStep,
        currentStepDef,
        totalSteps: TOUR_STEPS.length,
        next,
        prev,
        skip,
        startTour,
      }}
    >
      {children}
      {isActive && currentStepDef && (
        <TourTooltip
          step={currentStepDef}
          stepIndex={currentStep}
          totalSteps={TOUR_STEPS.length}
          onNext={next}
          onPrev={prev}
          onSkip={skip}
        />
      )}
    </TourContext.Provider>
  );
}

// ── Tour Tooltip ───────────────────────────────────────────────────────

function TourTooltip({
  step,
  stepIndex,
  totalSteps,
  onNext,
  onPrev,
  onSkip,
}: {
  step: TourStepDef;
  stepIndex: number;
  totalSteps: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
}) {
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const el = document.querySelector(step.targetSelector);
    if (el) {
      const rect = el.getBoundingClientRect();
      const tooltipOffset = 12;

      let top = 0;
      let left = 0;

      switch (step.position) {
        case "top":
          top = rect.top - tooltipOffset - 160;
          left = rect.left + rect.width / 2 - 160;
          break;
        case "bottom":
          top = rect.bottom + tooltipOffset;
          left = rect.left + rect.width / 2 - 160;
          break;
        case "left":
          top = rect.top + rect.height / 2 - 80;
          left = rect.left - tooltipOffset - 320;
          break;
        case "right":
          top = rect.top + rect.height / 2 - 80;
          left = rect.right + tooltipOffset;
          break;
      }

      // Clamp to viewport
      top = Math.max(8, Math.min(top, window.innerHeight - 200));
      left = Math.max(8, Math.min(left, window.innerWidth - 340));

      setPosition({ top, left });

      // Scroll element into view
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [step]);

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-[9998] bg-background/40 transition-opacity duration-300"
        onClick={onSkip}
      />

      {/* Tooltip card */}
      <div
        className="fixed z-[9999] w-80 rounded-xl border border-border bg-editor p-4 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{ top: position.top, left: position.left }}
      >
        {/* Step counter */}
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-medium text-info">
            Step {stepIndex + 1} of {totalSteps}
          </span>
          <button
            onClick={onSkip}
            className="text-[10px] text-description-muted hover:text-description"
          >
            Skip tour
          </button>
        </div>

        {/* Content */}
        <h3 className="mb-1 text-sm font-semibold text-foreground">
          {step.title}
        </h3>
        <p className="mb-3 text-xs leading-relaxed text-description">
          {step.description}
        </p>

        {/* Progress dots */}
        <div className="mb-3 flex gap-1">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= stepIndex ? "bg-primary" : "bg-badge"
              }`}
            />
          ))}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button
            onClick={onPrev}
            disabled={stepIndex === 0}
            className="rounded px-3 py-1 text-xs text-description hover:text-foreground disabled:invisible"
          >
            Back
          </button>
          <button
            onClick={onNext}
            className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:brightness-110"
          >
            {stepIndex === totalSteps - 1 ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </>
  );
}
