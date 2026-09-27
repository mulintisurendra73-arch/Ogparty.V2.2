import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, addDoc, query, orderBy,
  onSnapshot, serverTimestamp, getDoc, limit, getDocs
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);

let authMode = "login";
let currentRoom = null;
let unsubscribeMessages = null;
let unsubscribeMembers = null;
let selectedCategory = "Chill";

function usernameOf(user){
  return (user?.displayName || "OG User").trim();
}
function initials(name){
  return (name || "OG").split(/\s+/).map(x=>x[0]).join("").slice(0,2).toUpperCase();
}
function showToast(text){
  const t=$("toast"); t.textContent=text; t.classList.add("show");
  setTimeout(()=>t.classList.remove("show"),1800);
}
function safe(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function iconFor(cat){return ({Chill:"🌙",Music:"🎵",Games:"🎮",Chat:"💬"})[cat]||"🎉";}

document.querySelectorAll(".auth-tab").forEach(btn=>{
  btn.onclick=()=>{
    authMode=btn.dataset.authTab;
    document.querySelectorAll(".auth-tab").forEach(b=>b.classList.toggle("active",b===btn));
    $("signupFields").classList.toggle("hidden",authMode!=="signup");
    $("authBtn").textContent=authMode==="signup"?"Create account":"Login";
    $("authStatus").textContent="";
  };
});

$("authBtn").onclick=async()=>{
  const email=$("email").value.trim();
  const password=$("password").value;
  const name=$("username").value.trim();
  if(!email||!password){$("authStatus").textContent="Enter email and password.";return;}
  if(authMode==="signup" && name.length<3){$("authStatus").textContent="Username must be at least 3 characters.";return;}
  try{
    if(authMode==="signup"){
      const cred=await createUserWithEmailAndPassword(auth,email,password);
      await updateProfile(cred.user,{displayName:name});
      await setDoc(doc(db,"profiles",cred.user.uid),{
        username:name, createdAt:serverTimestamp()
      },{merge:true});
      $("authStatus").textContent="Welcome to OG Party!";
    }else{
      await signInWithEmailAndPassword(auth,email,password);
    }
  }catch(e){$("authStatus").textContent=e.message.replace("Firebase: ","");}
};

onAuthStateChanged(auth,async user=>{
  const logged=!!user;
  $("authView").classList.toggle("hidden",logged);
  $("appView").classList.toggle("hidden",!logged);
  if(!user)return;

  if(!user.displayName){
    $("usernameModal").classList.remove("hidden");
    $("setupUsername").value="";
  }else{
    refreshUserUI(user);
  }
  loadRooms();
});

function refreshUserUI(user){
  const name=usernameOf(user), ini=initials(name);
  $("homeUsername").textContent=name;
  $("profileUsername").textContent=name;
  $("profileNameSmall").textContent=name;
  $("profileAvatar").textContent=ini;
  $("topProfileBtn").textContent=ini;
  $("profileEmail").textContent="Email hidden from other users";
}

$("saveUsernameBtn").onclick=async()=>{
  const name=$("setupUsername").value.trim();
  if(name.length<3){showToast("Choose a username with 3+ characters");return;}
  try{
    await updateProfile(auth.currentUser,{displayName:name});
    await setDoc(doc(db,"profiles",auth.currentUser.uid),{username:name,updatedAt:serverTimestamp()},{merge:true});
    $("usernameModal").classList.add("hidden");
    refreshUserUI(auth.currentUser);
    showToast("Username saved");
  }catch(e){showToast(e.message);}
};

function go(pageId){
  document.querySelectorAll(".page").forEach(p=>p.classList.toggle("active-page",p.id===pageId));
  document.querySelectorAll(".nav-item").forEach(n=>n.classList.toggle("active",n.dataset.page===pageId));
  window.scrollTo({top:0,behavior:"smooth"});
}
document.querySelectorAll(".nav-item").forEach(n=>n.onclick=()=>go(n.dataset.page));
$("topProfileBtn").onclick=()=>go("profilePage");
$("quickDiscover").onclick=()=>go("roomsPage");
$("seeAllRooms").onclick=()=>go("roomsPage");
$("chatRoomsBtn").onclick=()=>go("roomsPage");
$("roomsCreateBtn").onclick=()=>openCreate();
$("quickCreate").onclick=()=>openCreate();
$("navCreate").onclick=()=>openCreate();

$("quickJoin").onclick=()=>{
  const code=prompt("Enter the room code:");
  if(code) joinRoom(code.trim().toUpperCase());
};

function openCreate(){$("createModal").classList.remove("hidden");$("newRoomName").focus();}
$("closeModal").onclick=()=>{$("createModal").classList.add("hidden");$("roomStatus").textContent="";};
document.querySelectorAll(".category").forEach(b=>b.onclick=()=>{
  selectedCategory=b.dataset.category;
  document.querySelectorAll(".category").forEach(x=>x.classList.toggle("active",x===b));
});

$("createRoomBtn").onclick=async()=>{
  const title=$("newRoomName").value.trim()||"My Party";
  if(!auth.currentUser)return;
  try{
    const id=Math.random().toString(36).slice(2,8).toUpperCase();
    await setDoc(doc(db,"rooms",id),{
      ownerId:auth.currentUser.uid,
      ownerName:usernameOf(auth.currentUser),
      title, category:selectedCategory,
      createdAt:serverTimestamp()
    });
    $("createModal").classList.add("hidden");
    $("newRoomName").value="";
    showToast("Party room created");
    await joinRoom(id);
  }catch(e){$("roomStatus").textContent=e.message;}
};

async function loadRooms(){
  try{
    const q=query(collection(db,"rooms"),orderBy("createdAt","desc"),limit(12));
    onSnapshot(q,snap=>{
      const rooms=snap.docs.map(d=>({id:d.id,...d.data()}));
      renderRooms($("homeRooms"),rooms.slice(0,4));
      renderRooms($("roomsList"),rooms);
    },err=>{
      $("homeRooms").innerHTML='<div class="empty-state"><p>Could not load rooms. Check Firestore rules.</p></div>';
      console.error(err);
    });
  }catch(e){console.error(e);}
}

function renderRooms(container,rooms){
  if(!rooms.length){
    container.innerHTML='<div class="empty-state"><div class="empty-icon">🎉</div><h3>No rooms yet</h3><p>Create the first party and invite your friends.</p></div>';
    return;
  }
  container.innerHTML=rooms.map(r=>`
    <article class="room-card">
      <div class="room-card-top">
        <div><div class="room-icon">${iconFor(r.category)}</div></div>
        <div style="flex:1"><h3>${safe(r.title||"OG Party")}</h3><p>${safe(r.category||"Chat")} · Hosted by ${safe(r.ownerName||"OG User")}</p></div>
      </div>
      <button class="join-btn" data-room="${safe(r.id)}">Join room · ${safe(r.id)}</button>
    </article>`).join("");
  container.querySelectorAll(".join-btn").forEach(b=>b.onclick=()=>joinRoom(b.dataset.room));
}

async function joinRoom(id){
  if(!id||!auth.currentUser)return;
  try{
    const ref=doc(db,"rooms",id);
    const room=await getDoc(ref);
    if(!room.exists()){showToast("Room not found");return;}
    const data=room.data();
    currentRoom=id;
    await setDoc(doc(db,"rooms",id,"members",auth.currentUser.uid),{
      username:usernameOf(auth.currentUser),
      joinedAt:serverTimestamp()
    });
    $("roomTitle").textContent=data.title||"OG Party";
    $("roomCodeLabel").textContent=id;
    $("roomHostLabel").textContent="Hosted by "+(data.ownerName||"OG User")+" · "+(data.category||"Chat");
    go("roomPage");
    unsubscribeMessages?.();unsubscribeMembers?.();

    const mq=query(collection(db,"rooms",id,"messages"),orderBy("createdAt"),limit(100));
    unsubscribeMessages=onSnapshot(mq,snap=>{
      $("messages").innerHTML="";
      snap.forEach(d=>{
        const m=d.data();
        const el=document.createElement("div");el.className="msg";
        el.innerHTML=`<b>${safe(m.username||"OG User")}</b>${safe(m.text||"")}`;
        $("messages").appendChild(el);
      });
      $("messages").scrollTop=$("messages").scrollHeight;
    });

    unsubscribeMembers=onSnapshot(collection(db,"rooms",id,"members"),snap=>{
      $("roomOnlineCount").textContent=`● ${snap.size} online`;
      $("members").innerHTML="";
      snap.forEach(d=>{
        const name=d.data().username||"OG User";
        $("members").innerHTML+=`<div class="member"><span class="member-avatar">${initials(name)}</span><div><b>${safe(name)}</b><small> • member</small></div></div>`;
      });
    });
  }catch(e){showToast(e.message.replace("Firebase: ",""));}
}

$("sendBtn").onclick=sendMessage;
$("messageInput").addEventListener("keydown",e=>{if(e.key==="Enter")sendMessage();});
async function sendMessage(){
  const text=$("messageInput").value.trim();
  if(!currentRoom||!text||!auth.currentUser)return;
  await addDoc(collection(db,"rooms",currentRoom,"messages"),{
    uid:auth.currentUser.uid,username:usernameOf(auth.currentUser),text,createdAt:serverTimestamp()
  });
  $("messageInput").value="";
}

$("backHomeBtn").onclick=()=>go("homePage");
$("copyRoomBtn").onclick=async()=>{
  if(!currentRoom)return;
  try{await navigator.clipboard.writeText(currentRoom);showToast("Room code copied");}
  catch{showToast("Room code: "+currentRoom);}
};

$("editUsernameBtn").onclick=()=>{
  $("setupUsername").value=usernameOf(auth.currentUser);
  $("usernameModal").classList.remove("hidden");
};
$("logoutBtn").onclick=async()=>{
  unsubscribeMessages?.();unsubscribeMembers?.();currentRoom=null;
  await signOut(auth);
  showToast("Logged out");
};
