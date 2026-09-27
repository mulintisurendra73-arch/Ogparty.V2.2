# .vibes V8.2 — real room voice

GitHub Pages + Firebase Auth/Firestore + WebRTC mesh voice.

## What changed
- The room microphone now uses WebRTC `RTCPeerConnection` to send the microphone track to other people in the same room.
- Firebase Firestore is used only for WebRTC signaling (offer/answer/ICE candidates).
- Each room member gets an audio peer connection; up to 8 seats means a small peer-to-peer mesh.
- The mic button turns the local track on/off for all connected peers.
- Room audio is played through hidden HTML audio elements.

## Firebase rules
Publish `firestore.rules` in Firebase Console > Firestore Database > Rules. The rules include the `rooms/{roomId}/signals` signaling path.

## Important network note
This version uses public Google STUN servers. WebRTC can connect directly on many networks, but some carrier/mobile/strict NAT networks require a TURN server for reliable voice. For production voice across all networks, add a TURN service (for example coturn/Cloudflare Calls/LiveKit/Agora) and put its ICE server credentials in `RTC_CONFIG` in `app.js`.

## How to test
1. Deploy the files to GitHub Pages over HTTPS.
2. Publish the included Firestore rules.
3. Open the same room on two different phones/accounts.
4. Join the same room on both devices.
5. Allow microphone permission on the speaking device.
6. Press the microphone button. The other phone should receive the voice when the WebRTC connection succeeds.
7. Use headphones during testing to avoid feedback/echo.

The WebRTC media is peer-to-peer; Firebase does not carry the microphone audio itself.
