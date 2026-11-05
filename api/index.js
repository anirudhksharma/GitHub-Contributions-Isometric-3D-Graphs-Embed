// Vercel function entry point. vercel.json rewrites every path here, passing
// the requested path as the __path query parameter, since the function itself
// sees the rewrite destination (/api) as its URL. Restore the original URL so
// the handler routes the same as the standalone server.
import handleRequest from "../server.js";

export default function handler(req, res) {
  const url = new URL(req.url, "http://localhost");
  const path = url.searchParams.get("__path");
  if (path !== null) {
    url.searchParams.delete("__path");
    req.url = `/${path}${url.search}`;
  }
  return handleRequest(req, res);
}
