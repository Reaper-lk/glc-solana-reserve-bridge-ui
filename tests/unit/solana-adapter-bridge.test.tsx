import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { WalletReadyState } from "@solana/wallet-adapter-base";

const adapterState = {
  wallets: [] as Array<{
    adapter: { name: string; icon: string; connect: () => Promise<void> };
    readyState: WalletReadyState;
  }>,
  wallet: null as null | {
    adapter: { name: string; icon: string };
    readyState: WalletReadyState;
  },
  publicKey: null as null | { toBase58: () => string },
  connecting: false,
  disconnecting: false,
  connected: false,
  signTransaction: undefined as undefined | (() => void),
  select: vi.fn(),
  disconnect: vi.fn(),
};

vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => adapterState,
}));

const runtimeState = {
  configured: true,
  failure: null as null | { code: string },
  setFailure: vi.fn(),
};

vi.mock("@/lib/solana/adapter/provider", () => ({
  useWalletRuntime: () => runtimeState,
}));

import { useWalletConnectionBridge } from "@/lib/solana/adapter/bridge";

function resetAdapterState() {
  adapterState.wallets = [];
  adapterState.wallet = null;
  adapterState.publicKey = null;
  adapterState.connecting = false;
  adapterState.disconnecting = false;
  adapterState.connected = false;
  adapterState.signTransaction = undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAdapterState();
  runtimeState.configured = true;
  runtimeState.failure = null;
});

describe("useWalletConnectionBridge — status derivation", () => {
  it("reports unconfigured when no RPC endpoint is set, before mount is even relevant", () => {
    runtimeState.configured = false;
    const { result } = renderHook(() => useWalletConnectionBridge());
    expect(result.current.status).toBe("unconfigured");
    // Advertised wallets still list (as not-installed) so a visitor can
    // discover what to install even before an RPC endpoint is configured;
    // none of them can be detected as actually present without hydration.
    expect(result.current.wallets.every((w) => !w.installed)).toBe(true);
  });

  it("reports disconnected once configured and mounted with no active wallet", () => {
    const { result } = renderHook(() => useWalletConnectionBridge());
    expect(result.current.status).toBe("disconnected");
  });

  it("reports connecting while the adapter is connecting", () => {
    adapterState.connecting = true;
    const { result } = renderHook(() => useWalletConnectionBridge());
    expect(result.current.status).toBe("connecting");
  });

  it("reports disconnecting while the adapter is disconnecting", () => {
    adapterState.disconnecting = true;
    const { result } = renderHook(() => useWalletConnectionBridge());
    expect(result.current.status).toBe("disconnecting");
  });

  it("reports connected when the adapter is connected", () => {
    adapterState.connected = true;
    const { result } = renderHook(() => useWalletConnectionBridge());
    expect(result.current.status).toBe("connected");
  });
});

describe("useWalletConnectionBridge — address and canSign", () => {
  it("exposes the address as a base58 string, never a PublicKey", () => {
    adapterState.connected = true;
    adapterState.publicKey = {
      toBase58: () => "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    };
    const { result } = renderHook(() => useWalletConnectionBridge());
    expect(result.current.address).toBe("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
  });

  it("address is null when unconfigured even if the adapter has a stale publicKey", () => {
    runtimeState.configured = false;
    adapterState.publicKey = { toBase58: () => "should-not-appear" };
    const { result } = renderHook(() => useWalletConnectionBridge());
    expect(result.current.address).toBeNull();
  });

  it("canSign is true only when connected with a signTransaction capability", () => {
    adapterState.connected = true;
    adapterState.signTransaction = () => undefined;
    const { result } = renderHook(() => useWalletConnectionBridge());
    expect(result.current.canSign).toBe(true);
  });

  it("canSign is false when connected but signTransaction is unavailable", () => {
    adapterState.connected = true;
    const { result } = renderHook(() => useWalletConnectionBridge());
    expect(result.current.canSign).toBe(false);
  });
});

describe("useWalletConnectionBridge — wallet list", () => {
  it("lists detected wallets first, then advertised undetected ones, installed-first", () => {
    adapterState.wallets = [
      {
        adapter: { name: "Solflare", icon: "solflare-icon", connect: vi.fn() },
        readyState: WalletReadyState.Installed,
      },
    ];
    const { result } = renderHook(() => useWalletConnectionBridge());
    const ids = result.current.wallets.map((w) => w.id);
    expect(ids[0]).toBe("solflare");
    expect(result.current.wallets.find((w) => w.id === "solflare")?.installed).toBe(true);
    // Phantom/Backpack are advertised even though not detected.
    expect(ids).toContain("phantom");
    expect(result.current.wallets.find((w) => w.id === "phantom")?.installed).toBe(false);
  });

  it("reports the connected wallet's descriptor once one is active", () => {
    adapterState.connected = true;
    adapterState.wallet = {
      adapter: { name: "Phantom", icon: "phantom-icon" },
      readyState: WalletReadyState.Installed,
    };
    const { result } = renderHook(() => useWalletConnectionBridge());
    expect(result.current.wallet).toEqual({
      id: "phantom",
      name: "Phantom",
      iconUrl: "phantom-icon",
      installed: true,
      installUrl: "https://phantom.app/download",
    });
  });

  it("reports no connected wallet before one is chosen", () => {
    const { result } = renderHook(() => useWalletConnectionBridge());
    expect(result.current.wallet).toBeNull();
  });
});

describe("useWalletConnectionBridge — connect", () => {
  it("fails with not-installed when the requested wallet id has no match", async () => {
    const { result } = renderHook(() => useWalletConnectionBridge());
    await result.current.connect("nonexistent-wallet");
    expect(runtimeState.setFailure).toHaveBeenCalledWith(
      expect.objectContaining({ code: "not-installed" }),
    );
  });

  it("selects then connects the matching wallet on success", async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    adapterState.wallets = [
      {
        adapter: { name: "Phantom", icon: "i", connect },
        readyState: WalletReadyState.Installed,
      },
    ];
    const { result } = renderHook(() => useWalletConnectionBridge());
    await result.current.connect("phantom");
    expect(adapterState.select).toHaveBeenCalledWith("Phantom");
    expect(connect).toHaveBeenCalled();
  });

  it("records a failure when the adapter's connect() rejects", async () => {
    const connect = vi.fn().mockRejectedValue(new Error("user rejected"));
    adapterState.wallets = [
      {
        adapter: { name: "Phantom", icon: "i", connect },
        readyState: WalletReadyState.Installed,
      },
    ];
    const { result } = renderHook(() => useWalletConnectionBridge());
    await result.current.connect("phantom");
    expect(runtimeState.setFailure).toHaveBeenCalledWith(
      expect.objectContaining({ code: "user-rejected" }),
    );
  });

  it("clears any previous failure before attempting to connect", async () => {
    const { result } = renderHook(() => useWalletConnectionBridge());
    await result.current.connect("nonexistent-wallet");
    expect(runtimeState.setFailure).toHaveBeenNthCalledWith(1, null);
  });
});

describe("useWalletConnectionBridge — disconnect / dismissError", () => {
  it("disconnects the adapter and clears any prior failure first", async () => {
    const { result } = renderHook(() => useWalletConnectionBridge());
    await result.current.disconnect();
    expect(runtimeState.setFailure).toHaveBeenNthCalledWith(1, null);
    expect(adapterState.disconnect).toHaveBeenCalled();
  });

  it("records a failure when disconnect() rejects", async () => {
    adapterState.disconnect.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useWalletConnectionBridge());
    await result.current.disconnect();
    await waitFor(() =>
      expect(runtimeState.setFailure).toHaveBeenLastCalledWith(
        expect.objectContaining({ code: "unknown" }),
      ),
    );
  });

  it("dismissError clears the failure without touching the adapter", () => {
    const { result } = renderHook(() => useWalletConnectionBridge());
    result.current.dismissError();
    expect(runtimeState.setFailure).toHaveBeenCalledWith(null);
    expect(adapterState.disconnect).not.toHaveBeenCalled();
  });
});
