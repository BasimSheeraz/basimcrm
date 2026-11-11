# 💼 Basim CRM — Complete Production Package

> Private client outreach CRM with multi-mailbox isolation, real PostgreSQL database, Row Level Security, TOTP 2FA, and deliverability protection.

---

## 📦 What's Included in this Package (`G:\basim_crm`)

- **Application Source Code**: Complete Next.js 14 App Router application with Tailwind CSS, Lucide icons, and Apple glassmorphism interface.
- **Pre-installed Dependencies (`node_modules`)**: Turnkey, ready to run without waiting for package downloads.
- **Offline Node.js Installer (`tools/`)**: Official `node-v24.19.0-x64.msi` installer ready for offline installations.
- **Database Migrations (`database/`)**: Numbered PostgreSQL scripts ready to run in Supabase SQL Editor.
- **One-Click Launchers**:
  - `start_crm.bat`: One-click Windows desktop launcher.
  - `start_crm.ps1`: Advanced PowerShell launcher.
  - `clean_restart.bat`: Cache-cleaning restart script.
  - `build_test.bat`: Production compilation verification script.
- **Documentation (`documentation/`)**: Complete guides for quick start, database setup, Gmail OAuth, and multi-mailbox architecture.

---

## ⚡ How to Run

1. **First-time setup**: Configure `.env.local` with your Supabase & Google keys (see `documentation/01_QUICK_START.md`).
2. **Start the CRM**: Double-click **`start_crm.bat`**.
3. **Access the CRM**: Open your browser to `http://localhost:3000`.

---

## 👥 The 3-Person Team Structure

- **Basim** (`basim@ourteam.io`): Administrator — manages team members, global caps, and DNC exclusions.
- **Ali Shah** (`alishah@ourteam.io`): Outreach Member — sends outreach and manages assigned pipeline.
- **Moiz Ali** (`moiz@ourteam.io`): Outreach Member — sends outreach and manages assigned pipeline.

---

## 🛡️ Key Features

- **Multi-Mailbox Isolation**: 3 personal Gmail mailboxes feeding into one unified team inbox.
- **Safe Sending**: Nobody can send emails from another teammate's address.
- **Warm-up Protection**: Automatic daily send limits resetting at midnight PKT.
- **Collision Guard**: Prevents teammates from stepping on each other's leads.
- **Universal DNC List**: Permanent email and domain-wide blocks across all accounts.
- **Two-Factor Authentication**: Supabase MFA with TOTP and one-time emergency recovery codes.
