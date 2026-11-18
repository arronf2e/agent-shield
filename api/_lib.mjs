// Shared helpers for the Vercel serverless functions under api/guard/.
// (Files prefixed with _ are not routed as endpoints by Vercel.)
export function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.end(body);
}

export async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

export function guard(handler) {
  return async (req, res) => {
    if (req.method === "OPTIONS") return sendJson(res, 204, {});
    try {
      await handler(req, res);
    } catch (e) {
      sendJson(res, 500, { error: String(e.message || e) });
    }
  };
}
