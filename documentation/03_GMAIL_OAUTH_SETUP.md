# 📧 Google Cloud OAuth 2.0 Setup Guide

Basim CRM connects **three personal Gmail mailboxes** (Basim, Ali Shah, and Moiz Ali) through Google Cloud OAuth 2.0 using PKCE and state validation.

---

## 🛠️ Step 1: Create Google Cloud Project
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project: `Basim CRM Outreach`.
3. Enable the **Gmail API**:
   - Go to **APIs & Services** -> **Library**.
   - Search for `Gmail API` and click **Enable**.

---

## 🔑 Step 2: Configure OAuth Consent Screen
1. Go to **APIs & Services** -> **OAuth consent screen**.
2. Select User Type: **External** (or Internal if using Google Workspace).
3. Fill in:
   - App name: `Basim CRM`
   - User support email: your email
   - Developer contact email: your email
4. Click **Save and Continue**.
5. **Scopes**: Add the following scopes:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`
6. **Test Users**: While in Testing mode, add the 3 personal Gmail addresses:
   - `basim@gmail.com` (or Basim's real address)
   - `alishah@gmail.com` (or Ali's real address)
   - `moiz@gmail.com` (or Moiz's real address)

---

## ⚡ Step 3: Create Web Application Credentials
1. Go to **APIs & Services** -> **Credentials**.
2. Click **Create Credentials** -> **OAuth client ID**.
3. Application type: **Web application**.
4. Name: `Basim CRM Web Client`.
5. **Authorized JavaScript origins**:
   - `http://localhost:3000`
6. **Authorized redirect URIs**:
   - `http://localhost:3000/api/auth/callback`
7. Click **Create**.
8. Copy your **Client ID** and **Client Secret**.

---

## ⚙️ Step 4: Add to `.env.local`
Paste the credentials into your `.env.local` file:
```env
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-your-client-secret"
```

---

## 🤝 Step 5: Connecting Each Personal Mailbox
1. Log in to Basim CRM as **Basim** -> Go to **Settings** -> Click **Connect Personal Gmail**.
2. Log in as **Ali Shah** -> Go to **Settings** -> Click **Connect Personal Gmail**.
3. Log in as **Moiz Ali** -> Go to **Settings** -> Click **Connect Personal Gmail**.

Each person connects **only their own** personal mailbox. Tokens are encrypted using AES-256-GCM and stored in `gmail_accounts`. Nobody on the team can send emails from another teammate's address.
