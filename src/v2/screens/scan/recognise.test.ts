import { describe, expect, it, vi } from "vitest";
import { answerCapture, type Recognisers } from "./recognise.ts";
import { RecogniserAuthError, RecogniserUnavailableError } from "../../../scan/remoteRecognize.ts";
import type { IndexedCard, ScanResult } from "../../../scan/cardIndex.ts";

/**
 * The failover rules, which are the whole risk of this screen.
 *
 * None of this is visible in the markup: a row answered by the device after a
 * timeout looks exactly like a row answered by the server, which is why it has
 * to be asserted here rather than looked at.
 */

const CARD: IndexedCard = {
  id: "base1-4",
  name: "Charizard",
  number: "4",
  setId: "base1",
  setName: "Base Set",
  rarity: "Rare Holo",
};

function result(confident: boolean): ScanResult {
  return {
    match: { ordinal: 0, distance: 2 },
    runnerUp: { ordinal: 1, distance: 14 },
    confident,
    candidates: [{ card: CARD, distance: 2 }],
  };
}

function recognisers(over: Partial<Recognisers> = {}): Recognisers {
  return {
    server: () => Promise.resolve(result(true)),
    device: () => result(true),
    ...over,
  };
}

describe("who answers a capture", () => {
  it("uses the server's verdict, and records that the server gave it", async () => {
    const answer = await answerCapture("server", recognisers());
    expect(answer.kind).toBe("answered");
    if (answer.kind !== "answered") return;
    expect(answer.via).toBe("server");
    expect(answer.failedOver).toBe(false);
  });

  it("carries the service's own reasoning through, so review can show it", async () => {
    const answer = await answerCapture(
      "server",
      recognisers({ server: () => Promise.resolve({ ...result(true), reason: "margin 12" }) }),
    );
    expect(answer.kind === "answered" && answer.note).toBe("margin 12");
  });

  it("falls back to the device when the server is unreachable, and says so", async () => {
    const answer = await answerCapture(
      "server",
      recognisers({
        server: () => Promise.reject(new RecogniserUnavailableError("the server is unreachable")),
      }),
    );
    expect(answer.kind).toBe("answered");
    if (answer.kind !== "answered") return;
    expect(answer.via).toBe("device");
    // A silent failover must not look like the server working.
    expect(answer.failedOver).toBe(true);
    expect(answer.note).toContain("the server is unreachable");
    expect(answer.note).toContain("on this device");
  });

  it("does NOT fall back when the token was rejected", async () => {
    // The device could answer and deliberately does not. A refused token stays
    // refused until someone types a new one; answering the pile on the device
    // while the screen still says "Server" is the exact failure this prevents.
    const device = vi.fn(() => result(true));
    const answer = await answerCapture(
      "server",
      recognisers({
        server: () => Promise.reject(new RecogniserAuthError()),
        device,
      }),
    );
    expect(answer.kind).toBe("rejected");
    expect(device).not.toHaveBeenCalled();
  });

  it("says so plainly when there is neither a server nor an index", async () => {
    const answer = await answerCapture(
      "server",
      recognisers({
        server: () => Promise.reject(new RecogniserUnavailableError("the server took too long")),
        device: () => null,
      }),
    );
    expect(answer.kind).toBe("unanswerable");
    expect(answer.kind === "unanswerable" && answer.note).toContain("no index");
  });

  it("never reaches the network when the device is the chosen engine", async () => {
    const server = vi.fn(() => Promise.resolve(result(true)));
    const answer = await answerCapture("device", recognisers({ server }));
    expect(server).not.toHaveBeenCalled();
    expect(answer.kind === "answered" && answer.via).toBe("device");
    expect(answer.kind === "answered" && answer.failedOver).toBe(false);
  });

  it("reports an unloaded index rather than pretending nothing happened", async () => {
    const answer = await answerCapture("device", recognisers({ device: () => null }));
    expect(answer.kind).toBe("unanswerable");
  });
});
