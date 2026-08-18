import { execSync } from "node:child_process";

/**
 * Temporary diagnostic: the short git SHA of the checkout this dev server is
 * running from, so a browser showing stale content can be told apart from a
 * genuinely stale server. `execSync` runs once per process (module-level,
 * not per-request) and is a no-op outside development.
 */
export const devBuildSha =
  process.env.NODE_ENV === "development"
    ? (() => {
        try {
          return execSync("git rev-parse --short HEAD", {
            cwd: process.cwd(),
            stdio: ["ignore", "pipe", "ignore"],
          })
            .toString()
            .trim();
        } catch {
          return null;
        }
      })()
    : null;
