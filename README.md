# .vibes V8 — GitHub Pages project

Complete V8 web/PWA project based on the existing Firebase project `vibes-699f5`.

## Files
- `index.html` — complete UI
- `style.css` — neon mobile UI
- `app.js` — Firebase Auth, rooms, realtime members/messages, host menu, mic and local music picker
- `firebase-config.js` — Firebase web config
- `firestore.rules` — Firestore rules
- `manifest.json` / `sw.js` — installable PWA support

## GitHub Pages
Upload all files to the same repository/folder that serves `index.html`. Enable GitHub Pages from the repository settings.

## Music
Tap 🎵 and select audio files from the phone. Browser security does not allow a GitHub Pages website to silently scan every downloaded song on the device. The user must select files using the phone file picker. Selected songs are played locally and are not uploaded to Firebase.

## Host controls
Tap a room member to open Seat Here, Mute, Unmute, Like, Kick Out, Block and View Profile. Kick/Block are restricted by the room owner check in the app and Firestore rules.

## Important
This is a web/PWA V8. It is not a native APK. Real room-wide voice/audio broadcasting still requires WebRTC signaling/media infrastructure; Firebase Firestore alone is not a media server.
