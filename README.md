# Connections

A local-first, installable PWA for personal contacts, conversations, and follow-ups. Contact data stays on the device and can be synchronized as encrypted snapshots to the user's own Google Drive. There is no application backend.

## Try it

Open the published site on your phone. On iPhone, use Safari's **Share > Add to Home Screen**, then open the Home Screen app. On Android, use the browser's **Install app** or **Add to Home Screen** option. The installed app and a browser tab may use separate storage.

Use **Import contacts** to select a `.vcf` file exported from your phone. The original file may be unencrypted; delete it when no longer needed. AI search is optional: choose **Enable AI search** while online to download the model. The model runs on the device and is cached for offline use when the browser permits it. The model download can be large, and mobile performance varies.

## Connect Google Drive

Google Drive sync requires a Google OAuth client. The maintainer creates one client for the application; users do not need to create their own projects.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the **Google Drive API**. Stay on the standard free tier; no billing account is needed for it.
2. Configure Google Auth Platform branding and an **External** audience in testing. Add your Google account and each initial user's Google account as test users. Google may show a testing warning.
3. Configure the `https://www.googleapis.com/auth/drive.file` scope, which limits access to files created by or explicitly shared with the app.
4. Create an OAuth client ID for a **Web application**. Add the published site's origin, for example `https://13jksingh.github.io`, as an authorized JavaScript origin. For local testing, also add `http://localhost:5173` or your actual local origin.
5. In Settings, paste the client ID and select **Save client ID**, then **Connect Drive**. Alternatively, the maintainer can place this public client ID in `public/config.json` and redeploy so every user gets it automatically. Never add a client secret or service-account key.
6. Select **Sync now** and enter a password. For the first sync, confirm the same password. On another phone, connect the same Google account and restore a Drive version using that password.

The OAuth client ID identifies the app; it is not a secret. The encryption password is not sent to Google and is not recoverable. Google authorization can expire, requiring the user to reconnect. The app syncs only while open, online, and authorized; check for **Saved to Drive** before closing it. Changes not yet synced exist only on that device.

Each upload creates an encrypted snapshot rather than overwriting an existing file. If another device has a different version, the app asks the user which copy to keep. Snapshots accumulate in the user's Drive and use their storage quota. Google Drive is not a substitute for keeping an independent encrypted export. Multi-device behavior should be tested with real accounts before relying on it.

## Develop

```sh
npm ci
npm test
npm run dev
npm run build
```

The GitHub Pages workflow builds and deploys `dist` when changes are pushed to `main`. Enable Pages with **GitHub Actions** as the source in the repository settings. The site uses a relative base path for project Pages.

## Limits

- Google Cloud's free tier, Google Drive quotas, and hosting terms may change.
- Password-protected exports and Drive snapshots use AES-GCM with a PBKDF2-derived key; local browser data is not separately encrypted by the app.
- Browser data can be cleared or lost. A file saved only on the same phone is not a recovery backup.
- PWA reminders are displayed inside the app; closed-app notifications are not supported.
- AI search and actual Google sign-in should be tested on the intended iPhone. Google Drive sync requires an OAuth client and internet connectivity.
