import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {getAuth,onAuthStateChanged,signInWithEmailAndPassword,createUserWithEmailAndPassword,signOut} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {getFirestore,collection,doc,setDoc,getDoc,addDoc,updateDoc,deleteDoc,onSnapshot,query,orderBy,serverTimestamp,limit} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import {firebaseConfig} from './firebase-config.js';

const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);
let me=null,currentRoom=null,currentRoomData=null,unsubRooms=null,unsubMembers=null,unsubMessages=null,stream=null,songs=[],songIndex=-1,audio=new Audio();
const peers=new Map(), signalStops=new Map(), candidateStops=new Map(), remoteAudio=new Map();
const RTC_CONFIG={iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]};
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function msg(t){$('authMsg').textContent=t}
function modal(title,body,buttons=''){ $('modalRoot').innerHTML=`<div class="overlay" id="appOverlay"><div class="sheet"><button class="close" data-close>×</button><h3>${esc(title)}</h3>${body}${buttons?`<div class="sheet-actions">${buttons}</div>`:''}</div></div>`; }
function closeModal(){$('modalRoot').innerHTML=''}
document.addEventListener('click',e=>{if(e.target.matches('[data-close]'))closeModal();});

$('signIn').onclick=async()=>{msg('');try{await signInWithEmailAndPassword(auth,$('email').value.trim(),$('password').value)}catch(e){msg(e.message)}};
$('signUp').onclick=async()=>{msg('');try{const email=$('email').value.trim(),password=$('password').value,username=$('username').value.trim()||'User';const c=await createUserWithEmailAndPassword(auth,email,password);await setDoc(doc(db,'profiles',c.user.uid),{uid:c.user.uid,username,gender:'',createdAt:serverTimestamp()});}catch(e){msg(e.message)}};
$('signOut').onclick=()=>signOut(auth);

onAuthStateChanged(auth,async u=>{me=u;if(u){$('auth').hidden=true;$('main').hidden=false;await loadProfile();listenRooms();}else{$('auth').hidden=false;$('main').hidden=true;closeRoom();}});

async function loadProfile(){
 const s=await getDoc(doc(db,'profiles',me.uid));
 const p=s.exists()?s.data():{username:me.email.split('@')[0]};
 $('myName').textContent=p.username||'User';$('myGender').textContent=p.gender||'Member';$('myId').textContent=me.uid.slice(0,10);$('myAvatar').textContent=(p.username||'U').slice(0,2).toUpperCase();
}

function listenRooms(){
 unsubRooms?.();
 unsubRooms=onSnapshot(collection(db,'rooms'),s=>{
  $('roomList').innerHTML='';
  if(s.empty){$('roomList').innerHTML='<div class="empty-state">No rooms yet. Create the first room.</div>';return}
  s.forEach(d=>{const r=d.data();$('roomList').insertAdjacentHTML('beforeend',`<button class="room-card" data-room="${d.id}"><div class="room-avatar">${esc((r.name||'R').slice(0,2).toUpperCase())}</div><div><b>${esc(r.name||'Room')}</b><small>👥 ${r.memberCount||0} people</small></div><span>›</span></button>`)})
  document.querySelectorAll('[data-room]').forEach(x=>x.onclick=()=>openRoom(x.dataset.room));
 },e=>showError('Rooms could not be loaded: '+e.message));
}

$('createRoom').onclick=async()=>{
 const name=prompt('Room name','My Vibes Room');if(!name?.trim())return;
 try{const r=await addDoc(collection(db,'rooms'),{name:name.trim(),ownerId:me.uid,memberCount:1,createdAt:serverTimestamp()});await setDoc(doc(db,'rooms',r.id,'members',me.uid),{uid:me.uid,username:$('myName').textContent,role:'host',seat:0,joinedAt:serverTimestamp()});openRoom(r.id)}catch(e){showError(e.message)}
};

async function openRoom(id){
 try{
  currentRoom=id;$('roomsView').hidden=true;$('profileCard').hidden=true;$('roomView').hidden=false;
  const rs=await getDoc(doc(db,'rooms',id));if(!rs.exists()){showError('Room no longer exists.');closeRoom();return}
  currentRoomData=rs.data();$('roomTitle').textContent=currentRoomData.name||'Room';
  const mine=await getDoc(doc(db,'rooms',id,'members',me.uid));
  if(!mine.exists()){
   const ms=await getDocsSafe(collection(db,'rooms',id,'members'));
   const used=new Set(ms.map(x=>x.seat).filter(Number.isInteger));let seat=0;while(used.has(seat)&&seat<8)seat++;
   await setDoc(doc(db,'rooms',id,'members',me.uid),{uid:me.uid,username:$('myName').textContent,role:me.uid===currentRoomData.ownerId?'host':'member',seat:seat<8?seat:null,joinedAt:serverTimestamp()});
   await updateDoc(doc(db,'rooms',id),{memberCount:ms.length+1});
  }
  unsubMembers?.();unsubMessages?.();
  unsubMembers=onSnapshot(collection(db,'rooms',id,'members'),s=>{const a=[];s.forEach(d=>a.push(d.data()));renderSeats(a,currentRoomData.ownerId);syncVoice(a).catch(e=>showError('Voice: '+e.message))},e=>showError(e.message));
  const q=query(collection(db,'rooms',id,'messages'),orderBy('createdAt','asc'),limit(100));
  unsubMessages=onSnapshot(q,s=>{$('messages').innerHTML='';s.forEach(d=>{const m=d.data();$('messages').insertAdjacentHTML('beforeend',`<div class="chat"><b>${esc(m.username||'User')}</b> ${esc(m.text||'')}</div>`)});$('messages').scrollTop=$('messages').scrollHeight},e=>showError(e.message));
 }catch(e){showError(e.message);closeRoom()}
}
async function getDocsSafe(ref){return new Promise((resolve,reject)=>{const stop=onSnapshot(ref,s=>{stop();const arr=[];s.forEach(d=>arr.push(d.data()));resolve(arr)},reject)})}

function renderSeats(members,owner){
 $('roomCount').textContent=`${members.length} people`;
 const slots=Array(8).fill(null);
 members.forEach(m=>{if(Number.isInteger(m.seat)&&m.seat>=0&&m.seat<8&&!slots[m.seat])slots[m.seat]=m});
 const unseated=members.filter(m=>!Number.isInteger(m.seat)||m.seat<0||m.seat>=8||slots[m.seat]!==m);
 for(let i=0;i<8&&unseated.length;i++){if(!slots[i])slots[i]=unseated.shift()}
 $('seats').innerHTML=slots.map((m,i)=>m?`<button class="seat" data-user="${esc(m.uid)}"><div class="seat-avatar">${esc((m.username||'U').slice(0,2).toUpperCase())}</div><small>${m.uid===owner?'👑 ':''}${esc(m.username||'User')}</small></button>`:`<button class="seat empty" data-empty-seat="${i}"><div class="seat-avatar">＋</div><small>Empty</small></button>`).join('');
 document.querySelectorAll('.seat[data-user]').forEach(b=>b.onclick=()=>showUserMenu(b.dataset.user,owner));
 document.querySelectorAll('[data-empty-seat]').forEach(b=>b.onclick=()=>sitIn(+b.dataset.emptySeat));
}
async function sitIn(seat){
 if(!currentRoom)return;
 try{await updateDoc(doc(db,'rooms',currentRoom,'members',me.uid),{seat})}catch(e){showError(e.message)}
}

async function showUserMenu(uid,owner){
 const snap=await getDoc(doc(db,'rooms',currentRoom,'members',uid));const p=snap.data()||{};const isHost=me.uid===owner;
 modal(p.username||'User',`<div class="profile-pop"><div class="big-avatar">${esc((p.username||'U').slice(0,2).toUpperCase())}</div><p>ID: ${esc(uid.slice(0,10))}</p><p>Seat: ${Number.isInteger(p.seat)?p.seat+1:'Not seated'}</p></div><div class="action-list"><button data-host="profile">👤 View Profile</button><button data-host="like">❤️ Like</button>${isHost&&uid!==me.uid?`<button data-host="seat">🪑 Move to first free seat</button><button data-host="mute">🔇 Mark muted</button><button data-host="kick" class="danger">👢 Kick Out</button><button data-host="block" class="danger">🚫 Block</button>`:''}</div>`);
 document.querySelectorAll('[data-host]').forEach(b=>b.onclick=()=>hostAction(b.dataset.host,uid,p.username||'User',owner));
}
async function hostAction(action,uid,name,owner){
 if(action==='profile'){closeModal();showProfile(uid,name);return}
 if(action==='like'){closeModal();showToast(`❤️ You liked ${name}`);return}
 if(me.uid!==owner){closeModal();showToast('Only the room host can use that control.');return}
 try{
  if(action==='kick'){await deleteDoc(doc(db,'rooms',currentRoom,'members',uid));await refreshMemberCount();showToast(`${name} was removed from the room.`)}
  else if(action==='block'){await setDoc(doc(db,'rooms',currentRoom,'members',uid),{blocked:true},{merge:true});await deleteDoc(doc(db,'rooms',currentRoom,'members',uid));await refreshMemberCount();showToast(`${name} was blocked from this room.`)}
  else if(action==='seat'){const ms=await getDocsSafe(collection(db,'rooms',currentRoom,'members'));const used=new Set(ms.map(x=>x.seat).filter(Number.isInteger));let seat=0;while(used.has(seat)&&seat<8)seat++;if(seat<8)await updateDoc(doc(db,'rooms',currentRoom,'members',uid),{seat});showToast(seat<8?`${name} moved to seat ${seat+1}.`:'All 8 seats are full.')}
  else if(action==='mute'){await updateDoc(doc(db,'rooms',currentRoom,'members',uid),{muted:true});showToast(`${name} marked muted.`)}
 }catch(e){showError(e.message)} finally{closeModal()}
}
async function refreshMemberCount(){const ms=await getDocsSafe(collection(db,'rooms',currentRoom,'members'));await updateDoc(doc(db,'rooms',currentRoom),{memberCount:ms.length})}
function showProfile(uid,name){modal(name,`<div class="profile-pop"><div class="big-avatar">${esc((name||'U').slice(0,2).toUpperCase())}</div><p>User ID: ${esc(uid.slice(0,10))}</p><p>This profile is stored in the .vibes Firebase account.</p></div>`)}

$('sendMessage').onclick=sendMessage;$('messageInput').onkeydown=e=>{if(e.key==='Enter')sendMessage()};
async function sendMessage(){const t=$('messageInput').value.trim();if(!t||!currentRoom)return;try{await addDoc(collection(db,'rooms',currentRoom,'messages'),{uid:me.uid,username:$('myName').textContent,text:t,createdAt:serverTimestamp()});$('messageInput').value=''}catch(e){showError(e.message)}}

$('micBtn').onclick=toggleMic;
async function toggleMic(){
 try{
  if(stream){
   stream.getTracks().forEach(t=>t.stop());
   stream=null;
   for(const pc of peers.values()){
    const sender=pc.getSenders().find(s=>s.track?.kind==='audio') || pc.getSenders()[0];
    if(sender) await sender.replaceTrack(null);
   }
   $('micBtn').textContent='🎙️';
   showToast('Microphone off');
   return;
  }
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone access is not supported here. Use HTTPS GitHub Pages in Chrome.');
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
  const track=stream.getAudioTracks()[0];
  for(const pc of peers.values()){
   const sender=pc.getSenders().find(s=>s.track?.kind==='audio') || pc.getSenders()[0];
   if(sender) await sender.replaceTrack(track);
  }
  $('micBtn').textContent='🔴';
  showToast('🎙️ Mic is ON — connecting your voice to room members…');
 }catch(e){showError('Microphone: '+(e.message||e.name||'permission denied'))}
}

function voiceSignalId(a,b){return [a,b].sort().join('__')}
function voiceSignalRef(a,b){return doc(db,'rooms',currentRoom,'signals',voiceSignalId(a,b))}

async function createPeer(otherUid,initiator){
 if(!currentRoom||!me||otherUid===me.uid)return null;
 if(peers.has(otherUid))return peers.get(otherUid);
 const pc=new RTCPeerConnection(RTC_CONFIG);
 peers.set(otherUid,pc);
 // Always negotiate an audio channel so a user can start the mic later without rejoining.
 const transceiver=pc.addTransceiver('audio',{direction:'sendrecv'});
 if(stream) await transceiver.sender.replaceTrack(stream.getAudioTracks()[0]);
 pc.ontrack=ev=>{
  const st=ev.streams?.[0] || new MediaStream([ev.track]);
  let el=remoteAudio.get(otherUid);
  if(!el){el=new Audio();el.autoplay=true;el.playsInline=true;el.dataset.uid=otherUid;document.body.appendChild(el);remoteAudio.set(otherUid,el)}
  el.srcObject=st;
  el.play().catch(()=>showToast('Tap the screen once to enable room audio.'));
 };
 pc.onconnectionstatechange=()=>{
  if(['failed','closed'].includes(pc.connectionState)){
   try{pc.close()}catch{}
   peers.delete(otherUid);
   remoteAudio.get(otherUid)?.remove();remoteAudio.delete(otherUid);
  }
 };
 pc.onicecandidate=async e=>{
  if(!e.candidate)return;
  try{await addDoc(collection(voiceSignalRef(me.uid,otherUid),'candidates'),{from:me.uid,to:otherUid,candidate:e.candidate.toJSON(),createdAt:serverTimestamp()})}catch(err){console.warn('ICE send failed',err)}
 };
 const sref=voiceSignalRef(me.uid,otherUid);
 if(initiator){
  const offer=await pc.createOffer();
  await pc.setLocalDescription(offer);
  await setDoc(sref,{roomId:currentRoom,callerId:me.uid,calleeId:otherUid,offer:{type:offer.type,sdp:offer.sdp},updatedAt:serverTimestamp()},{merge:true});
 }
 const stopSignal=onSnapshot(sref,async snap=>{
  if(!snap.exists()||!peers.has(otherUid))return;
  const data=snap.data();
  try{
   if(!initiator && data.offer && !pc.currentRemoteDescription){
    await pc.setRemoteDescription(data.offer);
    const answer=await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await updateDoc(sref,{answer:{type:answer.type,sdp:answer.sdp},updatedAt:serverTimestamp()});
   }else if(initiator && data.answer && pc.signalingState==='have-local-offer' && !pc.currentRemoteDescription){
    await pc.setRemoteDescription(data.answer);
   }
  }catch(err){console.warn('WebRTC signaling error',err)}
 },err=>console.warn('Signal listener',err));
 signalStops.set(otherUid,stopSignal);
 const cstop=onSnapshot(collection(sref,'candidates'),snap=>{
  snap.docChanges().forEach(async ch=>{
   if(ch.type!=='added')return;
   const c=ch.doc.data();
   if(c.from===me.uid)return;
   try{await pc.addIceCandidate(new RTCIceCandidate(c.candidate))}catch(err){console.warn('ICE candidate error',err)}
  });
 },err=>console.warn('Candidate listener',err));
 candidateStops.set(otherUid,cstop);
 return pc;
}

async function syncVoice(members){
 const ids=members.map(m=>m.uid).filter(uid=>uid&&uid!==me?.uid);
 for(const uid of ids){
  if(!peers.has(uid)){
   const initiator=me.uid.localeCompare(uid)<0;
   await createPeer(uid,initiator);
  }
 }
 for(const [uid,pc] of [...peers]){
  if(!ids.includes(uid)){
   signalStops.get(uid)?.();candidateStops.get(uid)?.();signalStops.delete(uid);candidateStops.delete(uid);
   try{pc.close()}catch{}
   peers.delete(uid);remoteAudio.get(uid)?.remove();remoteAudio.delete(uid);
  }
 }
}

function closeVoice(){
 for(const stop of signalStops.values())stop();
 for(const stop of candidateStops.values())stop();
 signalStops.clear();candidateStops.clear();
 for(const pc of peers.values()){try{pc.close()}catch{}}
 peers.clear();
 for(const el of remoteAudio.values())el.remove();
 remoteAudio.clear();
 if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}
 $('micBtn').textContent='🎙️';
}

$('audioPicker').onchange=e=>{songs=[...e.target.files].map(file=>({name:file.name,url:URL.createObjectURL(file)}));songIndex=songs.length?0:-1;if(songs.length)playSong()};
function playSong(){if(songIndex<0)return;audio.src=songs[songIndex].url;audio.play().catch(()=>{});showMusic()}
function showMusic(){const list=songs.map((s,i)=>`<button class="song" data-song="${i}">🎵 ${esc(s.name)}</button>`).join('');modal('🎵 My Music',`<p>Choose audio files stored on your phone. The browser only gets files you explicitly select.</p><button id="pickAgain">＋ Add songs</button><div class="song-list">${list||'<p>No songs selected.</p>'}</div><div class="player"><button id="prevSong">⏮</button><button id="playPause">▶/⏸</button><button id="nextSong">⏭</button></div>`);$('pickAgain').onclick=()=>$('audioPicker').click();document.querySelectorAll('[data-song]').forEach(b=>b.onclick=()=>{songIndex=+b.dataset.song;playSong()});$('prevSong').onclick=()=>{if(!songs.length)return;songIndex=(songIndex-1+songs.length)%songs.length;playSong()};$('nextSong').onclick=()=>{if(!songs.length)return;songIndex=(songIndex+1)%songs.length;playSong()};$('playPause').onclick=()=>audio.paused?audio.play():audio.pause()}

function closeRoom(){closeVoice();currentRoom=null;currentRoomData=null;unsubMembers?.();unsubMessages?.();unsubMembers=null;unsubMessages=null;$('roomView').hidden=true;if(me){$('roomsView').hidden=false;$('profileCard').hidden=false}}

function doAction(a){
 const actions={
  search:()=>{modal('Search',`<input id="searchBox" class="full-input" placeholder="Search rooms or users"><div id="searchResults" class="search-results">Type to search this page.</div>`);$('searchBox').oninput=()=>{const q=$('searchBox').value.toLowerCase();const cards=[...document.querySelectorAll('.room-card')].map(x=>x.innerText).filter(x=>x.toLowerCase().includes(q));$('searchResults').textContent=cards.length?cards.join('\n\n'):(q?'No matching rooms.':'Type to search this page.')}},
  rankings:()=>modal('🏆 Rankings','<p>Room activity rankings will appear here as members send messages and join rooms.</p><div class="rank-row">🥇 Active room host</div><div class="rank-row">🥈 Most active member</div><div class="rank-row">🥉 Rising room</div>'),
  rooms:()=>{closeModal();$('roomsView').hidden=false;$('profileCard').hidden=false;$('roomView').hidden=true},
  friends:()=>modal('👥 Friends','<p>Your friends list is empty right now.</p><button id="addFriend">＋ Add a friend by ID</button>'),
  games:()=>modal('🎮 Games','<p>Quick games</p><div class="game-grid"><button onclick="alert(\'Dice: \'+(Math.floor(Math.random()*6)+1))">🎲 Dice</button><button onclick="alert(\'You rolled a number!\')">🔢 Number</button><button onclick="alert(\'Tic-Tac-Toe board coming next.\')">⭕ Tic-Tac-Toe</button></div>'),
  profile:()=>showProfile(me.uid,$('myName').textContent),
  store:()=>modal('🏪 My Store','<p>Your store is ready for future virtual items.</p><div class="store-card">⭐ Gems balance: 0.00</div>'),
  backpack:()=>modal('🎒 Backpack','<p>Your backpack is empty.</p>'),
  referral:()=>modal('🤝 Referral',`<p>Share your invite ID with friends.</p><div class="copy-box">${esc(me.uid)}</div><button id="copyReferral">Copy ID</button>`),
  host:()=>modal('🎧 Host Center','<p>Create rooms, manage seats and moderate members from inside a room.</p>'),
  level:()=>modal('👑 Level','<p>Level 1 • 0 XP</p><div class="progress"><span></span></div>'),
  help:()=>modal('🛟 Help & Safety','<p>Use the room host controls to remove or mute members. Do not share private information.</p>'),
  settings:()=>modal('⚙️ Settings','<label class="setting"><input type="checkbox" id="soundSetting" checked> Interface sounds</label><label class="setting"><input type="checkbox" id="compactSetting"> Compact room cards</label>'),
  copyId:async()=>{try{await navigator.clipboard.writeText(me.uid);showToast('User ID copied')}catch{showToast(me.uid)}},
  speaker:()=>{audio.muted=!audio.muted;showToast(audio.muted?'Speaker muted':'Speaker on')},
  music:()=>showMusic(),
  mic:()=>toggleMic(),
  emoji:()=>{$('messageInput').value+=' ❤️';$('messageInput').focus()},
  closeRoom,share:()=>shareRoom(),roomMore:()=>modal('Room options','<p>Room controls</p><button id="leaveRoom">Leave room</button>')
 };
 actions[a]?.();
}
async function shareRoom(){const url=location.href;try{if(navigator.share)await navigator.share({title:'.vibes room',text:`Join ${$('roomTitle').textContent} on .vibes`,url});else{await navigator.clipboard.writeText(url);showToast('Room link copied')}}catch{}}
function showToast(t){$('toast').textContent=t;$('toast').hidden=false;clearTimeout(window.__toast);window.__toast=setTimeout(()=>$('toast').hidden=true,2500)}
function showError(t){$('toast').textContent=t;$('toast').hidden=false;clearTimeout(window.__toast);window.__toast=setTimeout(()=>$('toast').hidden=true,5000)}

document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b)doAction(b.dataset.action);if(e.target.id==='leaveRoom')closeModal()});
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
