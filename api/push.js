// ملف واحد للإشعارات: ?a=subscribe  |  ?a=notify  |  ?a=send
const crypto = require("crypto");
let admin = null;

const TOPIC = "all";

function init() {
  if (!admin) admin = require("firebase-admin");
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is missing");
    const sa = JSON.parse(raw);
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, "\n");
    admin.initializeApp({
      credential: admin.credential.cert(sa),
      databaseURL: "https://students-e21f2-default-rtdb.firebaseio.com",
    });
  }
  return admin;
}

// true = كمان يبعت للمجموعة القديمة "all" عشان الأجهزة اللي لسه ماسجلتش نفسها بالطريقة الجديدة.
// كل جهاز بيتسجل جديد بيتشال من المجموعة تلقائيًا، فمفيش تكرار. بعد ما الطلاب يفتحوا الموقع مرة خليها false.
const LEGACY_TOPIC = true;

const tokKey = (t) => crypto.createHash("sha1").update(t).digest("hex");

async function broadcast({ title, body, url }) {
  const ad = init();
  const data = { title: String(title), body: String(body || ""), url: url || "/" };
  // TTL 28 يوم: الرسالة تفضل محفوظة لحد ما الجهاز يرجع نت.
  // Topic: الإشعار الجديد يستبدل القديم المنتظر، فيوصل آخر إشعار بس.
  const webpush = { headers: { Urgency: "high", TTL: "2419200", Topic: "latest" } };

  // إرسال مباشر لكل جهاز على حدة
  const snap = await ad.database().ref("push_tokens").once("value");
  const rows = [];
  snap.forEach((c) => { const t = c.val() && c.val().t; if (typeof t === "string") rows.push({ k: c.key, t }); });

  let sent = 0, failed = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const r = await ad.messaging().sendEachForMulticast({ tokens: chunk.map((x) => x.t), data, webpush });
    const dead = {};
    r.responses.forEach((x, n) => {
      if (x.success) { sent++; return; }
      failed++;
      const code = x.error && x.error.code;
      if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token")
        dead["push_tokens/" + chunk[n].k] = null; // تنظيف الأجهزة اللي مسحت الموقع/الإذن
    });
    if (Object.keys(dead).length) await ad.database().ref().update(dead);
  }

  if (LEGACY_TOPIC) {
    try { await ad.messaging().send({ topic: TOPIC, data, webpush }); } catch (e) { console.error("legacy topic", e); }
  }
  return { sent, failed };
}

const safeUrl = (u) => (typeof u === "string" && /^\/[^\/\\]*$/.test(u) ? u : "/");

function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = async (req, res) => {
  // فحص سريع: افتح /api/push في المتصفح يظهر لك حالة الإعدادات
  if (req.method === "GET") {
    const out = {
      ok: true,
      node: process.version,
      hasServiceAccount: !!process.env.FIREBASE_SERVICE_ACCOUNT,
      hasAdminSecret: !!process.env.ADMIN_SECRET,
    };
    try { require("firebase-admin"); out.firebaseAdmin = "installed"; }
    catch (e) { out.firebaseAdmin = "MISSING: " + String(e.message).slice(0, 120); }
    try {
      const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "");
      out.serviceAccount = "valid JSON, project=" + sa.project_id;
    } catch (e) { out.serviceAccount = "INVALID: " + String(e.message).slice(0, 80); }
    try { init().messaging(); out.init = "ok"; }
    catch (e) { out.init = "FAILED: " + String(e.message).slice(0, 160); }
    return res.status(200).json(out);
  }
  if (req.method !== "POST") return res.status(405).end();
  const a = req.query && req.query.a;
  const b = req.body || {};
  try {
    // تسجيل جهاز الطالب لاستقبال الإشعارات
    if (a === "subscribe") {
      const token = b.token;
      if (typeof token !== "string" || token.length < 50 || token.length > 400)
        return res.status(400).json({ error: "bad token" });
      const ad = init();
      // حفظ توكن الجهاز عشان الإرسال له مباشرة
      await ad.database().ref("push_tokens/" + tokKey(token)).set({ t: token, at: Date.now() });
      // شيل الجهاز من المجموعة القديمة (لو كان فيها) عشان ميوصلوش الإشعار مرتين
      try { await ad.messaging().unsubscribeFromTopic(token, TOPIC); } catch (e) {}
      return res.json({ ok: true });
    }

    // إشعار تلقائي لتعليق جديد في المنتدى
    if (a === "notify") {
      const m = (req.headers.authorization || "").match(/^Bearer (.+)$/);
      if (!m) return res.status(401).json({ error: "no token" });
      const ad = init();
      const user = await ad.auth().verifyIdToken(m[1]);
      const now = Date.now();
      const r = await ad.database().ref("push_meta/lastComment").transaction((v) => {
        if (v && now - v < 30000) return; // حد أدنى 30 ثانية
        return now;
      });
      if (!r.committed) return res.json({ ok: true, skipped: true });
      const name = String(user.name || "طالب").slice(0, 30);
      const text = String(b.text || "").replace(/\s+/g, " ").slice(0, 90);
      await broadcast({
        title: "💬 تعليق جديد في المنتدى",
        body: text ? name + ": " + text : name,
        url: "/#forum",
      });
      return res.json({ ok: true });
    }

    // إشعار يدوي من send.html بكلمة سر
    if (a === "send") {
      const secret = process.env.ADMIN_SECRET;
      if (!secret) return res.status(500).json({ error: "ADMIN_SECRET missing" });
      if (!same(req.headers["x-admin-secret"] || "", secret))
        return res.status(401).json({ error: "wrong password" });
      const title = String(b.title || "").trim().slice(0, 80);
      if (!title) return res.status(400).json({ error: "title required" });
      await broadcast({ title, body: String(b.body || "").trim().slice(0, 200), url: safeUrl(b.url) });
      return res.json({ ok: true });
    }

    res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String((e && e.message) || e).slice(0, 200) });
  }
};
