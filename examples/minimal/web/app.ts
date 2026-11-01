import {
  createAuthStore,
  createBrowserAuth,
  createResourceStore,
  formatEuros,
  hasFeature,
} from "@circle-rd/auth-ai/client";
import type { AuthState } from "@circle-rd/auth-ai/client";

const auth = createBrowserAuth();
const authStore = createAuthStore(auth);

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found as T;
}

const show = (id: string, value: unknown): void => {
  element(id).textContent =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
};

/** Same-origin JSON call; the session cookie is the only credential. */
async function api(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    credentials: "same-origin",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data: unknown = await response.json().catch(() => undefined);
  return response.ok ? data : { status: response.status, ...(data as object) };
}

const wallet = createResourceStore(() => auth.getWallet(), {
  pollIntervalMs: 15_000,
});
wallet.state.subscribe(() => {
  const { status, data, error } = wallet.state.get();
  if (error) show("wallet", `${status}: ${error.code} ${error.message}`);
  else if (data) {
    show(
      "wallet",
      `${formatEuros(data.balance, 4)} € · canSpend=${data.canSpend}`,
    );
    element<HTMLAnchorElement>("topup").href = data.topupUrl;
  }
});

function render({ status, user, error }: AuthState): void {
  const bar = element("session");
  bar.replaceChildren();
  element("app").hidden = status !== "authenticated";
  if (status === "authenticated" && user) {
    const out = document.createElement("button");
    out.textContent = `Sign out ${user.name ?? user.email ?? user.sub}`;
    out.addEventListener("click", () => void auth.logout());
    bar.append(out);
    show("user", {
      ...user,
      canUseBeta: hasFeature(user, "beta"),
    });
  } else {
    const inButton = document.createElement("button");
    inButton.textContent =
      status === "loading" ? "Loading…" : error ? "Retry sign in" : "Sign in";
    inButton.addEventListener("click", () => auth.login("/"));
    bar.append(inButton);
    if (error) bar.append(` ${error.code}: ${error.message}`);
  }
}

let started = false;
authStore.state.subscribe(() => {
  const state = authStore.state.get();
  render(state);
  if (state.status === "authenticated" && !started) {
    started = true;
    wallet.start();
    void load();
  }
});
render(authStore.state.get());
void authStore.refresh();

async function load(): Promise<void> {
  const gateway = (await api("/api/gateway")) as {
    models?: { ok: boolean; data?: { id: string }[] };
  };
  show("gateway", gateway);
  const select = element<HTMLSelectElement>("chat-model");
  for (const model of gateway.models?.data ?? []) {
    select.add(new Option(model.id, model.id));
  }
}

element<HTMLFormElement>("chat").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget as HTMLFormElement);
  show("chat-out", "…");
  void api("/api/chat", {
    model: form.get("model"),
    message: form.get("message"),
  }).then((answer) => {
    show("chat-out", answer);
    void wallet.refresh();
  });
});

element("embed").addEventListener("click", () => {
  const model = element<HTMLSelectElement>("chat-model");
  const embedding = [...model.options].find((o) => /embed/i.test(o.value));
  show("embed-out", "…");
  void api("/api/embed", {
    model: embedding?.value ?? "perplexity/pplx-embed-v1-0.6b",
    input: "The quick brown fox",
  }).then((answer) => {
    show("embed-out", answer);
    setTimeout(() => void wallet.refresh(), 6_000);
  });
});

element("consume").addEventListener("click", () => {
  void api("/api/consume", { key: "test.calls", value: 1 }).then((answer) =>
    show("consume-out", answer),
  );
});

element("selftest").addEventListener("click", () => {
  show("selftest-out", "Running (up to a minute)…");
  void api("/api/selftest", {}).then((answer) => {
    show("selftest-out", answer);
    void wallet.refresh();
  });
});
