import { afterEach, describe, expect, it, vi } from "vitest";
import { copyLink, handOverLink } from "./handOverLink.ts";

const URL_ = "https://example.test/#/trade/abc123";

function stub(share: (() => Promise<void>) | undefined, writeText: (() => Promise<void>) | undefined) {
  const shareFn = share ? vi.fn(share) : undefined;
  const writeFn = writeText ? vi.fn(writeText) : undefined;
  Object.defineProperty(navigator, "share", { configurable: true, value: shareFn });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: writeFn ? { writeText: writeFn } : undefined,
  });
  return { share: shareFn, writeText: writeFn };
}

const reject = (name: string) => () => Promise.reject(new DOMException(name, name));
const ok = () => Promise.resolve();

afterEach(() => {
  Reflect.deleteProperty(navigator, "share");
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("handOverLink", () => {
  it("reports a completed share sheet as shared", async () => {
    const { share, writeText } = stub(ok, ok);
    expect(await handOverLink(URL_, "t")).toBe("shared");
    expect(share).toHaveBeenCalledWith({ title: "t", url: URL_ });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("treats only AbortError as the user cancelling", async () => {
    const { writeText } = stub(reject("AbortError"), ok);
    expect(await handOverLink(URL_, "t")).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies when the share sheet is refused", async () => {
    const { writeText } = stub(reject("NotAllowedError"), ok);
    expect(await handOverLink(URL_, "t")).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(URL_);
  });

  it("copies when there is no share sheet", async () => {
    const { writeText } = stub(undefined, ok);
    expect(await handOverLink(URL_, "t")).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(URL_);
  });

  it("fails, rather than pretending, when both are refused", async () => {
    stub(reject("NotAllowedError"), reject("NotAllowedError"));
    expect(await handOverLink(URL_, "t")).toBe("failed");
  });

  it("fails when there is neither a share sheet nor a clipboard", async () => {
    stub(undefined, undefined);
    expect(await handOverLink(URL_, "t")).toBe("failed");
    expect(await copyLink(URL_)).toBe(false);
  });
});
