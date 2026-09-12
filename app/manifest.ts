import type { MetadataRoute } from "next";
import { siteIdentity } from "@/lib/config/site-identity";

/**
 * The web app manifest, served at `/manifest.webmanifest`.
 *
 * It existed nowhere before this, which meant a request for it returned the
 * app's 404 page. A manifest is the one machine-readable place a web app
 * names itself, its icon and the origin it belongs to, and it is read both by
 * the browser (install prompts, home-screen label) and by the automated
 * reviewers that decide whether a signing surface is what it claims to be.
 *
 * `id` and `start_url` are the load-bearing fields. `id` is the app's stable
 * identity and is pinned to the configured origin rather than left to default
 * to the request URL, so the identity does not change with the host that
 * served the response. Both are absolute for the same reason the canonical
 * URL is: they must name the operator's configured origin.
 */
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  const { origin } = siteIdentity;

  return {
    id: `${origin}/`,
    name: siteIdentity.name,
    short_name: siteIdentity.shortName,
    description: siteIdentity.description,
    start_url: `${origin}/`,
    scope: `${origin}/`,
    display: "standalone",
    theme_color: siteIdentity.themeColor,
    background_color: siteIdentity.backgroundColor,
    icons: [
      {
        src: siteIdentity.iconPath,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
