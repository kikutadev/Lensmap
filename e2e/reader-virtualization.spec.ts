import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { expect, test } from "@playwright/test";
import { writeLongTechnicalBookFixture } from "./technical-book-fixture";

test.describe("Long PDF reader", () => {
  test("releases distant Canvas/TextLayer content instead of retaining every visited page", async ({ page }, testInfo) => {
    await page.route("**/api/codex/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          available: false, ready: false, binaryPath: null, version: null, account: null,
          requiresOpenaiAuth: null, models: [], error: "mocked for reader-only E2E",
        }),
      });
    });

    const fixturePath = testInfo.outputPath("long-technical-book.pdf");
    mkdirSync(dirname(fixturePath), { recursive: true });
    writeLongTechnicalBookFixture(fixturePath, 120);

    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles(fixturePath);
    await expect(page.getByText("long-technical-book.pdf")).toBeVisible();
    await expect(page.getByText(/1 \/ 120/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "1ページ表示" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "幅に合わせる" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-pdf-page]')).toHaveCount(1);
    await expect(page.locator('[data-pdf-page="1"] canvas')).toBeVisible();

    const fitWidthDelta = await page.locator('[data-pdf-page="1"]').evaluate((element) => {
      const reader = element.closest('[data-reader-scroll]');
      if (!(reader instanceof HTMLElement)) throw new Error("Reader scroll root not found");
      return Math.abs((reader.clientWidth - 56) - (element as HTMLElement).getBoundingClientRect().width);
    });
    expect(fitWidthDelta).toBeLessThan(3);

    await page.getByRole("button", { name: "拡大" }).click();
    await expect(page.getByRole("button", { name: "幅に合わせる" })).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "幅に合わせる" }).click();
    await expect(page.getByRole("button", { name: "幅に合わせる" })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "次のページ" }).click();
    await expect(page.getByText(/2 \/ 120/)).toBeVisible();
    await expect(page.locator('[data-pdf-page]')).toHaveCount(1);
    await expect(page.locator('[data-pdf-page="2"] canvas')).toBeVisible();

    await page.getByRole("button", { name: "連続表示" }).click();
    await expect(page.getByRole("button", { name: "連続表示" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-pdf-page]')).toHaveCount(120);

    await page.locator('[data-pdf-page="120"]').evaluate((element) => {
      element.scrollIntoView({ block: "start" });
    });
    await expect(page.getByText(/120 \/ 120/)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-pdf-page="120"] canvas')).toBeVisible({ timeout: 30_000 });

    await expect.poll(async () => page.locator('[data-pdf-page] canvas').count()).toBeLessThanOrEqual(8);
    await expect(page.locator('[data-pdf-page="1"] canvas')).toHaveCount(0);
    await expect(page.locator('[data-pdf-page="1"] .textLayer span')).toHaveCount(0);

    const renderedPages = await page.locator('[data-pdf-page]:has(canvas)').count();
    expect(renderedPages).toBeLessThanOrEqual(8);
  });
});
