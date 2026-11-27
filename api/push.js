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

  let sent = 0, failed = 0, firstErr = "", legacy = "off";
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const r = await ad.messaging().sendEachForMulticast({ tokens: chunk.map((x) => x.t), data, webpush });
    const dead = {};
    r.responses.forEach((x, n) => {
      if (x.success) { sent++; return; }
      failed++;
      const code = x.error && x.error.code;
      if (!firstErr) firstErr = String(code || (x.error && x.error.message) || "").slice(0, 120);
      if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token")
        dead["push_tokens/" + chunk[n].k] = null; // تنظيف الأجهزة اللي مسحت الموقع/الإذن
    });
    if (Object.keys(dead).length) await ad.database().ref().update(dead);
  }

  if (LEGACY_TOPIC) {
    try { await ad.messaging().send({ topic: TOPIC, data, webpush }); legacy = "ok"; }
    catch (e) { console.error("legacy topic", e); legacy = "FAILED: " + String((e && (e.code || e.message)) || e).slice(0, 120); }
  }
  return { sent, failed, devices: rows.length, firstErr, legacy };
}

// ====== إشعارات تلقائية: منشور/محاضرة جديدة + تذكير كل يومين ======
const REMINDER_EVERY = 47 * 3600 * 1000; // ~يومين (47 ساعة عشان فرق توقيت التشغيل)

const stripTags = (s) => String(s || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// يقرا index.html المنشور ويطلع المنشورات والمحاضرات الموجودة (من غير التعليقات)
function parseSite(html) {
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  const iP = html.indexOf('id="v-posts"');
  const iL = html.indexOf('id="v-lectures"');
  if (iP < 0 || iL < 0) return null;
  const postsHtml = html.slice(iP, iL);
  const lecEnd = html.indexOf("</section>", iL);
  const lecHtml = html.slice(iL, lecEnd < 0 ? undefined : lecEnd);

  const posts = {}, lectures = {};
  const re = /<article class="post card"([^>]*)>([\s\S]*?)<\/article>/g;
  let m;
  while ((m = re.exec(postsHtml))) {
    const title = stripTags((m[2].match(/<h3 class="post-title[^"]*">([\s\S]*?)<\/h3>/) || [])[1]);
    const date = stripTags((m[2].match(/class="post-date">([\s\S]*?)<\/div>/) || [])[1]);
    if (!title) continue;
    posts[crypto.createHash("sha1").update(title + "|" + date).digest("hex").slice(0, 16)] = title;
  }
  while ((m = re.exec(lecHtml))) {
    const id = (m[1].match(/id="([A-Za-z0-9_-]+)"/) || [])[1];
    const title = stripTags((m[2].match(/<h3 class="post-title[^"]*">([\s\S]*?)<\/h3>/) || [])[1]);
    if (id && title) lectures[id] = title;
  }
  return { posts, lectures };
}

async function runCron(req) {
  const ad = init();
  const db = ad.database();
  const now = Date.now();
  const out = { newPosts: 0, newLectures: 0, reminder: false };

  // قفل بسيط عشان لو اتشغل مرتين في نفس الوقت ميبعتش إشعار مكرر
  const lock = await db.ref("push_meta/cronLock").transaction((v) => (v && now - v < 60000 ? undefined : now));
  if (!lock.committed) return { ok: true, skipped: "locked" };

  const base = process.env.SITE_URL || ("https://" + (req.headers["x-forwarded-host"] || req.headers.host));
  const r = await fetch(base.replace(/\/$/, "") + "/?t=" + now, { headers: { "cache-control": "no-cache" } });
  if (!r.ok) throw new Error("site fetch failed: " + r.status);
  const site = parseSite(await r.text());
  const cnt = site ? Object.keys(site.posts).length + Object.keys(site.lectures).length : 0;
  if (!site || !cnt) throw new Error("could not parse posts/lectures from the site");

  // المنشورات والمحاضرات الجديدة
  const seenRef = db.ref("push_meta/seen");
  const seen = (await seenRef.once("value")).val();
  if (!seen) {
    // أول تشغيل: نسجل الموجود حاليًا من غير ما نبعت إشعارات
    const init0 = { posts: {}, lectures: {} };
    Object.keys(site.posts).forEach((k) => (init0.posts[k] = true));
    Object.keys(site.lectures).forEach((k) => (init0.lectures[k] = true));
    await seenRef.set(init0);
    await db.ref("push_meta/lastReminder").set(now);
    return { ok: true, seeded: true, ...out };
  }
  const sp = seen.posts || {}, sl = seen.lectures || {};
  const newP = Object.keys(site.posts).filter((k) => !sp[k]).map((k) => site.posts[k]);
  const newL = Object.keys(site.lectures).filter((k) => !sl[k]).map((k) => site.lectures[k]);
  out.newPosts = newP.length; out.newLectures = newL.length;

  if (newP.length || newL.length) {
    let title, body, url;
    if (newL.length && newP.length) {
      title = "🔔 جديد في الموقع";
      body = short("محاضرات: " + newL.join("، ") + " — منشورات: " + newP.join("، "), 200);
      url = "/#lectures";
    } else if (newL.length) {
      title = newL.length === 1 ? "📚 محاضرة جديدة" : "📚 " + newL.length + " محاضرات جديدة";
      body = short(newL.join("، "), 200); url = "/#lectures";
    } else {
      title = newP.length === 1 ? "📢 منشور جديد" : "📢 " + newP.length + " منشورات جديدة";
      body = short(newP.join("، "), 200); url = "/#posts";
    }
    await broadcast({ title, body, url });
    const upd = {};
    Object.keys(site.posts).forEach((k) => { if (!sp[k]) upd["posts/" + k] = true; });
    Object.keys(site.lectures).forEach((k) => { if (!sl[k]) upd["lectures/" + k] = true; });
    await seenRef.update(upd);
    await db.ref("push_meta/lastReminder").set(now); // الإشعار الجديد يغني عن التذكير
    return { ok: true, ...out };
  }

  // تذكير كل يومين بالتحقق من المحاضرات
  const last = (await db.ref("push_meta/lastReminder").once("value")).val() || 0;
  if (now - last >= REMINDER_EVERY) {
    await broadcast({
      title: "📚 تحقق من المحاضرات الجديدة",
      body: "افتح صفحة المحاضرات وشوف المحاضرات اللي نزلت",
      url: "/#lectures",
    });
    await db.ref("push_meta/lastReminder").set(now);
    out.reminder = true;
  }
  return { ok: true, ...out };
}

const safeUrl = (u) => (typeof u === "string" && /^\/[^\/\\]*$/.test(u) ? u : "/");

function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = async (req, res) => {
  // تشغيل تلقائي (Vercel Cron أو أي خدمة جدولة): /api/push?a=cron
  if (req.method === "GET" && req.query && req.query.a === "cron") {
    const auth = req.headers.authorization || "";
    const ok = [process.env.CRON_SECRET, process.env.ADMIN_SECRET].some(
      (s) => s && same(auth, "Bearer " + s)
    );
    if (!ok) return res.status(401).json({ error: "unauthorized" });
    try { return res.status(200).json(await runCron(req)); }
    catch (e) { console.error(e); return res.status(500).json({ error: String((e && e.message) || e).slice(0, 200) }); }
  }
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
      const info = await broadcast({ title, body: String(b.body || "").trim().slice(0, 200), url: safeUrl(b.url) });
      return res.json({ ok: true, ...info });
    }

    res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String((e && e.message) || e).slice(0, 200) });
  }
};
