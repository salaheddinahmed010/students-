// ملف واحد للإشعارات: ?a=subscribe  |  ?a=notify  |  ?a=send
const crypto = require("crypto");
const admin = require("firebase-admin");

const TOPIC = "all";

function init() {
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

function broadcast({ title, body, url }) {
  return init().messaging().send({
    topic: TOPIC,
    data: { title: String(title), body: String(body || ""), url: url || "/" },
    webpush: { headers: { Urgency: "high", TTL: "86400" } },
  });
}

const safeUrl = (u) => (typeof u === "string" && /^\/[^\/\\]*$/.test(u) ? u : "/");

function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();
  const a = req.query && req.query.a;
  const b = req.body || {};
  try {
    // تسجيل جهاز الطالب لاستقبال الإشعارات
    if (a === "subscribe") {
      const token = b.token;
      if (typeof token !== "string" || token.length < 50 || token.length > 400)
        return res.status(400).json({ error: "bad token" });
      await init().messaging().subscribeToTopic(token, TOPIC);
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
