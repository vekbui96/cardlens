import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PhotoCrop } from "./PhotoCrop.tsx";

const START = { x: 0.2, y: 0.2, w: 0.4, h: 0.5 };

function setup() {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <PhotoCrop
      src="data:image/gif;base64,R0lGODlhAQABAAAAACw="
      initial={START}
      prompt="Drag it"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return { onConfirm, onCancel, box: screen.getByTestId("crop-box") };
}

describe("PhotoCrop", () => {
  it("identifies the box it was opened with, untouched", () => {
    const { onConfirm } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Identify this" }));
    expect(onConfirm).toHaveBeenCalledWith(START);
  });

  it("draws the box over the photo in percentages, so it scales with the picture", () => {
    const { box } = setup();
    expect(box.style.left).toBe("20%");
    expect(box.style.width).toBe("40%");
    expect(screen.getAllByTestId(/crop-handle-/)).toHaveLength(4);
  });

  it("moves with the arrow keys and resizes with Shift", () => {
    const { box, onConfirm } = setup();
    fireEvent.keyDown(box, { key: "ArrowRight" });
    fireEvent.keyDown(box, { key: "ArrowDown", shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Identify this" }));
    const got = onConfirm.mock.calls[0][0];
    expect(got.x).toBeCloseTo(0.22);
    expect(got.y).toBeCloseTo(0.2);
    expect(got.w).toBeCloseTo(0.4);
    expect(got.h).toBeCloseTo(0.52);
  });

  it("cancels without identifying", () => {
    const { onCancel, onConfirm } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
