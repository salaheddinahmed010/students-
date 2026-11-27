// إرسال إشعار يدوي (منشور / محاضرة / تحديث) من صفحة send.html بكلمة سر
const crypto = require("crypto");
const { broadcast, safeUrl } = require("../lib/fb");

function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return res.status(500).json({ error: "ADMIN_SECRET missing" });
  if (!same(req.headers["x-admin-secret"] || "", secret)) {
    return res.status(401).json({ error: "wrong password" });
  }
  const b = req.body || {};
  const title = String(b.title || "").trim().slice(0, 80);
  const body = String(b.body || "").trim().slice(0, 200);
  if (!title) return res.status(400).json({ error: "title required" });
  try {
    await broadcast({ title, body, url: safeUrl(b.url) });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed" });
  }
};
