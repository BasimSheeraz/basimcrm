# 🚀 Basim CRM — Quick Start Guide

Welcome to **Basim CRM**, a private client outreach CRM and multi-mailbox inbox built for **Basim** (Admin), **Ali Shah** (Member), and **Moiz Ali** (Member).

---

## ⚡ 3-Minute Setup

### Step 1: Install Node.js (If not installed)
If running on a new computer without Node.js:
- Open the `tools/` folder.
- Double-click `install_node.bat` (or run `node-v24.19.0-x64.msi`).
- Complete the standard installation prompts.

### Step 2: Configure Database (Supabase)
1. Open your [Supabase Dashboard](https://supabase.com/dashboard).
2. Go to **SQL Editor** -> **New Query**.
3. Run the SQL files from the `database/` folder in order:
   - `01_init.sql`
   - `02_production_features.sql`
   - `03_multi_mailbox.sql`
   - `04_setup_initial_team.sql`
4. Go to **Project Settings** -> **API** to copy:
   - Project URL
   - `anon` `public` API key
   - `service_role` secret key

### Step 3: Populate `.env.local`
Open `.env.local` in the project root and insert your credentials:
```env
NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
CRON_SECRET="your-secure-cron-secret-token"
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

### Step 4: Launch Basim CRM
- Simply double-click **`start_crm.bat`** (or right-click `start_crm.ps1` -> Run with PowerShell).
- The server starts on `http://localhost:3000` and automatically opens in your default browser.

---

## 🔑 Initial Login Credentials (from `04_setup_initial_team.sql`)

| Teammate | Email | Initial Password | Role |
| :--- | :--- | :--- | :--- |
| **Basim** | `basim@ourteam.io` | `AdminPassword123!` | Administrator |
| **Ali Shah** | `alishah@ourteam.io` | `TeammatePassword123!` | Outreach Member |
| **Moiz Ali** | `moiz@ourteam.io` | `TeammatePassword123!` | Outreach Member |

*(Passwords can be changed at any time by clicking your avatar -> Change Password).*
