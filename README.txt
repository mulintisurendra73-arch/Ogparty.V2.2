OG PARTY ATTRACTIVE FRONTEND
==============================

This version upgrades the previous demo with:
- Username signup: other users see the username, not the email.
- Attractive mobile-first home page.
- Live rooms discovery page.
- Create-party modal with categories.
- Real-time room chat and members.
- Profile page.
- Bottom navigation.
- Firebase Authentication + Firestore.

FILES
-----
index.html
style.css
app.js
firebase-config.js

DEPLOY TO YOUR EXISTING GITHUB PAGES REPOSITORY
------------------------------------------------
1. Replace the existing index.html, style.css and app.js with these files.
2. Keep firebase-config.js from this package.
3. Commit/push to the main branch.
4. GitHub Pages will rebuild automatically.

IMPORTANT
---------
- Firebase Email/Password Authentication must be enabled.
- Cloud Firestore must be enabled.
- The current app uses Firebase directly as the backend; a separate Node.js server is not required.
- Do not upload Firebase service-account/private-key JSON files.

USERNAME
--------
New users choose a username during signup.
Firebase Auth displayName stores the username.
Room members and messages use username instead of email.

NOTE
----
This is an original UI inspired by the general feature set described for OG Party (rooms, chat, social profile), not a copy of proprietary screens/assets.
Audio/video calls, gifts, reels and payments are visual/coming-soon areas and are not implemented in this demo.
