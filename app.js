import {firebaseConfig} from "./firebase-config.js";
import {initializeApp} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import {getAuth,onAuthStateChanged,createUserWithEmailAndPassword,signInWithEmailAndPassword,updateProfile,signOut} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import {getFirestore,collection,doc,getDoc,getDocs,setDoc,addDoc,updateDoc,deleteDoc,onSnapshot,query,limit,serverTimestamp} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

const firebaseApp=initializeApp(firebaseConfig);
const auth=getAuth(firebaseApp),db=getFirestore(firebaseApp);
const $=id=>document.getElementById(id);
let user=null,profile=null,room=null,roomUnsub=null,memberUnsub=null,messageUnsub=null,signalUnsub=null;
let authReadyResolve;
const authReady=new Promise(resolve=>authReadyResolve=resolve);
let booting=false;
let members=[],localStream=null,micOn=false,speakerOn=true;
const peers=new Map(),candidateQueues=new Map(),handledSignals=new Set(),remoteAudio=new Map();

const toast=t=>{const x=$("toast");x.textContent=t;x.classList.add("show");setTimeout(()=>x.classList.remove("show"),2500)};
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const avatar=(p={})=>p.avatar||`data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" rx="80" fill="#8b45ed"/><text x="80" y="102" text-anchor="middle" font-size="70" fill="white" font-family="Arial">${esc((p.name||"V")[0].toUpperCase())}</text></svg>`)}`;
const cid=(a,b)=>[a,b].sort().join("_");

function authError(e){$("authError").textContent=e?.message?.replace("Firebase: ","")||String(e);$("authError").classList.remove("hidden")}

$("login").onclick=async()=>{try{$("authError").classList.add("hidden");await signInWithEmailAndPassword(auth,$("email").value.trim(),$("password").value)}catch(e){authError(e)}};
$("signup").onclick=async()=>{
  try{
    $("authError").classList.add("hidden");
    const email=$("email").value.trim(),pass=$("password").value,name=$("username").value.trim()||email.split("@")[0];
    if(pass.length<6)throw new Error("Password must be at least 6 characters.");
    const c=await createUserWithEmailAndPassword(auth,email,pass);
    await updateProfile(c.user,{displayName:name});
    await setDoc(doc(db,"profiles",c.user.uid),{uid:c.user.uid,name,bio:"",gender:"",avatar:"",createdAt:serverTimestamp()});
  }catch(e){authError(e)}
};

onAuthStateChanged(auth,async u=>{
  user=u;
  authReadyResolve(u);
  if(!u){
    booting=false;
    if(roomUnsub)roomUnsub();
    $("app").classList.add("hidden");
    $("authScreen").classList.remove("hidden");
    setStatus("Sign in to connect to Firebase","bad");
    return;
  }
  if(booting)return;
  booting=true;
  $("authScreen").classList.add("hidden");
  $("app").classList.remove("hidden");
  setStatus("Signed in. Checking Firebase…","ok");
  try{
    try{
      await loadProfile();
    }catch(profileError){
      console.error("profile load",profileError);
      profile={uid:user.uid,name:user.displayName||"Vibes User",bio:"",gender:"",avatar:""};
      setStatus("Signed in • Firestore profile check failed: "+friendlyFirebaseError(profileError),"bad");
      toast("Profile check: "+friendlyFirebaseError(profileError));
    }
    renderProfile();
    if(user) startRooms();
    if(user) loadPeople();
  }catch(e){
    console.error(".vibes startup error",e);
    setStatus("Firebase error: "+friendlyFirebaseError(e),"bad");
    toast(friendlyFirebaseError(e));
  }finally{booting=false}
});

function friendlyFirebaseError(e){
  const code=e?.code||"";
  if(code.includes("permission-denied"))return "Firestore permission denied. Publish the firestore.rules file, then sign out and sign in again.";
  if(code.includes("unauthenticated"))return "Firebase says you are not signed in. Sign out and sign in again.";
  if(code.includes("failed-precondition"))return "Firestore needs setup/indexing. Check Firestore Database in Firebase Console.";
  if(code.includes("unavailable"))return "Firestore is temporarily unavailable. Check your internet connection.";
  return e?.message||String(e);
}

async function loadProfile(){
  await authReady;
  if(!user)throw Object.assign(new Error("Not signed in"),{code:"auth/unauthenticated"});
  try{
    const r=await getDoc(doc(db,"profiles",user.uid));
    if(r.exists())profile={...r.data(),uid:user.uid};
    else{
      profile={uid:user.uid,name:user.displayName||"Vibes User",bio:"",gender:"",avatar:"",createdAt:serverTimestamp()};
      await setDoc(doc(db,"profiles",user.uid),profile);
    }
  }catch(e){
    // Keep the app usable even if the profile document is temporarily blocked.
    if(e?.code==="permission-denied") {
      profile={uid:user.uid,name:user.displayName||"Vibes User",bio:"",gender:"",avatar:""};
      throw e;
    }
    throw e;
  }
}
function setStatus(text,type){$("firebaseStatus").textContent=text;$("firebaseStatus").style.background=type==="bad"?"#ffdede":"#ffffff55";$("firebaseStatus").style.color=type==="bad"?"#9d0000":"#386b5d"}

function showPage(id){
  ["home","messages","profile"].forEach(x=>$(x).classList.toggle("hidden",x!==id));
  document.querySelectorAll(".nav").forEach(b=>b.classList.toggle("active",b.dataset.page===id));
  $("title").textContent=id==="home"?"Chatrooms":id==="messages"?"Message":"My Profile";
  if(id==="messages")loadPeople();
}
document.querySelectorAll(".nav").forEach(b=>b.onclick=()=>{showPage(b.dataset.page);if(b.dataset.tab)openTab(b.dataset.tab)});
function openTab(t){
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.tab===t));
  $("roomsTab")?.classList.toggle("hidden",t!=="rooms");$("friendsTab")?.classList.toggle("hidden",t!=="friends");$("gamesTab")?.classList.toggle("hidden",t!=="games");
}
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>openTab(b.dataset.tab));

function startRooms(){
  if(!user){setStatus("Waiting for Firebase Authentication…","bad");return}
  if(roomUnsub)roomUnsub();
  roomUnsub=onSnapshot(collection(db,"rooms"),snap=>{
    const arr=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    $("rooms").innerHTML="";
    if(!arr.length){$("rooms").innerHTML='<div class="empty">No rooms yet. Tap + Create.</div>';return}
    arr.forEach(r=>renderRoom(r));
  },e=>{console.error("rooms listener",e);setStatus("Rooms error: "+friendlyFirebaseError(e),"bad");toast(friendlyFirebaseError(e))});
}
async function renderRoom(r){
  if(!user)return;
  const el=document.createElement("div");el.className="roomCard";
  let ms=[];try{const s=await getDocs(query(collection(db,"rooms",r.id,"members"),limit(5)));ms=s.docs.map(d=>d.data())}catch{}
  el.innerHTML=`<img class="roomCover" src="${avatar({name:r.ownerName,avatar:r.ownerAvatar})}"><div class="roomInfo"><div class="roomTitle">${esc(r.name||"Room")}</div><span class="topic">${esc(r.topic||"Let's vibe")}</span><div class="miniAv">${ms.map(m=>`<img src="${avatar(m)}">`).join("")}</div></div><span class="count">◉ ${ms.length}</span>`;
  el.onclick=()=>enterRoom(r);
  $("rooms").appendChild(el);
}
$("createRoom").onclick=()=>$("roomModal").classList.remove("hidden");
$("saveRoom").onclick=async()=>{
  const name=$("newRoomName").value.trim()||`${profile.name}'s room`,topic=$("newRoomTopic").value.trim()||"Let's vibe";
  try{const r=await addDoc(collection(db,"rooms"),{name,topic,ownerId:user.uid,ownerName:profile.name,ownerAvatar:profile.avatar||"",createdAt:serverTimestamp()});$("roomModal").classList.add("hidden");$("newRoomName").value="";$("newRoomTopic").value="";enterRoom({id:r.id,name,topic})}catch(e){toast(e.message)}
};

async function enterRoom(r){
  room=r;$("room").classList.remove("hidden");$("roomName").textContent=r.name||"Room";$("roomId").textContent=r.id.slice(0,8);
  try{await setDoc(doc(db,"rooms",r.id,"members",user.uid),{uid:user.uid,name:profile.name,avatar:profile.avatar||"",gender:profile.gender||"",mic:false,joinedAt:serverTimestamp()});listenMembers();listenMessages();listenSignals()}catch(e){toast("Cannot join room: "+e.message)}
}
async function leaveRoom(){
  cleanupVoice();
  if(room)try{await deleteDoc(doc(db,"rooms",room.id,"members",user.uid))}catch{}
  [memberUnsub,messageUnsub,signalUnsub].forEach(f=>{if(f)f()});memberUnsub=messageUnsub=signalUnsub=null;
  room=null;$("room").classList.add("hidden");
}
$("leave").onclick=leaveRoom;
$("share").onclick=async()=>{try{await navigator.clipboard.writeText(location.href+"#room="+room.id);toast("Room link copied")}catch{toast("Copy the URL from your browser")}};
function listenMembers(){
  if(memberUnsub)memberUnsub();
  memberUnsub=onSnapshot(collection(db,"rooms",room.id,"members"),snap=>{members=snap.docs.map(d=>d.data());$("roomCount").textContent=members.length+" people";renderSlots();ensurePeers()});
}
function renderSlots(){
  const list=Array.from({length:8},(_,i)=>members[i]);
  $("slots").innerHTML=list.map(m=>m?`<div class="slot"><img src="${avatar(m)}"><span class="micState">${m.mic?"🎙️":"🔇"}</span><small>${esc(m.name)}</small></div>`:`<div class="slot"><div class="slotChair">＋</div><small>Empty</small></div>`).join("");
}
function listenMessages(){
  if(messageUnsub)messageUnsub();
  messageUnsub=onSnapshot(query(collection(db,"rooms",room.id,"messages"),limit(100)),snap=>{
    const arr=snap.docs.map(d=>d.data()).sort((a,b)=>(a.createdAt?.seconds||0)-(b.createdAt?.seconds||0));
    $("roomMessages").innerHTML=arr.map(m=>`<div class="msg"><img class="avatar" src="${avatar(m)}"><div><b>${esc(m.name)}</b><br>${esc(m.text)}</div></div>`).join("");
    $("roomMessages").scrollTop=$("roomMessages").scrollHeight;
  });
}
$("send").onclick=sendRoomMessage;$("roomText").onkeydown=e=>{if(e.key==="Enter")sendRoomMessage()};
async function sendRoomMessage(){const text=$("roomText").value.trim();if(!text||!room)return;try{await addDoc(collection(db,"rooms",room.id,"messages"),{uid:user.uid,name:profile.name,avatar:profile.avatar||"",text,createdAt:serverTimestamp()});$("roomText").value=""}catch(e){toast(e.message)}}
document.querySelectorAll(".emoji").forEach(b=>b.onclick=()=>{$("roomText").value+=b.textContent;$("roomText").focus()});

async function toggleMic(){
  if(!room){toast("Open a room first.");return}
  if(!navigator.mediaDevices?.getUserMedia){toast("Microphone requires HTTPS and a supported browser.");return}
  if(!window.isSecureContext){toast("Microphone needs an HTTPS page. Open the GitHub Pages https:// address.");return}
  if(!localStream){
    try{localStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false})}
    catch(e){
      console.error("getUserMedia",e);
      const msg=e.name==="NotAllowedError"?"Microphone permission was blocked. Android Chrome → site settings → Microphone → Allow, then reload.":e.name==="NotFoundError"?"No microphone was found on this device.":e.name==="NotReadableError"?"The microphone is being used by another app.":"Microphone error: "+(e.message||e.name);
      toast(msg);
      setStatus(msg,"bad");
      return;
    }
  }
  micOn=!micOn;localStream.getAudioTracks().forEach(t=>t.enabled=micOn);
  try{await updateDoc(doc(db,"rooms",room.id,"members",user.uid),{mic:micOn})}catch{}
  for(const [uid,pc] of peers){const s=pc.getSenders().find(x=>x.track?.kind==="audio");if(s)s.track.enabled=micOn;else if(micOn)localStream.getTracks().forEach(t=>pc.addTrack(t,localStream))}
  $("mic").classList.toggle("on",micOn);toast(micOn?"Microphone ON":"Microphone muted");
}
$("mic").onclick=toggleMic;

function newPeer(uid){
  if(peers.has(uid))return peers.get(uid);
  const pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"},{urls:"stun:stun1.l.google.com:19302"}]});
  peers.set(uid,pc);candidateQueues.set(uid,[]);
  if(localStream)localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
  pc.onicecandidate=e=>{if(e.candidate)sendSignal({to:uid,type:"candidate",candidate:e.candidate.toJSON()})};
  pc.ontrack=e=>{let a=remoteAudio.get(uid);if(!a){a=new Audio();a.autoplay=true;a.playsInline=true;remoteAudio.set(uid,a)}a.srcObject=e.streams[0];a.muted=!speakerOn;a.play().catch(()=>{})};
  pc.onconnectionstatechange=()=>{if(["failed","closed"].includes(pc.connectionState)){pc.close();peers.delete(uid)}};
  return pc;
}
async function sendSignal(data){if(!room)return;try{await addDoc(collection(db,"rooms",room.id,"signals"),{from:user.uid,...data,createdAt:serverTimestamp()})}catch(e){console.warn(e)}}
async function ensurePeers(){
  if(!room)return;
  for(const m of members){
    if(m.uid===user.uid)continue;
    newPeer(m.uid);
    // Only the lexicographically smaller UID starts an offer.
    if(user.uid<m.uid){
      const pc=peers.get(m.uid);
      if(pc.signalingState==="stable"&&!pc.localDescription){try{const offer=await pc.createOffer();await pc.setLocalDescription(offer);await sendSignal({to:m.uid,type:"offer",sdp:{type:offer.type,sdp:offer.sdp}})}catch{}}
    }
  }
}
function listenSignals(){
  if(signalUnsub)signalUnsub();
  signalUnsub=onSnapshot(collection(db,"rooms",room.id,"signals"),snap=>{
    snap.docChanges().forEach(ch=>{if(ch.type==="added")handleSignal(ch.doc.id,ch.doc.data())});
  });
}
async function handleSignal(id,s){
  if(handledSignals.has(id)||s.to!==user.uid)return;handledSignals.add(id);
  const pc=newPeer(s.from);
  try{
    if(s.type==="offer"){
      await pc.setRemoteDescription(s.sdp);
      const q=candidateQueues.get(s.from)||[];for(const c of q)await pc.addIceCandidate(c).catch(()=>{});candidateQueues.set(s.from,[]);
      const answer=await pc.createAnswer();await pc.setLocalDescription(answer);await sendSignal({to:s.from,type:"answer",sdp:{type:answer.type,sdp:answer.sdp}});
    }else if(s.type==="answer"){
      await pc.setRemoteDescription(s.sdp);
      const q=candidateQueues.get(s.from)||[];for(const c of q)await pc.addIceCandidate(c).catch(()=>{});candidateQueues.set(s.from,[]);
    }else if(s.type==="candidate"){
      if(pc.remoteDescription)await pc.addIceCandidate(s.candidate).catch(()=>{});else candidateQueues.get(s.from).push(s.candidate);
    }
  }catch(e){console.warn("WebRTC signal",e)}
}
function cleanupVoice(){
  peers.forEach(p=>p.close());peers.clear();candidateQueues.clear();handledSignals.clear();
  remoteAudio.forEach(a=>{a.pause();a.srcObject=null});remoteAudio.clear();
  if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null}
  micOn=false;$("mic").classList.remove("on");
}
$("speaker").onclick=()=>{speakerOn=!speakerOn;remoteAudio.forEach(a=>a.muted=!speakerOn);$("speaker").textContent=speakerOn?"🔊":"🔇";toast(speakerOn?"Speaker on":"Speaker muted")};

$("music").onclick=()=>$("musicPanel").classList.toggle("hidden");
$("loadMusic").onclick=()=>{const u=$("audioUrl").value.trim();if(!u)return toast("Enter a direct audio URL");$("audio").src=u;$("audio").play().catch(()=>toast("Tap play on the audio control"))};
$("stopMusic").onclick=()=>{$("audio").pause();$("audio").currentTime=0};

function renderProfile(){
  $("myAvatar").src=avatar(profile);$("myName").textContent=profile.name||"Vibes User";$("myGender").textContent=profile.gender||"Gender not set";$("myId").textContent=user.uid.slice(0,12);$("myBio").textContent=profile.bio||"Add your bio.";
}
$("edit").onclick=()=>{$("editName").value=profile.name||"";$("editBio").value=profile.bio||"";$("editGender").value=profile.gender||"";$("preview").src=avatar(profile);$("editModal").classList.remove("hidden")};
$("photo").onchange=e=>{
  const f=e.target.files?.[0];if(!f)return;const u=URL.createObjectURL(f),img=new Image();img.onload=()=>{const c=document.createElement("canvas"),max=220,s=Math.min(max/img.width,max/img.height,1);c.width=img.width*s;c.height=img.height*s;c.getContext("2d").drawImage(img,0,0,c.width,c.height);$("preview").src=c.toDataURL("image/jpeg",.58);URL.revokeObjectURL(u)};img.src=u;
};
$("saveProfile").onclick=async()=>{
  const data={name:$("editName").value.trim()||"Vibes User",bio:$("editBio").value.trim(),gender:$("editGender").value,avatar:$("preview").src,updatedAt:serverTimestamp()};
  try{await setDoc(doc(db,"profiles",user.uid),data,{merge:true});profile={...profile,...data};await updateProfile(user,{displayName:data.name});renderProfile();if(room)await updateDoc(doc(db,"rooms",room.id,"members",user.uid),{name:data.name,avatar:data.avatar,gender:data.gender});$("editModal").classList.add("hidden");toast("Profile updated")}catch(e){toast(e.message)}
};
$("copyId").onclick=async()=>{try{await navigator.clipboard.writeText(user.uid);toast("ID copied")}catch{toast(user.uid)}};
$("logout").onclick=()=>signOut(auth);

async function loadPeople(){
  try{
    const snap=await getDocs(query(collection(db,"profiles"),limit(50)));$("people").innerHTML="";
    snap.forEach(d=>{if(d.id===user.uid)return;const p=d.data(),el=document.createElement("div");el.className="person";el.innerHTML=`<img class="avatar" src="${avatar(p)}"><div class="personText"><b>${esc(p.name||"User")}</b><small>${esc(p.bio||"Start a private message")}</small></div><span>›</span>`;el.onclick=()=>openDm({uid:d.id,...p});$("people").appendChild(el)});
  }catch(e){toast(e.message)}
}
let dm=null,dmUnsub=null;
async function openDm(p){
  dm=p;$("dm").classList.remove("hidden");$("dmAvatar").src=avatar(p);$("dmName").textContent=p.name||"User";
  const id=cid(user.uid,p.uid);if(dmUnsub)dmUnsub();
  dmUnsub=onSnapshot(query(collection(db,"dms",id,"messages"),limit(100)),snap=>{
    const arr=snap.docs.map(d=>d.data()).sort((a,b)=>(a.createdAt?.seconds||0)-(b.createdAt?.seconds||0));
    $("dmMessages").innerHTML=arr.map(m=>`<div class="bubble ${m.from===user.uid?"mine":""}">${esc(m.text)}</div>`).join("");
    $("dmMessages").scrollTop=$("dmMessages").scrollHeight;
  },e=>toast("DM: "+e.message));
}
$("closeDm").onclick=()=>{$("dm").classList.add("hidden");if(dmUnsub)dmUnsub()};
$("dmSend").onclick=sendDm;$("dmText").onkeydown=e=>{if(e.key==="Enter")sendDm()};
async function sendDm(){const text=$("dmText").value.trim();if(!text||!dm)return;try{await addDoc(collection(db,"dms",cid(user.uid,dm.uid),"messages"),{from:user.uid,to:dm.uid,text,createdAt:serverTimestamp()});$("dmText").value=""}catch(e){toast(e.message)}}

document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>$(b.dataset.close).classList.add("hidden"));

$("dice").onclick=()=>game("Dice",`<div style="text-align:center;font-size:70px">🎲</div><h2 id="result">Roll</h2><button class="pink" id="roll">Roll dice</button>`);
$("guess").onclick=()=>game("Number Guess",`<p>Guess 1–10.</p><input id="g" type="number" min="1" max="10"><button class="pink" id="gb">Guess</button><h3 id="gr"></h3>`);
$("ttt").onclick=()=>game("Tic-Tac-Toe",`<div id="board" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">${Array(9).fill(0).map((_,i)=>`<button data-c="${i}" style="height:80px;font-size:30px;border-radius:14px">${""}</button>`).join("")}</div>`);
function game(title,html){$("gameTitle").textContent=title;$("gameBody").innerHTML=html;$("gameModal").classList.remove("hidden");if(title==="Dice")$("roll").onclick=()=>{$("result").textContent="You rolled "+(1+Math.floor(Math.random()*6))};if(title==="Number Guess")$("gb").onclick=()=>{$("gr").textContent=Number($("g").value)===1+Math.floor(Math.random()*10)?"🎉 Correct":"Try again"};if(title==="Tic-Tac-Toe"){let t="X",a=Array(9).fill("");document.querySelectorAll("[data-c]").forEach(b=>b.onclick=()=>{let i=b.dataset.c;if(a[i])return;a[i]=t;b.textContent=t;t=t==="X"?"O":"X"})}}

window.addEventListener("pagehide",()=>{if(room)deleteDoc(doc(db,"rooms",room.id,"members",user.uid)).catch(()=>{})});
