import type { MetadataRoute } from "next";
import { siteIdentity } from "@/lib/config/site-identity";

/**
 * `/robots.txt`.
 *
 * The layout has always declared `robots: { index: true, follow: true }`, but
 * the file itself 404'd — so every crawler and every reputation scanner that
 * asks for it first got the 404 page instead of a statement. This makes the
 * existing intent explicit and names the canonical host alongside it.
 *
 * `/admin` is disallowed from indexing. That is an indexing preference and
 * nothing more: the operator-only reserve funding page is gated by its own
 * checks, and a `robots.txt` entry has never been access control.
 */
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: "/admin" }],
    host: siteIdentity.origin,
  };
}
