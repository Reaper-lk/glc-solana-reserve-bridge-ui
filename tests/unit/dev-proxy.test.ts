import { describe, expect, it, vi, afterEach } from "vitest";
import { forwardToUpstream } from "@/lib/api/dev-proxy";

const baseRequest = {
  method: "GET",
  path: ["status"],
  search: "",
  headers: new Headers(),
  bodyText: null,
};

describe("forwardToUpstream", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a clear 500 when no upstream is configured, rather than throwing", async () => {
    const result = await forwardToUpstream(null, baseRequest);
    expect(result.status).toBe(500);
    expect(result.bodyText).toContain("NEXT_PUBLIC_BRIDGE_API_PROXY_UPSTREAM_URL");
  });

  it("forwards the method, path, query string and body to the upstream", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await forwardToUpstream("http://127.0.0.1:9999", {
      method: "POST",
      path: ["quote"],
      search: "?a=1",
      headers: new Headers({ "content-type": "application/json" }),
      bodyText: '{"direction":"GlcToSol","gross_amount":1}',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0]!;
    expect(String(calledUrl)).toBe("http://127.0.0.1:9999/quote?a=1");
    expect(calledInit?.method).toBe("POST");
    expect(calledInit?.body).toBe('{"direction":"GlcToSol","gross_amount":1}');
    expect(result.status).toBe(201);
    expect(result.bodyText).toBe('{"ok":true}');
  });

  it("strips a trailing slash from the configured upstream base", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    await forwardToUpstream("http://127.0.0.1:9999/", baseRequest);

    const [calledUrl] = fetchSpy.mock.calls[0]!;
    expect(String(calledUrl)).toBe("http://127.0.0.1:9999/status");
  });

  it("never sends a body for a GET request", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    await forwardToUpstream("http://127.0.0.1:9999", {
      ...baseRequest,
      bodyText: "should be ignored for GET",
    });

    const [, calledInit] = fetchSpy.mock.calls[0]!;
    expect(calledInit?.body).toBeUndefined();
  });

  it("degrades a network failure to a 502 rather than throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connection refused"));

    const result = await forwardToUpstream("http://127.0.0.1:9999", baseRequest);

    expect(result.status).toBe(502);
    expect(result.bodyText).toContain("connection refused");
  });
});
