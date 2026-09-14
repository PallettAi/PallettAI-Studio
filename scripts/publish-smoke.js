// ============================================================
// Publish providers smoke test
//
// The network calls cannot be covered here — they need live credentials — so
// everything that CAN be pinned down is pinned down instead: the request bodies.
// That is the right split, because the bodies are where these integrations fail
// silently. Cloudflare in particular returns a bare 500 if the manifest multipart
// has the wrong boundaries or part headers, which is unreadable at the call site
// and obvious here.
//
// SHA-256 is implemented in this module rather than taken from crypto.subtle,
// because crypto.subtle does not exist outside a secure context and a deploy that
// cannot hash is a deploy that cannot happen. It is checked against the published
// test vectors, including the two block-boundary cases that catch padding bugs.
//
// Run: node scripts/publish-smoke.js
// ============================================================
'use strict';

const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const Publish = require(path.join(ROOT, 'data', 'publish.js'));

let failed = 0;
function ok(name, cond, detail) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (!cond && detail ? '  -> ' + String(detail).slice(0, 240) : ''));
  if (!cond) failed++;
}

const nodeSha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// ---- 1. hashing ---------------------------------------------------------
console.log('\n1. SHA-256 against the published vectors');
[
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ['The quick brown fox jumps over the lazy dog', 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592']
].forEach(([input, want]) => ok('sha256(' + JSON.stringify(input.slice(0, 22)) + ')', Publish.sha256Hex(input) === want, Publish.sha256Hex(input)));
// 55 and 56 bytes straddle the length-padding boundary; 64 is a whole block.
[55, 56, 57, 64, 119, 120, 1000].forEach((n) => {
  const s = 'a'.repeat(n);
  ok('sha256 matches Node at ' + n + ' bytes', Publish.sha256Hex(s) === nodeSha(s));
});
ok('sha256 handles multibyte input', Publish.sha256Hex('\u00e9 \u4e2d\u6587 \ud83c\udfa8') === nodeSha('\u00e9 \u4e2d\u6587 \ud83c\udfa8'));
ok('sha256 of a megabyte matches Node', Publish.sha256Hex('a'.repeat(1000000)) === 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');

// ---- 2. base64 ----------------------------------------------------------
console.log('\n2. Base64 matches Node');
['', 'a', 'ab', 'abc', 'hello', '\u00e9 \u4e2d\u6587 \ud83c\udfa8', 'x'.repeat(257), '<!DOCTYPE html>\n<p>Hi</p>'].forEach((s) => {
  const want = Buffer.from(s, 'utf8').toString('base64');
  ok('base64(' + JSON.stringify(s.slice(0, 16)) + ')', Publish.toBase64(s) === want, Publish.toBase64(s) + ' != ' + want);
});

// ---- 3. file preparation ------------------------------------------------
console.log('\n3. Files become deployment entries');
const files = [
  { name: 'index.html', content: '<!DOCTYPE html><h1>Hi</h1>' },
  { name: 'about.html', content: '<!DOCTYPE html><h1>About</h1>' },
  { name: 'robots.txt', content: 'User-agent: *\nAllow: /\n' },
  { name: 'sitemap.xml', content: '<?xml version="1.0"?><urlset/>' },
  { name: 'icon.svg', content: '<svg/>' },
  { name: 'app.js', content: 'console.log(1)' }
];
const entries = Publish.entries(files);
ok('one entry per file', entries.length === 6, entries.length);
ok('duplicate paths collapse to the first', (() => {
  const e = Publish.entries([{ name: 'index.html', content: 'first' }, { name: 'index.html', content: 'second' }]);
  return e.length === 1 && /first/.test(e[0].content);
})());
ok('leading slashes are stripped', Publish.entries([{ name: '/index.html', content: 'x' }])[0].path === 'index.html');
ok('empty names are dropped', Publish.entries([{ name: '', content: 'x' }, { name: 'a.html', content: 'x' }]).length === 1);
ok('content types are correct', entries.map((e) => e.contentType).join('|') === [
  'text/html; charset=utf-8', 'text/html; charset=utf-8', 'text/plain; charset=utf-8',
  'application/xml; charset=utf-8', 'image/svg+xml', 'text/javascript; charset=utf-8'
].join('|'), entries.map((e) => e.contentType).join('|'));
ok('unknown types fall back safely', Publish.contentType('a.weird') === 'application/octet-stream');
ok('length counts bytes, not characters', Publish.entries([{ name: 'a.txt', content: '\u00e9' }])[0].length === 2);
ok('hash matches Node', entries[0].hash === nodeSha(files[0].content));

// ---- 4. Vercel ----------------------------------------------------------
console.log('\n4. Vercel request body');
{
  const body = Publish.vercelBody('Willow Caf\u00e9', 'Willow Caf\u00e9', files);
  ok('the project name is slugged', body.name === 'willow-cafe', body.name);
  ok('diacritics fold rather than drop', Publish.slug('Caf\u00e9 Ltd') === 'cafe-ltd', Publish.slug('Caf\u00e9 Ltd'));
  ok('targets production', body.target === 'production');
  ok('declares a static project', body.projectSettings.framework === null);
  ok('every file is present once', body.files.length === 6, body.files.length);
  ok('file data is base64 of the content', body.files[0].data === Buffer.from(files[0].content, 'utf8').toString('base64'));
  ok('file paths are relative', body.files.every((f) => f.file === Publish.normalizePath(f.file)));
  ok('url is normalised to https', Publish.vercelUrl({ url: 'x-abc.vercel.app' }) === 'https://x-abc.vercel.app');
  ok('an https url is left alone', Publish.vercelUrl({ url: 'https://y.vercel.app' }) === 'https://y.vercel.app');
  ok('an alias is used when there is no url', Publish.vercelUrl({ alias: ['z.vercel.app'] }) === 'https://z.vercel.app');
  ok('a missing url yields empty, not a broken link', Publish.vercelUrl({}) === '');
  ok('readiness is read correctly', Publish.vercelReady({ readyState: 'READY' }) && !Publish.vercelReady({ readyState: 'BUILDING' }));
  ok('failure is read correctly', Publish.vercelFailed({ readyState: 'ERROR' }) && Publish.vercelFailed({ readyState: 'CANCELED' }) && !Publish.vercelFailed({ readyState: 'READY' }));
}

// ---- 5. Cloudflare Pages ------------------------------------------------
console.log('\n5. Cloudflare Pages request bodies');
{
  const assets = Publish.cfAssetsBody(files);
  ok('one asset per file', assets.length === 6, assets.length);
  ok('an asset is keyed by content hash', assets[0].key === entries[0].hash);
  ok('an asset carries its base64 body and content type', assets[0].base64 === true && assets[0].value === entries[0].base64 && !!assets[0].metadata.contentType);

  const manifest = Publish.cfManifest(files);
  ok('the manifest maps path -> hash', manifest['index.html'] === entries[0].hash && manifest['sitemap.xml'] === entries[3].hash);
  ok('every entry is in the manifest', Object.keys(manifest).length === 6, Object.keys(manifest).length);
  ok('manifest values are exactly the uploaded keys', Object.values(manifest).sort().join() === assets.map((a) => a.key).sort().join());

  const mp = Publish.cfManifestMultipart(manifest, '----TESTBOUNDARY');
  const text = Buffer.from(mp.bytes).toString('utf8');
  ok('the body opens with the boundary', text.indexOf('--' + mp.boundary + '\r\n') === 0, JSON.stringify(text.slice(0, 40)));
  ok('the body closes with the terminal boundary', text.slice(-('--' + mp.boundary + '--\r\n').length) === '--' + mp.boundary + '--\r\n');
  ok('one part per path, not one JSON blob', (text.match(/Content-Disposition: form-data; name="/g) || []).length === 6);
  ok('each part declares its own content type', (text.match(/Content-Type: application\/json/g) || []).length === 6);
  ok('each part has a blank line before its body', (text.match(/\r\n\r\n"/g) || []).length === 6, (text.match(/\r\n\r\n"/g) || []).length);
  ok('the hash is sent as a quoted JSON string', text.indexOf('"' + entries[0].hash + '"') > -1);
  ok('the manifest is deterministic for the same input', (() => {
    const a = Buffer.from(Publish.cfManifestMultipart(manifest, '--B').bytes).toString();
    const b = Buffer.from(Publish.cfManifestMultipart(manifest, '--B').bytes).toString();
    return a === b;
  })());
  ok('a path cannot inject multipart headers', (() => {
    const evil = Buffer.from(Publish.cfManifestMultipart({ 'a"\r\nContent-Type: text/evil': 'h' }, '--B').bytes).toString();
    return evil.indexOf('name="a%22%0D%0AContent-Type: text/evil"') > -1 && evil.indexOf('text/evil\r\n\r\n') === -1;
  })(), Publish.partName('a"\r\nX: y'));

  ok('endpoints are exact', Publish.cfUploadTokenUrl('acct', 'proj') === 'https://api.cloudflare.com/client/v4/accounts/acct/pages/projects/proj/upload-token');
  ok('assets endpoint', Publish.cfAssetsUrl() === 'https://api.cloudflare.com/client/v4/pages/assets/upload');
  ok('upsert endpoint', Publish.cfUpsertUrl() === 'https://api.cloudflare.com/client/v4/pages/assets/upsert-hashes');
  ok('deployment endpoint', Publish.cfDeployUrl('acct', 'proj') === 'https://api.cloudflare.com/client/v4/accounts/acct/pages/projects/proj/deployments');
  ok('account ids are url-encoded', Publish.cfDeployUrl('a/b', 'p').indexOf('/accounts/a%2Fb/') > -1);
  ok('a project body names the branch', JSON.stringify(Publish.cfProjectBody('My Site', 'main')) === '{"name":"my-site","production_branch":"main"}');
  ok('an API error message is surfaced', Publish.cfError({ success: false, errors: [{ code: 8000000, message: 'Project not found' }] }, 404) === 'Project not found');
  ok('a bare failure still names the status', /404/.test(Publish.cfError({}, 404)), Publish.cfError({}, 404));
  ok('the live url is read from the payload', Publish.cfUrl({ result: { url: 'https://x.pages.dev' } }, 'x') === 'https://x.pages.dev');
  ok('a missing url falls back to pages.dev', Publish.cfUrl({}, 'my-site') === 'https://my-site.pages.dev');
}

// ---- 6. shared ----------------------------------------------------------
console.log('\n6. Shared helpers');
ok('the deploy zip is named from the site', Publish.deployFileName('Willow Caf\u00e9 & Co.') === 'willow-cafe-co-deploy.zip', Publish.deployFileName('Willow Caf\u00e9 & Co.'));
ok('an empty name still yields a usable zip name', Publish.deployFileName('') === 'site-deploy.zip', Publish.deployFileName(''));
ok('the dashboard fallback link is https', /^https:\/\/dash\.cloudflare\.com\//.test(Publish.cfDashboardUrl()));
ok('a very long name is truncated to a safe slug', Publish.slug('x'.repeat(200)).length <= 52, Publish.slug('x'.repeat(200)).length);

console.log('\n' + (failed === 0 ? 'PUBLISH SMOKE PASSED' : 'PUBLISH SMOKE FAILED: ' + failed));
process.exit(failed === 0 ? 0 : 1);
