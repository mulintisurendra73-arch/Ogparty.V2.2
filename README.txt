.vibes V4 — Firebase + GitHub Pages starter

Included and functional:
- .vibes branding
- Email/password Firebase Auth
- Public username, bio and gender profile fields
- Firebase Firestore live rooms, members and room chat
- Private 1-to-1 text messages using Firebase UID
- Direct audio URL music player (user-provided/authorized audio only)
- Dice and number-guess games
- Firestore-synced Tic-Tac-Toe inside a room
- Microphone permission/local microphone toggle
- GitHub Pages-ready static frontend

Important:
1. Upload the files to the repository root; index.html must be at root.
2. Publish firestore.rules in Firebase Console > Firestore Database > Rules.
3. firebase-config.js is already included for project vibes-699f5.
4. GitHub Pages cannot run a private server. Real multi-user group audio/1-to-1 calling needs a media/signaling backend such as LiveKit, Agora, or WebRTC signaling. The Mic button in this V4 only requests local microphone permission.
5. Gifts/coins/payments and Reels upload/storage are not implemented as a real-money system in this package. Do not put payment secrets in frontend code.
6. For copyrighted music, use audio you own or have permission to stream. Browser autoplay may require a user tap.
7. The DM rules here restrict messages based on from/to fields, but a production app should also use a parent conversation document and membership validation.

Deploy: extract ZIP -> upload all files to GitHub repo root -> Settings -> Pages -> Deploy from main/root.
