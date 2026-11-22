// Pragati Study Desk: background break alerts (Cloudflare Worker, free plan).
// The phone/laptop registers a Web Push subscription + its break schedule here.
// A cron runs every minute and sends "Stand up and walk" / "Walk done" pushes,
// so alerts arrive even when the app is closed or YouTube is open.
//
// Bindings (see wrangler.toml / README): KV namespace DESK, secret VAPID_JWK, var VAPID_SUB.

const H = { 'Content-Type': 'application/json' };
const enc = new TextEncoder();
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length } return o };

async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

// RFC 8291 (aes128gcm) payload encryption.
export async function encryptPayload(sub, text) {
  const uaPub = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const prkKey = await hmac(auth, ecdh);
  const ikm = await hmac(prkKey, cat(enc.encode('WebPush: info\0'), uaPub, asPub, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, enc.encode('Content-Encoding: aes128gcm\0\x01'))).slice(0, 16);
  const nonce = (await hmac(prk, enc.encode('Content-Encoding: nonce\0\x01'))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(enc.encode(text), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

// RFC 8292 VAPID header.
export async function vapidAuth(endpoint, jwkText, subject) {
  const jwk = JSON.parse(jwkText);
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body));
  const pub = b64u(cat(new Uint8Array([4]), unb64u(jwk.x), unb64u(jwk.y)));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${pub}`;
}
const pubKey = jwkText => { const j = JSON.parse(jwkText); return b64u(cat(new Uint8Array([4]), unb64u(j.x), unb64u(j.y))) };

async function sendPush(env, sub, msg, ttl) {
  const body = await encryptPayload(sub, JSON.stringify(msg));
  const r = await fetch(sub.endpoint, {
    method: 'POST', body, headers: {
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl || 300), Urgency: 'high',
      Authorization: await vapidAuth(sub.endpoint, env.VAPID_JWK, env.VAPID_SUB || 'mailto:study-desk@example.com'),
    }
  });
  return r.status;
}

// Same slot maths as index.html (checkBreak / nextBreak).
const toMin = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0) };
export function isBreakMinute(d, now) {
  if (!d.on) return false;
  const ev = Math.min(240, Math.max(5, Math.round(+d.every || 30)));
  let p; try { p = new Intl.DateTimeFormat('en-GB', { timeZone: d.tz || 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now) } catch (e) { return false }
  const m = (+p.find(x => x.type === 'hour').value % 24) * 60 + +p.find(x => x.type === 'minute').value;
  const a = toMin(d.from), b = toMin(d.to);
  const inH = a <= b ? (m >= a && m < b) : (m >= a || m < b);
  return inH && (((m - a) % 1440 + 1440) % 1440) % ev === 0;
}

const BREAK = { kind: 'break', title: 'Stand up and walk', body: 'Time for a break. Tap a walk time below, or open the app.' };
const WALKED = { kind: 'walkdone', title: 'Walk done', body: 'Sit down, drink some water and get back to study.' };

async function load(env) { return (await env.DESK.get('devices', 'json')) || {} }
async function store(env, all) { await env.DESK.put('devices', JSON.stringify(all)) }

async function tick(env) {
  const all = await load(env), now = new Date(), t = +now;
  let dirty = false;
  for (const [id, d] of Object.entries(all)) {
    let msg = null;
    if (d.once && d.once.at <= t + 20000) { msg = d.once.kind === 'walkdone' ? WALKED : BREAK; delete d.once; dirty = true }
    else if (!d.once && isBreakMinute(d, now)) msg = BREAK;
    if (!msg) continue;
    try {
      const st = await sendPush(env, d.sub, { ...msg, at: t });
      if (st === 404 || st === 410) { delete all[id]; dirty = true }
    } catch (e) { }
  }
  // Forget devices that have not checked in for 60 days.
  for (const [id, d] of Object.entries(all)) if (t - (d.seen || 0) > 60 * 864e5) { delete all[id]; dirty = true }
  if (dirty) await store(env, all);
}

export default {
  async fetch(req, env) {
    const cors = { 'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
    const out = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { ...H, ...cors } });
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const p = new URL(req.url).pathname;
    if (p === '/key') return out({ key: pubKey(env.VAPID_JWK) });
    if (req.method !== 'POST') return out({ ok: true, app: 'study-desk-push' });
    let b; try { b = await req.json() } catch (e) { return out({ error: 'bad json' }, 400) }
    const id = String(b.id || ''); if (!/^[a-z0-9]{16,40}$/.test(id)) return out({ error: 'bad id' }, 400);
    const all = await load(env);
    if (p === '/sub') {
      const s = b.sub; if (!s || !/^https:\/\//.test(s.endpoint || '') || !s.keys || !s.keys.p256dh || !s.keys.auth) return out({ error: 'bad sub' }, 400);
      const old = all[id] || {};
      all[id] = { sub: { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }, on: !!b.on, every: +b.every || 30, from: String(b.from || '07:00'), to: String(b.to || '23:00'), tz: String(b.tz || 'Asia/Kolkata').slice(0, 64), once: old.once, seen: Date.now() };
      if (Object.keys(all).length > 50) return out({ error: 'full' }, 429);
      await store(env, all); return out({ ok: true });
    }
    if (!all[id]) return out({ error: 'unknown device' }, 404);
    if (p === '/once') { // {at, kind:'walkdone'|'break'} or {at:0} to cancel
      if (+b.at > 0) all[id].once = { at: +b.at, kind: b.kind === 'walkdone' ? 'walkdone' : 'break' }; else delete all[id].once;
      all[id].seen = Date.now(); await store(env, all); return out({ ok: true });
    }
    if (p === '/test') { const st = await sendPush(env, all[id].sub, { ...BREAK, at: Date.now(), test: true }); return out({ ok: st < 300, status: st }) }
    if (p === '/unsub') { delete all[id]; await store(env, all); return out({ ok: true }) }
    return out({ error: 'not found' }, 404);
  },
  async scheduled(ev, env, ctx) { ctx.waitUntil(tick(env)) },
};
