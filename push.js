import {initializeApp,getApps,getApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getMessaging,getToken,onMessage,isSupported} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

/* ⚠️ الصق هنا مفتاح VAPID من Firebase Console ← Project settings ← Cloud Messaging ← Web Push certificates */
const VAPID = "BKCK2AluxbIw2NqrmWnA-EAdiRM3WXwopr32YAuoEQ1qFE-ZbKiP9x4D1a-ANOFvP-72-lOUj9sFl6l6djCyrKw";

const firebaseConfig={apiKey:"AIzaSyAbQMsUQNz3CKY7NLI_HaHoR6EgaePRQe8",authDomain:"students-e21f2.firebaseapp.com",databaseURL:"https://students-e21f2-default-rtdb.firebaseio.com",projectId:"students-e21f2",storageBucket:"students-e21f2.firebasestorage.app",messagingSenderId:"713037100201",appId:"1:713037100201:web:51a395f3ef400a9ff2a5b8",measurementId:"G-6343TWF8H9"};
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

const store = {
  get(k){try{return localStorage.getItem(k)}catch(e){return null}},
  set(k,v){try{localStorage.setItem(k,v)}catch(e){}}
};

/* إشعار تلقائي لتعليق جديد (يُستدعى من كود المنتدى) */
window.__notifyComment = async (text) => {
  try {
    const u = getAuth(app).currentUser;
    if (!u) return;
    const t = await u.getIdToken();
    await fetch("/api/notify", {
      method: "POST",
      headers: {"Authorization": "Bearer " + t, "Content-Type": "application/json"},
      body: JSON.stringify({text})
    });
  } catch (e) {}
};

/* زر تفعيل الإشعارات في القائمة الجانبية */
const foot = document.querySelector(".drawer-foot");
const btn = document.createElement("button");
btn.className = "btn btn-dark btn-sm";
btn.style.cssText = "width:100%;margin-bottom:10px";
btn.textContent = "🔔 فعّل الإشعارات";
if (foot) foot.prepend(btn);

const HINT_IOS = "الإشعارات على الآيفون بتشتغل بس لو ثبّتّ الموقع: من زر المشاركة اختار «إضافة إلى الشاشة الرئيسية» وافتحه من الأيقونة (iOS 16.4 أو أحدث).";

function setOn(){ btn.textContent = "🔔 الإشعارات مفعّلة ✓"; btn.className = "btn btn-ghost btn-sm"; }

let messaging = null;
async function supported(){
  try { return !!(window.Notification && navigator.serviceWorker && await isSupported()); }
  catch(e){ return false; }
}

async function enable(){
  if (VAPID.indexOf("الصق") === 0) { alert("مفتاح VAPID لسه متحطش في push.js"); return false; }
  const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (perm !== "granted") return false;
  const reg = await navigator.serviceWorker.ready;
  const token = await getToken(messaging, {vapidKey: VAPID, serviceWorkerRegistration: reg});
  if (!token) return false;
  if (store.get("pushTok") !== token) {
    const r = await fetch("/api/subscribe", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({token})
    });
    if (!r.ok) throw new Error("subscribe failed");
    store.set("pushTok", token);
  }
  return true;
}

(async () => {
  if (!(await supported())) {
    btn.onclick = () => alert(HINT_IOS);
    return;
  }
  messaging = getMessaging(app);

  // رسالة والموقع مفتوح
  onMessage(messaging, async (p) => {
    const d = p.data || {};
    if (Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification(d.title || "تحديث جديد", {
      body: d.body || "", icon: "/icon-192.png", badge: "/icon-192.png",
      dir: "rtl", lang: "ar", data: {url: d.url || "/"}
    });
  });

  if (Notification.permission === "granted") {
    setOn();
    enable().catch(() => {}); // تحديث التوكن بهدوء
  }
  btn.onclick = async () => {
    if (Notification.permission === "denied") {
      alert("الإشعارات متقفلة لهذا الموقع. فعّلها من إعدادات المتصفح ← إعدادات الموقع ← الإشعارات.");
      return;
    }
    btn.disabled = true;
    try {
      if (await enable()) setOn();
      else btn.textContent = "🔔 فعّل الإشعارات";
    } catch (e) {
      alert("حصلت مشكلة في التفعيل، جرب تاني.");
    }
    btn.disabled = false;
  };
})();
