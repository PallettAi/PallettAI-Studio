// Replay the confirmation step in isolation so we can see the exact
// confirmation email body and the link-fetch result.
'use strict';

const fs = require('fs');
const path = require('path');

const mem = {};
global.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};

const SUPABASE = require('../modules/supabase.js');
const MAIL = 'https://api.mail.tm';
const PW = 'Check12345!';

(async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'ref.html'), 'utf8');
  const url = (html.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0];
  const key = (html.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/) || [])[0];
  console.log('registry:', url);
  console.log('config:', SUPABASE.setConfig(url, key).ok);

  const reqAddr = 'diag.lc' + Date.now().toString(36).slice(-8) + '@uberip.com';
  async function mt(fn) {
    for (let i = 0; i < 6; i++) {
      try {
        const r = await fn();
        if (r && (r.id || r.token)) return r;
      } catch (e) { /* retry */ }
      await new Promise((r) => setTimeout(r, 3000));
    }
    return {};
  }

  const mbox = await mt(() => fetch(MAIL + '/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: reqAddr, password: 'Mailbox12345!' })
  }).then((x) => x.json()));
  console.log('mbox:', mbox.id ? mbox.address : null);
  const tok = await mt(() => fetch(MAIL + '/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: mbox.address, password: 'Mailbox12345!' })
  }).then((x) => x.json()));
  const mtToken = tok && tok.token;
  console.log('mtToken:', !!mtToken);

  const r = await SUPABASE.signUp(mbox.address, PW);
  console.log('signup:', JSON.stringify(r));

  const auth = { Authorization: 'Bearer ' + mtToken, 'Content-Type': 'application/json' };
  let msg = null;
  for (let i = 0; i < 24 && !msg; i++) {
    await new Promise((r) => setTimeout(r, 7000));
    const list = await fetch(MAIL + '/messages', { headers: auth }).then((x) => x.json()).catch(() => []);
    const first = (list['hydra:member'] || [])[0];
    if (first) msg = await fetch(MAIL + '/messages/' + first.id, { headers: auth }).then((x) => x.json()).catch(() => null);
  }
  console.log('msg arrived:', !!msg);
  if (msg) {
    const text = (msg.text || '') + ' ' + (msg.html || '');
    console.log('--- email body (first 1400 chars) ---');
    console.log(text.slice(0, 1400));
    const link = (text.match(/https:\/\/[a-z0-9]+\.supabase\.co\/auth\/v1\/verify\?[^"'\s<>)]+/) || [])[0];
    console.log('--- extracted link ---');
    console.log(link);
    console.log('--- follow link (no redirect, headers) ---');
    if (link) {
      const conf = await fetch(link, { redirect: 'manual' });
      console.log('HTTP', conf.status);
      console.log('headers:', conf.headers && Object.keys(conf.headers).length ? Object.fromEntries([...conf.headers.entries()]).toJSON ? Object.fromEntries([...conf.headers].map(([k,v]) => [k, [...v].join(', ')])) : {} : 'n/a');
      console.log('body:', await conf.text().catch(() => '').slice(0, 600));
    }
  }
  console.log('done');
})().catch((e) => { console.error('diagnostic crashed:', e); process.exit(1); });
