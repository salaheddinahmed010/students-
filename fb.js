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

// يبعت إشعار لكل المشتركين
function broadcast({ title, body, url }) {
  return init().messaging().send({
    topic: TOPIC,
    data: { title: String(title), body: String(body || ""), url: url || "/" },
    webpush: { headers: { Urgency: "high", TTL: "86400" } },
  });
}

// يسمح بروابط داخل الموقع فقط
function safeUrl(u) {
  return typeof u === "string" && /^\/[^\/\\]*$/.test(u) ? u : "/";
}

module.exports = { init, broadcast, safeUrl, TOPIC };
