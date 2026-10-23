export async function verify({
  page,
  origin,
  expect,
  inspection,
  sourceFiles,
}) {
  const aboutRoutes = inspection.pageRoutes.filter(
    (route) => route.path === "/about",
  );
  expect(aboutRoutes).toHaveLength(1);
  expect(aboutRoutes[0].module).toMatch(/\/page\.[jt]sx?$/);
  expect(inspection.pageRoutes.some((route) => route.path === "/")).toBe(true);
  expect(
    inspection.pageRoutes.filter((route) =>
      /^\/about\/(?:components|content)(?:\/|$)/.test(route.path),
    ),
  ).toHaveLength(0);

  await page.goto(`${origin}/about`);
  await expect(
    page.getByRole("heading", { name: "About evjs", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Pages can keep their components beside them.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "About evjs", exact: true }),
  ).toBeVisible();

  const marker = `page-colocation-${Math.random()}`;
  await page.evaluate((value) => {
    document.documentElement.dataset.evalMarker = value;
  }, marker);
  await page.getByRole("link", { name: "Home", exact: true }).first().click();
  await expect(page).toHaveURL(`${origin}/`);
  await expect(
    page.getByRole("heading", { name: "EVJS eval", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Welcome to the application.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "About", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/about`);
  await expect(
    page.getByRole("heading", { name: "About evjs", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.dataset.evalMarker),
  ).toBe(marker);
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "EVJS eval", exact: true }),
  ).toBeVisible();

  await page.goto(`${origin}/about/components`);
  await expect(page.getByText(/^(Page )?not found$/i).first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "About evjs", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Pages can keep their components beside them.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await page.goto(`${origin}/`);
  await expect(
    page.getByRole("heading", { name: "EVJS eval", exact: true }),
  ).toBeVisible();

  const files = (await sourceFiles()).map((file) => file.replace(/^src\//, ""));
  expect(files).toContain("pages/about/components/index.tsx");
  expect(files).toContain("pages/about/content.ts");
}
