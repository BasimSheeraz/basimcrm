# 🗄️ Supabase Database & Security Guide

Basim CRM relies on PostgreSQL in Supabase with strict Row Level Security (RLS), AES-256-GCM token encryption, and audit logging.

---

## 📜 Migration Order

Execute the SQL files located in the `database/` folder in the following sequence:

### 1. `database/01_init.sql`
- Baseline schema setup.
- Revokes public/anon access on all tables by default.
- Defines helper functions: `is_team_member()`, `is_mfa_verified()`, `is_admin()`.
- Creates core tables: `team_members`, `contacts`, `threads`, `messages`, `attachments`, `thread_contacts`, `internal_notes`, `audit_log`.

### 2. `database/02_production_features.sql`
- Adds team member deactivation (`is_active`).
- Creates `user_2fa_recovery_codes` table (stores SHA-256 hashed one-time backup codes).
- Creates `gmail_sync_settings` and `gmail_ignore_rules` tables.
- Creates Postgres Full-Text Search GIN indexes on subjects, bodies, names, emails, and companies.
- Installs `search_crm` RPC for fast paginated searches.
- Installs `merge_contacts` RPC and `admin_reset_user_2fa` RPC.

### 3. `database/03_multi_mailbox.sql`
- Transitions system from singleton shared mailbox to **3 personal mailboxes**.
- Creates `gmail_accounts` table:
  - `owner_user_id` (foreign key to `team_members.id`)
  - `encrypted_refresh_token` (AES-256-GCM, accessible only by service role)
  - `status` (`active`, `needs_reconnect`, `paused`)
  - `daily_cap` (1 to 30 sends/day)
  - `warmup_started_at`, `warmup_override`
- Adds `account_id` foreign key to `threads` and `messages`.
- Enforces uniqueness constraints to prevent duplicate syncs:
  - `uq_threads_account_gmail_thread` (`account_id`, `gmail_thread_id`)
  - `uq_messages_account_gmail_msg` (`account_id`, `gmail_message_id`)
- Creates `do_not_contact` table for global email/domain opt-outs.

### 4. `database/04_setup_initial_team.sql`
- Idempotent script that creates the 3 users in Supabase Auth (`auth.users`), links them in `public.team_members`, and creates their personal mailboxes in `public.gmail_accounts`.

---

## 🔒 Security Model & RLS Rules
- **No Anonymous Access**: All client queries require a valid authenticated Supabase session (`auth.uid()`).
- **Active Team Members Only**: Every query checks `public.is_team_member()`, which verifies `is_active = true`. Deactivating a teammate immediately revokes all database access.
- **Service-Role Key Isolation**: The Supabase Service Role Key is strictly isolated to server-side code (`lib/supabase/admin.ts`). It is never bundled into client-side JavaScript.
- **Audit Logging**: Any administrative action, stage update, contact merge, or password reset is logged to `audit_log`.
