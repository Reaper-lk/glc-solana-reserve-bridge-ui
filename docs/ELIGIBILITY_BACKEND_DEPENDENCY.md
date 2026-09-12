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

The contract below carries a per-side `applicable` flag for exactly this:
the backend states that a side is outside the rule, and the UI honours
that statement rather than assuming it. Two properties make that safe:

- The UI never sets it. A side is exempt only because a response said so.
- **Absent means applicable.** A backend that ships the endpoint without
  the field gets the strict reading — the side must be evaluated and
  eligible — so forgetting it fails closed rather than silently exempting
  a wallet. `tests/unit/eligibility.test.ts` pins this.

## What changes in the UI when it lands

**Nothing.** `HttpBridgeClient.getRouteEligibility` already ATTEMPTS
`GET /eligibility` for every route with no per-route endpoint, and a 404
is what currently turns into the refusal. The day the backend answers
instead of 404ing, those routes start clearing — no frontend deploy, no
table to edit, nothing to remember.

That is deliberate. An earlier revision of this branch kept a
compile-time table of "routes the backend answers for" and refused
anything absent from it. That table is still here — `ENDPOINTS` in
`src/lib/bridge/eligibility.ts` — but only as documentation and as the
per-route endpoint map. It no longer gates anything, because a gate
resting on it would be trusting a claim about the backend rather than an
answer from it: it would refuse a deployment that had started serving the
endpoint, and — the direction that matters — it could be loosened by
editing a constant instead of by obtaining a verdict.

The gate is now exactly one thing: **an authoritative answer arrived,
about these exact inputs, clearing every side the backend says applies.**

Tests that will invert (they currently assert the refusal, deliberately, so
the change is visible rather than silent):

- `tests/unit/eligibility.test.ts` — "refuses a route this deployment
  serves no endpoint for", and `ELIGIBILITY_BACKEND_DEPENDENCY`'s
  `covered`/`pending` split.
- `tests/unit/bridge-card-eligibility.test.tsx` — "the four routes
  awaiting the backend".
- `tests/unit/http-client.test.ts` — "REFUSES when the deployment does not
  serve the route-agnostic endpoint" describes the 404; the sibling test
  that attempts it already describes the answered case.
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
