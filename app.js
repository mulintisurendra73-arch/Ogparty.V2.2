import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, updateProfile, signOut
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, addDoc, updateDoc, deleteDoc,
  getDoc, getDocs, query, orderBy, limit, onSnapshot, serverTimestamp,
  where
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = id => document.getElementById(id);
const toast = msg => { $("toast").textContent = msg; $("toast").classList.add("show"); setTimeout(()=>$("toast").classList.remove("show"),2300); };
const esc = s => String(s ?? "").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const fallbackAvatar = name => "data:image/svg+xml;charset=UTF-8,"+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><defs><linearGradient id="g"><stop stop-color="#8b44ed"/><stop offset="1" stop-color="#35d3a4"/></linearGradient></defs><rect width="160" height="160" rx="80" fill="url(#g)"/><text x="80" y="98" text-anchor="middle" font-size="60" fill="white" font-family="Arial">${esc((name||"V").trim().slice(0,1).toUpperCase())}</text></svg>`);

let me = null, myProfile = null, roomsUnsub = null, currentRoom = null;
let roomMembersUnsub = null, roomMessagesUnsub = null, dmUnsub = null;
let currentDm = null, peerConnections = new Map(), processedSignals = new Set();
let localStream = null, micEnabled = false, speakerEnabled = true;
let remoteAudios = new Map();

function avatar(p){ return p?.avatar || fallbackAvatar(p?.name || "V"); }
function profileRef(uid){ return doc(db,"profiles",uid); }
function convoId(a,b){ return [a,b].sort().join("_"); }
function fmtTime(ts){ if(!ts?.toDate) return ""; return ts.toDate().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}); }

onAuthStateChanged(auth, async user=>{
  me = user;
  if(!user){ $("authScreen").classList.remove("hidden"); $("app").classList.add("hidden"); return; }
  $("authScreen").classList.add("hidden"); $("app").classList.remove("hidden");
  await loadProfile();
  startRooms();
  renderProfile();
});

$("signInBtn").onclick = async ()=>{
  try{ await signInWithEmailAndPassword(auth,$("authEmail").value.trim(),$("authPassword").value); }
  catch(e){ toast(e.message.replace("Firebase: ","")); }
};
$("signUpBtn").onclick = async ()=>{
  const email=$("authEmail").value.trim(), pass=$("authPassword").value, name=$("authName").value.trim()||email.split("@")[0];
  if(pass.length<6) return toast("Password must be at least 6 characters");
  try{
    const c=await createUserWithEmailAndPassword(auth,email,pass);
    await updateProfile(c.user,{displayName:name});
    await setDoc(profileRef(c.user.uid),{name,bio:"",gender:"",avatar:"",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    toast("Account created");
  }catch(e){toast(e.message.replace("Firebase: ",""))}
};

async function loadProfile(){
  const snap=await getDoc(profileRef(me.uid));
  if(snap.exists()) myProfile={uid:me.uid,...snap.data()};
  else {
    myProfile={uid:me.uid,name:me.displayName||"Vibes User",bio:"",gender:"",avatar:""};
    await setDoc(profileRef(me.uid),{...myProfile,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  }
}
function renderProfile(){
  const p=myProfile||{};
  $("profileAvatar").src=avatar(p); $("profileName").textContent=p.name||"Vibes User";
  $("profileGender").textContent=p.gender||"Gender not set"; $("profileId").textContent=me.uid.slice(0,10);
  $("profileBio").textContent=p.bio||"Add a short bio about yourself.";
}
function switchScreen(id){
  ["homeScreen","messagesScreen","profileScreen"].forEach(x=>$(x).classList.toggle("hidden",x!==id));
  document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.screen===id));
  if(id==="messagesScreen") startDmList();
}
document.querySelectorAll(".nav-btn").forEach(btn=>btn.onclick=()=>{
  switchScreen(btn.dataset.screen);
  if(btn.dataset.openTab) openTab(btn.dataset.openTab);
});
function openTab(tab){
  document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
  ["roomsTab","friendsTab","gamesTab"].forEach(x=>$(x).classList.toggle("hidden",x!==tab+"Tab"));
}
document.querySelectorAll(".tab").forEach(btn=>btn.onclick=()=>openTab(btn.dataset.tab));

async function ensureDemoRooms(){
  const snap=await getDocs(query(collection(db,"rooms"),limit(1)));
  if(!snap.empty) return;
  const examples=[
    ["Honey Room","ASVP • chill music","#ffdccc"],
    ["sree laxmi","devil's room","#f0d0ff"],
    ["5 star ✨","friends lounge","#e4f6c8"],
    ["Kavya ♡","Telugu Vibes","#ffd9cf"]
  ];
  for(const [name,topic,color] of examples){
    await addDoc(collection(db,"rooms"),{name,topic,color,ownerId:me.uid,ownerName:myProfile.name,ownerAvatar:myProfile.avatar||"",createdAt:serverTimestamp()});
  }
}
async function startRooms(){
  await ensureDemoRooms();
  if(roomsUnsub) roomsUnsub();
  roomsUnsub=onSnapshot(query(collection(db,"rooms"),orderBy("createdAt","desc")),snap=>{
    $("roomList").innerHTML="";
    snap.forEach(d=>renderRoomCard(d.id,d.data()));
  },e=>toast("Room list: "+e.message));
}
async function renderRoomCard(id,r){
  const card=document.createElement("article"); card.className="room-card";
  const membersSnap=await getDocs(query(collection(db,"rooms",id,"members"),limit(5)));
  const members=membersSnap.docs.map(d=>d.data());
  const count=members.length;
  card.innerHTML=`<img class="room-cover" src="${avatar({name:r.ownerName,avatar:r.ownerAvatar})}" alt="">
    <div class="room-info"><div class="room-name">${esc(r.name)}</div>
    <div class="room-topic">${esc(r.topic||"Welcome")}</div>
    <div class="mini-avatars">${members.map(m=>`<img class="avatar xs" src="${avatar(m)}">`).join("")}</div></div>
    <div class="room-count">◉ ${count}</div>`;
  card.onclick=()=>enterRoom(id,r);
  $("roomList").appendChild(card);
}

$("createRoomBtn").onclick=()=>{$("roomModal").classList.remove("hidden");};
$("saveRoomBtn").onclick=async()=>{
  const name=$("roomNameInput").value.trim()||`${myProfile.name}'s room`;
  const topic=$("roomTopicInput").value.trim()||"Let's vibe";
  const ref=await addDoc(collection(db,"rooms"),{name,topic,ownerId:me.uid,ownerName:myProfile.name,ownerAvatar:myProfile.avatar||"",createdAt:serverTimestamp()});
  $("roomModal").classList.add("hidden"); $("roomNameInput").value=""; $("roomTopicInput").value="";
  enterRoom(ref.id,{name,topic}); 
};
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>$(b.dataset.close).classList.add("hidden"));

async function enterRoom(id,r){
  currentRoom={id,...r};
  $("roomScreen").classList.remove("hidden");
  $("roomTitle").textContent=r.name||"Room"; $("roomIdText").textContent=id.slice(0,8);
  await setDoc(doc(db,"rooms",id,"members",me.uid),{uid:me.uid,name:myProfile.name,avatar:myProfile.avatar||"",gender:myProfile.gender||"",mic:false,joinedAt:serverTimestamp()});
  listenRoomMembers(id); listenRoomMessages(id);
}
async function leaveRoom(){
  if(!currentRoom) return;
  try{ await deleteDoc(doc(db,"rooms",currentRoom.id,"members",me.uid)); }catch{}
  cleanupAudio();
  if(roomMembersUnsub) roomMembersUnsub(); if(roomMessagesUnsub) roomMessagesUnsub();
  currentRoom=null; $("roomScreen").classList.add("hidden");
}
$("leaveRoomBtn").onclick=leaveRoom;
$("shareRoomBtn").onclick=async()=>{try{await navigator.clipboard.writeText(location.href+"#room="+currentRoom.id);toast("Room link copied")}catch{toast("Copy failed")}};

let membersCache=[];
function listenRoomMembers(id){
  if(roomMembersUnsub) roomMembersUnsub();
  roomMembersUnsub=onSnapshot(collection(db,"rooms",id,"members"),snap=>{
    membersCache=snap.docs.map(d=>d.data());
    $("roomSub").textContent=`${membersCache.length} people`;
    renderSlots();
    syncPeers();
  });
}
function renderSlots(){
  const slots=Array.from({length:8},(_,i)=>membersCache[i]);
  $("slotGrid").innerHTML=slots.map(m=>m?`<div class="slot">
    <img class="slot-avatar" src="${avatar(m)}">
    <span class="mic-state">${m.mic?"🎙️":"🔇"}</span>
    <span class="slot-name">${esc(m.name)}</span>
  </div>`:`<div class="slot"><div class="slot-chair">＋</div><span class="slot-name">Empty</span></div>`).join("");
}
function listenRoomMessages(id){
  if(roomMessagesUnsub) roomMessagesUnsub();
  roomMessagesUnsub=onSnapshot(query(collection(db,"rooms",id,"messages"),orderBy("createdAt","asc"),limit(100)),snap=>{
    $("roomMessages").innerHTML="";
    snap.forEach(d=>{const m=d.data(); const row=document.createElement("div");row.className="room-msg";row.innerHTML=`<img class="avatar xs" src="${avatar(m)}"><div class="msg-text"><b>${esc(m.name)}</b><br>${esc(m.text)} <small>${fmtTime(m.createdAt)}</small></div>`;$("roomMessages").appendChild(row)});
    $("roomMessages").scrollTop=$("roomMessages").scrollHeight;
  });
}
async function sendRoomMessage(){
  const text=$("roomMessageInput").value.trim(); if(!text||!currentRoom)return;
  await addDoc(collection(db,"rooms",currentRoom.id,"messages"),{uid:me.uid,name:myProfile.name,avatar:myProfile.avatar||"",text,createdAt:serverTimestamp()});
  $("roomMessageInput").value="";
}
$("sendRoomMessageBtn").onclick=sendRoomMessage;
$("roomMessageInput").onkeydown=e=>{if(e.key==="Enter")sendRoomMessage()};
document.querySelectorAll(".emoji-btn").forEach(b=>b.onclick=()=>{$("roomMessageInput").value+=b.dataset.emoji;$("roomMessageInput").focus()});

async function toggleMic(){
  if(!currentRoom) return;
  if(!localStream){
    try{localStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});}
    catch(e){toast("Microphone permission denied or unavailable");return;}
  }
  micEnabled=!micEnabled;
  localStream.getAudioTracks().forEach(t=>t.enabled=micEnabled);
  await updateDoc(doc(db,"rooms",currentRoom.id,"members",me.uid),{mic:micEnabled});
  for(const pc of peerConnections.values()){
    const sender=pc.getSenders().find(s=>s.track?.kind==="audio");
    if(micEnabled && !sender){
      localStream.getTracks().forEach(track=>pc.addTrack(track,localStream));
    }else if(sender){sender.track.enabled=micEnabled;}
  }
  $("micBtn").classList.toggle("mic-on",micEnabled); $("micBtn").classList.toggle("mic-off",!micEnabled);
  toast(micEnabled?"Microphone on":"Microphone muted");
}
$("micBtn").onclick=toggleMic;

function makePeer(remote){
  if(peerConnections.has(remote)) return peerConnections.get(remote);
  const pc=new RTCPeerConnection({iceServers:[
    {urls:"stun:stun.l.google.com:19302"},
    {urls:"stun:stun1.l.google.com:19302"}
  ]});
  peerConnections.set(remote,pc);
  if(localStream) localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
  pc.onicecandidate=async e=>{
    if(e.candidate&&currentRoom) await addDoc(collection(db,"rooms",currentRoom.id,"signals"),{from:me.uid,to:remote,type:"candidate",candidate:e.candidate.toJSON(),createdAt:serverTimestamp()});
  };
  pc.ontrack=e=>{
    let audio=remoteAudios.get(remote);
    if(!audio){audio=new Audio();audio.autoplay=true;audio.playsInline=true;remoteAudios.set(remote,audio);}
    audio.srcObject=e.streams[0]; audio.muted=!speakerEnabled; audio.play().catch(()=>toast("Tap speaker to allow room audio"));
  };
  pc.onconnectionstatechange=()=>{if(["failed","closed","disconnected"].includes(pc.connectionState)){pc.close();peerConnections.delete(remote);}};
  return pc;
}
async function createOffer(remote){
  const pc=makePeer(remote);
  const offer=await pc.createOffer(); await pc.setLocalDescription(offer);
  await addDoc(collection(db,"rooms",currentRoom.id,"signals"),{from:me.uid,to:remote,type:"offer",sdp:{type:offer.type,sdp:offer.sdp},createdAt:serverTimestamp()});
}
async function handleSignal(id,s){
  if(s.to!==me.uid || processedSignals.has(id)) return;
  processedSignals.add(id);
  const pc=makePeer(s.from);
  if(s.type==="offer"){
    await pc.setRemoteDescription(s.sdp);
    const answer=await pc.createAnswer(); await pc.setLocalDescription(answer);
    await addDoc(collection(db,"rooms",currentRoom.id,"signals"),{from:me.uid,to:s.from,type:"answer",sdp:{type:answer.type,sdp:answer.sdp},createdAt:serverTimestamp()});
  }else if(s.type==="answer"){
    await pc.setRemoteDescription(s.sdp);
  }else if(s.type==="candidate"){
    try{await pc.addIceCandidate(s.candidate)}catch{}
  }
}
let signalsUnsub=null;
function syncPeers(){
  if(!currentRoom)return;
  const remotes=membersCache.map(m=>m.uid).filter(uid=>uid!==me.uid);
  remotes.forEach(uid=>makePeer(uid));
  // Deterministic initiator prevents offer collisions.
  remotes.filter(uid=>me.uid<uid).forEach(uid=>{
    const pc=peerConnections.get(uid);
    if(pc && pc.signalingState==="stable" && !pc.localDescription) createOffer(uid).catch(()=>{});
  });
  if(signalsUnsub)signalsUnsub();
  signalsUnsub=onSnapshot(query(collection(db,"rooms",currentRoom.id,"signals"),orderBy("createdAt","asc"),limit(300)),snap=>{
    snap.docChanges().forEach(ch=>{if(ch.type==="added")handleSignal(ch.doc.id,ch.doc.data())});
  });
}
function cleanupAudio(){
  if(signalsUnsub){signalsUnsub();signalsUnsub=null}
  peerConnections.forEach(pc=>pc.close()); peerConnections.clear(); processedSignals.clear();
  remoteAudios.forEach(a=>{a.pause();a.srcObject=null});remoteAudios.clear();
  if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null}
  micEnabled=false; $("micBtn").classList.remove("mic-on"); $("micBtn").classList.add("mic-off");
}
$("speakerBtn").onclick=()=>{
  speakerEnabled=!speakerEnabled; remoteAudios.forEach(a=>a.muted=!speakerEnabled);
  $("speakerBtn").textContent=speakerEnabled?"🔊":"🔇";
};
$("musicBtn").onclick=()=>$("musicPanel").classList.toggle("hidden");
$("loadMusicBtn").onclick=()=>{const u=$("musicUrl").value.trim();if(!u)return; $("roomAudio").src=u;$("roomAudio").play().catch(()=>{});};
$("stopMusicBtn").onclick=()=>{$("roomAudio").pause();$("roomAudio").currentTime=0;};

function startDmList(){
  const p=collection(db,"profiles");
  onSnapshot(query(p,limit(30)),snap=>{
    $("dmList").innerHTML="";
    snap.forEach(d=>{
      if(d.id===me.uid)return;
      const x=d.data(); const el=document.createElement("div");el.className="dm-item";el.innerHTML=`<img class="avatar md" src="${avatar(x)}"><div class="grow"><b>${esc(x.name||"User")}</b><p>${esc(x.bio||"Start a private conversation")}</p></div><time>›</time>`;el.onclick=()=>openDm({uid:d.id,...x});$("dmList").appendChild(el);
    });
  });
}
async function openDm(other){
  currentDm=other;$("dmScreen").classList.remove("hidden");$("dmAvatar").src=avatar(other);$("dmName").textContent=other.name||"User";
  const cid=convoId(me.uid,other.uid);
  if(dmUnsub)dmUnsub();
  dmUnsub=onSnapshot(query(collection(db,"dms",cid,"messages"),orderBy("createdAt","asc"),limit(100)),snap=>{
    $("dmMessages").innerHTML="";
    snap.forEach(d=>{const m=d.data();const b=document.createElement("div");b.className="dm-bubble "+(m.from===me.uid?"mine":"theirs");b.textContent=m.text;$("dmMessages").appendChild(b)});
    $("dmMessages").scrollTop=$("dmMessages").scrollHeight;
  });
}
$("closeDmBtn").onclick=()=>{$("dmScreen").classList.add("hidden");if(dmUnsub)dmUnsub()};
async function sendDm(){
  if(!currentDm)return;const text=$("dmInput").value.trim();if(!text)return;
  await addDoc(collection(db,"dms",convoId(me.uid,currentDm.uid),"messages"),{from:me.uid,to:currentDm.uid,text,createdAt:serverTimestamp()});
  $("dmInput").value="";
}
$("sendDmBtn").onclick=sendDm;$("dmInput").onkeydown=e=>{if(e.key==="Enter")sendDm()};

$("editProfileBtn").onclick=()=>{
  $("editName").value=myProfile.name||"";$("editBio").value=myProfile.bio||"";$("editGender").value=myProfile.gender||"";$("avatarPreview").src=avatar(myProfile);$("profileModal").classList.remove("hidden");
};
$("avatarInput").onchange=async e=>{
  const file=e.target.files?.[0];if(!file)return;
  const img=new Image(), url=URL.createObjectURL(file);
  img.onload=()=>{const c=document.createElement("canvas"),max=300,s=Math.min(max/img.width,max/img.height,1);c.width=img.width*s;c.height=img.height*s;const x=c.getContext("2d");x.drawImage(img,0,0,c.width,c.height);$("avatarPreview").src=c.toDataURL("image/jpeg",.72);URL.revokeObjectURL(url)};
  img.src=url;
};
$("saveProfileBtn").onclick=async()=>{
  const data={name:$("editName").value.trim()||"Vibes User",bio:$("editBio").value.trim(),gender:$("editGender").value,avatar:$("avatarPreview").src,updatedAt:serverTimestamp()};
  await setDoc(profileRef(me.uid),data,{merge:true});myProfile={...myProfile,...data};await updateProfile(me,{displayName:data.name});renderProfile();
  if(currentRoom) await updateDoc(doc(db,"rooms",currentRoom.id,"members",me.uid),{name:data.name,avatar:data.avatar,gender:data.gender});
  $("profileModal").classList.add("hidden");toast("Profile saved");
};
$("copyIdBtn").onclick=async()=>{try{await navigator.clipboard.writeText(me.uid);toast("ID copied")}catch{}};
$("settingsBtn").onclick=async()=>{if(confirm("Sign out from .vibes?"))await signOut(auth)};

$("diceGameBtn").onclick=()=>openGame("Dice",`<div class="guess" style="text-align:center"><div style="font-size:80px">🎲</div><h2 id="diceResult">Roll the dice</h2><button class="primary" id="rollDice">Roll</button></div>`);
$("tttGameBtn").onclick=()=>openGame("Tic-Tac-Toe",`<p>Local two-player game.</p><div class="ttt">${Array(9).fill(0).map((_,i)=>`<button data-cell="${i}"></button>`).join("")}</div>`);
$("guessGameBtn").onclick=()=>openGame("Number Guess",`<div class="guess"><p>Guess a number from 1–10.</p><input id="guessInput" type="number" min="1" max="10"><button class="primary" id="guessBtn" style="margin-top:10px">Guess</button><h3 id="guessResult"></h3></div>`);
function openGame(title,html){$("gameTitle").textContent=title;$("gameBody").innerHTML=html;$("gameModal").classList.remove("hidden");
  if(title==="Dice")$("rollDice").onclick=()=>{$("diceResult").textContent="You rolled "+(Math.floor(Math.random()*6)+1)};
  if(title==="Number Guess")$("guessBtn").onclick=()=>{$("guessResult").textContent=Number($("guessInput").value)==Math.ceil(Math.random()*10)?"🎉 Correct!":"Try again!"};
  if(title==="Tic-Tac-Toe"){let turn="X",a=Array(9).fill("");document.querySelectorAll("[data-cell]").forEach(b=>b.onclick=()=>{const i=b.dataset.cell;if(a[i])return;a[i]=turn;b.textContent=turn;turn=turn==="X"?"O":"X";const wins=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];if(wins.some(w=>a[w[0]]&&a[w[0]]===a[w[1]]&&a[w[1]]===a[w[2]]))toast("Winner!");})}
}

window.addEventListener("beforeunload",()=>{try{if(currentRoom)deleteDoc(doc(db,"rooms",currentRoom.id,"members",me.uid));}catch{}});
