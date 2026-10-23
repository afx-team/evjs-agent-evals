export async function verify({
  page,
  origin,
  expect,
  inspection,
  sourceFiles,
}) {
  for (const echo of ["", `请求 / & ? ${crypto.randomUUID()}`]) {
    const response = await fetch(
      `${origin}/health?echo=${encodeURIComponent(echo)}`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, echo });
  }
  for (const [id, name] of [
    ["alice", "Alice"],
    ["bob", "Bob"],
  ]) {
    const response = await fetch(`${origin}/users/${id}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id, name });
  }
  const missingId = `missing-${crypto.randomUUID()}`;
  const missing = await fetch(`${origin}/users/${missingId}`);
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({
    error: "User not found",
    id: missingId,
  });

  for (const path of [
    "/api/health",
    "/api/users/alice",
    "/endpoints/health",
    "/users/users-store",
  ]) {
    const response = await fetch(`${origin}${path}`);
    if (response.headers.get("content-type")?.includes("application/json")) {
      expect(response.status).toBe(404);
    }
  }
  const options = await fetch(`${origin}/health`, { method: "OPTIONS" });
  expect(options.status).toBe(204);
  expect(
    options.headers
      .get("allow")
      .split(",")
      .map((method) => method.trim())
      .sort(),
  ).toEqual(["GET", "HEAD", "OPTIONS"]);
  const paths = sourceFiles();
  expect(paths.some((path) => path.startsWith("src/endpoints/"))).toBe(false);
  expect(
    inspection.graph.serverRoutes
      .map((route) => route.path.replace(/:[^/]+/g, ":param"))
      .sort(),
  ).toEqual(["/health", "/users/:param"]);
  for (const route of inspection.graph.serverRoutes) {
    expect(route.module).toMatch(/(?:^|\/)src\/apis\/.+\/api\.[jt]sx?$/);
    expect(route.methods).toEqual(["GET"]);
  }
  await page.goto(origin);
  await expect(
    page.getByRole("heading", { name: "EVJS eval", exact: true }),
  ).toBeVisible();
}
