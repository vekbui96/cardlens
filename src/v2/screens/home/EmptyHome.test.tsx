import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SyncStatus } from "../../../app/LibraryProvider.tsx";
import { EmptyHome } from "./EmptyHome.tsx";

const status = (state: SyncStatus["state"]): SyncStatus => ({ state, pending: 0, lastSyncAt: 0 });

const CONNECT = /Connect this device/;

describe("EmptyHome connect action", () => {
  afterEach(cleanup);

  it("offers to connect this device when sync is off, and runs the handler on press", () => {
    const onConnect = vi.fn();
    render(<EmptyHome syncStatus={status("off")} onConnect={onConnect} />);
    fireEvent.click(screen.getByRole("button", { name: CONNECT }));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it("offers it again after a rejected token", () => {
    render(<EmptyHome syncStatus={status("bad-token")} onConnect={() => {}} />);
    expect(screen.getByRole("button", { name: CONNECT })).toBeTruthy();
  });

  it("shows Connecting… and no pressable action while syncing", () => {
    const onConnect = vi.fn();
    render(<EmptyHome syncStatus={status("syncing")} onConnect={onConnect} />);
    expect(screen.getByText("Connecting…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: CONNECT })).toBeNull();
  });

  it.each(["disabled", "offline", "idle"] as const)("shows no connect action when sync is %s", (state) => {
    render(<EmptyHome syncStatus={status(state)} onConnect={() => {}} />);
    expect(screen.queryByText(CONNECT)).toBeNull();
    expect(screen.queryByText("Connecting…")).toBeNull();
  });

  it("keeps the two original actions", () => {
    render(<EmptyHome syncStatus={status("off")} onConnect={() => {}} />);
    expect(screen.getByRole("link", { name: /Browse sets/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Search for a card/ })).toBeTruthy();
  });
});
