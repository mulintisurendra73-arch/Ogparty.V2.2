.vibes V6
=========

This is a rebuilt version intended to fix the V5 runtime problems.

Features:
- Firebase Email/Password login
- Profile photo, username, bio, gender and ID
- Chatroom list with room DP and member DPs
- 8 visible room slots
- Real microphone permission with getUserMedia()
- WebRTC voice for small rooms using Firestore signaling
- Mute/unmute and speaker control
- Real-time room chat
- Private messages
- Authorized direct-audio music player
- Dice, Tic-Tac-Toe and Number Guess
- Mobile-first .vibes design
- Firebase connection status indicator

DEPLOY:
1. Extract this ZIP.
2. Upload all files to the ROOT of your GitHub repository:
   index.html
   style.css
   app.js
   firebase-config.js
   firestore.rules
   README.txt
3. GitHub Settings -> Pages -> Deploy from branch -> main -> / (root).
4. Firebase Console -> Firestore Database -> Rules -> paste firestore.rules -> Publish.
5. Firebase Console -> Authentication -> Sign-in method -> enable Email/Password.
6. Open the GitHub Pages HTTPS URL.
7. Allow microphone permission when you press 🎙️ in a room.

MICROPHONE:
- The site must be HTTPS.
- Android browser must allow microphone permission.
- If the browser shows a blocked microphone permission, open browser site permissions and allow Microphone.
- WebRTC is peer-to-peer and uses Google public STUN servers. Some networks need a TURN server for reliable calls.
- The app does NOT contain a private Firebase service-account key.

PROFILE PHOTOS:
Photos are compressed in the browser and stored in Firestore as data URLs, so Firebase Storage is not required for this version. Keep photos reasonably small.

IMPORTANT:
The voice mesh is suitable for small rooms. A large production voice service should use a dedicated media server/provider.
