import { describe, it, expect, vi, afterEach } from "vitest";
import { generateRecipeFromPrompt } from "./recipeGenerate";

function mockFetchOnce(status: number, body: any) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as any;
}

async function captureError(): Promise<any> {
  try {
    await generateRecipeFromPrompt("prompt", "tok");
    throw new Error("expected generateRecipeFromPrompt to reject");
  } catch (e) {
    return e;
  }
}

describe("generateRecipeFromPrompt error tagging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tags the server's own daily-limit 429 as quota, not transient", async () => {
    mockFetchOnce(429, { error: "Daily generation limit reached — resets at midnight UTC.", quotaExceeded: true });
    const e = await captureError();
    expect(e.quota).toBe(true);
    expect(e.transient).toBeUndefined();
  });

  it("tags an unmarked upstream 429 (Anthropic rate limit) as transient, not quota", async () => {
    mockFetchOnce(429, { error: { type: "rate_limit_error", message: "rate limited" } });
    const e = await captureError();
    expect(e.transient).toBe(true);
    expect(e.quota).toBeUndefined();
  });

  it("tags a 5xx (e.g. 529 overloaded) as transient", async () => {
    mockFetchOnce(529, { error: { type: "overloaded_error", message: "overloaded" } });
    const e = await captureError();
    expect(e.transient).toBe(true);
    expect(e.quota).toBeUndefined();
  });

  it("leaves other 4xx errors untagged", async () => {
    mockFetchOnce(400, { error: "Missing prompt" });
    const e = await captureError();
    expect(e.transient).toBeUndefined();
    expect(e.quota).toBeUndefined();
  });
});
