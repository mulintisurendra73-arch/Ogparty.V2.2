import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updateProfile } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { getFirestore, collection, doc, setDoc, getDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp, limit, getDocs, arrayUnion } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let me = null;
let profile = null;
let currentRoom = null;
let currentRoomData = null;
let currentDM = null;
let dmUnsub = null;
let dmListUnsub = null;
let unsubRooms = null;
let unsubMembers = null;
let unsubMessages = null;
let micStream = null;
let micBlocked = false;
let songs = [];
let songIndex = -1;
const audio = new Audio();
const peers = new Map();
const signalStops = new Map();
const candidateStops = new Map();
const remoteAudio = new Map();
const pendingCandidates = new Map();
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials = s => String(s || 'User').trim().split(/\s+/).map(x => x[0]).join('').slice(0,2).toUpperCase() || 'U';

function toast(text, error=false) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(window.__toast);
  window.__toast = setTimeout(() => $('toast').hidden = true, error ? 6000 : 2600);
}
function authMsg(text) { $('authMsg').textContent = text || ''; }
function friendlyError(e) {
  const code = e?.code || '';
  const map = {
    'auth/invalid-credential':'Email or password is incorrect.',
    'auth/email-already-in-use':'That email is already registered.',
    'auth/weak-password':'Password must be at least 6 characters.',
    'auth/invalid-email':'Enter a valid email address.',
    'permission-denied':'Firebase denied this operation. Publish the V8.4 Firestore rules.'
  };
  return map[code] || e?.message || 'Something went wrong.';
}

function modal(title, body, buttons='') {
  $('modalRoot').innerHTML = `<div class="overlay" id="appOverlay"><div class="sheet"><button class="close" data-close>×</button><h3>${esc(title)}</h3>${body}${buttons ? `<div class="sheet-actions">${buttons}</div>` : ''}</div></div>`;
}
function closeModal() { $('modalRoot').innerHTML = ''; }
function avatarMarkup(name, photo, cls='') {
  return photo ? `<div class="avatar ${cls}"><img src="${esc(photo)}" alt=""></div>` : `<div class="avatar ${cls}">${esc(initials(name))}</div>`;
}
function seatAvatar(name, photo) {
  return photo ? `<div class="seat-avatar"><img src="${esc(photo)}" alt=""></div>` : `<div class="seat-avatar">${esc(initials(name))}</div>`;
}

// ---------- Authentication ----------
$('signIn').onclick = async () => {
  authMsg('');
  try {
    await signInWithEmailAndPassword(auth, $('email').value.trim(), $('password').value);
  } catch (e) { authMsg(friendlyError(e)); }
};

$('signUp').onclick = async () => {
  authMsg('');
  try {
    const email = $('email').value.trim();
    const password = $('password').value;
    const username = $('username').value.trim() || 'User';
    if (!email || password.length < 6) throw new Error('Enter an email and a password of at least 6 characters.');
    const c = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(c.user, { displayName: username });
    await setDoc(doc(db, 'profiles', c.user.uid), {
      uid: c.user.uid, username, gender: '', bio: '', photoURL: '',
      friendsCount: 0, followingCount: 0, followersCount: 0, visitorsCount: 0,
      dmPeers: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
  } catch (e) { authMsg(friendlyError(e)); }
};
$('signOut').onclick = () => signOut(auth);

onAuthStateChanged(auth, async user => {
  me = user;
  if (!user) {
    $('auth').hidden = false;
    $('main').hidden = true;
    closeRoom();
    closeDM();
    unsubRooms?.(); unsubRooms = null;
    dmListUnsub?.(); dmListUnsub = null;
    return;
  }
  $('auth').hidden = true;
  $('main').hidden = false;
  try {
    await loadProfile();
    listenRooms();
    listenDMList();
    showView('home');
  } catch (e) { toast('Profile: ' + friendlyError(e), true); }
});

// ---------- Profile ----------
async function loadProfile() {
  const ref = doc(db, 'profiles', me.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    profile = {
      uid: me.uid,
      username: me.displayName || me.email?.split('@')[0] || 'User',
      gender: '', bio: '', photoURL: '', friendsCount: 0,
      followingCount: 0, followersCount: 0, visitorsCount: 0, dmPeers: []
    };
    await setDoc(ref, {...profile, createdAt: serverTimestamp(), updatedAt: serverTimestamp()});
  } else {
    profile = snap.data();
  }
  renderProfile();
}
function renderProfile() {
  const name = profile?.username || me?.displayName || 'User';
  $('profileName').textContent = name;
  $('profileGender').textContent = profile?.gender || 'Member';
  $('profileId').textContent = me?.uid?.slice(0,10) || '—';
  $('profileBio').textContent = profile?.bio || 'No bio yet.';
  $('statFriends').textContent = profile?.friendsCount || 0;
  $('statFollowing').textContent = profile?.followingCount || 0;
  $('statFollowers').textContent = profile?.followersCount || 0;
  $('statVisitors').textContent = profile?.visitorsCount || 0;
  $('profileAvatar').outerHTML = profile?.photoURL
    ? `<div id="profileAvatar" class="avatar large"><img src="${esc(profile.photoURL)}" alt=""></div>`
    : `<div id="profileAvatar" class="avatar large">${esc(initials(name))}</div>`;
  $('pageSubtitle').textContent = `Hi, ${name}`;
}

function openEditProfile() {
  const name = profile.username || 'User';
  modal('Edit profile', `
    <div class="profile-edit-head">
      <div id="editAvatarWrap">${avatarMarkup(name, profile.photoURL, 'edit-avatar')}</div>
      <div><button id="changePhoto" class="change-photo">📷 Change photo</button><div class="subtitle">Photo is compressed and stored in Firestore. No Storage upgrade is required.</div></div>
    </div>
    <label>Username<input id="editName" value="${esc(name)}" maxlength="40"></label>
    <label>Gender<select id="editGender"><option value="">Prefer not to say</option><option value="Male">Male</option><option value="Female">Female</option><option value="Other">Other</option></select></label>
    <label>Bio<textarea id="editBio" maxlength="160" placeholder="Tell people about you...">${esc(profile.bio || '')}</textarea></label>
    <div id="profileFormError" class="form-error"></div>`,
    `<button id="cancelEdit" class="secondary">Cancel</button><button id="saveProfile">Save changes</button>`
  );
  $('editGender').value = profile.gender || '';
  $('changePhoto').onclick = () => $('photoPicker').click();
  $('photoPicker').onchange = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await compressImage(file);
      window.__pendingPhoto = data;
      $('editAvatarWrap').innerHTML = avatarMarkup(name, data, 'edit-avatar');
    } catch (err) { $('profileFormError').textContent = err.message; }
  };
  $('cancelEdit').onclick = closeModal;
  $('saveProfile').onclick = saveProfile;
}
function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Please choose an image.'));
    const reader = new FileReader();
    const img = new Image();
    reader.onload = () => {
      img.onload = () => {
        const max = 300;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const out = c.toDataURL('image/jpeg', .72);
        if (out.length > 850000) return reject(new Error('Photo is still too large. Choose another image.'));
        resolve(out);
      };
      img.onerror = () => reject(new Error('Could not read image.'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Could not read image.'));
    reader.readAsDataURL(file);
  });
}
async function saveProfile() {
  const name = $('editName').value.trim() || 'User';
  const gender = $('editGender').value;
  const bio = $('editBio').value.trim();
  const photo = window.__pendingPhoto !== undefined ? window.__pendingPhoto : (profile.photoURL || '');
  $('profileFormError').textContent = 'Saving...';
  try {
    await updateDoc(doc(db, 'profiles', me.uid), {
      username: name, gender, bio, photoURL: photo, updatedAt: serverTimestamp()
    });
    await updateProfile(me, { displayName: name });
    profile = {...profile, username:name, gender, bio, photoURL:photo};
    delete window.__pendingPhoto;
    renderProfile();
    if (currentRoom) {
      await updateDoc(doc(db, 'rooms', currentRoom, 'members', me.uid), {username:name, photoURL:photo});
    }
    closeModal();
    toast('✓ Profile updated successfully');
  } catch (e) { $('profileFormError').textContent = friendlyError(e); }
}

// ---------- Rooms ----------
function listenRooms() {
  unsubRooms?.();
  unsubRooms = onSnapshot(collection(db, 'rooms'), async snap => {
    const rooms = snap.docs.map(d => ({id:d.id, ...d.data()}));
    rooms.sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    await renderRoomList('roomList', rooms);
    await renderRoomList('homeRooms', rooms.slice(0,3));
  }, e => toast('Rooms: ' + friendlyError(e), true));
}
async function roomOwner(room) {
  if (!room.ownerId) return null;
  const s = await getDoc(doc(db, 'profiles', room.ownerId));
  return s.exists() ? s.data() : null;
}
async function renderRoomList(id, rooms) {
  const el = $(id);
  if (!el) return;
  if (!rooms.length) {
    el.innerHTML = '<div class="empty-panel"><b>No rooms yet</b><span>Create the first room.</span></div>';
    return;
  }
  const html = [];
  for (const r of rooms) {
    const owner = await roomOwner(r);
    html.push(`<button class="room-card" data-room="${esc(r.id)}"><div class="room-avatar">${owner?.photoURL ? `<img src="${esc(owner.photoURL)}" alt="">` : esc(initials(r.name))}</div><div><b>${esc(r.name || 'Room')}</b><small>👥 ${r.memberCount || 0} people${owner?.username ? ` • ${esc(owner.username)}` : ''}</small></div><span class="arrow">›</span></button>`);
  }
  el.innerHTML = html.join('');
  el.querySelectorAll('[data-room]').forEach(b => b.onclick = () => openRoom(b.dataset.room));
}
async function createRoom() {
  const name = prompt('Room name', 'My Vibes Room');
  if (!name?.trim()) return;
  try {
    const r = await addDoc(collection(db, 'rooms'), {
      name:name.trim(), ownerId:me.uid, memberCount:1, createdAt:serverTimestamp()
    });
    await setDoc(doc(db,'rooms',r.id,'members',me.uid), {
      uid:me.uid, username:profile.username || 'User', photoURL:profile.photoURL || '',
      role:'host', seat:0, muted:false, micOn:false, joinedAt:serverTimestamp()
    });
    await openRoom(r.id);
  } catch(e) { toast(friendlyError(e), true); }
}
$('createRoom').onclick = createRoom;
$('heroCreate').onclick = createRoom;
$('homeSeeRooms').onclick = () => showView('rooms');

async function openRoom(id) {
  try {
    currentRoom = id;
    currentRoomData = (await getDoc(doc(db,'rooms',id))).data();
    if (!currentRoomData) throw new Error('Room no longer exists.');
    $('roomTitle').textContent = currentRoomData.name || 'Room';
    $('roomView').hidden = false;
    document.body.style.overflow = 'hidden';

    const memberRef = doc(db,'rooms',id,'members',me.uid);
    const mine = await getDoc(memberRef);
    if (!mine.exists()) {
      const ms = await getDocs(collection(db,'rooms',id,'members'));
      const used = new Set(ms.docs.map(x => x.data().seat).filter(Number.isInteger));
      let seat = 0; while (used.has(seat) && seat < 8) seat++;
      await setDoc(memberRef, {
        uid:me.uid, username:profile.username || 'User', photoURL:profile.photoURL || '',
        role:me.uid === currentRoomData.ownerId ? 'host' : 'member', seat:seat < 8 ? seat : null,
        muted:false, micOn:false, joinedAt:serverTimestamp()
      });
    }
    await updateMemberCount();

    unsubMembers?.();
    unsubMessages?.();
    unsubMembers = onSnapshot(collection(db,'rooms',id,'members'), snap => {
      const members = snap.docs.map(d => ({id:d.id,...d.data()}));
      const own = members.find(m => m.uid === me.uid);
      micBlocked = !!own?.muted;
      if (micBlocked && micStream) micStream.getAudioTracks().forEach(t => t.enabled = false);
      $('roomCount').textContent = `${members.length} people`;
      renderSeats(members, currentRoomData.ownerId);
      syncVoice(members).catch(console.warn);
    }, e => toast(friendlyError(e), true));

    const q = query(collection(db,'rooms',id,'messages'),orderBy('createdAt','asc'),limit(100));
    unsubMessages = onSnapshot(q, snap => {
      $('messages').innerHTML = snap.docs.map(d => {
        const m=d.data();
        return `<div class="chat"><b>${esc(m.username || 'User')}</b><span>${esc(m.text || '')}</span></div>`;
      }).join('');
      $('messages').scrollTop = $('messages').scrollHeight;
    }, e => toast(friendlyError(e), true));
  } catch(e) { toast(friendlyError(e), true); closeRoom(); }
}

async function updateMemberCount() {
  if (!currentRoom) return;
  const s = await getDocs(collection(db,'rooms',currentRoom,'members'));
  await updateDoc(doc(db,'rooms',currentRoom), {memberCount:s.size});
}

async function leaveRoom() {
  if (!currentRoom) return;
  try {
    await stopMic(true);
    await deleteDoc(doc(db,'rooms',currentRoom,'members',me.uid));
    await updateMemberCount();
  } catch(e) { console.warn(e); }
  closeRoom();
}

function closeRoom() {
  closeVoice();
  unsubMembers?.(); unsubMessages?.();
  unsubMembers = null; unsubMessages = null;
  currentRoom = null; currentRoomData = null;
  $('roomView').hidden = true;
  document.body.style.overflow = '';
}

async function renderSeats(members, ownerId) {
  const slots = Array(8).fill(null);
  members.forEach(m => { if(Number.isInteger(m.seat) && m.seat >= 0 && m.seat < 8 && !slots[m.seat]) slots[m.seat] = m; });
  const loose = members.filter(m => !Number.isInteger(m.seat) || m.seat < 0 || m.seat >= 8 || slots[m.seat] !== m);
  for(let i=0;i<8 && loose.length;i++) if(!slots[i]) slots[i]=loose.shift();
  $('seats').innerHTML = slots.map((m,i) => m
    ? `<button class="seat" data-user="${esc(m.uid)}"><div class="seat-wrap">${seatAvatar(m.username,m.photoURL)}${m.micOn && !m.muted ? '<span class="mic-dot">🎙️</span>' : ''}</div><small>${m.uid===ownerId?'👑 ':''}${esc(m.username || 'User')}</small></button>`
    : `<button class="seat empty" data-empty-seat="${i}"><div class="seat-avatar">＋</div><small>Empty</small></button>`).join('');
  $('seats').querySelectorAll('[data-user]').forEach(b => b.onclick=()=>showUserMenu(b.dataset.user,ownerId));
  $('seats').querySelectorAll('[data-empty-seat]').forEach(b=>b.onclick=()=>sitIn(+b.dataset.emptySeat));
}
async function sitIn(seat) {
  try {
    const ms=await getDocs(collection(db,'rooms',currentRoom,'members'));
    if(ms.docs.some(d => d.data().seat === seat && d.id !== me.uid)) return toast('That seat is occupied.',true);
    await updateDoc(doc(db,'rooms',currentRoom,'members',me.uid),{seat});
    toast(`You are in seat ${seat+1}`);
  } catch(e) { toast(friendlyError(e),true); }
}

async function showUserMenu(uid,ownerId) {
  const s = await getDoc(doc(db,'rooms',currentRoom,'members',uid));
  const m = s.data() || {};
  modal(m.username || 'User', `<div class="profile-pop">${avatarMarkup(m.username,m.photoURL,'big-avatar')}<p>User ID: ${esc(uid.slice(0,10))}</p><p>Seat: ${Number.isInteger(m.seat) ? m.seat+1 : 'Not seated'}</p><p>${m.muted ? '🔇 Muted by host' : (m.micOn ? '🎙️ Mic on' : 'Mic off')}</p></div><div class="action-list"><button data-host-action="profile">👤 View Profile</button><button data-host-action="message">💬 Message</button><button data-host-action="like">❤️ Like</button>${me.uid===ownerId&&uid!==me.uid ? `<button data-host-action="seat">🪑 Move to first free seat</button><button data-host-action="mute">${m.muted?'🔊 Unmute':'🔇 Mute'}</button><button data-host-action="kick" class="danger">👢 Kick Out</button>` : ''}</div>`);
  document.querySelectorAll('[data-host-action]').forEach(b=>b.onclick=()=>hostAction(b.dataset.hostAction,uid,m.username||'User',ownerId,m.muted));
}
async function hostAction(action,uid,name,ownerId,isMuted) {
  if(action==='profile'){closeModal();showUserProfile(uid,name);return;}
  if(action==='message'){closeModal();openDM(uid,name);return;}
  if(action==='like'){closeModal();toast(`❤️ You liked ${name}`);return;}
  if(me.uid!==ownerId){toast('Only the host can use that control.',true);return;}
  try {
    if(action==='kick') {
      await deleteDoc(doc(db,'rooms',currentRoom,'members',uid));
      await updateMemberCount();
      toast(`${name} removed.`);
    }
    if(action==='mute') {
      await updateDoc(doc(db,'rooms',currentRoom,'members',uid),{muted:!isMuted});
      toast(`${name} ${isMuted?'unmuted':'muted'}.`);
    }
    if(action==='seat') {
      const ms=await getDocs(collection(db,'rooms',currentRoom,'members'));
      const used=new Set(ms.docs.map(d=>d.data().seat).filter(Number.isInteger));
      let seat=0; while(used.has(seat)&&seat<8) seat++;
      if(seat<8){await updateDoc(doc(db,'rooms',currentRoom,'members',uid),{seat});toast(`${name} moved to seat ${seat+1}.`)}
      else toast('All 8 seats are full.',true);
    }
  } catch(e) { toast(friendlyError(e),true); }
  finally { closeModal(); }
}

async function showUserProfile(uid,name) {
  const snap=await getDoc(doc(db,'profiles',uid));
  const p=snap.exists()?snap.data():{username:name};
  modal(p.username||name, `<div class="profile-pop">${avatarMarkup(p.username||name,p.photoURL,'big-avatar')}<p><b>${esc(p.username||name)}</b></p><p>${esc(p.gender||'Member')}</p><p>${esc(p.bio||'No bio yet.')}</p><p>User ID: ${esc(uid.slice(0,10))}</p></div><div class="action-list"><button id="profileMessage">💬 Send message</button></div>`);
  $('profileMessage').onclick=()=>{closeModal();openDM(uid,p.username||name)};
}

// ---------- Room chat ----------
$('sendMessage').onclick = sendMessage;
$('messageInput').onkeydown = e => { if(e.key==='Enter') sendMessage(); };
async function sendMessage() {
  const text=$('messageInput').value.trim();
  if(!text || !currentRoom) return;
  try {
    await addDoc(collection(db,'rooms',currentRoom,'messages'),{uid:me.uid,username:profile.username||'User',text,createdAt:serverTimestamp()});
    $('messageInput').value='';
  } catch(e) { toast(friendlyError(e),true); }
}

// ---------- Voice / WebRTC ----------
$('micBtn').onclick = toggleMic;
async function toggleMic() {
  if(micBlocked) return toast('The host has muted your microphone.',true);
  if(micStream) return stopMic(false);
  try {
    if(!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone requires the HTTPS GitHub Pages address.');
    micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    micStream.getAudioTracks().forEach(t=>t.enabled=true);
    for(const pc of peers.values()) {
      const sender=pc.getSenders().find(x=>x.track?.kind==='audio' || (!x.track && x.transceiver?.receiver?.track?.kind==='audio'));
      if(sender) await sender.replaceTrack(micStream.getAudioTracks()[0]);
    }
    await updateDoc(doc(db,'rooms',currentRoom,'members',me.uid),{micOn:true});
    $('micBtn').textContent='🔴';
    toast('🎙️ Mic is ON — room members can hear you.');
  } catch(e) { toast('Microphone: '+friendlyError(e),true); }
}
async function stopMic(silent=false) {
  if(!micStream) return;
  micStream.getTracks().forEach(t=>t.stop());
  micStream=null;
  for(const pc of peers.values()) {
    const sender=pc.getSenders().find(x=>x.track?.kind==='audio');
    if(sender) await sender.replaceTrack(null).catch(()=>{});
  }
  if(currentRoom) await updateDoc(doc(db,'rooms',currentRoom,'members',me.uid),{micOn:false}).catch(()=>{});
  $('micBtn').textContent='🎙️';
  if(!silent) toast('Microphone off');
}
function pairId(a,b){return [a,b].sort().join('__');}
function signalRef(other){return doc(db,'rooms',currentRoom,'signals',pairId(me.uid,other));}
async function createPeer(other,initiator) {
  if(peers.has(other) || !currentRoom || other===me.uid) return peers.get(other);
  const pc=new RTCPeerConnection(RTC_CONFIG);
  peers.set(other,pc);
  pendingCandidates.set(other,[]);
  const trans=pc.addTransceiver('audio',{direction:'sendrecv'});
  if(micStream) await trans.sender.replaceTrack(micStream.getAudioTracks()[0]);
  pc.ontrack=e=>{
    const stream=e.streams?.[0] || new MediaStream([e.track]);
    let el=remoteAudio.get(other);
    if(!el){
      el=new Audio(); el.autoplay=true; el.playsInline=true; el.setAttribute('aria-label','Room voice');
      document.body.appendChild(el); remoteAudio.set(other,el);
    }
    el.srcObject=stream;
    el.play().catch(()=>toast('Tap the page once to allow room audio.',true));
  };
  pc.onicecandidate=async e=>{
    if(!e.candidate)return;
    try { await addDoc(collection(signalRef(other),'candidates'),{from:me.uid,candidate:e.candidate.toJSON(),createdAt:serverTimestamp()}); } catch{}
  };
  const ref=signalRef(other);
  const stop=onSnapshot(ref,async snap=>{
    if(!snap.exists() || !peers.has(other)) return;
    const d=snap.data();
    try {
      if(!initiator && d.offer && !pc.currentRemoteDescription){
        await pc.setRemoteDescription(d.offer);
        const answer=await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await updateDoc(ref,{answer:{type:answer.type,sdp:answer.sdp},updatedAt:serverTimestamp()});
        for(const c of pendingCandidates.get(other)||[]) await pc.addIceCandidate(c);
        pendingCandidates.set(other,[]);
      } else if(initiator && d.answer && pc.signalingState==='have-local-offer' && !pc.currentRemoteDescription){
        await pc.setRemoteDescription(d.answer);
        for(const c of pendingCandidates.get(other)||[]) await pc.addIceCandidate(c);
        pendingCandidates.set(other,[]);
      }
    } catch(err){ console.warn('WebRTC signaling',err); }
  },()=>{});
  signalStops.set(other,stop);
  const cstop=onSnapshot(collection(ref,'candidates'),snap=>{
    snap.docChanges().forEach(async ch=>{
      if(ch.type!=='added')return;
      const c=ch.doc.data(); if(c.from===me.uid)return;
      const ice=new RTCIceCandidate(c.candidate);
      if(pc.remoteDescription) pc.addIceCandidate(ice).catch(()=>{});
      else pendingCandidates.get(other)?.push(ice);
    });
  },()=>{});
  candidateStops.set(other,cstop);
  if(initiator){
    const offer=await pc.createOffer();
    await pc.setLocalDescription(offer);
    await setDoc(ref,{callerId:me.uid,calleeId:other,offer:{type:offer.type,sdp:offer.sdp},updatedAt:serverTimestamp()},{merge:true});
  }
  return pc;
}
async function syncVoice(members){
  const ids=members.map(x=>x.uid).filter(x=>x && x!==me.uid);
  for(const uid of ids) if(!peers.has(uid)) await createPeer(uid,me.uid.localeCompare(uid)<0);
  for(const [uid,pc] of [...peers]) if(!ids.includes(uid)){
    signalStops.get(uid)?.(); candidateStops.get(uid)?.();
    try{pc.close()}catch{}
    peers.delete(uid); pendingCandidates.delete(uid);
    remoteAudio.get(uid)?.remove(); remoteAudio.delete(uid);
  }
}
function closeVoice(){
  for(const f of signalStops.values())f(); for(const f of candidateStops.values())f();
  signalStops.clear(); candidateStops.clear(); pendingCandidates.clear();
  for(const p of peers.values())try{p.close()}catch{}
  peers.clear();
  for(const a of remoteAudio.values())a.remove(); remoteAudio.clear();
  if(micStream){micStream.getTracks().forEach(t=>t.stop());micStream=null;}
  $('micBtn').textContent='🎙️';
}

// ---------- Music ----------
$('audioPicker').onchange=e=>{
  songs=[...e.target.files].map(f=>({name:f.name,url:URL.createObjectURL(f)}));
  songIndex=songs.length?0:-1;
  if(songs.length) playSong();
};
function playSong(){if(songIndex<0)return;audio.src=songs[songIndex].url;audio.play().catch(()=>{});showMusic();}
function showMusic(){
  modal('🎵 My Music',`<p class="subtitle">Select audio files already downloaded on your phone. Chrome only exposes files you choose.</p><button id="pickAgain">＋ Add songs</button><div class="song-list">${songs.length?songs.map((s,i)=>`<button class="song" data-song="${i}">🎵 ${esc(s.name)}</button>`).join(''):'<p class="subtitle">No songs selected.</p>'}</div><div class="player"><button id="prevSong">⏮</button><button id="playPause">▶ / ⏸</button><button id="nextSong">⏭</button></div>`);
  $('pickAgain').onclick=()=>$('audioPicker').click();
  document.querySelectorAll('[data-song]').forEach(b=>b.onclick=()=>{songIndex=+b.dataset.song;playSong();});
  $('prevSong').onclick=()=>{if(!songs.length)return;songIndex=(songIndex-1+songs.length)%songs.length;playSong();};
  $('nextSong').onclick=()=>{if(!songs.length)return;songIndex=(songIndex+1)%songs.length;playSong();};
  $('playPause').onclick=()=>audio.paused?audio.play():audio.pause();
}

// ---------- Private messages ----------
function dmId(a,b){return [a,b].sort().join('__');}
function listenDMList(){
  dmListUnsub?.();
  dmListUnsub=onSnapshot(doc(db,'profiles',me.uid), async snap=>{
    const ids=snap.exists()?snap.data().dmPeers||[]:[];
    const items=[];
    for(const uid of ids){const s=await getDoc(doc(db,'profiles',uid));if(s.exists())items.push({uid,...s.data()});}
    const el=$('dmList');
    if(!items.length){el.innerHTML='<div class="empty-panel">💬<b>No private chats</b><span>Open a room member and tap Message.</span></div>';return;}
    el.innerHTML=items.map(p=>`<button class="dm-card" data-dm-user="${esc(p.uid)}"><div>${avatarMarkup(p.username,p.photoURL)}</div><div><b>${esc(p.username||'User')}</b><small>${esc(p.bio||'Private conversation')}</small></div><span>›</span></button>`).join('');
    el.querySelectorAll('[data-dm-user]').forEach(b=>b.onclick=async()=>{const uid=b.dataset.dmUser;const s=await getDoc(doc(db,'profiles',uid));openDM(uid,s.exists()?(s.data().username||'User'):'User');});
  });
}
async function openDM(uid,name){
  if(uid===me.uid)return;
  const id=dmId(me.uid,uid);
  currentDM={id,uid,name};
  await setDoc(doc(db,'dms',id),{participants:[me.uid,uid],updatedAt:serverTimestamp()},{merge:true});
  await updateDoc(doc(db,'profiles',me.uid),{dmPeers:arrayUnion(uid)});
  await updateDoc(doc(db,'profiles',uid),{dmPeers:arrayUnion(me.uid)}).catch(()=>{});
  showView('messages');
  $('dmPanel').hidden=false; $('dmList').hidden=true; $('dmTitle').textContent=name;
  dmUnsub?.();
  const q=query(collection(db,'dms',id,'messages'),orderBy('createdAt','asc'),limit(100));
  dmUnsub=onSnapshot(q,snap=>{
    $('dmMessages').innerHTML=snap.docs.map(d=>{const m=d.data();return `<div class="chat ${m.from===me.uid?'mine':''}"><b>${m.from===me.uid?'You':esc(name)}</b><span>${esc(m.text||'')}</span></div>`}).join('');
    $('dmMessages').scrollTop=$('dmMessages').scrollHeight;
  },e=>toast(friendlyError(e),true));
}
function closeDM(){
  dmUnsub?.(); dmUnsub=null; currentDM=null;
  const panel=$('dmPanel'), list=$('dmList');
  if(panel){panel.hidden=true;} if(list){list.hidden=false;}
}
$('dmSend').onclick=sendDM;
$('dmInput').onkeydown=e=>{if(e.key==='Enter')sendDM();};
$('closeDm').onclick=closeDM;
async function sendDM(){
  const text=$('dmInput').value.trim(); if(!text||!currentDM)return;
  try{await addDoc(collection(db,'dms',currentDM.id,'messages'),{from:me.uid,text,createdAt:serverTimestamp()});$('dmInput').value='';await updateDoc(doc(db,'dms',currentDM.id),{updatedAt:serverTimestamp()});}
  catch(e){toast(friendlyError(e),true);}
}

// ---------- Navigation ----------
const views=['home','rooms','messages','profile'];
function showView(name){
  if(currentRoom) closeRoom();
  views.forEach(v=>$(v+'View').hidden=v!==name);
  document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===name));
  if(name!=='messages') closeDM();
  window.scrollTo(0,0);
}
document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>showView(b.dataset.nav));

// ---------- Buttons / dialogs ----------
document.addEventListener('click',e=>{
  if(e.target.matches('[data-close]')){closeModal();return;}
  const b=e.target.closest('[data-action]');
  if(!b)return;
  const a=b.dataset.action;
  if(a==='closeRoom')closeRoom();
  if(a==='editProfile')openEditProfile();
  if(a==='copyId')navigator.clipboard?.writeText(me.uid).then(()=>toast('User ID copied')).catch(()=>toast(me.uid));
  if(a==='search')modal('Search','<input id="searchBox" placeholder="Search rooms..."><div id="searchResults" class="search-results">Start typing.</div>');
  if(a==='rankings')modal('🏆 Rankings','<div class="rank-row">⭐ Active rooms</div><div class="rank-row">🎙️ Room hosts</div><div class="rank-row">🔥 Rising members</div><p class="subtitle">These are feature placeholders; no paid ranking system is enabled.</p>');
  if(a==='store')modal('🏪 My Store','<p>Your store is ready for virtual items.</p><div class="store-card">⭐ Gems balance: 0.00</div>');
  if(a==='backpack')modal('🎒 Backpack','<p>Your backpack is empty.</p>');
  if(a==='referral')modal('🤝 Referral',`<p>Share your invite ID with friends.</p><div class="copy-box">${esc(me.uid)}</div><button id="copyReferral">Copy ID</button>`);
  if(a==='host')modal('🎧 Host Center','<p>Inside your room you can move seats, mute members and remove members.</p>');
  if(a==='level')modal('👑 Level','<p>Level 1 • 0 XP</p>');
  if(a==='help')modal('🛟 Help & Safety','<p>Use block/report tools when you add them. Do not share passwords or private information.</p>');
  if(a==='settings')modal('⚙️ Settings','<label class="setting"><input type="checkbox" checked> Interface sounds</label><label class="setting"><input type="checkbox"> Compact cards</label>');
  if(a==='speaker'){audio.muted=!audio.muted;toast(audio.muted?'Speaker muted':'Speaker on');}
  if(a==='music')showMusic();
  if(a==='emoji'){$('messageInput').value+=' ❤️';$('messageInput').focus();}
  if(a==='share')shareRoom();
  if(a==='roomMore')modal('Room options','<button id="leaveRoom" class="danger">Leave room</button>');
});
document.addEventListener('input',e=>{
  if(e.target.id==='searchBox'){
    const q=e.target.value.toLowerCase();
    const cards=[...document.querySelectorAll('#roomList .room-card')].map(x=>x.innerText).filter(x=>x.toLowerCase().includes(q));
    $('searchResults').textContent=cards.length?cards.join('\n\n'):(q?'No matching rooms.':'Start typing.');
  }
});
document.addEventListener('click',e=>{
  if(e.target.id==='copyReferral')navigator.clipboard?.writeText(me.uid).then(()=>toast('Referral ID copied')).catch(()=>toast(me.uid));
  if(e.target.id==='leaveRoom'){closeModal();leaveRoom();}
});

async function shareRoom(){
  if(!currentRoom)return;
  const url=location.href;
  try{if(navigator.share)await navigator.share({title:'.vibes room',text:`Join ${$('roomTitle').textContent} on .vibes`,url});else{await navigator.clipboard.writeText(url);toast('Room link copied');}}catch{}
}

if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
