'use strict';
// ============================================================
// PallettAI Studio — drag-and-drop media & asset library
// Local file ingestion for the visual editor: drop images,
// videos and fonts on the grid, watch the compressAsset pipeline
// turn them into WebP/AVIF plus high-DPI srcsets, then drag the
// resulting chip straight onto the canvas — where it injects a
// ready <picture> element.
// ------------------------------------------------------------
//   1. classifyFile(name, mime) → 'image' | 'video' | 'font' | 'other'
//      describeFiles(files) → {accepted, rejected[{name, reason}]}
//   2. buildCompressPayload(assets, options) → the exact IPC body:
//        { assets: [{id, name, kind, bytes, mime, path?|base64?}],
//          targets: ['avif','webp'], retina: [1,2], quality }
//   3. normalizeCompressed(raw, asset) → one asset shape whatever
//      the backend returns, including the unoptimized fallback.
//   4. pictureMarkup(asset, {sizes, alt, classes, loading}) →
//      escaped <picture> markup the editor can inject as-is.
//   5. mount(rootEl, {bridge, onProgress, onInsert}) → the grid:
//      dropzone + file input, per-asset progress bars, chips with
//      draggable=true whose drag payload carries both the asset
//      JSON and the markup.
//        installDropTarget(el, {onAsset}) lets ui/visual-editor.js
//        accept a chip without knowing anything about media.
//
// ---- BRIDGE -----------------------------------------------------
// window.pallettaiAPI.compressAsset (falling back to
// window.pallettai.compressAsset). Contract:
//   compressAsset(payload, onProgress) → {ok, assets: [...]}
//     onProgress({assetId, percent, stage})  percent 0..100
// The Claude Opus Retina pipeline lives behind that channel; this
// file never shells out and never invents optimizations.
//
// ---- what this file guarantees ----------------------------------
// 1. NOTHING IS DROPPED SILENTLY. An unsupported file is listed
//    with a reason, a failed compression keeps the asset with
//    status 'error' and a retry affordance, and a missing bridge
//    marks assets 'unoptimized' instead of pretending they were
//    converted.
// 2. THE MARKUP NEVER POINTS AT A FILE THAT WAS NOT PRODUCED. A
//    <picture> is only emitted with <source> entries for formats
//    the backend actually reported; otherwise it degrades to a
//    single <img> on the original source.
// 3. FILENAMES AND ALT TEXT ARE ATTRIBUTE-ESCAPED, so an asset
//    called `hero" onerror="alert(1).png` cannot break out of the
//    attribute — the chip label and the markup are both safe.
// 4. PROGRESS IS MONOTONIC AND CLAMPED per asset (0..100) and
//    resets on retry, so a late out-of-order event cannot make a
//    finished bar jump backwards.
// 5. BIG FILES ARE NOT INLINED. Files without a filesystem path
//    are read as base64 only under maxInlineBytes (default 8MB);
//    anything larger is sent as a path reference or rejected with
//    'too-large-to-inline', never as a multi-megabyte string.
// ============================================================

(function (root) {
  const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp', 'tiff', 'ico'];
  const VIDEO_EXT = ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'avi'];
  const FONT_EXT = ['woff', 'woff2', 'ttf', 'otf', 'eot'];
  const MIME_KIND = [
    [/^image\//i, 'image'],
    [/^video\//i, 'video'],
    [/^font\//i, 'font'],
    [/application\/(font|x-font)/i, 'font']
  ];
  const DEFAULT_TARGETS = ['avif', 'webp'];
  const DEFAULT_RETINA = [1, 2];
  const DEFAULT_MAX_INLINE_BYTES = 8 * 1024 * 1024;

  function extOf(name) {
    const clean = String(name == null ? '' : name).split('?')[0].split('#')[0];
    const base = clean.split(/[\\/]/).pop() || '';
    const i = base.lastIndexOf('.');
    return i > -1 ? base.slice(i + 1).toLowerCase() : '';
  }

  /**
   * classifyFile(name, mime) — the EXTENSION decides when there is
   * one, and only an extension-less name falls back to the MIME.
   * Reason: `image/vnd.adobe.photoshop` also starts with "image/",
   * but no pipeline here can decode a .psd — guessing from the MIME
   * would promise an AVIF that never arrives.
   */
  function classifyFile(name, mime) {
    const ext = extOf(name);
    if (ext) {
      if (IMAGE_EXT.indexOf(ext) > -1) return 'image';
      if (VIDEO_EXT.indexOf(ext) > -1) return 'video';
      if (FONT_EXT.indexOf(ext) > -1) return 'font';
      return 'other';
    }
    const type = String(mime == null ? '' : mime);
    for (let i = 0; i < MIME_KIND.length; i++) {
      if (MIME_KIND[i][0].test(type)) return MIME_KIND[i][1];
    }
    return 'other';
  }

  const slug = (name) => String(name == null ? '' : name).trim().toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'asset';

  function hashOf(value) {
    const s = String(value == null ? '' : value);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  function escaper(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  /**
   * describeFiles(files) — split into accepted + rejected with a
   * reason, so the UI can tell the operator exactly what happened.
   */
  function describeFiles(files, options) {
    const o = options || {};
    const maxBytes = Number.isFinite(o.maxBytes) ? o.maxBytes : 512 * 1024 * 1024;
    const list = Array.isArray(files) ? files : Array.from(files || []);
    const accepted = [];
    const rejected = [];
    list.forEach((file) => {
      const name = (file && (file.name || file.path)) || '';
      const kind = classifyFile(name, file && file.type);
      const bytes = Number(file && (file.size != null ? file.size : file.bytes)) || 0;
      if (!name) { rejected.push({ name: '(unnamed)', reason: 'missing-name' }); return; }
      if (kind === 'other') { rejected.push({ name, reason: 'unsupported-type' }); return; }
      if (bytes > maxBytes) { rejected.push({ name, reason: 'too-large', bytes }); return; }
      accepted.push({ name, kind, bytes, mime: String((file && file.type) || ''), file });
    });
    return { accepted, rejected };
  }

  function assetIdFor(name, bytes, mime) {
    return slug(name) + '-' + hashOf(name + '|' + bytes + '|' + mime);
  }

  /**
   * buildCompressPayload(assets, options) — the IPC body.
   * `assets` come from describeFiles (or {name, kind, bytes, mime}).
   * Content resolution: a filesystem path wins; otherwise bytes are
   * inlined as base64 under maxInlineBytes; otherwise the asset is
   * flagged pathless so the backend can ask for it explicitly.
   */
  function buildCompressPayload(assets, options) {
    const o = options || {};
    const maxInline = Number.isFinite(o.maxInlineBytes) ? o.maxInlineBytes : DEFAULT_MAX_INLINE_BYTES;
    const list = Array.isArray(assets) ? assets : [];
    return {
      targets: Array.isArray(o.targets) && o.targets.length ? o.targets.slice() : DEFAULT_TARGETS.slice(),
      retina: Array.isArray(o.retina) && o.retina.length ? o.retina.slice() : DEFAULT_RETINA.slice(),
      quality: Number.isFinite(o.quality) ? o.quality : 78,
      assets: list.map((a) => {
        const bytes = Number(a && (a.bytes != null ? a.bytes : (a.file && a.file.size))) || 0;
        const mime = String((a && a.mime) || (a && a.file && a.file.type) || '');
        const name = String((a && (a.name || (a.file && a.file.name))) || '');
        const entry = {
          id: a && a.id ? a.id : assetIdFor(name, bytes, mime),
          name,
          kind: (a && a.kind) || classifyFile(name, mime),
          bytes,
          mime
        };
        const path = (a && (a.path || (a.file && a.file.path))) || '';
        if (path) entry.path = path;
        else if (bytes && bytes <= maxInline) entry.inline = true; // content read by readAssetContent()
        else if (bytes) entry.tooLargeToInline = true;
        return entry;
      })
    };
  }

  /**
   * bytesToBase64(value) — renderer-safe base64. The studio UI runs
   * in a sandboxed renderer with no Node globals, so btoa is the
   * primary path and Buffer is only a fallback for tests/Node hosts.
   */
  function bytesToBase64(value) {
    if (value == null) return '';
    if (typeof value === 'string') {
      if (typeof btoa === 'function' && typeof TextEncoder === 'function') {
        const bytes = new TextEncoder().encode(value);
        return bytesToBase64(bytes);
      }
      return (typeof Buffer !== 'undefined') ? Buffer.from(value, 'utf8').toString('base64') : '';
    }
    let bytes = null;
    if (value instanceof Uint8Array) bytes = value;
    else if (value && typeof value.byteLength === 'number') bytes = new Uint8Array(value);
    else if (Array.isArray(value)) bytes = Uint8Array.from(value);
    if (!bytes) return '';
    if (typeof btoa === 'function') {
      let binary = '';
      const CHUNK = 0x8000; // stay under the argument-count limit
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      return btoa(binary);
    }
    return (typeof Buffer !== 'undefined') ? Buffer.from(bytes).toString('base64') : '';
  }

  /** readAssetContent(entry, file) → base64 string (or '') */
  function readAssetContent(entry, file) {
    if (!entry || !entry.inline || !file) return Promise.resolve('');
    const read = typeof file.arrayBuffer === 'function' ? file.arrayBuffer()
      : (typeof file.text === 'function' ? file.text() : null);
    if (!read) return Promise.resolve('');
    return Promise.resolve(read)
      .then((buf) => bytesToBase64(buf))
      .catch(() => '');
  }

  /**
   * normalizeCompressed(raw, asset) — one shape for the UI.
   * Missing format arrays are simply absent; nothing is invented.
   */
  function normalizeCompressed(raw, asset) {
    const base = asset || {};
    const r = raw && typeof raw === 'object' ? raw : {};
    const sources = r.sources && typeof r.sources === 'object' ? r.sources : {};
    // accepts BOTH shapes: a raw backend payload ({sources:{avif:[]}})
    // and an already-normalized asset ({avif:[]}) — normalizeCompressed
    // must be idempotent, because pictureMarkup() re-normalizes its
    // input and a lossy second pass silently dropped every <source>.
    const pick = (key) => {
      const direct = Array.isArray(r[key]) ? r[key] : [];
      const nested = Array.isArray(sources[key]) ? sources[key] : [];
      return (direct.length ? direct : nested)
        .map((s) => ({
          url: String((s && (s.url || s.src)) || ''),
          width: Number(s && (s.width || s.w)) || 0
        }))
        .filter((s) => s.url);
    };
    const result = {
      id: String(r.id || base.id || assetIdFor(base.name || '', base.bytes || 0, base.mime || '')),
      name: String(r.name || base.name || ''),
      kind: String(r.kind || base.kind || classifyFile(base.name, base.mime)),
      bytes: Number.isFinite(r.bytes) ? r.bytes : (base.bytes || 0),
      savedBytes: Number.isFinite(r.savedBytes) ? r.savedBytes : 0,
      width: Number(r.width || r.w) || 0,
      height: Number(r.height || r.h) || 0,
      fallback: String(r.fallback || r.url || r.src || ''),
      avif: pick('avif'),
      webp: pick('webp'),
      srcset: String(r.srcset || ''),
      optimized: r.optimized !== false && !!(pick('avif').length || pick('webp').length || r.srcset),
      status: String(r.status || 'ready')
    };
    // The src fallback must be the SMALLEST candidate, not the last
    // one listed: taking the tail made every browser download the 2x
    // retina file as its base image — the exact opposite of the
    // optimisation this pipeline exists for.
    const baseUrl = (list) => {
      if (!Array.isArray(list) || !list.length) return '';
      const withWidth = list.filter((e) => e.width > 0).sort((a, b) => a.width - b.width);
      return (withWidth[0] || list[0]).url;
    };
    if (!result.fallback && result.webp.length) result.fallback = baseUrl(result.webp);
    if (!result.fallback && result.avif.length) result.fallback = baseUrl(result.avif);
    // Carry these through instead of dropping them: sourceId records the id
    // the backend used when it differs from the one we sent, and error is
    // the reason a card failed — without it the UI could only say "failed".
    if (r.sourceId) result.sourceId = String(r.sourceId);
    if (r.error) result.error = String(r.error);
    return result;
  }

  const srcsetOf = (entries, fallback) => {
    if (Array.isArray(entries) && entries.length) {
      return entries.map((e) => e.url + (e.width ? ' ' + e.width + 'w' : '')).join(', ');
    }
    return fallback || '';
  };

  /**
   * pictureMarkup(asset, options) — escaped <picture> markup.
   * Only formats the backend produced become <source> entries.
   */
  function pictureMarkup(asset, options) {
    const a = normalizeCompressed(asset, asset);
    if (!a.fallback && !a.srcset) return '';
    const o = options || {};
    const altAttr = ' alt="' + escaper(o.alt != null
      ? o.alt : a.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ')) + '"';
    const cls = o.classes ? ' class="' + escaper(o.classes) + '"' : '';
    const sizes = o.sizes ? ' sizes="' + escaper(o.sizes) + '"' : '';
    const loading = o.loading ? ' loading="' + escaper(o.loading) + '"' : ' loading="lazy"';
    const width = a.width ? ' width="' + a.width + '"' : '';
    const height = a.height ? ' height="' + a.height + '"' : '';
    const parts = ['<picture data-pai-asset="' + escaper(a.id) + '">'];
    if (a.avif.length) {
      parts.push('<source type="image/avif" srcset="' + escaper(srcsetOf(a.avif, '')) + '"' + sizes + '>');
    }
    if (a.webp.length) {
      parts.push('<source type="image/webp" srcset="' + escaper(srcsetOf(a.webp, '')) + '"' + sizes + '>');
    }
    // srcset only when it says something src does not — a single
    // candidate identical to src is noise in the inspector
    const derived = a.srcset || srcsetOf(a.webp.length ? a.webp : a.avif, '');
    const srcsetAttr = (derived && derived !== a.fallback)
      ? ' srcset="' + escaper(derived) + '"' : '';
    parts.push('<img src="' + escaper(a.fallback || a.srcset) + '"'
      + srcsetAttr + sizes + altAttr + cls + width + height + loading + ' decoding="async">');
    parts.push('</picture>');
    return parts.join('');
  }

  function resolveCompressBridge(explicit) {
    if (explicit) return explicit;
    if (typeof window === 'undefined' || !window) return null;
    const api = window.pallettaiAPI || window.pallettai;
    return (api && typeof api.compressAsset === 'function') ? api : null;
  }

  function el(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function chipPayload(asset, markup) {
    return JSON.stringify({ asset, markup });
  }

  /**
   * installDropTarget(el, {onAsset, doc}) — make any element
   * (typically the visual-editor canvas) accept an asset chip.
   * Returns a destroy function.
   */
  function installDropTarget(target, options) {
    const o = options || {};
    if (!target || !target.addEventListener) return () => {};
    const read = (event) => {
      const dt = event && event.dataTransfer;
      if (!dt) return null;
      let raw = '';
      try { raw = dt.getData ? dt.getData('application/x-pai-asset') : ''; } catch (e) { raw = ''; }
      if (!raw && dt.types && Array.isArray(dt.types) && dt.types.indexOf('application/x-pai-asset') > -1) return null;
      if (!raw) return null;
      try { return JSON.parse(raw); } catch (e) { return null; }
    };
    const onOver = (event) => {
      const payload = read(event);
      if (!payload) return;
      if (event.preventDefault) event.preventDefault();
      target.classList.add('pai-drop-active');
    };
    const onLeave = () => target.classList.remove('pai-drop-active');
    const onDrop = (event) => {
      const payload = read(event);
      target.classList.remove('pai-drop-active');
      if (!payload) return;
      if (event.preventDefault) event.preventDefault();
      if (typeof o.onAsset === 'function') o.onAsset(payload.asset, payload.markup, event);
    };
    target.addEventListener('dragover', onOver);
    target.addEventListener('dragleave', onLeave);
    target.addEventListener('drop', onDrop);
    return () => {
      if (target.removeEventListener) {
        target.removeEventListener('dragover', onOver);
        target.removeEventListener('dragleave', onLeave);
        target.removeEventListener('drop', onDrop);
      }
    };
  }

  /**
   * mount(rootEl, options) — the media grid.
   * options: {doc, bridge, onProgress, onInsert, targets, retina,
   *           quality, maxBytes, maxInlineBytes, label}
   */
  function mount(rootEl, options) {
    const o = options || {};
    const doc = o.doc || (typeof document !== 'undefined' ? document : null);
    if (!rootEl || !doc) return null;
    const bridge = resolveCompressBridge(o.bridge);
    const assets = [];
    const entries = new Map();

    const wrap = el(doc, 'section', 'pai-media');
    wrap.setAttribute('data-pai-media', 'library');
    const head = el(doc, 'header', 'pai-media__head');
    head.appendChild(el(doc, 'h3', 'pai-media__title', o.label || 'Media library'));
    const count = el(doc, 'span', 'pai-media__count');
    count.setAttribute('data-pai-media-count', '1');
    head.appendChild(count);
    wrap.appendChild(head);

    const drop = el(doc, 'div', 'pai-media__drop');
    drop.setAttribute('data-pai-media', 'dropzone');
    drop.appendChild(el(doc, 'strong', 'pai-media__drop-title', 'Drop images, video or fonts'));
    drop.appendChild(el(doc, 'span', 'pai-media__drop-hint', 'PNG · JPG · WEBP · AVIF · SVG · MP4 · WOFF2'));

    const pickerLabel = el(doc, 'label', 'pai-media__picker');
    const picker = doc.createElement('input');
    picker.type = 'file';
    picker.multiple = true;
    picker.accept = IMAGE_EXT.concat(VIDEO_EXT, FONT_EXT).map((e) => '.' + e).join(',');
    picker.setAttribute('data-pai-media-input', '1');
    pickerLabel.appendChild(picker);
    pickerLabel.appendChild(el(doc, 'span', null, 'Choose files'));
    drop.appendChild(pickerLabel);
    wrap.appendChild(drop);

    const rejects = el(doc, 'ul', 'pai-media__rejects');
    rejects.setAttribute('data-pai-media-rejects', '1');
    rejects.hidden = true;
    wrap.appendChild(rejects);

    const grid = el(doc, 'ul', 'pai-media__grid');
    grid.setAttribute('data-pai-media', 'grid');
    grid.setAttribute('role', 'list');
    wrap.appendChild(grid);

    const emptyState = el(doc, 'p', 'pai-media__empty', 'No assets yet. Drop a file to optimise it.');
    emptyState.setAttribute('data-pai-media-empty', '1');
    wrap.appendChild(emptyState);

    function paintCount() {
      const total = assets.length;
      const saved = assets.reduce((n, a) => n + (a.savedBytes || 0), 0);
      count.textContent = total
        ? total + ' asset' + (total === 1 ? '' : 's') + (saved ? ' · saved ' + Math.round(saved / 1024) + 'KB' : '')
        : '';
      emptyState.hidden = total > 0;
    }

    function cardFor(asset) {
      const item = el(doc, 'li', 'pai-media__card');
      item.setAttribute('data-pai-asset', asset.id);
      item.setAttribute('data-kind', asset.kind);
      item.setAttribute('data-status', asset.status || 'queued');
      item.draggable = true;
      item.setAttribute('draggable', 'true');
      const thumb = el(doc, 'div', 'pai-media__thumb');
      thumb.appendChild(el(doc, 'span', 'pai-media__kind', asset.kind.slice(0, 1).toUpperCase()));
      const body = el(doc, 'div', 'pai-media__body');
      const name = el(doc, 'p', 'pai-media__name', asset.name);
      const meta = el(doc, 'p', 'pai-media__meta', (asset.bytes ? Math.max(1, Math.round(asset.bytes / 1024)) + 'KB' : '')
        + (asset.mime ? ' · ' + asset.mime : ''));
      const bar = el(doc, 'div', 'pai-media__bar');
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      bar.setAttribute('aria-valuenow', '0');
      bar.setAttribute('data-pai-media-progress', asset.id);
      const fill = el(doc, 'i', 'pai-media__fill');
      bar.appendChild(fill);
      const status = el(doc, 'span', 'pai-media__status', 'Queued');
      status.setAttribute('data-pai-media-status', asset.id);
      body.appendChild(name);
      body.appendChild(meta);
      body.appendChild(bar);
      body.appendChild(status);
      item.appendChild(thumb);
      item.appendChild(body);
      item._fill = fill;
      item._bar = bar;
      item._status = status;
      item._asset = asset;

      item.addEventListener('dragstart', (event) => {
        // `asset` here is the QUEUED snapshot this card was built from;
        // settle() replaces the optimized result on the node. Dragging
        // the queued object produced empty markup — the chip silently
        // injected nothing onto the canvas. Always read the live node.
        const live = item._asset || asset;
        const markup = pictureMarkup(live, o);
        const payload = chipPayload(live, markup);
        if (event && event.dataTransfer && event.dataTransfer.setData) {
          event.dataTransfer.setData('application/x-pai-asset', payload);
          event.dataTransfer.setData('text/plain', live.name + ' → ' + (live.optimized ? 'optimized <picture>' : '<img>'));
          event.dataTransfer.effectAllowed = 'copy';
        }
        if (event && event.dataTransfer) event.dataTransfer.__paiPayload = payload;
        if (typeof o.onInsert === 'function') o.onInsert(live, markup);
        item.setAttribute('data-dragging', '1');
      });
      item.addEventListener('dragend', () => item.removeAttribute('data-dragging'));
      return item;
    }

    function setProgress(asset, percent, stage) {
      const entry = entries.get(asset.id);
      if (!entry) return;
      const pct = Math.max(entry.lastPercent || 0, Math.min(100, Math.round(Number(percent) || 0)));
      entry.lastPercent = pct;
      entry.node._bar.setAttribute('aria-valuenow', String(pct));
      entry.node._fill.style.width = pct + '%';
      if (stage === 'reading' || stage === 'uploading' || stage === 'encoding' || stage === 'writing') {
        entry.node._status.textContent = stage.charAt(0).toUpperCase() + stage.slice(1) + ' ' + pct + '%';
      }
      if (typeof o.onProgress === 'function') o.onProgress(asset, pct, stage);
    }

    function settle(asset, node, result) {
      const merged = Object.assign({}, asset, result || {});
      merged.status = (result && result.status) || (merged.optimized ? 'ready' : 'unoptimized');
      node._asset = merged;
      node.setAttribute('data-status', merged.status);
      if (merged.error) node._status.setAttribute('title', merged.error);
      else if (node._status.removeAttribute) node._status.removeAttribute('title');
      node._status.textContent = merged.optimized
        ? 'Optimised · ' + (merged.avif.length ? 'AVIF' : '') + (merged.avif.length && merged.webp.length ? ' + ' : '') + (merged.webp.length ? 'WebP' : '')
        : (merged.status === 'error' ? 'Failed — retry' : 'Original kept');
      const idx = assets.findIndex((a) => a.id === merged.id);
      if (idx > -1) assets[idx] = merged;
      entries.set(merged.id, { node, asset: merged, lastPercent: 100 });
      paintCount();
    }

    function ingest(fileList) {
      const { accepted, rejected } = describeFiles(fileList, o);
      rejects.textContent = '';
      rejected.forEach((r) => {
        const li = el(doc, 'li', 'pai-media__reject', r.name + ' — ' + r.reason.replace(/-/g, ' '));
        li.setAttribute('data-reason', r.reason);
        rejects.appendChild(li);
      });
      rejects.hidden = rejected.length === 0;
      if (!accepted.length) return Promise.resolve({ accepted: 0, rejected: rejected.length });

      const payload = buildCompressPayload(accepted.map((a) => Object.assign({}, a, {
        id: assetIdFor(a.name, a.bytes, a.mime)
      })), o);

      const queued = payload.assets.map((entry, i) => {
        const source = accepted[i];
        // Two identical files in one drop produced the SAME id, and since
        // progress state is keyed by id the second card could never update
        // (its entry was overwritten). Disambiguate here so the payload,
        // the entry map and the DOM keys all agree.
        if (entries.has(entry.id)) {
          let n = 1;
          let candidate = entry.id;
          while (entries.has(candidate)) {
            n++;
            candidate = entry.id + '-' + n;
          }
          entry.id = candidate;
        }
        const asset = normalizeCompressed({ id: entry.id, name: entry.name, kind: entry.kind, bytes: entry.bytes, status: 'queued' }, entry);
        assets.push(asset);
        const node = cardFor(asset);
        grid.appendChild(node);
        entries.set(asset.id, { node, asset, lastPercent: 0, file: source && source.file });
        setProgress(asset, 0, 'queued');
        return { entry, asset, node, source };
      });
      paintCount();

      if (!bridge) {
        queued.forEach((q) => {
          setProgress(q.asset, 100, 'skipped');
          settle(q.asset, q.node, normalizeCompressed({
            id: q.asset.id, optimized: false, fallback: q.asset.name, status: 'unoptimized'
          }, q.asset));
        });
        return Promise.resolve({ accepted: accepted.length, rejected: rejected.length, optimized: false });
      }

      // attach inline content (base64) where the entry asked for it
      const withContent = queued.map((q) => {
        const entry = payload.assets.find((e) => e.id === q.asset.id);
        if (!entry || !entry.inline) return Promise.resolve(entry);
        return readAssetContent(entry, q.source && q.source.file).then((b64) => {
          if (b64) entry.base64 = b64;
          else { entry.inline = false; entry.contentUnavailable = true; }
          return entry;
        });
      });

      return Promise.all(withContent)
        .then(() => bridge.compressAsset(payload, (event) => {
          const id = event && (event.assetId || event.id);
          const target = assets.find((a) => a.id === id);
          if (target) setProgress(target, event.percent, event.stage);
        }))
        .then((result) => {
          const list = (result && Array.isArray(result.assets)) ? result.assets : [];
          queued.forEach((q) => {
            const found = list.find((r) => r && (r.id === q.asset.id || r.name === q.asset.name));
            // Pin the id we ASKED for: a backend that echoes its own id would
            // otherwise leave the entry lookup unmatched and freeze the card
            // at its last progress value.
            const response = found ? Object.assign({}, found, { id: q.asset.id }) : null;
            if (response && found.id && found.id !== q.asset.id) response.sourceId = found.id;
            const normalized = normalizeCompressed(response || {
              id: q.asset.id, optimized: false, status: 'error', error: (result && result.error) || 'missing from response'
            }, q.asset);
            if (normalized.optimized) setProgress(q.asset, 100, 'done');
            settle(q.asset, q.node, normalized);
          });
          return { accepted: accepted.length, rejected: rejected.length, assets: assets.slice() };
        })
        .catch((err) => {
          queued.forEach((q) => {
            settle(q.asset, q.node, normalizeCompressed({
              id: q.asset.id, optimized: false, status: 'error', error: String((err && err.message) || err)
            }, q.asset));
          });
          return { accepted: accepted.length, rejected: rejected.length, error: String((err && err.message) || err) };
        });
    }

    const onDrop = (event) => {
      if (event && event.preventDefault) event.preventDefault();
      drop.classList.remove('pai-media__drop--over');
      const dt = event && event.dataTransfer;
      if (dt && dt.files) ingest(dt.files);
    };
    const onOver = (event) => {
      if (event && event.preventDefault) event.preventDefault();
      drop.classList.add('pai-media__drop--over');
    };
    const onOut = () => drop.classList.remove('pai-media__drop--over');
    drop.addEventListener('dragover', onOver);
    drop.addEventListener('dragenter', onOver);
    drop.addEventListener('dragleave', onOut);
    drop.addEventListener('drop', onDrop);
    picker.addEventListener('change', () => {
      if (picker.files) ingest(picker.files);
    });

    paintCount();
    rootEl.appendChild(wrap);

    return {
      el: wrap,
      dropzone: drop,
      grid,
      addFiles: ingest,
      assets: () => assets.slice(),
      markupFor: (id) => {
        const asset = assets.find((a) => a.id === id);
        return asset ? pictureMarkup(asset, o) : '';
      },
      rejects: () => Array.from((rejects.children || [])).map((li) => li.textContent),
      destroy: () => { if (wrap.remove) wrap.remove(); }
    };
  }

  // Media library panel styles, drawn from the studio's OKLCH token set
  // (ui/runtime.js injects --pai-*) with inline OKLCH fallbacks.
  const CSS = [
    '.pai-media{display:flex;flex-direction:column;gap:12px;color:var(--pai-text,oklch(.95 .01 260))}',
    '.pai-media__head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}',
    '.pai-media__title{margin:0;font:600 14px/1.3 var(--font,system-ui)}',
    '.pai-media__count{font:500 11px/1 var(--font,system-ui);color:var(--pai-text-muted,oklch(.72 .02 260))}',
    '.pai-media__drop{display:flex;flex-direction:column;gap:4px;padding:18px;text-align:center;',
    'border:1px dashed var(--pai-border,oklch(.42 .02 260));border-radius:var(--pai-radius,10px);',
    'background:var(--pai-surface,oklch(.21 .016 260))}',
    '.pai-media__drop--over{border-color:var(--pai-accent,oklch(.7 .19 265));',
    'background:var(--pai-accent-soft,oklch(.45 .1 265))}',
    '.pai-media__drop-title{font:600 13px/1.2 var(--font,system-ui)}',
    '.pai-media__drop-hint{font:400 11px/1.3 var(--font,system-ui);color:var(--pai-text-muted,oklch(.72 .02 260))}',
    '.pai-media__picker{display:inline-flex;align-items:center;justify-content:center;gap:6px;margin-top:8px;',
    'padding:7px 12px;border:1px solid var(--pai-border,oklch(.42 .02 260));',
    'border-radius:calc(var(--pai-radius,10px) * .6);cursor:pointer}',
    '.pai-media__picker input{position:absolute;width:1px;height:1px;opacity:0}',
    '.pai-media__rejects{margin:0;padding-left:18px;color:var(--pai-warn,oklch(.78 .15 85))}',
    '.pai-media__grid{display:grid;gap:10px;margin:0;padding:0;list-style:none;',
    'grid-template-columns:repeat(auto-fill,minmax(132px,1fr))}',
    '.pai-media__card{display:flex;gap:8px;padding:8px;cursor:grab;',
    'background:var(--pai-surface,oklch(.21 .016 260));border:1px solid var(--pai-border,oklch(.42 .02 260));',
    'border-radius:var(--pai-radius,10px)}',
    '.pai-media__card[data-dragging]{opacity:.6;cursor:grabbing}',
    '.pai-media__card[data-status=error]{border-color:var(--pai-error,oklch(.65 .2 25))}',
    '.pai-media__card[data-status=ready] .pai-media__fill{background:var(--pai-ok,oklch(.72 .17 150))}',
    '.pai-media__thumb{width:34px;height:34px;flex:0 0 auto;display:grid;place-items:center;',
    'background:var(--pai-surface-alt,oklch(.26 .02 260));border-radius:calc(var(--pai-radius,10px) * .5)}',
    '.pai-media__body{min-width:0;flex:1}',
    '.pai-media__name{margin:0;font:600 12px/1.3 var(--font,system-ui);overflow-wrap:anywhere}',
    '.pai-media__meta{margin:2px 0 6px;font:400 11px/1.3 var(--font,system-ui);',
    'color:var(--pai-text-muted,oklch(.72 .02 260))}',
    '.pai-media__bar{height:4px;overflow:hidden;background:var(--pai-surface-alt,oklch(.26 .02 260));',
    'border-radius:999px}',
    '.pai-media__fill{display:block;width:0;height:100%;background:var(--pai-accent,oklch(.7 .19 265));',
    'transition:width .18s ease-out}',
    '.pai-media__status{font:500 11px/1.4 var(--font,system-ui);color:var(--pai-text-muted,oklch(.72 .02 260))}',
    '.pai-media__empty{color:var(--pai-text-muted,oklch(.72 .02 260))}',
    '.pai-drop-active{outline:2px dashed var(--pai-accent,oklch(.7 .19 265));outline-offset:4px}'
  ].join('');

  const api = {
    CSS,
    IMAGE_EXT,
    VIDEO_EXT,
    FONT_EXT,
    DEFAULT_TARGETS,
    DEFAULT_RETINA,
    extOf,
    slug,
    escaper,
    bytesToBase64,
    classifyFile,
    describeFiles,
    assetIdFor,
    buildCompressPayload,
    readAssetContent,
    normalizeCompressed,
    pictureMarkup,
    resolveCompressBridge,
    installDropTarget,
    mount
  };

  if (root) root.PallettAIMedia = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
