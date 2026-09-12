# Rolling 24-hour wallet eligibility — the backend dependency

The UI gates submission on **all six routes** behind an authoritative
backend verdict for the rolling 24-hour wallet rule. The backend answers
for two of them today. This file records exactly what is outstanding and
what changes when it lands, so the gap is a tracked dependency rather
than a surprise.

## The policy

For each route, the **source** wallet and the **destination** wallet may
each be used at most once within a rolling 24-hour window on that route.
Two independent windows, both enforced, and a transfer needs both sides
clear.

The backend owns every verdict. The UI re-implements no window, keeps no
"last used" record, and — deliberately — uses no `localStorage`: a
client-side record of what a wallet did is neither authoritative nor
tamper-proof, and treating one as enforcement would be a second policy
free to disagree with the real one.

## What has landed

`glc-solana-reserve-bridge`, `service/src/api.rs`, publishes two
endpoints. Both return the same `RecipientEligibility` shape, built by the
same `RecipientEligibility::from_windows`, and both carry **both sides at
once**:

| route      | endpoint                                 | source (`?wallet=`)  | destination (`?address=`) |
| ---------- | ---------------------------------------- | -------------------- | ------------------------- |
| `SolToGlc` | `GET /recipients/sol-to-glc/eligibility` | base58 Solana pubkey | Goldcoin P2PKH            |
| `RhnToGlc` | `GET /recipients/rhn-to-glc/eligibility` | `0x` EVM address     | Goldcoin P2PKH            |

Response fields the UI reads (all from the real schema — see
`src/lib/api/schemas/eligibility.ts`):

```
direction, address, wallet, eligible,
blocked_reason, blocked_reasons[],
retry_after, retry_after_seconds,
source_wallet_retry_after, recipient_retry_after,
window_seconds
```

The mapping onto the UI's by-side model is literal, and lives in exactly
one function (`normalizeRecipientEligibility`):

- `source_wallet_*` / `source_wallet_rate_limited` → **source** side
- `recipient_*` / `recipient_rate_limited` → **destination** side

`wallet` echoed as `null` means the source leg was **not evaluated**, which
is not the same as "evaluated and clear" — it fails the verdict closed.

`RecipientEligibility` publishes no `as_of`. The UI reports it as absent
rather than inventing one.

## What is outstanding

**No eligibility endpoint exists for these four routes:**

- `GlcToSol`
- `GlcToRhn`
- `SolToRhn`
- `RhnToSol`

They are therefore **not submittable from this UI**. That is intentional
and is the explicitly requested behaviour: a transfer the bridge would
hold back cannot be reversed once it is sent, so "we could not establish
eligibility" must not authorize one. The UI shows
`Wallet eligibility check is temporarily unavailable.` and keeps the
submit control disabled. Nothing synthesises `eligible: true`, and no
Goldcoin-payout endpoint is substituted for a route that pays out
elsewhere — that would be asking about a window which does not govern it.

Backend main states the corresponding policy positions directly:
`GlcToSol`/`GlcToRhn` recipients have no rate limit, and the two
cross routes have no window at all. So this is a gap in what is
_published_, not a rule the UI is guessing at.

### One structural note for the Goldcoin-sourced routes

`GlcToSol` and `GlcToRhn` are funded by sending GLC to a deposit address
the backend issues. No Goldcoin wallet is connected in the browser, and
this UI never learns which address the user will send from — so the
**source side of the policy cannot be established client-side on those two
routes at all**, even once an endpoint exists.

When the endpoint lands it will need to either (a) accept a request with
no source wallet and answer about the destination side while stating that
the source side is enforced at fold time, or (b) declare those routes
out of scope for the source-side window. Either is fine for the UI; what
it cannot do is supply a source wallet it has no way to know.

## The expected replacement

One route-agnostic endpoint, equivalent to:

```
GET /eligibility?route=<Route>&source=<address>&destination=<address>

{
  "route": "RhnToSol",
  "source": "...",
  "destination": "...",
  "eligible": false,
  "as_of": 1787000000,
  "window_seconds": 86400,
  "source":      { "eligible": false, "retry_at": ..., "remaining_seconds": ..., "reason": "..." },
  "destination": { "eligible": true,  "retry_at": null, "remaining_seconds": null, "reason": null }
}
```

## What changes in the UI when it lands

Two things, and nothing else:

1. `ENDPOINTS` in `src/lib/bridge/eligibility.ts` gains the four missing
   entries.
2. `fetchRouteEligibility` in `src/lib/api/eligibility-request.ts` gains
   one more input shape to normalise.

The form, the submit gate, the pre-signing re-check and the compact
display all read `RouteEligibility` already. That indirection exists for
exactly this reason.

Tests that will invert (they currently assert the refusal, deliberately, so
the change is visible rather than silent):

- `tests/unit/eligibility.test.ts` — "refuses all four routes the backend
  publishes no endpoint for", and `ELIGIBILITY_BACKEND_DEPENDENCY`'s
  `covered`/`pending` split.
- `tests/unit/bridge-card-eligibility.test.tsx` — "the four routes
  awaiting the backend".
- `tests/unit/cross-route-submit.test.tsx` — the `SolToRhn`/`RhnToSol`
  submission assertions, which this branch replaced with refusal
  assertions. The payload encodings they used to cover end-to-end are
  pinned at the unit level meanwhile, in
  `tests/unit/cross-route-destination.test.ts` (the encoders, byte for
  byte) and `tests/unit/evm-deposit.test.ts` (the calldata `deposit()`
  actually names, including route `0x04` with the 32 raw pubkey bytes).
- `tests/unit/bridge-card.test.tsx` and
  `tests/unit/bridge-card-minimum-amount.test.tsx` — the `GlcToSol`
  submission path, currently asserted via
  `expectHeldOnlyByEligibility()`.
