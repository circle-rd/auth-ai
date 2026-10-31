import type { AuthClient } from "../client.js";
import { ERR } from "../errors.js";
import { BillingApi } from "./billing.js";
import { ConsumptionApi } from "./consumption.js";
import { ApiHttp } from "./http.js";
import { MachineTokenProvider } from "./machine-tokens.js";
import { WalletInternalApi } from "./wallet-internal.js";

export interface MachineApiOptions {
  /** UUID of the application, shown in the admin interface: required by the consumption API. */
  readonly applicationId?: string;
}

/**
 * The auth-service REST API as the application's backend: every call carries a
 * `client_credentials` token minted from the application's own secret.
 */
export class MachineApi {
  readonly billing: BillingApi;
  readonly wallet: WalletInternalApi;
  readonly #http: ApiHttp;
  readonly #applicationId: string | undefined;
  #consumption: ConsumptionApi | undefined;

  constructor(
    auth: Pick<AuthClient, "clientCredentials" | "config" | "fetch">,
    options: MachineApiOptions = {},
  ) {
    if (!auth.config.clientSecret) {
      throw ERR.CFG_001("The machine API requires a confidential client");
    }
    this.#http = new ApiHttp(auth, new MachineTokenProvider(auth));
    this.#applicationId = options.applicationId;
    this.billing = new BillingApi(this.#http);
    this.wallet = new WalletInternalApi(this.#http);
  }

  get consumption(): ConsumptionApi {
    if (!this.#applicationId) {
      throw ERR.CFG_001("The consumption API requires `applicationId`");
    }
    this.#consumption ??= new ConsumptionApi(this.#http, this.#applicationId);
    return this.#consumption;
  }
}

export function createMachineApi(
  auth: Pick<AuthClient, "clientCredentials" | "config" | "fetch">,
  options: MachineApiOptions = {},
): MachineApi {
  return new MachineApi(auth, options);
}
