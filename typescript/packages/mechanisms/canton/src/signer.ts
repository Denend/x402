/**
 * Injected ledger-access interfaces. The mechanism package carries the
 * PROTOCOL logic (payload codec, verify-before-sign, structural verify, settle
 * shape); all access to a Canton participant / Scan / registry is supplied by
 * the integrator through these interfaces. The facilitator side needs only the
 * participant: verify reads everything else from the signed transaction. This keeps `@x402/canton` free of any
 * specific ledger client and free of operational concerns (rate-limits,
 * attribution, workers) that belong to a facilitator deployment, not the scheme.
 *
 * Mirrors the SVM mechanism's `ClientSvmSigner` / `FacilitatorSvmSigner` split.
 */

/** Result of relaying the payer-signed transaction (ExecuteSubmission). */
export interface ExecuteResult {
  /** Canton updateId of the committed transaction. */
  updateId: string;
  /** Whether funds actually moved to the merchant (committed-zero-funds → false). */
  transferred: boolean;
  /** True when the funds-moved read could not be confirmed either way. */
  confirmInconclusive?: boolean;
}

/**
 * Client-side signer: the payer's self-custody key plus participant access to
 * resolve the transfer factory and interactive-prepare the transaction. The
 * client scheme verifies the returned bytes (verify-before-sign), then hands
 * THOSE EXACT bytes to `signPrepared`, which recomputes the hash from them and
 * signs it — so the payer never signs a hash it did not derive from a validated
 * transaction. This closes the "lying relay" hash-substitution attack: a relay
 * that returns honest bytes alongside the hash of a different, draining
 * transaction cannot get the payer's signature over that other hash.
 */
export interface ClientCantonSigner {
  /** The payer party this signer acts as. */
  readonly party: string;
  /**
   * Resolve the transfer factory and interactive-prepare a
   * `TransferFactory_Transfer` (sender = this party, receiver = payTo). Returns
   * the prepared transaction (base64). The hash is NOT returned here — it is
   * derived from these bytes inside `signPrepared`, so the value the payer signs
   * is bound to the bytes the client validated.
   */
  prepareTransfer(input: {
    receiver: string;
    /** Ledger Decimal amount string, e.g. "0.2500000000". */
    amount: string;
    instrumentId: { admin: string; id: string };
    executeBeforeSeconds: number;
    /** Optional `x402.memo` meta to stamp into the transfer. */
    memo?: string;
  }): Promise<{ preparedTransaction: string }>;
  /**
   * Recompute the Canton hash FROM these exact prepared-transaction bytes and
   * Ed25519-sign it with the payer's key. The hash MUST be derived from the
   * bytes passed in (never a relay-supplied value) — this is the hash binding
   * that protects the payer from a lying relay.
   *
   * @param preparedTransaction - The base64 prepared transaction the client validated.
   * @returns The hex hash actually signed, the base64 signature, and the hashing scheme.
   */
  signPrepared(preparedTransaction: string): Promise<{
    preparedTxHashHex: string;
    signatureB64: string;
    hashingSchemeVersion?: "HASHING_SCHEME_VERSION_V1" | "HASHING_SCHEME_VERSION_V2";
  }>;
}

/**
 * Facilitator-side signer + ledger capabilities. `verify` checks the payer's
 * signature; `settle` additionally relays via `executeSubmission`.
 */
export interface FacilitatorCantonSigner {
  /** Facilitator parties this deployment relays as (the `feePayer`). */
  getAddresses(): readonly string[];
  /**
   * Recompute the Canton hash from the prepared bytes, check it equals the
   * claimed hash, and verify the Ed25519 signature against the payer over it.
   */
  verifySignature(args: {
    preparedTransactionBytes: Buffer;
    claimedPreparedTxHash: string;
    signatureB64: string;
    payer: string;
    hashingSchemeVersion: string;
  }): Promise<{
    verified: boolean;
    preparedTxHashHex?: string;
    publishedProtocolKeys?: number;
  }>;
  /** Relay the payer-signed transaction (ExecuteSubmission). Settle only. */
  executeSubmission(args: {
    preparedTransactionBytes: Buffer;
    signatureB64: string;
    payer: string;
    hashingSchemeVersion: string;
    /** The transfer kind verify decoded from the signed transaction. Selects
     *  the funds-moved signal: `amulet` uses the archived-Amulet check,
     *  `registry` the CIP-56 result-tag signal. */
    transferKind: "amulet" | "registry";
  }): Promise<ExecuteResult>;
}

/** Trust anchors + registry config, supplied out-of-band (never relay-derived). */
export interface CantonSchemeConfig {
  /** Ceiling (seconds) on how far ahead the transfer's executeBefore may sit. */
  maxExecuteBeforeSeconds?: number;
  /** Which merchants this facilitator will burn its own traffic for. */
  merchantPolicy?: "open" | "provider" | "allowlist" | "provider-or-allowlist";
  merchantAllowlist?: readonly string[];
  /**
   * CIP-56 registries this facilitator settles for: registrar (instrument admin)
   * → the registry infrastructure parties trusted to appear in its transfers
   * (e.g. the Registry Utility operator and the token's provider). A registrar
   * absent here is not settled.
   */
  registryTrustedParties?: Record<string, string[]>;
}
