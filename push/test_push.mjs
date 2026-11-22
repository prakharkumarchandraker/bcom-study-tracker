// node push/test_push.mjs : checks encryption (decrypts like a browser would), VAPID signature, slot maths, full cron flow.
import W, { encryptPayload, vapidAuth, isBreakMinute } from './worker.js';
const S = crypto.subtle, enc = new TextEncoder(), dec = new TextDecoder();
const b64u = b => Buffer.from(b).toString('base64url'), unb = s => new Uint8Array(Buffer.from(s, 'base64url'));
const cat = (...a) => new Uint8Array(Buffer.concat(a.map(x => Buffer.from(x))));
const hmac = async (k, d) => new Uint8Array(await S.sign('HMAC', await S.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), d));
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++ };

// fake browser subscription
const ua = await S.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const uaPub = new Uint8Array(await S.exportKey('raw', ua.publicKey)), auth = crypto.getRandomValues(new Uint8Array(16));
const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: b64u(uaPub), auth: b64u(auth) } };

async function decrypt(body) { // receiver side, RFC 8291
  const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const asKey = await S.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await S.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const ikm = await hmac(await hmac(auth, ecdh), cat(enc.encode('WebPush: info\0'), uaPub, asPub, [1]));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, enc.encode('Content-Encoding: aes128gcm\0\x01'))).slice(0, 16);
  const nonce = (await hmac(prk, enc.encode('Content-Encoding: nonce\0\x01'))).slice(0, 12);
  const pt = new Uint8Array(await S.decrypt({ name: 'AES-GCM', iv: nonce }, await S.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ct));
  ok(pt[pt.length - 1] === 2, 'padding delimiter 0x02');
  return dec.decode(pt.slice(0, -1));
}
const body = await encryptPayload(sub, '{"hi":1}');
ok(await decrypt(body) === '{"hi":1}', 'payload decrypts');

const kp = await S.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const j = await S.exportKey('jwk', kp.privateKey), JWK = JSON.stringify({ x: j.x, y: j.y, d: j.d });
const h = await vapidAuth(sub.endpoint, JWK, 'mailto:a@b.c');
const [, t, k] = h.match(/^vapid t=([^,]+), k=(.+)$/);
const [hh, bb, ss] = t.split('.');
const claims = JSON.parse(Buffer.from(bb, 'base64url'));
ok(claims.aud === 'https://fcm.googleapis.com', 'aud = push origin');
const vk = await S.importKey('raw', unb(k), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
ok(await S.verify({ name: 'ECDSA', hash: 'SHA-256' }, vk, unb(ss), enc.encode(hh + '.' + bb)), 'VAPID signature verifies with k');

// slots: every 30 from 07:00 to 23:00 IST
const D = { on: true, every: 30, from: '07:00', to: '23:00', tz: 'Asia/Kolkata' };
const at = s => new Date(s + '+05:30');
ok(isBreakMinute(D, at('2026-11-22T09:30:00')), '09:30 is a break');
ok(!isBreakMinute(D, at('2026-11-22T09:31:00')), '09:31 is not');
ok(!isBreakMinute(D, at('2026-11-22T07:00:00')) === false, '07:00 counts (same as app)');
ok(!isBreakMinute(D, at('2026-11-22T23:00:00')), '23:00 is outside');
ok(isBreakMinute({ ...D, every: 11 }, at('2026-11-22T07:22:00')), 'every 11 -> 07:22');
ok(!isBreakMinute({ ...D, on: false }, at('2026-11-22T09:30:00')), 'off = never');

// full flow with fake KV + fake push service
const kv = new Map(), sent = [];
const env = { VAPID_JWK: JWK, DESK: { get: async (key) => kv.has(key) ? JSON.parse(kv.get(key)) : null, put: async (key, v) => kv.set(key, v) } };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, o) => { sent.push({ url, o, msg: JSON.parse(await decrypt(new Uint8Array(o.body))) }); return new Response('', { status: 201 }) };
const call = (path, b) => W.fetch(new Request('https://w.dev' + path, { method: b ? 'POST' : 'GET', body: b && JSON.stringify(b) }), env);
const id = 'abcdefghijklmnop1234';
ok((await (await call('/key')).json()).key.length === 87, '/key gives 65-byte key');
ok((await call('/sub', { id, sub, ...D })).status === 200, '/sub stores device');
const RealDate = Date; const fake = iso => { const T = +at(iso); globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [T])) } static now() { return T } } };
fake('2026-11-22T09:30:05'); await W.scheduled({}, env, { waitUntil: p => p }); await new Promise(r => setTimeout(r, 50));
ok(sent.length === 1 && sent[0].msg.kind === 'break', 'cron 09:30 sends break');
ok(sent[0].o.headers.Authorization.startsWith('vapid t='), 'Authorization header set');
fake('2026-11-22T09:31:05'); await W.scheduled({}, env, { waitUntil: p => p }); await new Promise(r => setTimeout(r, 50));
ok(sent.length === 1, 'cron 09:31 sends nothing');
await call('/once', { id, at: +at('2026-11-22T09:36:00'), kind: 'walkdone' });
fake('2026-11-22T09:35:50'); await W.scheduled({}, env, { waitUntil: p => p }); await new Promise(r => setTimeout(r, 50));
ok(sent.length === 2 && sent[1].msg.kind === 'walkdone', 'walk-done one-off fires');
ok(!JSON.parse(kv.get('devices'))[id].once, 'one-off cleared');
globalThis.Date = RealDate; globalThis.fetch = realFetch;
console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);
