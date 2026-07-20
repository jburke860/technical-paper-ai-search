import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { answerStreamBody, mockAnswerStream, mockStatusAndPapers } from "./fixtures";

async function scan(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => node.target.join(" ")).slice(0, 5),
  }));
}

test.describe("automated accessibility scans", () => {
  test.setTimeout(90_000);

  test("initial workspace has no WCAG A/AA violations", async ({ page }) => {
    await mockStatusAndPapers(page);
    await page.goto("/");
    await expect(page.getByText("195 questions left")).toBeVisible();

    expect(await scan(page)).toEqual([]);
  });

  test("answer, sources, and explanation states have no violations", async ({ page }) => {
    await mockStatusAndPapers(page);
    await mockAnswerStream(page, answerStreamBody(["Autonomy manages safety [Source 1]."]));
    await page.goto("/");
    await expect(page.getByText("195 questions left")).toBeVisible();
    await page.getByRole("button", { name: "Ask the library" }).click();
    await expect(page.locator(".answer-copy")).toContainText("manages safety");
    // Open the source panel (a drawer on mobile) and expand the explanation.
    await page.locator(".result-card").first().click();
    const explanation = page.locator(".why-source summary").first();
    await expect(explanation).toBeVisible();
    await explanation.click();

    expect(await scan(page)).toEqual([]);
  });

  test("local document mode has no violations", async ({ page }) => {
    await mockStatusAndPapers(page);
    await page.goto("/");
    await expect(page.getByText("195 questions left")).toBeVisible();
    await page.getByRole("button", { name: /Your PDF/ }).click();
    await expect(page.getByText("Search your own PDF")).toBeVisible();

    expect(await scan(page)).toEqual([]);
  });
});
