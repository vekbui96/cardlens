import { test, expect } from "@playwright/test";

test.describe("companion-phone input relay", () => {
  test("phone submits a search term that the relay stores for the glasses session", async ({
    page,
    request,
  }) => {
    // The glasses side would create the session; here we create it via the API
    // (same relay) to get a code, then act as the phone at /input/:code.
    const created = await request.post("/api/session");
    expect(created.ok()).toBeTruthy();
    const { code } = (await created.json()) as { code: string };
    expect(code).toHaveLength(6);

    // Phone page.
    await page.goto(`/input/${code}`);
    await expect(page.getByRole("heading", { name: "CardLens" })).toBeVisible();
    await expect(page.getByText(code)).toBeVisible();

    const input = page.getByLabel("Pokémon card name");
    await input.fill("Charizard ex");
    await page.getByRole("button", { name: /Send to glasses/i }).click();
    await expect(page.getByText("Sent!")).toBeVisible();

    // The glasses side would poll this and receive the value.
    const status = await request.get(`/api/session/${code}`);
    const body = (await status.json()) as { status: string; value?: string };
    expect(body.status).toBe("submitted");
    expect(body.value).toBe("Charizard ex");
  });

  test("submitting to an unknown/expired session shows an error", async ({ page }) => {
    await page.goto("/input/ZZZZZZ");
    await page.getByLabel("Pokémon card name").fill("Pikachu");
    await page.getByRole("button", { name: /Send to glasses/i }).click();
    await expect(page.getByText(/couldn’t send/i)).toBeVisible();
  });
});
