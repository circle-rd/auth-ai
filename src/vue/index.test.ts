// @vitest-environment happy-dom
import { createApp, defineComponent, h, nextTick } from "vue";
import type { App } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserAuth, WalletView } from "../browser/client.js";
import { ERR } from "../errors.js";
import {
  createAuthPlugin,
  useAuth,
  useEntitlements,
  useModels,
  useWallet,
} from "./index.js";

const user = {
  sub: "u1",
  name: "Ada",
  roles: ["editor"],
  permissions: ["docs.write"],
  features: { maxProjects: 10 },
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
let mounted: App[];

beforeEach(() => {
  mounted = [];
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

afterEach(() => {
  for (const app of mounted) app.unmount();
  document.body.innerHTML = "";
});

function mount(
  component: ReturnType<typeof defineComponent>,
  install = true,
): HTMLElement {
  const root = document.createElement("div");
  document.body.append(root);
  const app = createApp(component);
  if (install) app.use(createAuthPlugin({ auth }));
  app.mount(root);
  mounted.push(app);
  return root;
}

const settle = async (): Promise<void> => {
  await vi.waitFor(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
};

describe("createAuthPlugin and useAuth", () => {
  const Who = defineComponent({
    setup() {
      const { state, user: current } = useAuth();
      return () =>
        h("p", `${state.value.status}:${current.value?.name ?? "-"}`);
    },
  });

  it("starts loading, then shows the user", async () => {
    const root = mount(Who);
    expect(root.textContent).toBe("loading:-");
    await settle();
    expect(root.textContent).toBe("authenticated:Ada");
  });

  it("shows a signed-out user", async () => {
    auth.getUser.mockResolvedValue(null);
    const root = mount(Who);
    await settle();
    expect(root.textContent).toBe("unauthenticated:-");
  });

  it("binds login and logout to the client", async () => {
    let api: ReturnType<typeof useAuth> | undefined;
    mount(
      defineComponent({
        setup() {
          api = useAuth();
          return () => null;
        },
      }),
    );
    api?.login("/home");
    await api?.logout();
    expect(auth.login).toHaveBeenCalledWith("/home");
    expect(auth.logout).toHaveBeenCalledOnce();
  });

  it("fails loudly without the plugin", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(() => mount(Who, false)).toThrow("createAuthPlugin");
    warn.mockRestore();
  });
});

describe("useEntitlements", () => {
  it("follows the current user", async () => {
    const root = mount(
      defineComponent({
        setup() {
          const can = useEntitlements();
          return () =>
            h(
              "p",
              [
                can.hasRole("editor"),
                can.hasPermission("docs", "write"),
                can.hasFeature("maxProjects"),
                can.getFeature("maxProjects"),
              ].join(","),
            );
        },
      }),
    );
    expect(root.textContent).toBe("false,false,false,");
    await settle();
    expect(root.textContent).toBe("true,true,true,10");
  });
});

describe("useWallet and useModels", () => {
  it("loads the wallet", async () => {
    const root = mount(
      defineComponent({
        setup() {
          const { state } = useWallet();
          return () =>
            h(
              "p",
              `${state.value.status}:${state.value.data?.canSpend ?? "-"}`,
            );
        },
      }),
    );
    await settle();
    expect(root.textContent).toBe("ready:true");
  });

  it("stops polling when the component unmounts", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mount(
        defineComponent({
          setup() {
            useWallet({ pollIntervalMs: 1000 });
            return () => null;
          },
        }),
      );
      await vi.advanceTimersByTimeAsync(2100);
      expect(auth.getWallet.mock.calls.length).toBeGreaterThanOrEqual(3);
      const app = mounted.pop();
      app?.unmount();
      const calls = auth.getWallet.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(auth.getWallet).toHaveBeenCalledTimes(calls);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-reads the session when the API says it ended", async () => {
    auth.getWallet.mockRejectedValue(ERR.SES_001());
    mount(
      defineComponent({
        setup() {
          useWallet();
          return () => null;
        },
      }),
    );
    await settle();
    expect(auth.getUser.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("lists the models", async () => {
    const root = mount(
      defineComponent({
        setup() {
          const { state } = useModels();
          return () =>
            h("p", (state.value.data ?? []).map((m) => m.id).join(","));
        },
      }),
    );
    await settle();
    expect(root.textContent).toBe("gpt-4o-mini");
  });
});
