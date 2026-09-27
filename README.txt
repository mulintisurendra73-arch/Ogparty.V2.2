.vibes V5
====================

This version is designed from the uploaded reference screens with an original .vibes UI.

Included:
- Firebase Email/Password authentication
- Profile picture, username, bio, gender
- Persistent profile ID
- Chatroom cards with room DP, member DPs and live member count
- 8 visible voice slots per room
- Real microphone permission using getUserMedia()
- Small-room WebRTC voice mesh with Firestore signaling
- Mute/unmute microphone state synced to room
- Speaker mute/unmute for remote audio
- Real-time room text chat
- Private 1-to-1 messages
- Room music player for authorized direct audio URLs
- Dice, Tic-Tac-Toe and Number Guess games
- Mobile-first design
- GitHub Pages compatible

Firebase:
Project: vibes-699f5
Web configuration is already inside firebase-config.js.

IMPORTANT:
1. Deploy firestore.rules in Firebase Console -> Firestore Database -> Rules.
2. Enable Authentication -> Email/Password.
3. For the microphone, GitHub Pages must be HTTPS. Browser microphone permission is not available on ordinary HTTP pages.
4. WebRTC uses public Google STUN servers. Some mobile networks may require TURN for difficult NATs. For a larger production app, add a TURN server.
5. The voice implementation is a peer-to-peer mesh intended for small rooms. It is not a replacement for a scalable media server.
6. Profile photos are compressed and stored as data URLs in Firestore, so Firebase Storage is not required for this demo. Keep photos small.
7. Do not upload Firebase service-account/private-key JSON to GitHub.
8. Only play music you own or are authorized to stream. Browser autoplay rules can require the user to press play.

GitHub Pages:
Upload all files to the repository root:
index.html
style.css
app.js
firebase-config.js
firestore.rules
README.txt

Then:
GitHub -> Settings -> Pages -> Deploy from branch -> main -> /root -> Save.

Firestore security:
The included rules are suitable for this demo. For production, tighten DM and WebRTC signaling authorization further and use a server-authoritative backend for coins, gifts and payments.
