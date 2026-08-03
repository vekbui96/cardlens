import { describe, expect, it } from "vitest";
import { extractTcin, parseBotState, statusLabel } from "./target.ts";

describe("extractTcin", () => {
  it("reads the id out of a Target product URL", () => {
    expect(extractTcin("https://www.target.com/p/some-product/-/A-93565639")).toBe("93565639");
  });

  it("accepts a bare TCIN", () => {
    expect(extractTcin("  1011209279 ")).toBe("1011209279");
  });

  it("rejects anything that is neither", () => {
    expect(extractTcin("pokemon booster box")).toBeNull();
    expect(extractTcin("")).toBeNull();
  });
});

describe("parseBotState", () => {
  const payload = {
    runtime: {
      startedAt: "2026-08-03T08:32:14.803127",
      lastCheckStartedAt: "2026-08-03T08:32:21.537823",
      lastCheckFinishedAt: null,
      lastCheckDurationSeconds: null,
      checksCompleted: 3,
      blocked: false,
      blockBackoffSeconds: 0,
      checkIntervalSeconds: 60,
      storeId: "2520",
      paused: false,
      browserReady: true,
    },
    products: [
      {
        tcin: "93565639",
        name: "Armarouge Figure",
        url: "https://www.target.com/p/-/A-93565639",
        enabled: 1,
        health_check: 0,
        healthCheck: false,
        autoCart: false,
        lastStatus: "IN_STOCK",
        lastCheckedAt: "2026-08-03T08:33:00",
        lastAlertedAt: null,
        createdAt: "2026-06-29T10:00:00",
      },
    ],
  };

  it("reads runtime and products", () => {
    const state = parseBotState(payload);
    expect(state?.runtime.storeId).toBe("2520");
    expect(state?.runtime.checksCompleted).toBe(3);
    expect(state?.products).toHaveLength(1);
    expect(state?.products[0].name).toBe("Armarouge Figure");
    expect(state?.products[0].enabled).toBe(true);
  });

  it("drops unrecognisable products rather than failing the screen", () => {
    // One bad row should not hide the good ones — same rule collection sync
    // applies when merging.
    const state = parseBotState({
      ...payload,
      products: [...payload.products, { name: "no tcin" }, null, "nonsense"],
    });
    expect(state?.products).toHaveLength(1);
  });

  it("survives a runtime block being absent entirely", () => {
    const state = parseBotState({ products: [] });
    expect(state).not.toBeNull();
    expect(state?.runtime.paused).toBe(false);
    expect(state?.runtime.browserReady).toBe(false);
  });

  it("rejects a payload with no products array", () => {
    expect(parseBotState({ runtime: {} })).toBeNull();
    expect(parseBotState(null)).toBeNull();
    expect(parseBotState("nope")).toBeNull();
  });

  it("names a product that arrived without one", () => {
    const state = parseBotState({ products: [{ tcin: "123" }] });
    expect(state?.products[0].name).toBe("Target Product 123");
  });
});

describe("statusLabel", () => {
  it("distinguishes never-checked from out of stock", () => {
    expect(statusLabel(null)).toBe("Not checked yet");
    expect(statusLabel("OUT")).toBe("Out of stock");
    expect(statusLabel("IN_STOCK")).toBe("In stock");
  });

  it("keeps BLOCKED distinct — it is not a stock state", () => {
    expect(statusLabel("BLOCKED")).toBe("Blocked");
  });
});
