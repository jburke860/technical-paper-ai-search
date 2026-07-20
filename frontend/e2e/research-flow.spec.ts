import { expect, test } from "@playwright/test";
import {
  answerStreamBody,
  mockAnswerStream,
  mockStatusAndPapers,
  statusPayload,
} from "./fixtures";

const ANSWER_DELTAS = ["Autonomous systems manage ", "safety constraints [Source 1] ", "during operation [Source 2]."];
const FULL_ANSWER = ANSWER_DELTAS.join("");

test.describe("hosted research workflow", () => {
  test("streams sources before the answer and supports copy actions", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await mockStatusAndPapers(page);
    await mockAnswerStream(page, answerStreamBody(ANSWER_DELTAS));

    await page.goto("/");
    await expect(page.getByText("195 questions left")).toBeVisible();

    await page.getByRole("button", { name: "Ask the library" }).click();
    await expect(page.getByText("Answer from the library")).toBeVisible();
    await expect(page.locator(".answer-copy")).toContainText("during operation");
    await expect(page.getByRole("heading", { name: "Supporting sources" })).toBeVisible();
    await expect(page.locator(".result-card")).toHaveCount(3);
    await expect(page.getByText("194 questions left")).toBeVisible();

    await page.getByRole("button", { name: /^Copy$/ }).click();
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain("safety constraints");
  });

  test("keeps the ask action disabled for an empty question", async ({ page }) => {
    await mockStatusAndPapers(page);
    await page.goto("/");
    await expect(page.getByText("195 questions left")).toBeVisible();

    await page.getByRole("textbox", { name: "Research question" }).fill("");
    await expect(page.getByRole("button", { name: "Ask the library" })).toBeDisabled();
  });

  test("reports an unreachable status endpoint without breaking the page", async ({ page }) => {
    await page.route("**/api/status", (route) => route.abort());
    await page.route("**/api/papers", (route) => route.abort());
    await page.goto("/");

    await expect(page.getByText("Status unavailable")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ask the library" })).toBeDisabled();
    await expect(page.getByText("Built for verifiable answers")).toBeVisible();
  });

  test("shows the exhausted state when the global quota is already spent", async ({ page }) => {
    await mockStatusAndPapers(
      page,
      statusPayload({ status: "unavailable" }, {
        available: false,
        code: "DAILY_DEMO_LIMIT_REACHED",
        consumed: 200,
        remaining: 0,
      }),
    );
    await page.goto("/");

    await expect(page.getByText("Daily capacity reached")).toBeVisible();
    await expect(page.getByText("Today’s demo capacity has been reached")).toBeVisible();
    await expect(page.getByText(/Hosted research resets at/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Ask the library" })).toBeDisabled();
  });

  test("handles mid-session global exhaustion from the stream route", async ({ page }) => {
    let statusCalls = 0;
    await page.route("**/api/status", (route) => {
      statusCalls += 1;
      const exhausted = statusCalls > 1;
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          exhausted
            ? statusPayload({ status: "unavailable" }, {
                available: false,
                code: "DAILY_DEMO_LIMIT_REACHED",
                consumed: 200,
                remaining: 0,
              })
            : statusPayload(),
        ),
      });
    });
    await page.route("**/api/papers", (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify({ papers: [], count: 0 }) }),
    );
    await page.route("**/api/answer/stream", (route) =>
      route.fulfill({
        status: 503,
        headers: { "Content-Type": "application/json", "X-Demo-Remaining": "0" },
        body: JSON.stringify({
          code: "DAILY_DEMO_LIMIT_REACHED",
          message: "Today's hosted demo capacity has been reached.",
          resetsAt: "2099-01-01T00:00:00.000Z",
          error: { code: "DAILY_DEMO_LIMIT_REACHED", message: "Today's hosted demo capacity has been reached." },
        }),
      }),
    );

    await page.goto("/");
    await expect(page.getByText("195 questions left")).toBeVisible();
    await page.getByRole("button", { name: "Ask the library" }).click();

    await expect(page.getByText("Research interrupted")).toBeVisible();
    await expect(page.getByText("Today's hosted demo capacity has been reached.")).toBeVisible();
    await expect(page.getByText("Daily capacity reached")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ask the library" })).toBeDisabled();
  });

  test("surfaces browser burst limits as a retryable message", async ({ page }) => {
    await mockStatusAndPapers(page);
    await page.route("**/api/answer/stream", (route) =>
      route.fulfill({
        status: 429,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: "BROWSER_BURST_LIMIT_REACHED",
          message: "Please wait before submitting another question.",
          error: { code: "BROWSER_BURST_LIMIT_REACHED", message: "Please wait before submitting another question." },
        }),
      }),
    );

    await page.goto("/");
    await expect(page.getByText("195 questions left")).toBeVisible();
    await page.getByRole("button", { name: "Ask the library" }).click();

    await expect(page.getByText("Please wait before submitting another question.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ask the library" })).toBeEnabled();
  });

  test("recovers from an interrupted stream through the retry action", async ({ page }) => {
    let attempts = 0;
    await mockStatusAndPapers(page);
    await page.route("**/api/answer/stream", (route) => {
      attempts += 1;
      route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "X-Demo-Remaining": "194" },
        body: attempts === 1
          ? answerStreamBody(["Partial answer "], { done: false })
          : answerStreamBody(ANSWER_DELTAS),
      });
    });

    await page.goto("/");
    await expect(page.getByText("195 questions left")).toBeVisible();
    await page.getByRole("button", { name: "Ask the library" }).click();

    await expect(page.getByText("Research interrupted")).toBeVisible();
    await expect(page.getByText("The answer stream ended before completion.")).toBeVisible();

    await page.getByRole("button", { name: "Retry" }).first().click();
    await expect(page.locator(".answer-copy")).toContainText("during operation");
    await expect(page.getByText("Research interrupted")).toHaveCount(0);
  });

  test("persists history locally and restores a previous session", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "History list is asserted in the static sidebar.");
    await mockStatusAndPapers(page);
    await mockAnswerStream(page, answerStreamBody(ANSWER_DELTAS));

    await page.goto("/");
    await expect(page.getByText("195 questions left")).toBeVisible();
    const question = "What safety and reliability challenges affect autonomous systems?";
    await page.getByRole("button", { name: "Ask the library" }).click();
    await expect(page.locator(".answer-copy")).toContainText("during operation");

    await expect(page.locator(".history-list button", { hasText: question })).toBeVisible();

    await page.reload();
    await expect(page.getByText("195 questions left")).toBeVisible();
    const entry = page.locator(".history-list button", { hasText: question });
    await expect(entry).toBeVisible();

    await page.getByRole("textbox", { name: "Research question" }).fill("different question");
    await entry.click();
    await expect(page.getByRole("textbox", { name: "Research question" })).toHaveValue(question);
    await expect(page.locator(".answer-copy")).toContainText("during operation");
    await expect(page.locator(".result-card")).toHaveCount(3);
  });

  test("opens the cited page from an inline citation and copies a citation", async ({ page }, testInfo) => {
    await mockStatusAndPapers(page);
    await mockAnswerStream(page, answerStreamBody(ANSWER_DELTAS));

    await page.goto("/");
    await expect(page.getByText("195 questions left")).toBeVisible();
    await page.getByRole("button", { name: "Ask the library" }).click();
    await expect(page.locator(".answer-copy")).toContainText("during operation");

    await page.getByRole("button", { name: /Open Source 2:/ }).click();
    const panel = page.locator("#sources");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Page 3", { exact: true })).toBeVisible();
    await expect(panel.locator(".pdf-toolbar")).toBeVisible({ timeout: 30_000 });
    await expect(panel.locator(".pdf-toolbar span").first()).toContainText("3");

    await panel.getByRole("button", { name: "Copy citation" }).click();
    await expect(panel.getByRole("button", { name: "Copied" })).toBeVisible();

    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Close sources" }).last().click();
      await expect(panel).not.toBeInViewport();
    }
  });

  test("shows a safe failure state when the cited PDF cannot load", async ({ page }) => {
    await mockStatusAndPapers(page);
    await mockAnswerStream(page, answerStreamBody(ANSWER_DELTAS));
    await page.route("**/pdfs/**", (route) => route.abort());

    await page.goto("/");
    await expect(page.getByText("195 questions left")).toBeVisible();
    await page.getByRole("button", { name: "Ask the library" }).click();
    await expect(page.locator(".answer-copy")).toContainText("during operation");

    await page.getByRole("button", { name: /Open Source 1:/ }).click();
    await expect(page.getByText(/could not be loaded/)).toBeVisible({ timeout: 30_000 });
  });

  test("supports keyboard-only drawer usage with focus trapping and restoration", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Drawers overlay content only on narrow layouts.");
    await mockStatusAndPapers(page);

    await page.goto("/");
    await expect(page.getByText("195 questions left")).toBeVisible();

    const openLibrary = page.getByRole("button", { name: "Open library" });
    await openLibrary.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#library")).toBeVisible();
    await expect.poll(() =>
      page.evaluate(() => document.getElementById("library")?.contains(document.activeElement)),
    ).toBe(true);

    // Tab far enough to pass the last focusable element; focus must stay trapped.
    for (let index = 0; index < 40; index += 1) await page.keyboard.press("Tab");
    expect(await page.evaluate(() =>
      document.getElementById("library")?.contains(document.activeElement),
    )).toBe(true);

    await page.keyboard.press("Escape");
    await expect(page.locator("#library")).not.toBeInViewport();
    await expect.poll(() =>
      page.evaluate(() => document.activeElement?.getAttribute("aria-label")),
    ).toBe("Open library");
  });

  test("respects reduced motion preferences while streaming", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockStatusAndPapers(page);
    await mockAnswerStream(page, answerStreamBody(ANSWER_DELTAS));

    await page.goto("/");
    await expect(page.getByText("195 questions left")).toBeVisible();

    const scrollBehavior = await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollBehavior,
    );
    expect(scrollBehavior).toBe("auto");
    const dotAnimation = await page.evaluate(
      () => getComputedStyle(document.querySelector(".status-dot")!).animationDuration,
    );
    expect(parseFloat(dotAnimation)).toBeLessThanOrEqual(0.01);

    await page.getByRole("button", { name: "Ask the library" }).click();
    await expect(page.locator(".answer-copy")).toContainText("during operation");
    expect(FULL_ANSWER).toContain("safety constraints");
  });
});
