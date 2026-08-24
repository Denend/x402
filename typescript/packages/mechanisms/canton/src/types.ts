/**
 * Canton-specific x402 types for the `exact` scheme, layered on the base wire
 * types from `@x402/core`.
 *
 * The wire format is the one the merged Canton spec defines
 * (`specs/schemes/exact/scheme_exact_canton.md`): the payer signs a
 * `TransferFactory_Transfer` (CIP-56 Token Standard) and carries it INLINE in
 * the payment payload, so any facilitator can relay it. Canton Coin and any
 * CIP-56 registry token share this exact wire shape and differ only by
 * `extra.instrumentId.admin`.
 */

/** CAIP-2-style Canton network identifier: `canton:<global-synchronizer-id>`. */
export type CantonNetwork = `canton:${string}`;

/**
 * True when a network string is a Canton network (`canton:*`).
 *
 * @param network - The CAIP-2 network identifier to test.
 * @returns Whether the network is a Canton network.
 */
export function isCantonNetwork(network: string): boolean {
  return network.startsWith("canton:");
}

/** The single on-ledger settlement method: a token-standard
 *  `TransferFactory_Transfer` relayed by the facilitator in one transaction. */
export type CantonTransferMethod = "transfer-factory";

/** Canton-specific `extra` block of a 402 PaymentRequirements. Lives inside the
 *  base `PaymentRequirements.extra: Record<string, unknown>`. */
export interface CantonPaymentRequirementsExtra {
  assetTransferMethod: "transfer-factory";
  /** The facilitator party that relays the signed tx and pays the GS traffic. */
  feePayer: string;
  /** The Global Synchronizer the transfer settles on. */
  synchronizerId: string;
  /** `{admin,id}` of the instrument. Canton Coin = `{admin: <DSO>, id: "Amulet"}`;
   *  a CIP-56 registry token = `{admin: <registrar>, id: <symbol>}`. */
  instrumentId: { admin: string; id: string };
  /** Relative deadline (seconds) the client uses to compute the transfer's
   *  absolute `executeBefore`. */
  executeBeforeSeconds: number;
  /** Optional merchant memo, enforced in the signed transfer's `x402.memo` meta. */
  memo?: string;
}

/** INLINE payload — the payer-signed transaction, self-contained. Lives inside
 *  the base `PaymentPayload.payload: Record<string, unknown>`. */
export interface CantonInlinePayload {
  assetTransferMethod: "transfer-factory";
  /** `base64(gzip(prepared TransferFactory_Transfer))`, disclosed contracts embedded. */
  preparedTransaction: string;
  /** Lower-case hex hash of the prepared tx the payer signed. */
  preparedTxHash: string;
  /** Base64 Ed25519 signature over `preparedTxHash`. */
  signature: string;
  /** Canton hashing scheme used for `preparedTxHash`. Defaults to V2. */
  hashingSchemeVersion?: "HASHING_SCHEME_VERSION_V1" | "HASHING_SCHEME_VERSION_V2";
}

/** Canton `exact` error codes (prefix `invalid_exact_canton_*`), mapped onto the
 *  base `VerifyResponse.invalidReason` / `SettleResponse.errorReason`. */
export type CantonErrorCode =
  | "invalid_exact_canton_amount_mismatch"
  | "invalid_exact_canton_asset_mismatch"
  | "invalid_exact_canton_counter_not_ready"
  | "invalid_exact_canton_execute_before_too_far"
  | "invalid_exact_canton_execute_failed"
  | "invalid_exact_canton_expired"
  | "invalid_exact_canton_fee_payer_mismatch"
  | "invalid_exact_canton_holding_locked"
  | "invalid_exact_canton_input_contention"
  | "invalid_exact_canton_instrument_id_mismatch"
  | "invalid_exact_canton_insufficient_balance"
  | "invalid_exact_canton_insufficient_inputs"
  | "invalid_exact_canton_malformed_payload"
  | "invalid_exact_canton_memo_mismatch"
  | "invalid_exact_canton_merchant_mismatch"
  | "invalid_exact_canton_merchant_not_registered"
  | "invalid_exact_canton_missing_proof"
  | "invalid_exact_canton_nonce_reuse"
  | "invalid_exact_canton_payment_already_settled"
  | "invalid_exact_canton_preapproval_missing"
  | "invalid_exact_canton_self_payment"
  | "invalid_exact_canton_signature_invalid"
  | "invalid_exact_canton_transfer_command_not_found"
  | "invalid_exact_canton_transfer_completed_not_visible"
  | "invalid_exact_canton_transfer_factory_disabled"
  | "invalid_exact_canton_transfer_factory_not_found"
  | "invalid_exact_canton_transfer_instruction_not_found"
  | "invalid_exact_canton_transfer_instruction_pending"
  | "unexpected_canton_ledger_error";
