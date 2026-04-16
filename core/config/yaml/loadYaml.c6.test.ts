/**
 * Tests for Phase C.C6 hard refusal helper — SECURITY_HARDENING_PLAN.md.
 *
 * The helper is the single point that decides whether a model's
 * `apiKey:` value gets the YAML loader to refuse the entire config.
 * Get the classifier wrong and either:
 *   - we leak (false negative — accept a literal key), OR
 *   - we lock users out (false positive — reject a legit `vault://`
 *     reference or a `${{ secrets.X }}` template).
 *
 * Both failure modes are PR-stoppers, so this test exhausts the
 * documented acceptable shapes plus the obvious leak shapes.
 */

import { isPlaintextApiKey } from "./apiKeyClassifier";

describe("isPlaintextApiKey (Phase C.C6 hard refusal)", () => {
  describe("REJECTS plaintext literals", () => {
    const literals = [
      "sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAxyz_",
      "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "gsk_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "AIzaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "any-old-string",
      "12345",
      "x", // single char still counts as a literal
      "  literal-with-whitespace  ",
    ];
    for (const v of literals) {
      it(`rejects ${JSON.stringify(v)}`, () => {
        expect(isPlaintextApiKey(v)).toBe(true);
      });
    }
  });

  describe("ACCEPTS empty / undefined (no-key providers)", () => {
    it("undefined", () => {
      expect(isPlaintextApiKey(undefined)).toBe(false);
    });
    it("empty string", () => {
      expect(isPlaintextApiKey("")).toBe(false);
    });
    it("whitespace only", () => {
      expect(isPlaintextApiKey("   ")).toBe(false);
    });
  });

  describe("ACCEPTS vault:// references (Phase C.C3 resolver path)", () => {
    const refs = [
      "vault://openai",
      "vault://openai/gpt-4",
      "vault://anthropic/claude-sonnet-4",
      "vault://my-custom-slug/some/path/with/slashes",
    ];
    for (const v of refs) {
      it(`accepts ${JSON.stringify(v)}`, () => {
        expect(isPlaintextApiKey(v)).toBe(false);
      });
    }
  });

  describe("ACCEPTS ${{ secrets.X }} templates", () => {
    const templates = [
      "${{ secrets.OPENAI_API_KEY }}",
      "${{secrets.X}}",
      "${{ inputs.api_key }}",
    ];
    for (const v of templates) {
      it(`accepts ${JSON.stringify(v)}`, () => {
        expect(isPlaintextApiKey(v)).toBe(false);
      });
    }
  });

  describe("ACCEPTS env-var indirection", () => {
    it("${ENV_VAR}", () => {
      expect(isPlaintextApiKey("${OPENAI_API_KEY}")).toBe(false);
    });
    it("$ENV_VAR", () => {
      expect(isPlaintextApiKey("$OPENAI_API_KEY")).toBe(false);
    });
    it("$WITH_NUMBERS_2", () => {
      expect(isPlaintextApiKey("$KEY_2")).toBe(false);
    });
    it("DOES NOT accept $literal-text-with-dashes (looks like a key)", () => {
      // Anything that doesn't match the strict env-var name pattern
      // must fall through to "literal" so we don't get tricked by
      // accidental $-prefixed strings that aren't actually env vars.
      expect(isPlaintextApiKey("$sk-proj-leak")).toBe(true);
    });
  });
});
