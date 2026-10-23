export const GET = (req: Request) => {
  const echo = new URL(req.url).searchParams.get("echo") ?? "";
  return Response.json({ ok: true, echo });
};
