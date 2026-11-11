# Supabase: Stage 1 (Database + Auth)

| File | Purpose |
| --- | --- |
| `migrations/20261111000000_init.sql` | The whole schema: tables, indexes, RLS, helper functions, triggers, grants, Realtime |
| `seed/link_team_members.sql` | Links the 3 Auth users into `team_members`. Contains **placeholders only** |
| `tests/rls_smoke_test.sql` | Checks that permissions work. Runs in a transaction and **rolls back** everything |

## 1. Create the project
1. Go to https://supabase.com and create a new project (free tier). Choose the region closest to the team.
2. Save the database password in a password manager. You will need it in Stage 7 for backups.

## 2. Lock down Auth (Dashboard → Authentication)
- **Sign In / Providers → User Signups**: turn **"Allow new users to sign up" OFF**.
- **Sign In / Providers → "Allow anonymous sign-ins"**: **OFF**.
- **Email** provider: **enabled**. Every other provider (Google, GitHub, phone, …): **disabled**.
- **Email → Minimum password length**: set it to 12 or more.
- **Multi-Factor → TOTP**: **enabled**. Stage 2 requires it.

## 3. Create the 3 users
**Authentication → Users → Add user → Create new user**, once for each person:
- Basim, Moiz, Ali. Use each person's real email and a strong password, and tick **Auto Confirm User**.

## 4. Run the migration
**SQL Editor → New query** → paste all of `migrations/20261111000000_init.sql` → **Run**.
Expected result: "Success. No rows returned".

## 5. Link the users (seed)
Paste `seed/link_team_members.sql` into a new SQL Editor query. Replace the three `REPLACE_WITH_..._EMAIL` placeholders **in the editor only**, then Run.
You should get 3 rows back: Basim = admin, Moiz and Ali = member.
If you forget to replace the placeholders, the script stops with an error.

## 6. Test
Paste `tests/rls_smoke_test.sql` into a new query and Run. Open the **Messages/Notices** output. You should see about 22 lines that start with `PASS:`. If anything is wrong, the script stops with an error that starts with `FAIL:`.

Also check by hand: **Table Editor** should show the 🔒 RLS badge on all 12 tables. **Database → Advisors → Security Advisor** should report no "RLS disabled" errors.

## Security model (summary)
- RLS is enabled on every table. `anon` has no grants and no policies.
- Every policy calls `is_team_member()`. Data policies also require `is_mfa_verified()` (JWT `aal2`). A session that has not passed TOTP gets **zero rows** from the database, even if the app had a bug. The only pre-MFA access is a user reading their **own** `team_members` row.
- `gmail_account` and `sync_state` have no client grants at all. Only the server-side service role can read them. The UI gets status through `get_gmail_status()`, which never returns the token.
- Only the server writes `messages`, `attachments`, `thread_contacts` and new `threads`. This guarantees HTML is sanitized before it is stored.
- Column grants limit what members can change. For example, threads only allow `status` and `assigned_to_user_id`, and contacts do not allow changing the email.
- Database triggers write deletes, assignment/status changes and Gmail account changes to `audit_log`. Calling the REST API directly cannot skip them. `audit_log` is append-only.
- The last admin cannot be demoted or deleted.
- Soft thread locks are capped at 2 minutes and renewed by a heartbeat.

> [!NOTE]
> Free-tier projects pause after 7 days with no activity. The external cron added in Stage 3 calls `/api/sync` every 1–2 minutes, which keeps the project awake.
