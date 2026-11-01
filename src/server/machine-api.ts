import type { AuthClient } from "../client.js";
import { ERR } from "../errors.js";
import { BillingApi } from "./billing.js";
import { ConsumptionApi } from "./consumption.js";
import { JsonHttp } from "../http.js";
import { MachineTokenProvider } from "./machine-tokens.js";

type MachineAuth = Pick<AuthClient, "clientCredentials" | "config" | "fetch">;

/**
 * The auth-service REST API as the application's backend: every call carries a
 * `client_credentials` token minted from the application's own secret. The
 * scopes `billing:read`, `consumption:read` and `consumption:write` must be
 * granted to the application by a superadmin.
 */
export class MachineApi {
  readonly billing: BillingApi;
  readonly consumption: ConsumptionApi;

  constructor(auth: MachineAuth) {
    if (!auth.config.clientSecret) {
      throw ERR.CFG_001("The machine API requires a confidential client");
    }
    const http = new JsonHttp({
      baseUrl: auth.config.issuer,
      fetch: auth.fetch,
      timeoutMs: auth.config.timeoutMs,
      tokens: new MachineTokenProvider(auth),
    });
    this.billing = new BillingApi(http);
    this.consumption = new ConsumptionApi(http);
  }
}

export function createMachineApi(auth: MachineAuth): MachineApi {
  return new MachineApi(auth);
}
