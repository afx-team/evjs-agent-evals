export async function verify({ page, origin, expect, inspection }) {
  for (const [routePath, title, description] of [
    ["/", "Task Desk", "Organize everyday work."],
    ["/about", "About Task Desk", "About our task workspace."],
  ]) {
    const route = inspection.pageRoutes.find(
      (candidate) => candidate.path === routePath,
    );
    expect(route).toBeDefined();
    expect(route.module).toMatch(/\/page\.[jt]sx?$/);
    const graphPage = Object.values(inspection.graph.pages).find(
      (candidate) => candidate.source.module === route.module,
    );
    expect(graphPage).toBeDefined();
    const directory = route.module.slice(0, route.module.lastIndexOf("/"));
    expect([
      `${directory}/page.config.ts`,
      `${directory}/page.config.js`,
    ]).toContain(graphPage.source.config);
    expect(graphPage.metadata).toBeDefined();
    expect(graphPage.metadata.title).toBe(title);
    const meta = Object.fromEntries(
      Object.entries(graphPage.metadata.meta ?? {}).map(([name, value]) => [
        name.toLowerCase(),
        value,
      ]),
    );
    expect(meta.description).toBe(description);
    if (routePath === "/about") {
      expect(meta).not.toHaveProperty("keywords");
      expect(meta["theme-color"]).toBe("#123456");
    } else {
      expect(meta.keywords).toBe("tasks,work");
      if (meta["theme-color"] !== undefined) {
        expect(meta["theme-color"]).toBe("#ffffff");
      }
    }
  }

  async function assertMetadata(about) {
    await expect(page).toHaveTitle(about ? "About Task Desk" : "Task Desk");
    await expect(page.locator("head title")).toHaveCount(1);
    const description = page.locator('meta[name="description" i]');
    await expect(description).toHaveCount(1);
    await expect(description).toHaveAttribute(
      "content",
      about ? "About our task workspace." : "Organize everyday work.",
    );
    await expect(page.locator('meta[name="theme-color" i]')).toHaveCount(1);
    await expect(page.locator('meta[name="theme-color" i]')).toHaveAttribute(
      "content",
      about ? "#123456" : "#ffffff",
    );
    await expect(page.locator('meta[name="viewport" i]')).toHaveCount(1);
    await expect(page.locator('meta[name="viewport" i]')).toHaveAttribute(
      "content",
      "width=device-width, initial-scale=1.0",
    );
    await expect(page.locator('meta[name="keywords" i]')).toHaveCount(
      about ? 0 : 1,
    );
    if (!about) {
      await expect(page.locator('meta[name="keywords" i]')).toHaveAttribute(
        "content",
        "tasks,work",
      );
    }
    await expect(
      page.getByRole("heading", {
        name: about ? "About Task Desk" : "EVJS eval",
        exact: true,
      }),
    ).toBeVisible();
  }

  await page.goto(`${origin}/`);
  await assertMetadata(false);
  const marker = `page-metadata-${Math.random()}`;
  await page.evaluate((value) => {
    document.documentElement.dataset.evalMarker = value;
  }, marker);
  await page.getByRole("link", { name: "About", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/about`);
  await assertMetadata(true);
  expect(
    await page.evaluate(() => document.documentElement.dataset.evalMarker),
  ).toBe(marker);
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await assertMetadata(false);
  await page.goBack();
  await assertMetadata(true);
  await page.goForward();
  await assertMetadata(false);

  await page.goto(`${origin}/about`);
  await assertMetadata(true);
  await page.reload();
  await assertMetadata(true);
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await assertMetadata(false);
}
