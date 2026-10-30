# Lumen for Android and iOS

React Native (Expo) app for Lumen. Android is built and tested; the iOS code is in place but not built yet (it needs a Mac or Expo's cloud build and an Apple Developer account).

## What it does

- Home, libraries, search, title pages, seasons and episodes, My List.
- Native player (ExoPlayer on Android). It plays the original file whenever the phone can decode it (MKV, HEVC, AC3/EAC3 where the phone has the decoder) and switches audio tracks inside the file without restarting. Otherwise the server converts only what's needed.
- Subtitles (text subtitles rendered by the app, picture subtitles burned in by the server), skip intro, skip credits, next episode, seek previews, picture-in-picture, lock-screen controls.
- Downloads: the original file, through Android's background downloader (keeps going when the app is closed). Artwork and text subtitles are saved alongside. Progress made offline syncs back when Lumen can be reached again.
- Watch together: start or join a party (invite links are the same as the website's), with sync, chat and reactions.
- Requests through Seerr, and admin screens (server status, who's watching, library scans, user access).

## Sign-in

The app opens Pocket ID in a browser tab. The server sends it back to `lumen://auth` with a one-time code, which the app trades for a session token with a verifier only it knows (`/api/auth/app-token`). The token is kept in the phone's secure storage and sent as `Authorization: Bearer`. Pocket ID needs no changes.

## Building (Android)

Needs JDK 17 and the Android SDK (`~/Android/jdk17`, `~/Android/Sdk` on the build machine).

```sh
npm install
npx expo prebuild --platform android --clean
cd android
JAVA_HOME=~/Android/jdk17 ANDROID_HOME=~/Android/Sdk ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

Release builds are signed with the key named in `~/.gradle/gradle.properties` (`LUMEN_STORE_FILE`, `LUMEN_STORE_PASSWORD`, `LUMEN_KEY_ALIAS`, `LUMEN_KEY_PASSWORD`; see `plugins/withReleaseSigning.js`). Keep that keystore backed up: updates must be signed with the same key, or the app has to be uninstalled first (which deletes downloads).

## Developing

`npx expo run:android` builds a debug app and starts Metro for live reload. `npm run typecheck` checks types.

The native module in `modules/lumen-device` reports the phone's decoders to the server.
