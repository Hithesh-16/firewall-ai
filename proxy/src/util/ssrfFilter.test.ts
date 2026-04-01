import { describe, it, expect } from "vitest";
import { isPrivateIp, validateUrlForSSRF } from "./ssrfFilter";

describe("isPrivateIp", () => {
  it("blocks localhost", () => {
    expect(isPrivateIp("localhost")).toBe(true);
  });

  it("blocks 127.0.0.1", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
  });

  it("blocks 10.x range", () => {
    expect(isPrivateIp("10.0.0.1")).toBe(true);
    expect(isPrivateIp("10.255.255.255")).toBe(true);
  });

  it("blocks 172.16-31.x range", () => {
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("172.31.255.255")).toBe(true);
    expect(isPrivateIp("172.15.0.1")).toBe(false);
    expect(isPrivateIp("172.32.0.1")).toBe(false);
  });

  it("blocks 192.168.x range", () => {
    expect(isPrivateIp("192.168.1.1")).toBe(true);
  });

  it("blocks AWS metadata endpoint 169.254.x", () => {
    expect(isPrivateIp("169.254.169.254")).toBe(true);
  });

  it("allows public IPs", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("1.1.1.1")).toBe(false);
    expect(isPrivateIp("203.0.113.1")).toBe(false);
  });

  it("allows public hostnames", () => {
    expect(isPrivateIp("example.com")).toBe(false);
    expect(isPrivateIp("api.openai.com")).toBe(false);
  });
});

describe("validateUrlForSSRF", () => {
  it("allows public URLs", () => {
    expect(validateUrlForSSRF("https://api.example.com/webhook").safe).toBe(true);
  });

  it("blocks localhost URLs", () => {
    const result = validateUrlForSSRF("http://localhost:8080/admin");
    expect(result.safe).toBe(false);
  });

  it("blocks 169.254 (AWS metadata)", () => {
    const result = validateUrlForSSRF("http://169.254.169.254/latest/meta-data/");
    expect(result.safe).toBe(false);
  });

  it("rejects invalid URLs", () => {
    const result = validateUrlForSSRF("not-a-url");
    expect(result.safe).toBe(false);
  });
});
