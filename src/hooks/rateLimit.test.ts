import { describe, expect, it } from "vitest";
import { ProviderError } from "../integrations/providers.ts";
import { countRateLimited } from "./rateLimit.ts";

const limited = new ProviderError("Rate limited", "rate-limit", { status: 429 });
const network = new ProviderError("Request failed (503)", "network", { status: 503 });

describe("countRateLimited", () => {
  it("counts a 429 still being retried as limited and retrying", () => {
    expect(countRateLimited([{ failureReason: limited, fetchStatus: "fetching" }])).toEqual({
      limited: 1,
      retrying: 1,
    });
  });

  it("counts a 429 that used up its retry as limited only", () => {
    expect(countRateLimited([{ failureReason: limited, fetchStatus: "idle" }])).toEqual({
      limited: 1,
      retrying: 0,
    });
  });

  it("ignores other failures and healthy queries", () => {
    expect(
      countRateLimited([
        { failureReason: network, fetchStatus: "fetching" },
        { failureReason: null, fetchStatus: "fetching" },
        { failureReason: new Error("Rate limited"), fetchStatus: "idle" },
      ]),
    ).toEqual({ limited: 0, retrying: 0 });
  });
});
