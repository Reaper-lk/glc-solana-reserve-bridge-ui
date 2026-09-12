import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NetworkAnnouncement } from "@/components/layout/NetworkAnnouncement";
import { BridgeStatusBar } from "@/components/layout/BridgeStatusBar";
import {
  ANNOUNCEMENT_STATUS_DESCRIPTION,
  ANNOUNCEMENT_STATUS_LABEL,
  NETWORK_ANNOUNCEMENT,
  networkAnnouncementStatus,
  type NetworkAnnouncement as NetworkAnnouncementConfig,
  type NetworkAnnouncementStatus,
} from "@/lib/config/announcement";
import * as fixtures from "@/lib/api/mock/fixtures";
import type { ChainsViewDto } from "@/lib/api/schemas/chains";
import type { BridgeStatusDto } from "@/lib/api/schemas/status";
import { renderWithQueryClient } from "./test-utils";

/**
 * The integration strip's contract.
 *
 * The strip used to be a pure constant announcing a future integration,
 * and its tests pinned that isolation: it rendered identically whatever
 * the bridge was doing. That property was correct while the routes did not
 * exist and became the defect once they did — the strip went on saying
 * "COMING SOON … launches next week" about machinery that had shipped.
 *
 * So the contract is inverted here, and the cases below are the inversion:
 * the badge and the line of copy track `GET /chains`, an unanswered read
 * is `unknown` rather than available, and no launch language survives in
 * any state the strip can reach.
 */

const config = NETWORK_ANNOUNCEMENT;

const getChains = vi.fn();
const getStatus = vi.fn();

vi.mock("@/lib/api", async () => ({
  // The real error factories: BridgeForm imports them by name, and a
  // partial mock of this module would leave them undefined.
  ...(await import("@/lib/api/errors")),
  bridgeApi: {
    getChains: (...args: unknown[]) => getChains(...args),
    getStatus: (...args: unknown[]) => getStatus(...args),
  },
}));

const now = () => new Date();

function status(overrides: Partial<BridgeStatusDto> = {}): BridgeStatusDto {
  return { ...fixtures.statusFixture(now), ...overrides };
}

beforeEach(() => {
  vi.resetAllMocks();
  getChains.mockResolvedValue(fixtures.chainsFixture(now));
  getStatus.mockResolvedValue(status());
});

/** The strip is a session-scoped dismissal, so the store must not leak. */
afterEach(() => {
  window.sessionStorage.clear();
});

const banner = () => screen.getByRole("region", { name: "Network announcement" });

/** Waits for `/chains` to land, so a case never asserts the `unknown` placeholder. */
async function settled(label: string) {
  return within(banner()).findByText(label);
}

describe("rendering", () => {
  it("renders the resolved status as text, not as colour alone", async () => {
    renderWithQueryClient(<NetworkAnnouncement />);
    // Both Robinhood routes ship closed, so the honest badge is
    // "Unavailable" — never a promise about when they open.
    expect(await settled(ANNOUNCEMENT_STATUS_LABEL.unavailable)).toBeInTheDocument();
  });

  it("renders the configured title as the section's heading", () => {
    renderWithQueryClient(<NetworkAnnouncement />);
    expect(
      screen.getByRole("heading", { name: config.title, level: 2 }),
    ).toBeInTheDocument();
    expect(banner()).toHaveAccessibleName("Network announcement");
  });

  it("renders exactly one line of copy, resolved from the status", async () => {
    renderWithQueryClient(<NetworkAnnouncement />);
    expect(
      await settled(ANNOUNCEMENT_STATUS_DESCRIPTION.unavailable),
    ).toBeInTheDocument();
    expect(within(banner()).getAllByText(/./, { selector: "p" })).toHaveLength(1);
  });

  it("renders nothing at all when the config is disabled", () => {
    const disabled: NetworkAnnouncementConfig = { ...config, enabled: false };
    const { container } = renderWithQueryClient(
      <NetworkAnnouncement announcement={disabled} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("region", { name: "Network announcement" })).toBeNull();
  });
});

describe("no stale launch language survives", () => {
  const STALE = [/coming soon/i, /next week/i, /launch/i, /\bsoon\b/i];

  it("says none of it in any state the strip can reach", async () => {
    for (const chains of [
      fixtures.chainsFixture(now),
      fixtures.chainsFixture(now, { robinhoodOpen: true }),
      fixtures.chainsFixture(now, { robinhoodOpen: true, robinhoodAvailable: false }),
    ]) {
      getChains.mockResolvedValue(chains);
      const view = renderWithQueryClient(<NetworkAnnouncement />);
      await screen.findByRole("heading", { name: config.title, level: 2 });
      const text = banner().textContent;
      for (const pattern of STALE) {
        expect(text, `"${text}" still carries ${pattern}`).not.toMatch(pattern);
      }
      view.unmount();
    }
  });

  it("carries no such wording in the config's own strings either", () => {
    const strings = [
      config.title,
      config.network,
      ...Object.values(ANNOUNCEMENT_STATUS_LABEL),
      ...Object.values(ANNOUNCEMENT_STATUS_DESCRIPTION),
    ];
    for (const value of strings) {
      for (const pattern of STALE) {
        expect(value).not.toMatch(pattern);
      }
    }
  });
});

describe("status derivation from GET /chains", () => {
  const cases: readonly {
    readonly name: string;
    readonly chains: () => ChainsViewDto | undefined;
    readonly expected: NetworkAnnouncementStatus;
  }[] = [
    {
      name: "both routes available",
      chains: () => fixtures.chainsFixture(now, { robinhoodOpen: true }),
      expected: "available",
    },
    {
      name: "both routes closed",
      chains: () => fixtures.chainsFixture(now),
      expected: "unavailable",
    },
    {
      name: "enabled but held shut by the destination reserve",
      chains: () =>
        fixtures.chainsFixture(now, { robinhoodOpen: true, robinhoodAvailable: false }),
      expected: "unavailable",
    },
    {
      name: "one available, one not",
      chains: () => {
        const chains = fixtures.chainsFixture(now, { robinhoodOpen: true });
        return {
          ...chains,
          routes: chains.routes.map((route) =>
            route.id === "RhnToGlc"
              ? { ...route, available: false, unavailable_reason: "closed" }
              : route,
          ),
        };
      },
      expected: "partial",
    },
    { name: "/chains has not answered", chains: () => undefined, expected: "unknown" },
  ];

  for (const { name, chains, expected } of cases) {
    it(`reports ${expected} when ${name}`, () => {
      expect(networkAnnouncementStatus(chains())).toBe(expected);
    });
  }

  it("fails closed when the backend publishes no `available` field", () => {
    // A deployment predating backend PR #76. `enabled: true` is not an
    // answer to "can this be used", and the strip must not read it as one.
    const chains = fixtures.chainsFixture(now, { robinhoodOpen: true });
    const legacy: ChainsViewDto = {
      ...chains,
      routes: chains.routes.map((route) => {
        const { available: _available, unavailable_reason: _reason, ...rest } = route;
        return rest;
      }),
    };
    expect(networkAnnouncementStatus(legacy)).toBe("unavailable");
  });

  it("renders the available badge and copy once the backend opens both routes", async () => {
    getChains.mockResolvedValue(fixtures.chainsFixture(now, { robinhoodOpen: true }));
    renderWithQueryClient(<NetworkAnnouncement />);

    expect(await settled(ANNOUNCEMENT_STATUS_LABEL.available)).toBeInTheDocument();
    expect(
      within(banner()).getByText(ANNOUNCEMENT_STATUS_DESCRIPTION.available),
    ).toBeInTheDocument();
    expect(
      within(banner()).queryByText(ANNOUNCEMENT_STATUS_LABEL.unavailable),
    ).toBeNull();
  });

  it("carries the state in words and an icon, never in colour alone", async () => {
    getChains.mockResolvedValue(fixtures.chainsFixture(now, { robinhoodOpen: true }));
    renderWithQueryClient(<NetworkAnnouncement />);
    const badge = await settled(ANNOUNCEMENT_STATUS_LABEL.available);

    expect(badge.querySelector("svg")).not.toBeNull();
    expect(badge.className).toContain("success");
  });

  it("has a label and a line of copy for every status the union can hold", () => {
    const all: readonly NetworkAnnouncementStatus[] = [
      "available",
      "partial",
      "unavailable",
      "unknown",
    ];
    for (const value of all) {
      expect(ANNOUNCEMENT_STATUS_LABEL[value]).toBeTruthy();
      expect(ANNOUNCEMENT_STATUS_DESCRIPTION[value]).toBeTruthy();
    }
  });
});

describe("artwork", () => {
  it("uses the mascot on the left and the Robinhood mark on the right", () => {
    renderWithQueryClient(<NetworkAnnouncement />);
    const sources = [...banner().querySelectorAll("img")].map((img) =>
      // next/image rewrites the attribute through its loader in some
      // configurations, so match on the underlying file rather than on an
      // exact src string.
      decodeURIComponent(img.getAttribute("src") ?? ""),
    );

    expect(sources.some((src) => src.includes("/branding/goldcoin-mascot.png"))).toBe(
      true,
    );
    expect(sources.some((src) => src.includes("/brands/robinhood-mark.png"))).toBe(true);
  });

  it("keeps both images decorative, so neither is announced", () => {
    renderWithQueryClient(<NetworkAnnouncement />);
    // An empty alt plus aria-hidden: the heading already names the network,
    // and the mascot carries no information the text does not.
    expect(within(banner()).queryAllByRole("img")).toHaveLength(0);
    for (const img of banner().querySelectorAll("img")) {
      expect(img).toHaveAttribute("alt", "");
      expect(img).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("sets no width or height class that could distort either image", () => {
    renderWithQueryClient(<NetworkAnnouncement />);
    for (const img of banner().querySelectorAll("img")) {
      // Height is driven; width follows the intrinsic ratio.
      expect(img.className).toContain("w-auto");
    }
  });
});

describe("controls", () => {
  it("offers no call to action — there is no page to open", () => {
    renderWithQueryClient(<NetworkAnnouncement />);
    expect(
      within(banner()).queryByRole("button", { name: /learn more/i }),
    ).not.toBeInTheDocument();
  });

  it("leaves dismissal as the strip's only control, disabled or otherwise", () => {
    renderWithQueryClient(<NetworkAnnouncement />);

    // A disabled button is still exposed to assistive technology, so this
    // catches a dead control being left behind as well as a live one.
    const controls = within(banner()).getAllByRole("button");
    expect(controls).toHaveLength(1);
    expect(controls[0]).toHaveAccessibleName(
      `Dismiss the ${config.network} announcement`,
    );
  });

  it("renders no links whatsoever — a dead route is worse than no link", () => {
    renderWithQueryClient(<NetworkAnnouncement />);
    expect(within(banner()).queryAllByRole("link")).toHaveLength(0);
    expect(banner().querySelectorAll("a")).toHaveLength(0);
  });
});

describe("dismissal", () => {
  it("hides the strip when the labelled close button is pressed", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<NetworkAnnouncement />);

    await user.click(
      within(banner()).getByRole("button", {
        name: `Dismiss the ${config.network} announcement`,
      }),
    );

    expect(screen.queryByRole("region", { name: "Network announcement" })).toBeNull();
  });

  it("stays hidden for the rest of the browser session", async () => {
    const user = userEvent.setup();
    const first = renderWithQueryClient(<NetworkAnnouncement />);
    await user.click(
      screen.getByRole("button", { name: `Dismiss the ${config.network} announcement` }),
    );
    first.unmount();

    renderWithQueryClient(<NetworkAnnouncement />);
    expect(screen.queryByRole("region", { name: "Network announcement" })).toBeNull();
  });

  it("still renders when session storage is unavailable", () => {
    const original = window.sessionStorage.getItem;
    window.sessionStorage.getItem = () => {
      throw new Error("storage disabled");
    };
    try {
      renderWithQueryClient(<NetworkAnnouncement />);
      expect(banner()).toBeInTheDocument();
    } finally {
      window.sessionStorage.getItem = original;
    }
  });
});

describe("beside the global trust strip", () => {
  it("stays a separate landmark, scoped to one network", async () => {
    getChains.mockResolvedValue(fixtures.chainsFixture(now, { robinhoodOpen: true }));
    renderWithQueryClient(
      <>
        <BridgeStatusBar initialStatus={status()} />
        <NetworkAnnouncement />
      </>,
    );

    // The bridge-wide strip counts every executable route — all six; the
    // integration strip speaks only for the four touching Robinhood.
    // Neither is the other.
    expect(await screen.findByText("6 of 6 routes available.")).toBeInTheDocument();
    expect(
      within(banner()).getByText(ANNOUNCEMENT_STATUS_LABEL.available),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View status" })).toHaveAttribute(
      "href",
      "/status",
    );
  });

  it("does not track the bridge-wide status snapshot", async () => {
    // A Solana-side pause is not a statement about Robinhood's routes, and
    // this strip must not repeat it. `/chains` is the only input.
    getChains.mockResolvedValue(fixtures.chainsFixture(now, { robinhoodOpen: true }));
    getStatus.mockResolvedValue(fixtures.pausedStatusFixture());
    renderWithQueryClient(
      <>
        <BridgeStatusBar initialStatus={fixtures.pausedStatusFixture()} />
        <NetworkAnnouncement />
      </>,
    );

    expect(
      await within(banner()).findByText(ANNOUNCEMENT_STATUS_LABEL.available),
    ).toBeInTheDocument();
  });
});
