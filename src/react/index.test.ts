// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserAuth, WalletView } from "../browser/client.js";
import { ERR } from "../errors.js";
import {
  AuthProvider,
  useAuth,
  useEntitlements,
  useModels,
  useUser,
  useWallet,
  useWalletStats,
} from "./index.js";

const user = {
  sub: "u1",
  name: "Ada",
  roles: ["editor"],
  permissions: ["docs.write"],
  features: { maxProjects: 10, beta: false },
};

const wallet: WalletView = {
  balance: 5_000_000n,
  isUnlimited: false,
  canSpend: true,
  currency: "eur",
  topupUrl: "https://idp.test/profile",
};

let auth: {
  [K in keyof BrowserAuth]: ReturnType<typeof vi.fn<BrowserAuth[K]>>;
};

beforeEach(() => {
  auth = {
    getUser: vi.fn<BrowserAuth["getUser"]>().mockResolvedValue(user),
    loginUrl: vi.fn<BrowserAuth["loginUrl"]>(),
    login: vi.fn<BrowserAuth["login"]>(),
    logout: vi.fn<BrowserAuth["logout"]>().mockResolvedValue(),
    getWallet: vi.fn<BrowserAuth["getWallet"]>().mockResolvedValue(wallet),
    getWalletStats: vi.fn<BrowserAuth["getWalletStats"]>(),
    listModels: vi
      .fn<BrowserAuth["listModels"]>()
      .mockResolvedValue([{ id: "gpt-4o-mini" }]),
  };
});

afterEach(cleanup);

const mount = (child: ReactNode, props: { refreshOnFocus?: boolean } = {}) =>
  render(createElement(AuthProvider, { auth, ...props }, child));

function Who(): ReactNode {
  const { status, user: current } = useAuth();
  return createElement(
    "p",
    { "data-testid": "who" },
    `${status}:${current?.name ?? "-"}`,
  );
}

describe("AuthProvider and useAuth", () => {
  it("starts loading, then shows the user", async () => {
    mount(createElement(Who));
    expect(screen.getByTestId("who").textContent).toBe("loading:-");
    await waitFor(() =>
      expect(screen.getByTestId("who").textContent).toBe("authenticated:Ada"),
    );
  });

  it("shows a signed-out user", async () => {
    auth.getUser.mockResolvedValue(null);
    mount(createElement(Who));
    await waitFor(() =>
      expect(screen.getByTestId("who").textContent).toBe("unauthenticated:-"),
    );
  });

  it("exposes login and logout bound to the client", async () => {
    let captured: ReturnType<typeof useAuth> | undefined;
    mount(
      createElement(() => {
        captured = useAuth();
        return null;
      }),
    );
    await waitFor(() => expect(captured?.status).toBe("authenticated"));
    captured?.login("/home");
    await captured?.logout();
    expect(auth.login).toHaveBeenCalledWith("/home");
    expect(auth.logout).toHaveBeenCalledOnce();
  });

  it("re-reads the session when the tab becomes visible", async () => {
    mount(createElement(Who));
    await waitFor(() => expect(auth.getUser).toHaveBeenCalledTimes(1));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(auth.getUser).toHaveBeenCalledTimes(2));
  });

  it("can skip the visibility refresh", async () => {
    mount(createElement(Who), { refreshOnFocus: false });
    await waitFor(() => expect(auth.getUser).toHaveBeenCalledTimes(1));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(auth.getUser).toHaveBeenCalledTimes(1);
  });

  it("fails loudly outside a provider", () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    expect(() => render(createElement(Who))).toThrow("AuthProvider");
    error.mockRestore();
  });
});

describe("useUser and useEntitlements", () => {
  function Gate(): ReactNode {
    const current = useUser();
    const can = useEntitlements();
    return createElement(
      "p",
      { "data-testid": "gate" },
      [
        current?.sub ?? "anon",
        can.hasRole("editor"),
        can.hasRole("admin"),
        can.hasPermission("docs"),
        can.hasPermission("docs", "write"),
        can.hasFeature("maxProjects"),
        can.hasFeature("beta"),
        can.getFeature("maxProjects"),
      ].join(","),
    );
  }

  it("denies everything while signed out, then grants by entitlement", async () => {
    mount(createElement(Gate));
    expect(screen.getByTestId("gate").textContent).toBe(
      "anon,false,false,false,false,false,false,",
    );
    await waitFor(() =>
      expect(screen.getByTestId("gate").textContent).toBe(
        "u1,true,false,true,true,true,false,10",
      ),
    );
  });
});

describe("useWallet", () => {
  function Balance({ poll }: { poll?: number }): ReactNode {
    const { status, data, refresh } = useWallet(
      poll === undefined ? {} : { pollIntervalMs: poll },
    );
    return createElement(
      "button",
      { "data-testid": "wallet", onClick: () => void refresh() },
      `${status}:${data?.canSpend ?? "-"}`,
    );
  }

  it("loads the wallet and refreshes on demand", async () => {
    mount(createElement(Balance));
    await waitFor(() =>
      expect(screen.getByTestId("wallet").textContent).toBe("ready:true"),
    );
    await act(async () => screen.getByTestId("wallet").click());
    await waitFor(() => expect(auth.getWallet).toHaveBeenCalledTimes(2));
  });

  it("polls while mounted and stops after unmount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const view = mount(createElement(Balance, { poll: 1000 }));
      await waitFor(() => expect(auth.getWallet).toHaveBeenCalledTimes(1));
      await act(async () => vi.advanceTimersByTimeAsync(2100));
      expect(auth.getWallet.mock.calls.length).toBeGreaterThanOrEqual(3);
      view.unmount();
      const calls = auth.getWallet.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(auth.getWallet).toHaveBeenCalledTimes(calls);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-reads the session when the API says it ended", async () => {
    auth.getWallet.mockRejectedValue(ERR.SES_001());
    mount(createElement(Balance));
    await waitFor(() =>
      expect(screen.getByTestId("wallet").textContent).toBe("error:-"),
    );
    await waitFor(() =>
      expect(auth.getUser.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
  });
});

describe("useWalletStats and useModels", () => {
  it("reload when the window changes", async () => {
    auth.getWalletStats.mockResolvedValue({ days: 7, total: 1n } as never);
    function Stats({ days }: { days: number }): ReactNode {
      const { data } = useWalletStats(days);
      return createElement(
        "p",
        { "data-testid": "stats" },
        String(data?.days ?? "-"),
      );
    }
    const view = mount(createElement(Stats, { days: 7 }));
    await waitFor(() => expect(auth.getWalletStats).toHaveBeenCalledWith(7));
    auth.getWalletStats.mockResolvedValue({ days: 30, total: 1n } as never);
    view.rerender(
      createElement(AuthProvider, { auth }, createElement(Stats, { days: 30 })),
    );
    await waitFor(() => expect(auth.getWalletStats).toHaveBeenCalledWith(30));
  });

  it("lists the models", async () => {
    function Models(): ReactNode {
      const { data } = useModels();
      return createElement(
        "p",
        { "data-testid": "models" },
        (data ?? []).map((m) => m.id).join(","),
      );
    }
    mount(createElement(Models));
    await waitFor(() =>
      expect(screen.getByTestId("models").textContent).toBe("gpt-4o-mini"),
    );
  });
});
