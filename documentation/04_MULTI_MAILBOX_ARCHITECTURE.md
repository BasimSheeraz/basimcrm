# 🛡️ Multi-Mailbox Architecture & Deliverability Rules

Basim CRM implements strict outreach deliverability protections, contact collision prevention, and personal mailbox isolation.

---

## 📬 1. Combined Team Inbox with Personal Sending Isolation

- **Combined Reading**: All three personal mailboxes sync into one unified team inbox so teammates have full visibility into client communications and avoid duplicate outreach.
- **Strict Sending Isolation**:
  - Replies on existing threads **always** send from the personal mailbox that owns the thread.
  - New outreach sends **only** from the logged-in teammate's own personal mailbox.
  - Server actions reject any attempt to send an email through a mailbox owned by another user (`403 Forbidden`).

---

## 📈 2. Automated Warm-up Schedule & Daily Caps

To protect personal Gmail domain reputation, each mailbox follows an automated warm-up schedule:

| Week | Days Active | Max Daily Sends (PKT) |
| :--- | :--- | :--- |
| **Week 1** | Days 1 – 7 | 5 emails / day |
| **Week 2** | Days 8 – 14 | 10 emails / day |
| **Week 3** | Days 15 – 21 | 15 emails / day |
| **Week 4** | Days 22 – 28 | 20 emails / day |
| **Week 5+** | Day 29+ | Configured cap (max 30 / day) |

### ⏰ Midnight PKT Reset
- Send counters reset every night at **00:00 Pakistan Standard Time (PKT / UTC+5)**.
- If an outreach attempt exceeds the daily cap, it is automatically scheduled for the next valid morning window.
- Administrator accounts can toggle **Admin Warm-up Override** in Settings if an account has already been warmed up externally.

---

## ⚠️ 3. Contact Collision Guard & DNC Protection

- **Collision Prevention**: When drafting a message to a contact that another teammate has contacted within the last 14 days, the composer displays a prominent warning with the previous owner's name and contact date.
- **Do Not Contact (DNC) List**:
  - Supports exact email exclusions (`founder@badcompany.com`) and domain-wide wildcards (`@competitor.com`).
  - Clicking **Do Not Contact** on any thread immediately blocks future outreach across **all 3 team mailboxes**.
  - Server actions validate recipient addresses against the DNC table before dispatching to Gmail API.

---

## 🔄 4. Automated Sync Engine (`/api/sync`)

- Protected by `CRON_SECRET` authorization header.
- Loops through all active accounts in `gmail_accounts` independently.
- Syncs only `INBOX` and `SENT` labels (skips Spam, Trash, Social, Promotions, and Drafts).
- First connect backfills only the last 60 days to conserve database storage.
- A failure or token expiration on one mailbox will **never** interrupt syncing for the other teammates.
