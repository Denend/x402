# Exact Payment Scheme for Canton Network (`exact`)

This document specifies the `exact` payment scheme for the x402 protocol on
Canton Network. The client creates a `Splice.ExternalPartyAmuletRules.TransferCommand`
via Ed25519 external-party signing; the facilitator, acting as `delegate`,
exercises `TransferCommand_Send` — submitting the transaction and sponsoring
sequencer traffic.

## Scheme Name

`exact`

## Networks

| Network | Identifier |
|---|---|
| Canton MainNet | `canton:mainnet` |
| Canton TestNet | `canton:testnet` |

## Protocol Flow

1. **Client** requests a resource from the **Resource Server**.
2. **Resource Server** responds with a 402 containing `PaymentRequirements`.
   The `extra` field includes `facilitatorParty` (the delegate that will
   execute the transfer) and `synchronizerId`.
3. **Client** reads its next nonce from SV Scan:
   `GET /api/scan/v0/transfer-command-counters/{party}`. First payment from
   a new party defaults to nonce `0`.
4. **Client** exercises `ExternalPartyAmuletRules_CreateTransferCommand` via
   interactive submission on its own participant:
   - `POST /v2/interactive-submission/prepare` → `preparedTransactionHash`
   - Client signs the hash with its Ed25519 key
   - `POST /v2/interactive-submission/execute` with the signature
5. **Client** locates the created `TransferCommand` in its ACS by matching
   `(sender, nonce)` and extracts the `transferCommandCid`.
6. **Client** retries the original request with a `PAYMENT-SIGNATURE` header
   containing the `transferCommandCid`, `payerParty`, and `nonce`.
7. **Resource Server** forwards the payload to the facilitator's `/verify`.
8. **Facilitator** reads the `TransferCommand` by `cid` from ACS (it is a
   stakeholder as `delegate`), reads the sender's `TransferCommandCounter`
   from Scan, and validates the command against `PaymentRequirements`.
9. **Facilitator** returns `VerifyResponse` to the **Resource Server**.
10. **Resource Server** forwards the payload to the facilitator's `/settle`.
11. **Facilitator** re-verifies, fetches `AmuletRules`, `OpenMiningRound`,
    `IssuingMiningRounds`, and `TransferCommandCounter` from SV Scan as
    disclosed contracts, then exercises `TransferCommand_Send`. The ledger
    atomically moves Canton Coin from sender to receiver and archives the
    `TransferCommand`.
12. **Facilitator** returns `SettlementResponse` with the ledger `updateId`.
13. **Resource Server** grants the **Client** access and echoes settlement
    metadata in the `PAYMENT-RESPONSE` header.

## `PaymentRequirements` for `exact`

```json
{
  "scheme": "exact",
  "network": "canton:mainnet",
  "amount": "1000000000",
  "asset": "canton-coin",
  "payTo": "merchant_party::1220abc...",
  "maxTimeoutSeconds": 60,
  "extra": {
    "transferMethod": "external-party-amulet-rules",
    "facilitatorParty": "ftp_facilitator::1220def...",
    "synchronizerId": "global-domain::1220xyz...",
    "merchantContractCid": "00mc..."
  }
}
```

- `amount`: Atomic units as a JSON string. Canton Coin uses 10 decimal places
  (`"1000000000"` = 0.1 CC).
- `asset`: `"canton-coin"`. This transfer method settles Canton Coin only.
- `payTo`: Receiver party id in canonical form `"<name>::<fingerprint>"`.
- `extra.transferMethod`: MUST be `"external-party-amulet-rules"`.
- `extra.facilitatorParty`: The facilitator's Canton party id. MUST be set as
  `delegate` in the `TransferCommand`. Clients MUST NOT alter this value.
- `extra.synchronizerId`: The Global Synchronizer the transfer settles on.
- `extra.merchantContractCid` (optional): When present, the facilitator
  verifies the merchant is registered before accepting the payment.

## `PaymentPayload` `payload` Field

```json
{
  "x402Version": 2,
  "resource": {
    "url": "https://api.example.com/data",
    "description": "Access to protected resource",
    "mimeType": "application/json"
  },
  "accepted": {
    "scheme": "exact",
    "network": "canton:mainnet",
    "amount": "1000000000",
    "asset": "canton-coin",
    "payTo": "merchant_party::1220abc...",
    "maxTimeoutSeconds": 60,
    "extra": {
      "transferMethod": "external-party-amulet-rules",
      "facilitatorParty": "ftp_facilitator::1220def...",
      "synchronizerId": "global-domain::1220xyz..."
    }
  },
  "payload": {
    "transferMethod": "external-party-amulet-rules",
    "transferCommandCid": "00abc...",
    "payerParty": "agent_party::1220...",
    "nonce": 42
  }
}
```

- `transferCommandCid`: Contract id of the `TransferCommand` created by the
  client on-ledger.
- `payerParty`: The client's Canton party id (`TransferCommand.sender`).
- `nonce`: The monotonic nonce used when creating the `TransferCommand`.

## `SettlementResponse`

```json
{
  "success": true,
  "payer": "agent_party::1220...",
  "transaction": "122038abc...",
  "network": "canton:mainnet"
}
```

`transaction` is the Canton ledger `updateId` of the `TransferCommand_Send`
exercise. Resolvable in any SV Scan API as proof of settlement.

On failure:

```json
{
  "success": false,
  "errorReason": "invalid_exact_canton_amount_mismatch",
  "transaction": ""
}
```

## Facilitator Verification Rules (MUST)

1. **Network match.** `paymentRequirements.network` MUST equal the
   facilitator's configured network.

2. **TransferCommand exists.** The facilitator MUST locate the
   `TransferCommand` by `payload.transferCommandCid` in its ACS (it is an
   observer as `delegate`). If absent or archived, reject with
   `invalid_exact_canton_transfer_command_not_found`.

3. **Delegate.** `TransferCommand.delegate` MUST equal `extra.facilitatorParty`.

4. **Amount.** `TransferCommand.amount` MUST equal `PaymentRequirements.amount`
   exactly (string comparison; no numeric coercion).

5. **Expiry.** `TransferCommand.expiresAt` MUST be at least 5 seconds in the
   future at verification time. Reject with `invalid_exact_canton_expired`.

6. **Sender.** `TransferCommand.sender` MUST equal `payload.payerParty`.

7. **Receiver.** `TransferCommand.receiver` MUST equal
   `PaymentRequirements.payTo`.

8. **Nonce.** `TransferCommand.nonce` MUST be ≥ `nextNonce` from the sender's
   `TransferCommandCounter` on SV Scan. A missing counter (first payment)
   defaults to `nextNonce = 0`. Reject with
   `invalid_exact_canton_nonce_reuse` if stale.

9. **Description.** `TransferCommand.description` MUST parse as a JSON object
   containing a non-empty `paymentId` string and `resourceUrl` equal to
   `resource.url`. Reject with `invalid_exact_canton_resource_url_mismatch`
   if absent, unparseable, or mismatched.

10. **Merchant registration** (when `extra.merchantContractCid` is present).
    The referenced `MerchantContract` MUST be active and its `merchant` field
    MUST equal `PaymentRequirements.payTo`. Reject with
    `invalid_exact_canton_merchant_not_registered` otherwise.

## Duplicate Settlement Mitigation

Canton provides native replay protection: `TransferCommand_Send` consumes
(archives) the `TransferCommand` contract. A second `Send` on the same
contract id fails at the ledger with `CONTRACT_NOT_FOUND`. No off-chain
deduplication store is required.

## Settlement

After verification succeeds:

1. Fetch in parallel from SV Scan:
   - `AmuletRules` (contract + `created_event_blob`)
   - Open and issuing mining rounds (contracts + `created_event_blob` for each)
   - `TransferCommandCounter` for the payer (contract + `created_event_blob`)

2. Select the active `OpenMiningRound`: among rounds where `opensAt ≤ now`,
   pick the highest `round.number`. Fall back to the highest overall if none
   are open yet.

3. Exercise `TransferCommand_Send` as `delegate`:

   ```
   choiceArgument = {
     context: {
       amuletRules: <AmuletRules contractId>,
       context: {
         openMiningRound: <active round contractId>,
         issuingMiningRounds: [[{number: "N"}, <contractId>], ...],
         validatorRights: [],
         featuredAppRight: null
       }
     },
     inputs: [],
     transferCounterCid: <TransferCommandCounter contractId>
   }
   disclosedContracts: [AmuletRules, OpenMiningRound, TransferCommandCounter,
                        ...IssuingMiningRounds]
   ```

4. **Stale counter retry.** If the ledger rejects with
   `LOCAL_VERDICT_INACTIVE_CONTRACTS` (SV Scan counter cache lagging behind
   the ledger), refresh the counter from Scan and retry up to 5 times with
   exponential backoff starting at 500 ms. Return
   `unexpected_canton_ledger_error` after 5 failed attempts.

## Error Reason Codes

| Code | Meaning |
|---|---|
| `invalid_exact_canton_transfer_command_not_found` | `transferCommandCid` does not resolve to an active `TransferCommand` visible to the facilitator. |
| `invalid_exact_canton_amount_mismatch` | `TransferCommand.amount` != `PaymentRequirements.amount`. |
| `invalid_exact_canton_expired` | `TransferCommand.expiresAt` is past or within the 5-second safety margin. |
| `invalid_exact_canton_payer_mismatch` | `TransferCommand.sender` != `payload.payerParty`. |
| `invalid_exact_canton_merchant_mismatch` | `TransferCommand.receiver` != `PaymentRequirements.payTo`. |
| `invalid_exact_canton_nonce_reuse` | `TransferCommand.nonce` < `TransferCommandCounter.nextNonce`. |
| `invalid_exact_canton_resource_url_mismatch` | `TransferCommand.description` is absent, unparseable, or `resourceUrl` does not match `resource.url`. |
| `invalid_exact_canton_merchant_not_registered` | `MerchantContract` is absent or belongs to a different merchant. |
| `invalid_exact_canton_counter_not_ready` | No `TransferCommandCounter` exists for the sender; first-payment settle not yet possible. |
| `unexpected_canton_ledger_error` | Scan API failure, ledger rejection, or timeout not covered above. |

## References

- [x402 v2 spec](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md)
- [SVM scheme spec (precedent)](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_svm.md)
- [`Splice.ExternalPartyAmuletRules`](https://github.com/hyperledger-labs/splice/blob/main/daml/splice-amulet/daml/Splice/ExternalPartyAmuletRules.daml)
- [Canton external-party signing](https://docs.digitalasset.com/build/3.4/tutorials/app-dev/external_signing_overview)
