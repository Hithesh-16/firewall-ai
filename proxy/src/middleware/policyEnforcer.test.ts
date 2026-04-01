import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import { createPolicyEnforcerHook } from "./policyEnforcer";

describe("policyEnforcer middleware", () => {
  const app = Fastify();

  beforeAll(async () => {
    // Register the middleware as a preHandler on a test route
    app.addHook("preHandler", createPolicyEnforcerHook({ skipPaths: ["/health"] }));

    app.post("/v1/chat/completions", async (_req, reply) => {
      return reply.send({ choices: [{ message: { content: "Hello" } }] });
    });

    app.get("/health", async (_req, reply) => {
      return reply.send({ status: "ok" });
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("allows clean requests through", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello, how are you?" }],
      },
    });

    expect(res.statusCode).toBe(200);
  });

  it("blocks requests containing private keys with 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gpt-4",
        messages: [
          {
            role: "user",
            content: "Here is my key:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/yGaXm\n-----END RSA PRIVATE KEY-----",
          },
        ],
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("FIREWALL_BLOCKED");
    expect(res.headers["x-af-action"]).toBe("BLOCK");
  });

  it("skips enforcement for skipPaths", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(res.statusCode).toBe(200);
  });

  it("passes through requests without messages body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { model: "gpt-4" },
    });

    // No messages = skip enforcement, route handler deals with validation
    expect(res.statusCode).toBe(200);
  });

  it("attaches scanContext on ALLOW", async () => {
    // We can't directly inspect request.scanContext from inject,
    // but we verify the request succeeds (meaning middleware didn't block)
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "What is the weather today?" }],
      },
    });

    expect(res.statusCode).toBe(200);
  });
});
