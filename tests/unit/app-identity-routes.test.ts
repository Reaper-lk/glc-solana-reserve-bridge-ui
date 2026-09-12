import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/manifest.webmanifest` and `/robots.txt` both 404'd before this: the
 * manifest did not exist, and `robots.txt` was never served despite the
 * layout declaring `robots: { index: true, follow: true }`. Both are read by
 * the automated reviewers that decide what a signing surface is, and the
 * failure that matters in either is naming an origin the operator never
 * configured.
 */

const envState = { appUrl: "https://bridge.example.test/" };

vi.mock("@/lib/config/env", () => ({ env: envState }));

async function loadRoutes() {
  // Re-imported per test: `siteIdentity` resolves `env.appUrl` once at
  // module scope, exactly as it does in a running deployment.
  vi.resetModules();
  const [{ default: manifest }, { default: robots }] = await Promise.all([
    import("../../app/manifest"),
    import("../../app/robots"),
  ]);
  return { manifest, robots };
}

beforeEach(() => {
  envState.appUrl = "https://bridge.example.test/";
});

describe("web app manifest", () => {
  it("pins id, start_url and scope to the configured origin", async () => {
    const { manifest } = await loadRoutes();
    const m = manifest();

    // `id` is the app's stable identity. Left to default it would follow
    // whichever host served the response, so the same app served from two
    // hosts would be two apps.
    expect(m.id).toBe("https://bridge.example.test/");
    expect(m.start_url).toBe("https://bridge.example.test/");
    expect(m.scope).toBe("https://bridge.example.test/");
  });

  it("follows a change of configured origin rather than carrying a baked-in domain", async () => {
    envState.appUrl = "https://other.example.test";
    const { manifest } = await loadRoutes();
    const m = manifest();

    expect(m.id).toBe("https://other.example.test/");
    expect(m.start_url).toBe("https://other.example.test/");
  });

  it("names the app and ships a same-origin 512px PNG icon", async () => {
    const { manifest } = await loadRoutes();
    const m = manifest();

    expect(m.name).toBe("Goldcoin Reserve Bridge");
    expect(m.short_name).toBe("GLC Bridge");
    expect(m.icons).toHaveLength(1);
    expect(m.icons?.[0]).toMatchObject({
      src: "/icon.png",
      sizes: "512x512",
      type: "image/png",
    });
  });

  it("references no third-party origin anywhere", async () => {
    const { manifest } = await loadRoutes();
    const serialised = JSON.stringify(manifest());
    const origins = [...serialised.matchAll(/https?:\/\/[^"/]+/g)].map((m) => m[0]);

    expect(new Set(origins)).toEqual(new Set(["https://bridge.example.test"]));
  });
});

describe("robots.txt", () => {
  it("allows indexing, matching the layout's declared robots metadata", async () => {
    const { robots } = await loadRoutes();
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0] : rules;

    expect(rule?.userAgent).toBe("*");
    expect(rule?.allow).toBe("/");
  });

  it("keeps the operator page out of the index", async () => {
    // An indexing preference only. /admin is gated by its own checks;
    // robots.txt has never been access control.
    const { robots } = await loadRoutes();
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0] : rules;

    expect(rule?.disallow).toBe("/admin");
  });

  it("names the configured origin as the canonical host", async () => {
    const { robots } = await loadRoutes();
    expect(robots().host).toBe("https://bridge.example.test");
  });
});
