# Real-backend integration tests

Every spec in this directory drives an actual running instance of the bridge
service — a local regtest Goldcoin node, a local Solana test-validator with
`glc-reserve-bridge` deployed, and `glc-bridge-daemon` pointed at both —
rather than fixtures (`tests/unit/*`, most of `tests/e2e/*`) or `page.route`
interception (`tests/e2e/intercepted-*.spec.ts`). Nothing here uses mainnet,
production keys, or real funds.

## Skip by default, never fail by default

These tests only run when `E2E_REAL_BACKEND_URL` is set to a UI instance
already configured with `NEXT_PUBLIC_BRIDGE_API_MODE=http` against a real
backend. Every spec checks this at the top and calls `test.skip()` (not a
failure) when it is unset — there is no way to guarantee that stack is
running in every environment this repository's tests execute in, so this
project is deliberately excluded from `npm run test:e2e`'s default run and
from the 65-test fixture-mode baseline.

## Bringing up the real stack locally

None of this lives in the frontend repository — it is the backend's own
local/regtest tooling (`glc-solana-reserve-bridge`, read-only from here).
Outline (see that repo's `DEVELOPMENT.md`, `docs/09-runbook.md`, and
`service/tests/{daemon_smoke,regtest_acceptance}.rs` — the latter is the
canonical worked example this outline mirrors):

1. Start a throwaway `goldcoind -regtest` node (own datadir, own free ports,
   `-txindex=1`), generate 101+ blocks so it has spendable coin.
2. Start `solana-test-validator --upgradeable-program <PROGRAM_ID>
target/deploy/glc_reserve_bridge.so <UPGRADE_AUTHORITY_KEYPAIR>` (a plain
   `--bpf-program` deploy is immutable and `initialize` will never be
   callable — the upgrade authority must be a keypair you hold).
3. Create a Token-2022 mint at 6 decimals (`spl-token create-token
--program-2022 --decimals 6`) — the frontend's `deposit_to_reserve`
   builder (`src/lib/solana/deposit.ts`) hardcodes the Token-2022 program id,
   so the reserve mint must actually use it, not legacy SPL Token.
4. Call the program's `initialize` then `initialize_reserve_vault`
   instructions once (PDA seeds/account order/Borsh layout in
   `service/src/solana/instructions.rs`, mirrored in
   `src/lib/solana/deposit.ts`'s `deriveDepositAccounts`) — `authority` must
   be the program's real upgrade authority from step 2.
5. Mint reserve tokens into the reserve authority's ATA to fund Solana-side
   capacity (GlcToSol's destination).
6. Write a `config.toml` (exact shape and every field:
   `service/tests/daemon_smoke.rs`'s `config_toml` format string) pointing
   at the regtest RPC, the test-validator RPC, and the mint from step 3, and
   run `glc-bridge-daemon --config config.toml`.
7. Fund the Goldcoin-side reserve: the daemon logs the vault address it
   computed from the configured multisig pubkeys on startup
   (`vault constructed from configured signer set`) — send regtest coin to
   it, `importaddress`/`addmultisigaddress` the same redeem script into the
   `goldcoind` wallet so `listunspent` reports it `solvable` (otherwise
   reconciliation observes 0 and the Goldcoin reserve never gets funded),
   then generate confirmations.
8. Point the UI's `.env.local` at it:
   `NEXT_PUBLIC_BRIDGE_API_MODE=http`, `NEXT_PUBLIC_BRIDGE_API_URL` and
   `NEXT_PUBLIC_BRIDGE_API_PROXY_UPSTREAM_URL` (see `.env.example` — the real
   backend has no CORS of its own, so route through
   `app/api/bridge/[...path]/route.ts` rather than fetching it directly from
   a different origin), `NEXT_PUBLIC_SOLANA_RPC_URL`,
   `NEXT_PUBLIC_RESERVE_MINT_ADDRESS` (the mint from step 3, NOT the
   published canonical mainnet mint), `NEXT_PUBLIC_RESERVE_PROGRAM_ID`.
9. `E2E_REAL_BACKEND_URL=http://<that ui's origin> E2E_SKIP_LOCAL_SERVERS=1 \
npx playwright test --project=real-backend` — `E2E_SKIP_LOCAL_SERVERS`
   skips the other projects' local dev/production servers, which this
   project doesn't use and which would otherwise still try to start.

## What these tests do and don't do

`POST /transfers` (GlcToSol) only reserves capacity and returns deposit
instructions — it never broadcasts a Goldcoin transaction itself, so
creating one is a safe, valueless action; nothing here signs or broadcasts a
deposit. The SolToGlc direction is read/observed only in these specs (no
spec submits a real `deposit_to_reserve` transaction) for the same reason.
