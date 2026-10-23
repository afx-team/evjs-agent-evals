export async function verify({ page, origin, expect, inspection }) {
  const parent = inspection.pageRoutes.find((route) => route.path === "/teams");
  expect(parent).toBeDefined();
  const dynamicRoutes = inspection.pageRoutes.filter((route) =>
    /^\/teams\/\$[^/]+$/.test(route.path),
  );
  expect(dynamicRoutes).toHaveLength(1);
  const dynamic = dynamicRoutes[0];
  expect(dynamic.module).toMatch(/\/page\.[jt]sx?$/);
  expect(
    dynamic.module
      .split("/")
      .some(
        (segment) => segment.startsWith("$") && !segment.startsWith("$..."),
      ),
  ).toBe(true);
  const graphRoute = inspection.graph.routes.find(
    (route) => route.id === dynamic.id,
  );
  expect(graphRoute).toBeDefined();
  expect(graphRoute.pattern.segments).toEqual([
    { kind: "static", value: "teams" },
    expect.objectContaining({ kind: "param" }),
  ]);
  const byId = new Map(
    inspection.graph.routes.map((route) => [route.id, route]),
  );
  const ancestors = new Set();
  let parentId = graphRoute.parentId;
  while (parentId && !ancestors.has(parentId)) {
    ancestors.add(parentId);
    parentId = byId.get(parentId)?.parentId;
  }
  expect(
    [...ancestors].some(
      (id) => id === parent.id || Boolean(byId.get(id)?.facets.layout),
    ),
  ).toBe(true);

  async function assertTeam(name, members) {
    await expect(
      page.getByRole("heading", { name: "Teams", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name, exact: true, level: 2 }),
    ).toBeVisible();
    await expect(
      page.getByText(`Members: ${members}`, { exact: true }),
    ).toBeVisible();
    for (const team of ["Atlas", "Borealis"]) {
      await expect(
        page.getByRole("link", { name: team, exact: true }),
      ).toBeVisible();
    }
  }

  await page.goto(`${origin}/teams/alpha`);
  await assertTeam("Atlas", 3);
  await page.reload();
  await assertTeam("Atlas", 3);

  const marker = `team-navigation-${Math.random()}`;
  await page.evaluate((value) => {
    document.documentElement.dataset.evalMarker = value;
  }, marker);
  await page.getByRole("link", { name: "Borealis", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/teams/beta`);
  await assertTeam("Borealis", 5);
  await expect(
    page.getByRole("heading", { name: "Atlas", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.dataset.evalMarker),
  ).toBe(marker);

  await page.goBack();
  await assertTeam("Atlas", 3);
  await page.goForward();
  await assertTeam("Borealis", 5);
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "EVJS eval", exact: true }),
  ).toBeVisible();
  const links = await page.getByRole("link").all();
  let directoryLink;
  for (const link of links) {
    const href = await link.getAttribute("href");
    if (href && new URL(href, origin).pathname === "/teams") {
      directoryLink = link;
      break;
    }
  }
  expect(directoryLink).toBeDefined();
  await directoryLink.click();
  await expect(page).toHaveURL(`${origin}/teams`);
  await expect(
    page.getByRole("heading", { name: "Teams", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Atlas", exact: true }).click();
  await assertTeam("Atlas", 3);

  const unknownId = `missing-${Math.random().toString(36).slice(2)}`;
  await page.goto(`${origin}/teams/${unknownId}`);
  await expect(
    page.getByRole("heading", { name: "Team not found", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Teams", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Atlas", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Borealis", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Home", exact: true }),
  ).toBeVisible();
}
