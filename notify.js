// إشعار تلقائي عند تعليق جديد في المنتدى (يستدعيه الموقع بعد إرسال التعليق)
const { init, broadcast } = require("../lib/fb");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();
  const m = (req.headers.authorization || "").match(/^Bearer (.+)$/);
  if (!m) return res.status(401).json({ error: "no token" });
  try {
    const admin = init();
    const user = await admin.auth().verifyIdToken(m[1]);

    // حد أدنى 30 ثانية بين إشعارات التعليقات (يمنع الإزعاج والإساءة)
    const now = Date.now();
    const r = await admin.database().ref("push_meta/lastComment").transaction((v) => {
      if (v && now - v < 30000) return; // إلغاء
      return now;
    });
    if (!r.committed) return res.json({ ok: true, skipped: true });

    const name = String(user.name || "طالب").slice(0, 30);
    const text = String((req.body && req.body.text) || "").replace(/\s+/g, " ").slice(0, 90);
    await broadcast({
      title: "💬 تعليق جديد في المنتدى",
      body: text ? name + ": " + text : name,
      url: "/#forum",
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed" });
  }
};
