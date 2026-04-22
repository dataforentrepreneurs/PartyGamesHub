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

---

## 2. Android TV Compliance Checklist

- [x] **Focus Highlight**: Already implemented via `:focus` scale and border effects in `App.css`.
- [x] **Overscan Margins**: 5% padding added to `launcher-container`.
- [x] **Banner Image**: 320x180 banners generated and placed in `res/mipmap-*`.
- [ ] **leanback:true**: Ensure `android:banner` and `android:isGame="true"` are set in `AndroidManifest.xml`.

---

## 3. Google Play Console Requirements

Before submitting for review, ensure the following are configured in the Google Play Console:

### Store Listing Assets
- [ ] **Icon**: 512x512 PNG (Transparent).
- [x] **Feature Graphic**: 1024x500 PNG.
  - Path: `SharedAssets/feature_graphic_1024x500.png`
- [ ] **Screenshots**: At least 2 screenshots of the app.
- [ ] **TV Banner**: 320x180 PNG.
  - Path: `Games/Launcher/android/app/src/main/res/mipmap-mdpi/ic_tv_banner.png`

### App Compliance
- [x] **Privacy Policy URL**: `https://play.d4e.ai/privacy`
  - Served via: `Server/static/privacy.html`
- [ ] **App Access**: If the app requires login (not currently), provide test credentials.
- [ ] **Content Rating**: Complete the questionnaire (mostly "No" for party games).

### Testing Tracks
1. **Internal Testing**: Upload the `.aab` here first.
   - File Location: `Games/Launcher/android/app/build/outputs/bundle/release/app-release.aab`
2. **Production**: Move to production only AFTER Internal Testing is approved by Google.

---

## 4. Singapore Business Verification

Since you are based in Singapore, Google Play requires:
- **D-U-N-S Number**: If registering as an organization.
- **Identity Verification**: If registering as an individual (Singapore IC or Passport).
- **Physical Address**: Must match your verification documents.

---

## 5. Deployment to Render

1. Go to [Render Dashboard](https://dashboard.render.com).
2. Click **New** -> **Blueprint**.
3. Connect your GitHub repository.
4. Render will detect `render.yaml` and offer to create:
   - `party-games-hub` (Web Service)
   - `party-games-redis` (Redis)
5. **Set Environment Variables** in the Render Dashboard:
   - `GEMINI_API_KEY`: Your Google AI API Key (Required for DrawJudge and CoupleClash iconography).
   - `SENTRY_DSN`: Your Sentry DSN (from sentry.io).
   - `POSTHOG_API_KEY`: Your Posthog key.
   - `ENVIRONMENT`: Set to `production`.

---

## 6. Troubleshooting Production
- **404 on Icons**: Ensure `COUPLECLASH_DIST` is set and the build succeeded.
- **WebSocket Disconnection**: Verify `REDIS_URL` is connected and active on Render.

