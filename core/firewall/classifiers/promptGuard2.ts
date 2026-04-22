/**
 * L2 Local Classifier: Prompt Guard 2 86M ONNX via @huggingface/transformers
 *
 * Uses the `gravitee-io/Llama-Prompt-Guard-2-86M-onnx` model (Meta community license).
 * Runs entirely in-process via WebAssembly — no Python, no native binaries,
 * works identically in VS Code extensions, IntelliJ plugins, and the CLI.
 *
 * Confidence thresholds:
 *   > 0.7  → BLOCK
 *   < 0.3  → ALLOW (cache result)
 *   0.3–0.7 → ESCALATE to L3 (proxy)
 */

export interface ClassifierResult {
  label: "JAILBREAK" | "BENIGN";
  confidence: number;
  decision: "BLOCK" | "ALLOW" | "ESCALATE";
}

// Lazy-loaded classifier — initialized once at first use, then reused
let classifierPromise: Promise<
  (text: string) => Promise<ClassifierResult>
> | null = null;

const MODEL_ID = "onnx-community/prompt-guard-2-86m-onnx";

async function loadClassifier(): Promise<
  (text: string) => Promise<ClassifierResult>
> {
  try {
    // Dynamic import so this doesn't fail at module load time if the
    // package isn't installed yet (CLI may not have it during migration)
    const { pipeline } = await import("@huggingface/transformers");

    const pipe = await pipeline("text-classification", MODEL_ID, {
      // Use remote model on first load; thereafter cached locally
      // by HuggingFace's built-in model caching
      device: "cpu",
    });

    return async (text: string): Promise<ClassifierResult> => {
      const result = await pipe(text, {
        truncation: true,
        max_length: 512,
      } as any);
      const output = Array.isArray(result) ? result[0] : result;
      const label = (output as any).label as string;
      const score = (output as any).score as number;

      // Model labels: "JAILBREAK" or "BENIGN"
      const isJailbreak = label?.toUpperCase().includes("JAILBREAK");
      const confidence = isJailbreak ? score : 1 - score;

      let decision: ClassifierResult["decision"];
      if (isJailbreak && confidence > 0.7) {
        decision = "BLOCK";
      } else if (!isJailbreak && confidence > 0.7) {
        decision = "ALLOW";
      } else {
        decision = "ESCALATE";
      }

      return {
        label: isJailbreak ? "JAILBREAK" : "BENIGN",
        confidence,
        decision,
      };
    };
  } catch (err) {
    // If @huggingface/transformers is not installed or model download fails,
    // fall back to ESCALATE so L3 proxy handles the request
    console.warn(
      "[PromptGuard2] Classifier unavailable, falling back to ESCALATE:",
      err,
    );
    return async (_text: string): Promise<ClassifierResult> => ({
      label: "BENIGN",
      confidence: 0.5,
      decision: "ESCALATE",
    });
  }
}

/**
 * Run the Prompt Guard 2 86M classifier on a single text string.
 * Lazy-loads the ONNX model on first call and reuses it thereafter.
 */
export async function classifyWithPromptGuard2(
  text: string,
): Promise<ClassifierResult> {
  if (!classifierPromise) {
    classifierPromise = loadClassifier();
  }
  const classify = await classifierPromise;
  return classify(text);
}
