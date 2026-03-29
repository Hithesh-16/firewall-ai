describe("Test environment", () => {
  test("should have AI_FIREWALL_GLOBAL_DIR env var set to .continue-test", () => {
    expect(process.env.AI_FIREWALL_GLOBAL_DIR).toBeDefined();
    expect(process.env.AI_FIREWALL_GLOBAL_DIR)?.toMatch(/\.continue-test$/);
  });
});
