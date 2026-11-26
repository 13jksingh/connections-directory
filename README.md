# Connections

A local-first, installable PWA for personal contacts, conversations, and follow-ups. Contact data stays on the device and can be synchronized as encrypted snapshots to the user's own Google Drive. There is no application backend.

## Try it

Open the published site on your phone.

- **iPhone:** In Safari, tap **Share > Add to Home Screen**, then open the app from the Home Screen. Export contacts from Contacts as a `.vcf` file to import them.
- **Android:** In Chrome, use the menu's **Install app** or **Add to Home Screen** option. Export contacts as a `.vcf` file from the Contacts app to import them.

The installed app and a browser tab may use separate storage. On a new phone, install the app, connect the same Google account, and use the same encryption password to restore your data.

Use **Import contacts** to select a `.vcf` file exported from your phone. The original file may be unencrypted; delete it when no longer needed. AI search is optional: choose **Enable AI search** while online to download the model. The model runs on the device and is cached for offline use when the browser permits it. The model download can be large, and mobile performance varies.

## Connect Google Drive

Google Drive sync requires a Google OAuth client. The maintainer creates one client for the application; users do not need to create their own projects.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the **Google Drive API**. Stay on the standard free tier; no billing account is needed for it.
2. Configure Google Auth Platform branding and an **External** audience in testing. Add your Google account and each initial user's Google account as test users. Google may show a testing warning.
3. Configure the `https://www.googleapis.com/auth/drive.file` scope, which limits access to files created by or explicitly shared with the app.
4. Create an OAuth client ID for a **Web application**. Add the published site's origin, for example `https://13jksingh.github.io`, as an authorized JavaScript origin. For local testing, also add `http://localhost:5173` or your actual local origin.
5. The maintainer can place this public client ID in `public/config.json` and redeploy so every user gets it automatically. Alternatively, enter it under **Settings > Advanced** and select **Save client ID**. Never add a client secret or service-account key. Select **Connect Drive**.
6. Enter your encryption password when connecting. For the first sync, confirm the same password. Subsequent changes sync automatically while the app remains open and connected, without asking for the password again. On a new phone, connect the same Google account and enter the same password to load the Drive data.

The OAuth client ID identifies the app; it is not a secret. The encryption password is kept in memory for the current session, not sent to Google, and is not recoverable. Google authorization can expire, requiring the user to reconnect and enter the password again. The app syncs only while open, online, and authorized; check for **Saved to Drive** before closing it. Changes not yet synced exist only on that device.

The app updates one encrypted `connections-current.json` file. Existing snapshots from the previous app remain untouched and can be restored via **Settings > Backups & restore**; they continue to use Drive storage. If a phone has unsynced changes and Drive has changed since its last sync, the app pauses and asks which copy to keep. Google Drive does not provide an atomic compare-and-swap for this update, so simultaneous syncs can still overwrite each other; use one phone at a time and wait for **Saved to Drive** before switching. Update the app on all phones: older app versions still write snapshots that the new app will not see after the current file is created. Keep an independent encrypted export for recovery.

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
