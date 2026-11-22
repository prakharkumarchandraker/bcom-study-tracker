// node push/make_keys.mjs  -> prints the VAPID_JWK secret (keep it private, never commit it).
const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const j = await crypto.subtle.exportKey('jwk', k.privateKey);
console.log(JSON.stringify({ x: j.x, y: j.y, d: j.d }));
