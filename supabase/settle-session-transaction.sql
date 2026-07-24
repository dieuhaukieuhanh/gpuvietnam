-- =================================================================
-- GPUVietnam — SCB 3.4B — Settlement Transaction RPC (M-scb34)
--
-- Authority:
--   docs/scb/SCB_3_4_SPECIFICATION_FREEZE.md  (frozen architecture)
--   docs/scb/SCB_3_4A_RPC_DESIGN_CONTRACT.md  (frozen RPC contract)
--
-- Implements: SCB 3.4A §5 Transaction Steps, as the single server-side
-- atomic unit T described in SCB 3.4 §1 (steps 9–15, W2–W7).
--
--   W2  Claim in_progress        (gpu_sessions UPDATE)
--   W3  Deduct wallet balance    (users UPDATE)
--   W4  Insert wallet ledger     (wallet_transactions INSERT)
--   W5  Deduct entitlement       (manual_hour_grants | subscriptions CAS)
--   W6  Sync user_plan_inventory (projection re-derive)
--   W7  Finalize settlement      (gpu_sessions UPDATE -> 'settled')
--
-- The RPC is a PURE TRANSACTION EXECUTOR. It computes nothing — all
-- eligibility, allocation, wallet, and breakdown math stays in the JS
-- domain (settlement-core.js / settlement.js). It receives a prepared
-- plan and applies it atomically, or rejects atomically.
--
-- Replay boundary: the transaction T (= this RPC call). See SCB 3.4 §6
-- and SCB 3.4A §7. The settlement_status claim guard is the primary
-- exactly-once mechanism; the wallet_ledger idempotency_key unique
-- index is defence in depth (SCB 3.4 §6, SCB 3.4A §7/§8).
--
-- Idempotent: CREATE OR REPLACE FUNCTION. The wallet_transactions
-- idempotency_key column + partial unique index are ADD COLUMN IF NOT
-- EXISTS / CREATE UNIQUE INDEX IF NOT EXISTS — safe to re-run.
--
-- Apply order: after schema.sql, subscriptions.sql, hour-grants.sql,
-- user-plan-inventory.sql, user-settings.sql (wallet_transactions),
-- storage-upgrades.sql (users.wallet_balance), gpu-sessions.sql.
-- =================================================================

-- ------------------------------------------------------------------
-- 1. wallet_transactions.idempotency_key  (SCB 3.4A §7/§8)
--    Nullable. Set only by this RPC to the supplied idempotency_key
--    (e.g. "settle:<session_id>"). A partial UNIQUE index catches
--    duplicate T invocations that bypass the claim guard (defence in
--    depth per SCB 3.4 §6). Existing deposit/topup/refund rows keep
--    NULL and are not affected.
-- ------------------------------------------------------------------
ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_idempotency_key_uniq
  ON public.wallet_transactions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.wallet_transactions.idempotency_key IS
  'SCB 3.4A §7 — stable per-session idempotency key (e.g. settle:<session_id>). '
  'Set only by settle_session_transaction() for settlement ledger rows. '
  'Defence-in-depth dedup alongside the settlement_status claim guard. '
  'NULL for all non-settlement wallet transactions.';

-- ------------------------------------------------------------------
-- 2. settle_session_transaction(payload json) RETURNS json
--    SCB 3.4A §1 (name), §2 (responsibility), §3 (inputs),
--    §4 (outputs), §5 (steps), §6 (failure behaviour), §7 (idempotency),
--    §8 (locking).
--
--    SECURITY DEFINER so the function executes with the owner
--    (postgres) privileges and bypasses RLS — it is invoked via the
--    service-role client which already bypasses RLS, but SECURITY
--    DEFINER keeps the function self-contained regardless of the
--    caller role.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_session_transaction(payload json)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session_id              uuid        := (payload ->> 'session_id')::uuid;
  v_user_id                 uuid        := (payload ->> 'user_id')::uuid;
  v_provider_destroyed      boolean     := COALESCE((payload ->> 'provider_destroyed_verified')::boolean, false);
  -- P0-B: billing Close may settle before provider destroy verify.
  v_billing_close           boolean     := COALESCE((payload ->> 'billing_close_verified')::boolean, false);
  v_expected_pre            text        := payload ->> 'expected_pre_settlement_status';
  v_wallet_charge           json        := payload -> 'wallet_charge';
  v_wallet_amount           numeric     := 0;
  v_wallet_desc             text;
  v_wallet_balance_after    numeric;
  v_entitlement_lines       json        := COALESCE(payload -> 'entitlement_lines', '[]'::json);
  v_projection_sync         boolean     := COALESCE((payload ->> 'projection_sync')::boolean, true);
  v_breakdown               jsonb       := COALESCE((payload -> 'settlement_breakdown')::jsonb, '{}'::jsonb);
  v_settlement_at           timestamptz := (payload ->> 'settlement_at')::timestamptz;
  v_idempotency_key         text        := payload ->> 'idempotency_key';

  v_session_user_id         uuid;
  v_session_status          text;
  v_session_settlement      text;

  v_line                    json;
  v_line_table              text;
  v_line_id                 text;
  v_line_hours              numeric;
  v_expected_hours          numeric;
  v_current_hours           numeric;
  v_next_hours              numeric;
  v_final_hours             numeric;
  v_line_attempts           integer;
  v_consumed                jsonb       := '[]'::jsonb;
  v_wallet_charged          numeric     := 0;

  v_claimed_rows            integer;
  v_finalized_rows          integer;

  -- controlled-abort signalling: set v_err_* THEN RAISE EXCEPTION 'controlled abort'
  v_err_code                text        := NULL;
  v_err_msg                 text        := NULL;
  v_err_status              text        := NULL;
  v_attempts_json           jsonb;
  v_entitlement_attempts    int[]       := ARRAY[]::int[];
  v_idx                     integer;
BEGIN
  -- ---------------------------------------------------------------
  -- Precondition echo (SCB 3.4A §3 + P0-B billing Close).
  -- JS has already enforced this; defence in depth.
  -- ---------------------------------------------------------------
  IF v_provider_destroyed IS NOT TRUE AND v_billing_close IS NOT TRUE THEN
    RETURN json_build_object(
      'state', 'ERROR',
      'code', 'CLAIM_PRECONDITION',
      'message', 'provider_destroyed_verified and billing_close_verified are both false',
      'rolled_back', true,
      'settlement_status', NULL
    );
  END IF;

  IF v_expected_pre NOT IN ('pending', 'failed') THEN
    RETURN json_build_object(
      'state', 'ERROR',
      'code', 'CLAIM_PRECONDITION',
      'message', 'expected_pre_settlement_status must be pending or failed',
      'rolled_back', true,
      'settlement_status', NULL
    );
  END IF;

  -- ---------------------------------------------------------------
  -- Inner work block. Any exception (controlled abort or otherwise)
  -- triggers ROLLBACK of every write performed inside this block,
  -- then we translate to the SCB 3.4A §4 ERROR shape with
  -- rolled_back = true. This is the contract: no partial financial
  -- state persists on any ERROR path (SCB 3.4A §6).
  -- ---------------------------------------------------------------
  BEGIN
    -- =============================================================
    -- STEP 1 — CLAIM (W2)
    --   Re-read gpu_sessions row FOR UPDATE.
    --   Verify user_id, status IN (closed, completed),
    --   settlement_status = expected_pre_settlement_status.
    --   UPDATE settlement_status = 'in_progress'.
    --   SCB 3.4A §5 step 1; SCB 3.4 §1 step 10.
    -- =============================================================
    SELECT user_id, status, settlement_status
      INTO v_session_user_id, v_session_status, v_session_settlement
      FROM public.gpu_sessions
      WHERE id = v_session_id
      FOR UPDATE;

    IF NOT FOUND THEN
      v_err_code := 'CLAIM_PRECONDITION';
      v_err_msg  := 'session not found';
      v_err_status := NULL;
      RAISE EXCEPTION 'controlled abort';
    END IF;

    IF v_session_user_id IS DISTINCT FROM v_user_id THEN
      v_err_code := 'CLAIM_PRECONDITION';
      v_err_msg  := 'session user_id mismatch';
      v_err_status := v_session_settlement;
      RAISE EXCEPTION 'controlled abort';
    END IF;

    IF v_session_status NOT IN ('closed', 'completed') THEN
      v_err_code := 'CLAIM_PRECONDITION';
      v_err_msg  := 'session not closed';
      v_err_status := v_session_settlement;
      RAISE EXCEPTION 'controlled abort';
    END IF;

    IF v_session_settlement IS DISTINCT FROM v_expected_pre THEN
      -- A rival settler or reconciliation already moved settlement_status
      -- (possibly to 'settled' or 'in_progress'). SCB 3.4A §6: CLAIM_LOST.
      -- JS re-loads and decides IDEMPOTENT-vs-retry (SCB 3.4A §9).
      v_err_code := 'CLAIM_LOST';
      v_err_msg  := 'settlement_status expected=' || v_expected_pre ||
                    ' actual=' || COALESCE(v_session_settlement, 'null');
      v_err_status := v_session_settlement;
      RAISE EXCEPTION 'controlled abort';
    END IF;

    UPDATE public.gpu_sessions
      SET settlement_status = 'in_progress'
      WHERE id = v_session_id
        AND settlement_status = v_expected_pre;

    GET DIAGNOSTICS v_claimed_rows = ROW_COUNT;
    IF v_claimed_rows = 0 THEN
      v_err_code := 'CLAIM_LOST';
      v_err_msg  := 'claim update matched 0 rows';
      v_err_status := v_session_settlement;
      RAISE EXCEPTION 'controlled abort';
    END IF;

    -- =============================================================
    -- STEP 2 — WALLET (W3 + W4)
    --   Only if wallet_charge present and amount > 0.
    --   Lock users row FOR UPDATE. Optional CAS on wallet_balance
    --   (defence in depth per SCB 3.4 §4). UPDATE balance, INSERT
    --   ledger with idempotency_key. LEDGER_CONFLICT on dup.
    --   SCB 3.4A §5 step 2; SCB 3.4 §1 steps 11–12.
    -- =============================================================
    IF v_wallet_charge IS NOT NULL THEN
      v_wallet_amount := COALESCE((v_wallet_charge ->> 'amount')::numeric, 0);
    END IF;

    IF v_wallet_amount > 0 THEN
      v_wallet_desc          := v_wallet_charge ->> 'description';
      v_wallet_balance_after := COALESCE((v_wallet_charge ->> 'balance_after')::numeric, 0);

      -- Lock the users row for the duration of T (SCB 3.4A §8).
      PERFORM 1 FROM public.users WHERE id = v_user_id FOR UPDATE;

      -- CAS defence in depth (SCB 3.4A §3 note, §5 step 2):
      -- the pre-debit balance must equal balance_after + amount.
      -- If a concurrent debit changed it, surface WALLET_CAS so JS
      -- can re-read, recompute, and retry (SCB 3.4A §9).
      UPDATE public.users
        SET wallet_balance = v_wallet_balance_after,
            updated_at     = v_settlement_at
        WHERE id = v_user_id
          AND wallet_balance = (v_wallet_balance_after + v_wallet_amount);

      GET DIAGNOSTICS v_claimed_rows = ROW_COUNT;
      IF v_claimed_rows = 0 THEN
        v_err_code := 'WALLET_CAS';
        v_err_msg  := 'wallet_balance changed between JS read and RPC';
        v_err_status := v_expected_pre;
        RAISE EXCEPTION 'controlled abort';
      END IF;

      -- W4 — ledger insert. idempotency_key unique index is the
      -- defence-in-depth dedup (SCB 3.4 §6; SCB 3.4A §7/§8).
      BEGIN
        INSERT INTO public.wallet_transactions (
          user_id, type, amount, bonus_amount, balance_after,
          description, status, created_at, idempotency_key
        ) VALUES (
          v_user_id, 'payment', v_wallet_amount, 0,
          v_wallet_balance_after, v_wallet_desc, 'completed',
          v_settlement_at, v_idempotency_key
        );
      EXCEPTION WHEN unique_violation THEN
        v_err_code := 'LEDGER_CONFLICT';
        v_err_msg  := 'wallet ledger idempotency_key conflict';
        v_err_status := v_expected_pre;
        RAISE EXCEPTION 'controlled abort';
      END;

      v_wallet_charged := v_wallet_amount;
    END IF;

    -- =============================================================
    -- STEP 3 — ENTITLEMENT (W5), per line, in input order.
    --   Lock target row FOR UPDATE. CAS guard on hours_used.
    --   Retry within T up to N=5 (SCB 3.4A §5 step 3).
    --   SCB 3.4 §1 step 13; SCB 3.4 §4 (CAS kept inside T).
    -- =============================================================
    v_idx := 0;
    FOR v_idx IN 0..(jsonb_array_length(v_entitlement_lines::jsonb) - 1) LOOP
      v_line           := v_entitlement_lines -> v_idx;
      v_line_table     := v_line ->> 'table';
      v_line_id        := v_line ->> 'id';
      v_line_hours     := COALESCE((v_line ->> 'hours')::numeric, 0);
      v_expected_hours := COALESCE((v_line ->> 'expected_hours_used')::numeric, 0);
      v_line_attempts  := 0;
      v_final_hours    := NULL;

      IF v_line_table NOT IN ('manual_hour_grants', 'subscriptions') THEN
        v_err_code := 'CLAIM_PRECONDITION';
        v_err_msg  := 'entitlement line table not allowed: ' || COALESCE(v_line_table, 'null');
        v_err_status := v_expected_pre;
        RAISE EXCEPTION 'controlled abort';
      END IF;

      IF v_line_hours <= 0 THEN
        -- Nothing to debit on this line; record zero-consume and continue.
        v_consumed := v_consumed || jsonb_build_array(
          jsonb_build_object(
            'table', v_line_table,
            'id', v_line_id,
            'hours', 0,
            'final_hours_used', NULL
          )
        );
        v_entitlement_attempts := array_append(v_entitlement_attempts, 0);
        CONTINUE;
      END IF;

      <<cas_loop>>
      LOOP
        v_line_attempts := v_line_attempts + 1;
        IF v_line_attempts > 5 THEN
          v_err_code := 'CAS_EXHAUSTED';
          v_err_msg  := 'CAS exhausted on ' || v_line_table || ' id=' || COALESCE(v_line_id, 'null');
          v_err_status := v_expected_pre;
          RAISE EXCEPTION 'controlled abort';
        END IF;

        -- Lock + read current hours_used (SCB 3.4A §8: FOR UPDATE per row).
        -- Cast id: subscriptions.id is uuid; manual_hour_grants.id is bigint.
        -- JSON ->> always yields text, so untyped `$1` caused `uuid/bigint = text`.
        IF v_line_table = 'manual_hour_grants' THEN
          SELECT hours_used INTO v_current_hours
          FROM public.manual_hour_grants
          WHERE id = v_line_id::bigint
          FOR UPDATE;
        ELSE
          SELECT hours_used INTO v_current_hours
          FROM public.subscriptions
          WHERE id = v_line_id::uuid
          FOR UPDATE;
        END IF;

        IF v_current_hours IS NULL THEN
          v_err_code := 'CLAIM_PRECONDITION';
          v_err_msg  := 'entitlement row not found: ' || v_line_table || ' id=' || COALESCE(v_line_id, 'null');
          v_err_status := v_expected_pre;
          RAISE EXCEPTION 'controlled abort';
        END IF;

        -- CAS guard using expected_hours_used (JS pre-read on attempt 1,
        -- re-read value on retries). SCB 3.4A §5 step 3.
        v_next_hours := round((v_expected_hours + v_line_hours)::numeric, 2);

        IF v_line_table = 'manual_hour_grants' THEN
          UPDATE public.manual_hour_grants
            SET hours_used = v_next_hours
            WHERE id = v_line_id::bigint
              AND hours_used = v_expected_hours
            RETURNING hours_used INTO v_final_hours;
        ELSE
          UPDATE public.subscriptions
            SET hours_used = v_next_hours
            WHERE id = v_line_id::uuid
              AND hours_used = v_expected_hours
            RETURNING hours_used INTO v_final_hours;
        END IF;

        IF v_final_hours IS NOT NULL THEN
          -- CAS succeeded.
          v_consumed := v_consumed || jsonb_build_array(
            jsonb_build_object(
              'table', v_line_table,
              'id', v_line_id,
              'hours', v_line_hours,
              'final_hours_used', v_final_hours
            )
          );
          v_entitlement_attempts := array_append(v_entitlement_attempts, v_line_attempts);
          EXIT cas_loop;
        END IF;

        -- CAS failed (0 rows): a non-T writer changed hours_used between
        -- JS read and this lock. Re-read is already locked; refresh
        -- expected and retry (SCB 3.4A §5 step 3).
        v_expected_hours := v_current_hours;
      END LOOP cas_loop;
    END LOOP;

    -- =============================================================
    -- STEP 4 — PROJECTION SYNC (W6)
    --   Re-derive user_plan_inventory.hours_remaining + status from
    --   the authoritative subscriptions.hours_used and
    --   manual_hour_grants.hours_used (both written by W5 inside T).
    --   SCB 3.4A §5 step 4; SCB 3.4 §1 step 14; SCB 3.4 §3 (inside T).
    --   Lock surface is bounded to this user's rows (SCB 3.4 §3).
    -- =============================================================
    IF v_projection_sync THEN
      BEGIN
        -- Gift / manual-grant backed inventory rows (active projection only —
        -- do not revive expired duplicate inventory rows).
        UPDATE public.user_plan_inventory upi
          SET hours_remaining = round((g.hours_granted - g.hours_used)::numeric, 2),
              status = CASE
                WHEN (g.hours_granted - g.hours_used) <= 0 THEN 'depleted'
                WHEN g.expires_at IS NOT NULL AND g.expires_at <= v_settlement_at THEN 'expired'
                ELSE 'active'
              END
          FROM public.manual_hour_grants g
          WHERE upi.grant_id = g.id
            AND upi.user_id  = v_user_id
            AND g.user_id    = v_user_id
            AND upi.status IN ('active', 'depleted');

        -- Subscription-backed inventory rows (combo / hourly).
        UPDATE public.user_plan_inventory upi
          SET hours_remaining = round((s.hours_total - s.hours_used)::numeric, 2),
              status = CASE
                WHEN (s.hours_total - s.hours_used) <= 0 AND s.billing IS DISTINCT FROM 'hourly' THEN 'depleted'
                WHEN s.expires_at IS NOT NULL AND s.expires_at <= v_settlement_at THEN 'expired'
                ELSE 'active'
              END
          FROM public.subscriptions s
          WHERE upi.subscription_id = s.id
            AND upi.user_id         = v_user_id
            AND s.user_id           = v_user_id
            AND upi.status IN ('active', 'depleted');
      EXCEPTION WHEN OTHERS THEN
        v_err_code := 'PROJECTION_FAILED';
        v_err_msg  := 'user_plan_inventory sync failed: ' || SQLERRM;
        v_err_status := v_expected_pre;
        RAISE EXCEPTION 'controlled abort';
      END;
    END IF;

    -- =============================================================
    -- STEP 5 — FINALIZE SETTLEMENT (W7)
    --   UPDATE gpu_sessions settlement_status='settled',
    --   settlement_at, settlement_breakdown
    --   WHERE settlement_status='in_progress'. 0 rows → CLAIM_LOST.
    --   Must be the final write of T (SCB 3.4A §5 step 5; SCB 3.4 §1 step 15).
    -- =============================================================
    UPDATE public.gpu_sessions
      SET settlement_status    = 'settled',
          settlement_at        = v_settlement_at,
          settlement_breakdown = v_breakdown
      WHERE id = v_session_id
        AND settlement_status = 'in_progress';

    GET DIAGNOSTICS v_finalized_rows = ROW_COUNT;
    IF v_finalized_rows = 0 THEN
      v_err_code := 'CLAIM_LOST';
      v_err_msg  := 'finalize matched 0 rows (claim stolen mid-T)';
      v_err_status := v_expected_pre;
      RAISE EXCEPTION 'controlled abort';
    END IF;

  EXCEPTION
    -- Controlled abort: v_err_code was set before RAISE.
    WHEN OTHERS THEN
      -- The inner block's writes are rolled back by Postgres here.
      -- rolled_back: true is contractual (SCB 3.4A §6).
      IF v_err_code IS NOT NULL THEN
        RETURN json_build_object(
          'state', 'ERROR',
          'code', v_err_code,
          'message', v_err_msg,
          'rolled_back', true,
          'settlement_status', v_err_status
        );
      END IF;
      -- Unhandled exception → INTERNAL (retryable, log loudly).
      RETURN json_build_object(
        'state', 'ERROR',
        'code', 'INTERNAL',
        'message', SQLERRM,
        'rolled_back', true,
        'settlement_status', NULL
      );
  END;

  -- ---------------------------------------------------------------
  -- COMMIT path — PostgREST commits the implicit transaction on
  -- successful function return. SCB 3.4A §4 Success shape.
  -- ---------------------------------------------------------------
  v_attempts_json := jsonb_build_object(
    'claim', 1,
    'entitlement_lines', to_jsonb(v_entitlement_attempts)
  );

  RETURN json_build_object(
    'state', 'OK',
    'session_id', v_session_id,
    'settlement_status', 'settled',
    'settlement_at', v_settlement_at,
    'wallet_charged', v_wallet_charged,
    'entitlement_consumed', v_consumed,
    'projection_synced', v_projection_sync,
    'attempts', v_attempts_json
  );
END;
$$;

-- ------------------------------------------------------------------
-- 3. Grants. The function is invoked via the service-role client
--    (supabaseAdmin), which bypasses RLS; SECURITY DEFINER runs it
--    as the owner. Grant EXECUTE to service_role for completeness.
-- ------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.settle_session_transaction(json) TO service_role;

COMMENT ON FUNCTION public.settle_session_transaction(json) IS
  'SCB 3.4B — Settlement Transaction RPC. Pure server-side executor of '
  'the W2–W7 atomic unit (SCB 3.4 §1 steps 9–15). Receives a JS-prepared '
  'settlement plan, applies it under one Postgres transaction, returns '
  'the SCB 3.4A §4 result shape. Computes nothing; all eligibility, '
  'allocation, wallet, and breakdown math stays in settlement-core.js / '
  'settlement.js. Replay boundary = this call (SCB 3.4 §6).';

-- =================================================================
-- VERIFY (run manually after applying):
--
--   -- function exists, returns json, SECURITY DEFINER:
--   SELECT proname, prorettype::regtype, proconfig
--     FROM pg_proc WHERE proname = 'settle_session_transaction';
--
--   -- idempotency_key column + partial unique index:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='wallet_transactions' AND column_name='idempotency_key';
--   SELECT indexname, indexdef FROM pg_indexes
--     WHERE tablename='wallet_transactions'
--       AND indexname='wallet_transactions_idempotency_key_uniq';
--
--   -- grant:
--   SELECT routine_name, privilege_type FROM information_schema.routine_privileges
--     WHERE routine_name = 'settle_session_transaction';
-- =================================================================
