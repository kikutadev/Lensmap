import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { writeTechnicalBookFixture } from "./technical-book-fixture";

const apiBaseUrl = "http://127.0.0.1:4317";

test.describe("Deep Reader live E2E", () => {
  test("imports a book, deep-dives with the real Codex app-server, expands context, and saves an Insight", async ({ page, request }, testInfo) => {
    const codexResponse = await request.get(`${apiBaseUrl}/api/codex/status`);
    expect(codexResponse.ok(), await codexResponse.text()).toBe(true);
    const codexStatus = await codexResponse.json() as {
      ready: boolean;
      account: { type: string; planType?: string } | null;
      models: Array<{ id: string; displayName: string; isDefault: boolean }>;
    };
    expect(codexStatus.ready).toBe(true);
    expect(codexStatus.account?.type).toBe("chatgpt");
    const defaultModel = codexStatus.models.find((model) => model.isDefault);
    expect(defaultModel, "Codex app-server returned no default model").toBeTruthy();
    testInfo.annotations.push({
      type: "codex",
      description: `${defaultModel?.id ?? "unknown"} / ${codexStatus.account?.planType ?? "chatgpt"}`,
    });

    const fixturePath = testInfo.outputPath("technical-book-e2e.pdf");
    mkdirSync(dirname(fixturePath), { recursive: true });
    writeTechnicalBookFixture(fixturePath);

    await page.goto("/");
    await expect(page.getByText(/Codex ·/)).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles(fixturePath);
    await expect(page.getByText("technical-book-e2e.pdf")).toBeVisible();
    await expect(page.getByText("4 pages")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/blocks indexed/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Chapter 1 - Fast Path")).toBeVisible();
    await expect(page.getByText(/1 \/ 4/)).toBeVisible();
    await expect(page.getByRole("button", { name: "1ページ表示" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "幅に合わせる" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "連続表示" }).click();

    await selectPdfTextAcrossPages(page, "Remote cache invalidation is delegated to BlueGate", "Local caches reduce origin load");
    await page.getByRole("button", { name: "引用に追加" }).click();
    await expect(page.getByText(/S1 · PDF p\.1–2/)).toBeVisible();
    await page.getByRole("button", { name: "引用を外す" }).click();

    await selectPdfText(page, "Remote cache invalidation is delegated to BlueGate");
    await expect(page.getByRole("button", { name: "引用に追加" })).toBeVisible();
    await page.getByRole("button", { name: "引用に追加" }).click();
    await expect(page.getByText(/Context · 1 sources/)).toBeVisible();

    await page.getByRole("button", { name: "次のページ" }).click();
    await expect(page.getByText(/2 \/ 4/)).toBeVisible();
    await selectPdfText(page, "Local caches reduce origin load");
    await page.getByRole("button", { name: "深掘り" }).click();
    await expect(page.getByText(/Context · 2 sources/)).toBeVisible();

    const question = "選択箇所に出てくる BlueGate はこの抜粋だけでは定義されていません。本書内を追加で調べて BlueGate の定義を読み、Fast Path と Local Cache の関係を日本語で3点に整理してください。書籍本文に基づく説明には必ず Source ID を付けてください。";
    await page.getByLabel("質問").fill(question);
    await page.getByRole("button", { name: "送信" }).click();

    await expect(page.getByRole("button", { name: "Insightに保存" })).toBeVisible({ timeout: 180_000 });

    const booksResponse = await request.get(`${apiBaseUrl}/api/books`);
    expect(booksResponse.ok()).toBe(true);
    const books = await booksResponse.json() as Array<{ id: string; fileName: string }>;
    const book = books.find((candidate) => candidate.fileName === "technical-book-e2e.pdf");
    expect(book, "Imported E2E book was not persisted").toBeTruthy();

    const chatResponse = await request.get(`${apiBaseUrl}/api/books/${book!.id}/chat`);
    expect(chatResponse.ok(), await chatResponse.text()).toBe(true);
    const chat = await chatResponse.json() as {
      thread: {
        messages: Array<{
          id: string;
          role: string;
          status: string;
          content: string;
          sources: Array<{ label: string; origin: string; pageStart: number }>;
          retrievalEvents: Array<{ toolName: string }>;
        }>;
      } | null;
    };
    const assistant = chat.thread?.messages.findLast((message) => message.role === "assistant");
    expect(assistant?.status).toBe("completed");
    expect(assistant?.content.trim().length).toBeGreaterThan(0);
    expect(assistant?.retrievalEvents.length, "Codex did not perform progressive book retrieval").toBeGreaterThan(0);
    const expandedSource = assistant?.sources.find((source) =>
      source.origin === "ai-expansion"
      && source.pageStart === 2
      && assistant.content.includes(`[${source.label}]`),
    );
    expect(expandedSource, "Codex did not cite a materialized BlueGate source on PDF page 3").toBeTruthy();

    await expect(page.getByText(/AI追加参照/)).toBeVisible();
    await expect(page.getByText(/AI参照履歴/)).toBeVisible();
    await page.getByRole("button", { name: new RegExp(`${expandedSource!.label} · PDF p\\.3`) }).click();
    await expect(page.getByText(/3 \/ 4/)).toBeVisible();

    await page.getByRole("button", { name: "Insightに保存" }).click();
    await expect(page.getByRole("button", { name: "Insight保存済み" })).toBeVisible({ timeout: 30_000 });
    const insightResponse = await request.get(`${apiBaseUrl}/api/insights?bookId=${book!.id}`);
    expect(insightResponse.ok()).toBe(true);
    const insightList = await insightResponse.json() as { artifacts: Array<{ id: string; title: string; version: number }> };
    const savedInsight = insightList.artifacts[0];
    expect(savedInsight?.title.length).toBeLessThanOrEqual(80);
    await page.getByRole("button", { name: /^Insights/ }).click();
    await page.getByText(savedInsight!.title).click();
    await expect(page.getByText(/report · v1/)).toBeVisible();
    await expect(page.getByText(/refs/)).toBeVisible();

    await page.getByRole("button", { name: "編集" }).click();
    const editableBlock = page.locator("textarea").first();
    await editableBlock.fill(`${await editableBlock.inputValue()}\n\nユーザー編集メモ`);
    await page.getByRole("button", { name: /新しいversionとして保存/ }).click();
    await expect(page.getByText(/report · v2/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("編集済み").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "v1" })).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath("deep-reader-live-e2e.png"),
      fullPage: true,
    });
  });
});

async function selectPdfText(page: Page, text: string): Promise<void> {
  const span = page.locator(".textLayer span").filter({ hasText: text }).first();
  await expect(span).toBeVisible({ timeout: 30_000 });
  await span.evaluate((element) => {
    const selection = window.getSelection();
    if (!selection) throw new Error("Selection API is unavailable");
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }));
  });
}


async function selectPdfTextAcrossPages(page: Page, startText: string, endText: string): Promise<void> {
  const start = page.locator('[data-pdf-page="1"] .textLayer span').filter({ hasText: startText }).first();
  const end = page.locator('[data-pdf-page="2"] .textLayer span').filter({ hasText: endText }).first();
  await expect(start).toBeAttached({ timeout: 30_000 });
  await expect(end).toBeAttached({ timeout: 30_000 });
  await page.evaluate(({ startText, endText }) => {
    const spans = (pageNumber: number) => Array.from(document.querySelectorAll<HTMLElement>(`[data-pdf-page="${pageNumber}"] .textLayer span`));
    const startElement = spans(1).find((element) => element.textContent?.includes(startText));
    const endElement = spans(2).find((element) => element.textContent?.includes(endText));
    if (!startElement?.firstChild || !endElement?.firstChild) throw new Error("Cross-page text nodes unavailable");
    const selection = window.getSelection();
    if (!selection) throw new Error("Selection API is unavailable");
    const range = document.createRange();
    range.setStart(startElement.firstChild, 0);
    range.setEnd(endElement.firstChild, endElement.firstChild.textContent?.length ?? 0);
    selection.removeAllRanges();
    selection.addRange(range);
    const rect = endElement.getBoundingClientRect();
    endElement.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: rect.right, clientY: rect.bottom }));
  }, { startText, endText });
}
