/**
 * Hook Schemas
 *
 * Zod validation for hook registration with SSRF prevention.
 */

import { z } from "zod";
import { isPrivateIp } from "../util/ssrfFilter";

export const hookEventSchema = z.enum([
  "pre_send",
  "post_receive",
  "on_block",
  "on_redact",
  "on_approve",
]);

export const hookRegistrationSchema = z.object({
  event: hookEventSchema,
  url: z
    .string()
    .url()
    .refine(
      (url) => {
        try {
          const parsed = new URL(url);
          return !isPrivateIp(parsed.hostname);
        } catch {
          return false;
        }
      },
      { message: "Webhook URL must not point to internal/private addresses (SSRF protection)" },
    ),
  timeout: z.number().int().min(1000).max(30_000).default(5000),
  description: z.string().max(200).optional(),
});

export type HookRegistration = z.infer<typeof hookRegistrationSchema>;
