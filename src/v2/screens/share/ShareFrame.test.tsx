import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ShareGone } from "./ShareFrame.tsx";

describe("ShareGone", () => {
  it("announces that the link does not work, without the retry button", () => {
    render(<ShareGone onRetry={() => {}} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/nothing here to show you/i);
    expect(within(alert).queryByRole("button")).not.toBeInTheDocument();
  });
});
