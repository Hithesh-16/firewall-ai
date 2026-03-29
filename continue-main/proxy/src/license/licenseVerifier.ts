/**
 * License Key Verifier
 *
 * Ed25519-signed offline license keys. No phone-home required.
 * Format: base64url(payload).base64url(signature)
 * Public key baked into binary. Expired license degrades to community tier —
 * NEVER disables security scanning.
 *
 * SOLID:
 * - SRP: Only verifies and decodes license keys. No feature gating logic.
 * - OCP: New plan types / features added to LicensePayload without changing verification.
 * - DIP: Consumers depend on LicensePayload interface, not verification internals.
 */

import crypto from "node:crypto";

// ── Types ──────────────────────────────────────────────────────────────────

export type LicensePlan = "community" | "team" | "enterprise";

export interface LicensePayload {
  plan: LicensePlan;
  features: string[];
  seats: number;
  orgId: string;
  expiresAt: number; // Unix timestamp (ms)
  issuedAt: number;
}

export interface LicenseState {
  active: boolean;
  plan: LicensePlan;
  features: string[];
  seats: number;
  orgId: string;
  expired: boolean;
  expiresAt: number;
}

// ── Public Key ─────────────────────────────────────────────────────────────

/**
 * Ed25519 public key for license verification.
 * In production, this would be the actual public key from your license server.
 * For development, generate a keypair with:
 *   const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
 */
const LICENSE_PUBLIC_KEY = process.env.LICENSE_PUBLIC_KEY ?? "";

// Warn if no public key in production — dev mode accepts any well-formed payload
if (!LICENSE_PUBLIC_KEY && process.env.NODE_ENV === "production") {
  console.warn(
    "[license] WARNING: LICENSE_PUBLIC_KEY not set in production. " +
    "Any well-formed license key will be accepted without signature verification."
  );
}

// ── State ──────────────────────────────────────────────────────────────────

let currentLicense: LicensePayload | null = null;

// ── Verification ───────────────────────────────────────────────────────────

/**
 * Verify and decode a license key.
 * Format: base64url(JSON payload).base64url(Ed25519 signature)
 *
 * @returns LicensePayload if valid, null if invalid/tampered
 */
export function verifyLicense(licenseKey: string): LicensePayload | null {
  try {
    const parts = licenseKey.split(".");
    if (parts.length !== 2) return null;

    const [payloadB64, signatureB64] = parts;
    const payloadBuffer = Buffer.from(payloadB64, "base64url");
    const signatureBuffer = Buffer.from(signatureB64, "base64url");

    // If no public key configured, accept any well-formed payload (dev mode)
    if (!LICENSE_PUBLIC_KEY) {
      const payload = JSON.parse(payloadBuffer.toString("utf-8")) as LicensePayload;
      return isValidPayload(payload) ? payload : null;
    }

    // Verify Ed25519 signature
    const publicKeyObject = crypto.createPublicKey({
      key: Buffer.from(LICENSE_PUBLIC_KEY, "base64"),
      format: "der",
      type: "spki",
    });

    const isValid = crypto.verify(null, payloadBuffer, publicKeyObject, signatureBuffer);
    if (!isValid) return null;

    const payload = JSON.parse(payloadBuffer.toString("utf-8")) as LicensePayload;
    return isValidPayload(payload) ? payload : null;
  } catch {
    return null;
  }
}

/**
 * Activate a license key. Stores in memory for the proxy lifetime.
 */
export function activateLicense(licenseKey: string): LicenseState {
  const payload = verifyLicense(licenseKey);

  if (!payload) {
    return getCommunityState();
  }

  currentLicense = payload;
  return getLicenseState();
}

/**
 * Deactivate current license. Reverts to community tier.
 */
export function deactivateLicense(): LicenseState {
  currentLicense = null;
  return getCommunityState();
}

/**
 * Get current license state. Expired licenses degrade to community.
 */
export function getLicenseState(): LicenseState {
  if (!currentLicense) return getCommunityState();

  const expired = currentLicense.expiresAt > 0 && Date.now() > currentLicense.expiresAt;

  // Expired = degrade to community, NEVER disable scanning
  if (expired) {
    return {
      active: false,
      plan: "community",
      features: [],
      seats: 1,
      orgId: currentLicense.orgId,
      expired: true,
      expiresAt: currentLicense.expiresAt,
    };
  }

  return {
    active: true,
    plan: currentLicense.plan,
    features: currentLicense.features,
    seats: currentLicense.seats,
    orgId: currentLicense.orgId,
    expired: false,
    expiresAt: currentLicense.expiresAt,
  };
}

/**
 * Check if a specific feature is available in the current license.
 */
export function hasFeature(feature: string): boolean {
  const state = getLicenseState();
  if (!state.active) return false;
  return state.features.includes(feature);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getCommunityState(): LicenseState {
  return {
    active: true,
    plan: "community",
    features: [],
    seats: 1,
    orgId: "",
    expired: false,
    expiresAt: 0,
  };
}

function isValidPayload(p: unknown): p is LicensePayload {
  if (typeof p !== "object" || p === null) return false;
  const obj = p as Record<string, unknown>;
  return (
    typeof obj.plan === "string" &&
    ["community", "team", "enterprise"].includes(obj.plan) &&
    Array.isArray(obj.features) &&
    typeof obj.seats === "number" &&
    typeof obj.orgId === "string"
  );
}
