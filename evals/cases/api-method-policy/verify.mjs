export async function verify({ origin, expect, readSource, sourceFiles }) {
  const request = (path, options = {}) => fetch(`${origin}${path}`, options);
  const checkHeaders = (response, validated = false) => {
    expect(response.headers.get("x-eval-app")).toBe("evjs-eval");
    expect(response.headers.get("x-note-validated")).toBe(
      validated ? "true" : null,
    );
  };
  const before = await request("/api/notes");
  expect(before.status).toBe(200);
  checkHeaders(before);
  const initial = await before.json();
  expect(initial).toContainEqual({ id: "welcome", title: "欢迎" });

  for (const writer of [undefined, "disabled"]) {
    const denied = await request("/api/notes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(writer ? { "x-writer": writer } : {}),
      },
      body: JSON.stringify({ title: "must not exist" }),
    });
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: "Writer access required" });
    checkHeaders(denied);
  }

  for (const body of [
    "{bad-json",
    "{}",
    "null",
    JSON.stringify({ title: "  " }),
    JSON.stringify({ title: 7 }),
  ]) {
    const invalid = await request("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json", "x-writer": "enabled" },
      body,
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: "A non-empty title is required",
    });
    checkHeaders(invalid);
  }

  const title = `便签-${crypto.randomUUID()}`;
  const created = await request("/api/notes", {
    method: "POST",
    headers: { "content-type": "application/json", "x-writer": "enabled" },
    body: JSON.stringify({ title: `  ${title}  ` }),
  });
  expect(created.status).toBe(201);
  checkHeaders(created, true);
  const note = await created.json();
  expect(note).toEqual({ id: expect.any(String), title });
  expect(note.id.length).toBeGreaterThan(0);

  const after = await request("/api/notes");
  expect(after.status).toBe(200);
  checkHeaders(after);
  const notes = await after.json();
  expect(notes).toHaveLength(initial.length + 1);
  expect(notes).toContainEqual(note);

  const head = await request("/api/notes", { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(await head.text()).toBe("");
  checkHeaders(head);
  for (const [method, status] of [
    ["OPTIONS", 204],
    ["DELETE", 405],
  ]) {
    const response = await request("/api/notes", { method });
    expect(response.status).toBe(status);
    checkHeaders(response);
    expect(
      response.headers
        .get("allow")
        .split(",")
        .map((value) => value.trim())
        .sort(),
    ).toEqual(["GET", "HEAD", "OPTIONS", "POST"]);
    if (method === "OPTIONS") expect(await response.text()).toBe("");
  }
  const health = await request("/api/health");
  expect(health.status).toBe(200);
  expect(await health.json()).toEqual({ ok: true });
  checkHeaders(health);

  const authored = sourceFiles()
    .filter((path) => /\.[jt]sx?$/.test(path))
    .map(readSource)
    .join("\n");
  expect(authored).toMatch(/from\s+["']@evjs\/ev\/api["']/);
  expect(authored).toMatch(/\bwithMiddlewares\s*\(/);
}
