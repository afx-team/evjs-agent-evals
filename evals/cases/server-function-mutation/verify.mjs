export async function verify({ page, origin, expect, inspection }) {
  const getNotes = inspection.graph.serverFunctions.find(
    (fn) => fn.exportName === "getNotes",
  );
  const createNote = inspection.graph.serverFunctions.find(
    (fn) => fn.exportName === "createNote",
  );
  expect(getNotes).toBeDefined();
  expect(createNote).toBeDefined();
  const isRpc = (response, fnId) =>
    new URL(response.url()).pathname === "/__evjs/fn" &&
    response.request().method() === "POST" &&
    response.request().postDataJSON()?.fnId === fnId;
  const initialRpc = page.waitForResponse((response) =>
    isRpc(response, getNotes.id),
  );
  await page.goto(`${origin}/notes`);
  const firstResponse = await initialRpc;
  expect(firstResponse.status()).toBe(200);
  expect((await firstResponse.json()).result).toContainEqual({
    id: "welcome",
    title: "欢迎",
    body: "第一条便签",
  });
  await expect(
    page.getByRole("heading", { name: "便签", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("欢迎 / 第一条便签", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.__evjsEvalDocumentMarker = "same-document";
  });

  const created = [];
  for (const index of [1, 2]) {
    const title = `标题-${index}-${crypto.randomUUID()}`;
    const body = `内容-${crypto.randomUUID()}`;
    await page.getByLabel("标题", { exact: true }).fill(`  ${title}  `);
    await page.getByLabel("内容", { exact: true }).fill(`  ${body}  `);
    const mutationRpc = page.waitForResponse((response) =>
      isRpc(response, createNote.id),
    );
    await page.getByRole("button", { name: "保存", exact: true }).click();
    const response = await mutationRpc;
    expect(response.status()).toBe(200);
    expect(
      response
        .request()
        .postDataJSON()
        .args.map((value) => value.trim()),
    ).toEqual([title, body]);
    const result = (await response.json()).result;
    expect(result).toEqual({ id: expect.any(String), title, body });
    expect(result.id.length).toBeGreaterThan(0);
    await expect(
      page.getByText(`${title} / ${body}`, { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("标题", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("内容", { exact: true })).toHaveValue("");
    expect(await page.evaluate(() => window.__evjsEvalDocumentMarker)).toBe(
      "same-document",
    );
    created.push(result);
  }

  for (const [title, body] of [
    ["   ", "有效内容"],
    ["有效标题", "   "],
  ]) {
    await page.getByLabel("标题", { exact: true }).fill(title);
    await page.getByLabel("内容", { exact: true }).fill(body);
    const failureRpc = page.waitForResponse((response) =>
      isRpc(response, createNote.id),
    );
    await page.getByRole("button", { name: "保存", exact: true }).click();
    expect((await failureRpc).status()).toBe(400);
    await expect(page.getByRole("alert")).toContainText("标题和内容不能为空");
  }

  const recoveryTitle = `恢复-${crypto.randomUUID()}`;
  await page.getByLabel("标题", { exact: true }).fill(recoveryTitle);
  await page.getByLabel("内容", { exact: true }).fill("恢复后的内容");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByText(`${recoveryTitle} / 恢复后的内容`, { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  const reloadedRpc = page.waitForResponse((response) =>
    isRpc(response, getNotes.id),
  );
  await page.reload();
  const reloaded = await reloadedRpc;
  expect(reloaded.status()).toBe(200);
  const notes = (await reloaded.json()).result;
  expect(notes).toHaveLength(4);
  for (const note of created) {
    expect(notes).toContainEqual(note);
    await expect(
      page.getByText(`${note.title} / ${note.body}`, { exact: true }),
    ).toBeVisible();
  }
  await page.goto(origin);
  await expect(
    page.getByRole("heading", { name: "EVJS eval", exact: true }),
  ).toBeVisible();
}
