# Authentication & Cloud Backup Setup

Still works out of the box with local browser storage and JSON Export/Import. Below are two ways to add cloud sign-in for your users.

---

## Option 1: Let Anyone Sign In with Google (Google Drive Backup)

Right now, Still supports browser-only Google Drive backup using the non-sensitive [`drive.file` scope](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), which only accesses `Still Meditation Backup.json` and requires no backend server.

### Step 1: Add your GitHub Pages origin
1. Open the [Google Cloud Console](https://console.cloud.google.com/) and select your project.
2. Confirm the **Google Drive API** is enabled under **APIs & Services → Library**.
3. Go to **Google Auth Platform → Clients** and open your **Web application** OAuth client.
4. Under **Authorized JavaScript origins**, add your GitHub Pages origin (scheme + domain only, no trailing slash or repo path):
   - `https://YOUR-USERNAME.github.io`
   - `http://localhost:4173` (optional, for local testing)
5. Copy your **Client ID** (ends in `.apps.googleusercontent.com`) and paste it into `config.js`:
   ```js
   window.STILL_CONFIG = {
     googleClientId: "YOUR_REAL_ID.apps.googleusercontent.com"
   };
   ```

### Step 2: Switch from Testing to In Production (for public users)
In **Testing** mode, Google limits sign-in to up to 100 manually listed test emails ([Manage App Audience](https://support.google.com/cloud/answer/15549945?hl=en)). To allow anyone with a Google account to sign in:
1. Go to **Google Auth Platform → Branding** and fill in:
   - **Application home page**: `https://YOUR-USERNAME.github.io/still/`
   - **Privacy policy link**: `https://YOUR-USERNAME.github.io/still/privacy.html` (already included in this repo)
   - **Authorized domain**: `github.io` (or your custom domain)
2. Go to **Google Auth Platform → Audience** and click **Publish App** to move from **Testing** to **In Production**.
3. Because `drive.file` is a **non-sensitive** scope, follow **Google Auth Platform → Verification Center** for basic brand/app verification so users see your app name cleanly without an unverified-app warning ([OAuth brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)).

---

## Option 2: Add Email/Password + Google + Sign in with Apple

GitHub Pages only hosts static files (HTML/CSS/JS). Supporting **Email/Password** or **Sign in with Apple** requires a managed auth + database service to verify logins and store sessions:

- **[Supabase Auth](https://supabase.com/docs/guides/auth)** (free tier, Postgres database with Row Level Security) — supports [Email/Password](https://supabase.com/docs/guides/auth/passwords), [Google](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), and [Sign in with Apple](https://supabase.com/docs/guides/auth/social-sign-in/auth-apple).
- **[Firebase Authentication](https://firebase.google.com/docs/auth/web/start)** (free tier + Firestore) — supports Email/Password, Google, and Sign in with Apple directly from static sites hosted on GitHub Pages.

> **Note on Sign in with Apple**: Apple requires an active paid [Apple Developer Program](https://developer.apple.com/programs/) membership to register a primary App ID, a web Services ID, and a private signing key ([Configure Sign in with Apple for the web](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/)).
