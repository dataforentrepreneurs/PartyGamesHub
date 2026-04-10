# PartyGamesHub Production Release Guide

This guide covers the critical steps to move from local development to a live Play Store presence.

## 1. Play Store Release Strategy

### Keystore Generation (Digital Signing)
To upload your app to Google Play, you need a Keystore file (.jks).
Run this command in your terminal (Replace `MY_PASSWORD` with a strong password):

```bash
keytool -genkey -v -keystore partygameshub.jks -keyalg RSA -keysize 2048 -validity 10000 -alias my-alias
```

> [!CAUTION]
> **DO NOT LOSE THIS FILE.** If you lose it, you cannot update your app ever again. Back it up in Google Drive or a physical USB drive.

### Configure Android Project for Signing
1. Open `Games/Launcher/android/app/build.gradle`.
2. Add your signing configuration (don't commit passwords to Git; use environment variables or `local.properties`).

---

## 2. Android TV Compliance Checklist

- [x] **Focus Highlight**: Already implemented via `:focus` scale and border effects in `App.css`.
- [x] **Overscan Margins**: 5% padding added to `launcher-container`.
- [ ] **Banner Image**: You MUST provide a 320x180 banner in `res/drawable` for the Android TV home screen.
- [ ] **leanback:true**: Ensure `android:banner` and `android:isGame="true"` are set in `AndroidManifest.xml`.

---

## 3. Singapore Business Verification

Since you are based in Singapore, Google Play requires:
- **D-U-N-S Number**: If registering as an organization.
- **Identity Verification**: If registering as an individual (Singapore IC or Passport).
- **Physical Address**: Must match your verification documents.

---

## 4. Deployment to Render

1. Go to [Render Dashboard](https://dashboard.render.com).
2. Click **New** -> **Blueprint**.
3. Connect your GitHub repository.
4. Render will detect `render.yaml` and offer to create:
   - `party-games-hub` (Web Service)
   - `party-games-redis` (Redis)
5. **Set Environment Variables** in the Render Dashboard:
   - `GEMINI_API_KEY`: Your Google AI API Key.
   - `SENTRY_DSN`: Your Sentry DSN (from sentry.io).
   - `POSTHOG_API_KEY`: Your Posthog key.
