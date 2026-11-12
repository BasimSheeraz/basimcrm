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
- **Warm-up Protection**: Automatic daily send limits resetting at midnight PKT (Week 1: 5/day, Week 2: 10/day, Week 3: 15/day, Week 4+: 20/day, Hard max: 30/day).
- **Collision Guard**: Prevents teammates from stepping on each other's leads with 15-minute soft locks.
- **Universal DNC List**: Permanent email and domain-wide blocks across all accounts.
- **Two-Factor Authentication**: Supabase MFA with TOTP and one-time emergency recovery codes.

---

## 🎯 Deliverability Protection & Anti-Spam Architecture

> **Honest Deliverability Disclosure**:
> No software can guarantee 100% inbox placement. Free personal `@gmail.com` accounts do not have custom domain SPF/DKIM/DMARC records configured under your own domain name. These automated system protections, algorithmic pacing, and real-time content checks are engineered to minimize spam filter triggers and protect your sender reputation.

### Team Anti-Spam Best Practices Checklist
1. **Real Name & Profile Photo**: Ensure each connected personal Google Account has an authentic sender name and professional profile picture. Gmail algorithms penalize anonymous placeholder accounts.
2. **Authentic DKIM Signatures**: The CRM intentionally omits artificial `Message-ID` headers, allowing Google's infrastructure to automatically stamp an authentic DKIM signature and canonical `@mail.gmail.com` identifier on every message.
3. **Short & Personal Copy**: Keep outreach emails between 20 and 200 words. Reference specific prospect details. Avoid link shorteners, attachments in initial emails, and spam trigger phrases.
4. **No Mass Pitch Copy-Pasting**: The CRM enforces an 85% token-similarity guard against all team outreach sent in the last 14 days, preventing Google from flagging identical templates.
5. **Strict Opt-Out Respect**: Follow-up cadence automatically stops immediately upon receiving a reply, bounce, or negative response. Opt-outs are automatically added to the universal Do Not Contact list.
6. **Smart Pacing & Burst Guards**: Outreach sends are paced with randomized 60–180 second delays during local business hours (9:00–18:00 PKT), with a hard limit of at most 3 sends in any 10-minute window per mailbox.
