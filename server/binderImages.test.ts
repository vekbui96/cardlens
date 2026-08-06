import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BinderImageStore, ImageTooLargeError, MAX_IMAGE_BYTES } from "./binderImages.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cardlens-binder-images-"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const pngDataUrl = (bytes = 32) => `data:image/png;base64,${Buffer.alloc(bytes, 7).toString("base64")}`;

describe("BinderImageStore.save", () => {
  it("stores an image and returns an id that round-trips", () => {
    const store = new BinderImageStore(dir);
    const id = store.save(pngDataUrl());
    expect(id).toMatch(/\.png$/);
    const read = store.read(id as string);
    expect(read?.contentType).toBe("image/png");
    expect(read?.body.byteLength).toBe(32);
  });

  it("mints unguessable ids", () => {
    const store = new BinderImageStore(dir);
    const a = store.save(pngDataUrl());
    const b = store.save(pngDataUrl());
    expect(a).not.toBe(b);
    // The id is the credential, exactly like a live share.
    expect((a as string).length).toBeGreaterThanOrEqual(20);
  });

  it("refuses a format that is not a still image it can serve safely", () => {
    const store = new BinderImageStore(dir);
    // SVG would be script execution served from the API origin.
    expect(store.save(`data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`)).toBeNull();
    expect(store.save("data:application/pdf;base64,AAAA")).toBeNull();
    expect(store.save("https://example.test/cat.png")).toBeNull();
    expect(store.save(undefined)).toBeNull();
  });

  it("throws on an oversized image rather than truncating it", () => {
    const store = new BinderImageStore(dir);
    expect(() => store.save(pngDataUrl(MAX_IMAGE_BYTES + 1))).toThrow(ImageTooLargeError);
  });
});

describe("BinderImageStore.read", () => {
  it("refuses a traversal attempt", () => {
    const store = new BinderImageStore(dir);
    writeFileSync(join(dir, "secret.txt"), "shh");
    expect(store.read("../secret.txt")).toBeNull();
    expect(store.read("..%2Fsecret.txt")).toBeNull();
    expect(store.read("secret.txt")).toBeNull();
  });

  it("returns null for an unknown id without saying it is unknown", () => {
    expect(new BinderImageStore(dir).read("abcdefghijkl.png")).toBeNull();
  });
});

describe("BinderImageStore.sweep", () => {
  it("leaves a just-uploaded orphan alone", () => {
    // The image lands BEFORE the binder that references it is pushed — the
    // client debounces sync by ten seconds. A sweep with no age floor would
    // delete the picture inside that window.
    const store = new BinderImageStore(dir);
    const id = store.save(pngDataUrl()) as string;
    expect(store.sweep(new Set())).toEqual([]);
    expect(existsSync(join(dir, id))).toBe(true);
  });

  it("removes an old orphan and keeps an old referenced image", () => {
    const store = new BinderImageStore(dir);
    const orphan = store.save(pngDataUrl()) as string;
    const kept = store.save(pngDataUrl()) as string;
    const old = new Date(Date.now() - 30 * 24 * 60 * 60_000);
    utimesSync(join(dir, orphan), old, old);
    utimesSync(join(dir, kept), old, old);

    expect(store.sweep(new Set([kept]))).toEqual([orphan]);
    expect(existsSync(join(dir, orphan))).toBe(false);
    expect(existsSync(join(dir, kept))).toBe(true);
  });

  it("ignores files it did not name", () => {
    const store = new BinderImageStore(dir);
    writeFileSync(join(dir, "notes.txt"), "keep me");
    const old = new Date(Date.now() - 30 * 24 * 60 * 60_000);
    utimesSync(join(dir, "notes.txt"), old, old);
    expect(store.sweep(new Set())).toEqual([]);
    expect(existsSync(join(dir, "notes.txt"))).toBe(true);
  });
});
