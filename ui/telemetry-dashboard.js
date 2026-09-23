'use strict';

// ============================================================
// PallettAI Studio — Agent Telemetry & Build Dashboard
// Visualises the DeepSeek multithreaded worker pool in real time:
//   • compile time (sparkline), AST nodes pruned (bar chart),
//     CSS bundle reduction (progress ring), worker CPU/memory (bars)
//   • a live terminal capturing stdout from the CI/deploy runners
//
// Every chart is hand-built SVG — no charting library and no canvas, so the
// dashboard stays zero-dependency and renders identically under test.
// ============================================================

(function (root) {
  const RUNTIME = (typeof require === 'function' && typeof module !== 'undefined')
    ? require('./runtime.js')
    : (root && root.PallettAIDashboardRuntime);

  const DEFAULT_CAPACITY = 60;
  const LOG_CAPACITY = 400;

  const LOG_LEVELS = ['debug', 'info', 'ok', 'warn', 'error'];

  function num(value, fallback) {
    const n = Number(value);
    return isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
  }

  /** Ring buffer with a fixed ceiling so memory stays bounded on long builds. */
  function createRing(capacity) {
    const limit = Math.max(1, Number(capacity) || DEFAULT_CAPACITY);
    let items = [];

    return {
      push(value) {
        items.push(value);
        if (items.length > limit) items = items.slice(items.length - limit);
        return value;
      },
      all: () => items.slice(),
      latest: () => (items.length ? items[items.length - 1] : null),
      clear() { items = []; },
      get capacity() { return limit; },
      get size() { return items.length; }
    };
  }

  /**
   * Normalise the many shapes a build-progress event can take.
   * Unknown fields are dropped rather than guessed at.
   */
  function normaliseBuildEvent(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const out = {
      phase: String(raw.phase || raw.stage || raw.step || 'build'),
      compileMs: num(raw.compileMs !== undefined ? raw.compileMs : (raw.ms !== undefined ? raw.ms : raw.durationMs), null),
      progress: null,
      astNodesPruned: num(raw.astNodesPruned !== undefined ? raw.astNodesPruned : (raw.pruned !== undefined ? raw.pruned : raw.prunedNodes), null),
      cssBytesBefore: num(raw.cssBytesBefore !== undefined ? raw.cssBytesBefore : raw.cssBefore, null),
      cssBytesAfter: num(raw.cssBytesAfter !== undefined ? raw.cssBytesAfter : raw.cssAfter, null),
      message: raw.message || raw.line || raw.log || raw.text || null,
      level: LOG_LEVELS.indexOf(String(raw.level || '').toLowerCase()) !== -1 ? String(raw.level).toLowerCase() : 'info',
      workerId: raw.workerId !== undefined ? String(raw.workerId) : (raw.threadId !== undefined ? String(raw.threadId) : null),
      raw
    };

    // progress may arrive as 0..1 or 0..100.
    const p = raw.progress !== undefined ? raw.progress : raw.percent;
    if (p !== undefined && p !== null) {
      const v = num(p, null);
      if (v !== null) out.progress = v > 1 ? RUNTIME.clamp(v / 100, 0, 1) : RUNTIME.clamp(v, 0, 1);
    }

    // Derive reduction when the backend only sends byte counts.
    if (out.cssBytesBefore !== null && out.cssBytesAfter !== null && out.cssBytesBefore > 0) {
      out.cssReduction = RUNTIME.clamp(1 - out.cssBytesAfter / out.cssBytesBefore, 0, 1);
    } else if (raw.cssReduction !== undefined) {
      const r = num(raw.cssReduction, null);
      out.cssReduction = r === null ? null : (r > 1 ? RUNTIME.clamp(r / 100, 0, 1) : RUNTIME.clamp(r, 0, 1));
    } else {
      out.cssReduction = null;
    }

    return out;
  }

  /** Normalise a worker-metrics event into a list of per-worker readings. */
  function normaliseWorkerEvent(raw) {
    if (!raw || typeof raw !== 'object') return [];

    const list = Array.isArray(raw.workers)
      ? raw.workers
      : (raw.worker && typeof raw.worker === 'object' ? [raw.worker] : [raw]);

    const timestamp = Date.now();

    return list.map((worker, index) => {
      if (!worker || typeof worker !== 'object') return null;

      const id = String(
        worker.id !== undefined ? worker.id
          : worker.threadId !== undefined ? worker.threadId
            : worker.name !== undefined ? worker.name
              : 'worker-' + (index + 1)
      );

      // Accept 0..1 or 0..100 for cpu, and bytes or MB for memory.
      let cpu = num(worker.cpu !== undefined ? worker.cpu : worker.cpuPercent, null);
      if (cpu !== null && cpu <= 1 && cpu > 0) cpu *= 100;

      let memory = num(
        worker.memoryMb !== undefined ? worker.memoryMb
          : worker.memoryMB !== undefined ? worker.memoryMB
            : worker.memory, null
      );
      if (memory !== null && memory > 4096) memory = memory / (1024 * 1024); // bytes -> MB

      return {
        id,
        cpu: cpu === null ? null : RUNTIME.clamp(cpu, 0, 100),
        memory: memory === null ? null : Math.max(0, memory),
        status: String(worker.status || (worker.busy ? 'busy' : 'idle')),
        timestamp
      };
    }).filter(Boolean);
  }

  // ------------------------------------------------------------
  // SVG chart builders (pure: data in, element out)
  // ------------------------------------------------------------

  function emptyChart(host, label) {
    return host.svg('text', {
      x: '12', y: '20', fill: 'var(--pai-text-muted)', 'font-size': '11'
    }, label);
  }

  /**
   * Sparkline for a numeric series. `values` are plotted left-to-right.
   */
  function sparkline(host, values, options) {
    const opts = options || {};
    const width = opts.width || 260;
    const height = opts.height || 64;
    const pad = 4;
    const series = (values || []).map((v) => num(v, 0));

    const svg = host.svg('svg', {
      class: 'pai-chart',
      viewBox: '0 0 ' + width + ' ' + height,
      role: 'img',
      'aria-label': opts.label || 'Compile time trend'
    });

    if (series.length === 0) {
      svg.appendChild(emptyChart(host, 'No build samples yet'));
      return svg;
    }

    const max = Math.max.apply(null, series.concat([opts.min || 0])) || 1;
    const stepX = series.length > 1 ? (width - pad * 2) / (series.length - 1) : 0;

    const points = series.map((value, index) => {
      const x = pad + index * stepX;
      const y = height - pad - (value / max) * (height - pad * 2);
      return { x, y, value };
    });

    // Filled area under the line.
    const areaPath = 'M' + points.map((p) => p.x.toFixed(2) + ' ' + p.y.toFixed(2)).join(' L') +
      ' L' + (pad + (series.length - 1) * stepX).toFixed(2) + ' ' + (height - pad) +
      ' L' + pad + ' ' + (height - pad) + ' Z';

    svg.appendChild(host.svg('path', {
      d: areaPath, fill: 'var(--pai-accent-soft)', stroke: 'none'
    }));

    svg.appendChild(host.svg('polyline', {
      points: points.map((p) => p.x.toFixed(2) + ',' + p.y.toFixed(2)).join(' '),
      fill: 'none',
      stroke: 'var(--pai-accent)',
      'stroke-width': '2',
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round'
    }));

    // Marker on the most recent sample.
    const last = points[points.length - 1];
    svg.appendChild(host.svg('circle', {
      cx: last.x.toFixed(2), cy: last.y.toFixed(2), r: '3', fill: 'var(--pai-accent)'
    }));

    return svg;
  }

  /**
   * Horizontal bar chart for absolute counts (e.g. AST nodes pruned).
   */
  function barChart(host, data, options) {
    const opts = options || {};
    const rowHeight = opts.rowHeight || 22;
    const height = Math.max(rowHeight, (data || []).length * rowHeight + 6);

    const svg = host.svg('svg', {
      class: 'pai-chart',
      viewBox: '0 0 260 ' + height,
      role: 'img',
      'aria-label': opts.label || 'AST nodes pruned'
    });

    if (!data || data.length === 0) {
      svg.appendChild(emptyChart(host, 'No pruning data yet'));
      return svg;
    }

    const max = Math.max.apply(null, data.map((d) => num(d.value, 0))) || 1;
    const labelWidth = 74;
    const trackWidth = 260 - labelWidth - 46;

    data.forEach((item, index) => {
      const y = 3 + index * rowHeight;
      const value = num(item.value, 0);
      const barWidth = Math.max(1, (value / max) * trackWidth);

      svg.appendChild(host.svg('text', {
        x: '0', y: String(y + 13), fill: 'var(--pai-text-muted)', 'font-size': '11'
      }, String(item.label)));

      svg.appendChild(host.svg('rect', {
        x: String(labelWidth), y: String(y + 5),
        width: String(trackWidth), height: '9', rx: '4',
        fill: 'var(--pai-surface-alt)'
      }));

      svg.appendChild(host.svg('rect', {
        x: String(labelWidth), y: String(y + 5),
        width: String(barWidth), height: '9', rx: '4',
        fill: item.color || 'var(--pai-accent)'
      }));

      svg.appendChild(host.svg('text', {
        x: String(labelWidth + trackWidth + 6), y: String(y + 13),
        fill: 'var(--pai-text)', 'font-size': '11'
      }, String(value)));
    });

    return svg;
  }

  /** Donut showing a single 0..1 ratio (e.g. CSS bytes saved). */
  function progressRing(host, ratio, options) {
    const opts = options || {};
    const size = opts.size || 96;
    const stroke = opts.stroke || 10;
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const value = RUNTIME.clamp(num(ratio, 0), 0, 1);
    const dash = circumference * value;
    const center = size / 2;

    const svg = host.svg('svg', {
      class: 'pai-chart',
      viewBox: '0 0 ' + size + ' ' + size,
      role: 'img',
      'aria-label': opts.label || 'CSS bundle reduction',
      style: { maxWidth: size + 'px' }
    });

    svg.appendChild(host.svg('circle', {
      cx: String(center), cy: String(center), r: String(radius),
      fill: 'none', stroke: 'var(--pai-surface-alt)', 'stroke-width': String(stroke)
    }));

    svg.appendChild(host.svg('circle', {
      cx: String(center), cy: String(center), r: String(radius),
      fill: 'none',
      stroke: opts.color || 'var(--pai-ok)',
      'stroke-width': String(stroke),
      'stroke-dasharray': dash.toFixed(2) + ' ' + (circumference - dash).toFixed(2),
      'stroke-linecap': 'round',
      // Rotate so the arc starts at 12 o'clock.
      transform: 'rotate(-90 ' + center + ' ' + center + ')'
    }));

    svg.appendChild(host.svg('text', {
      x: String(center), y: String(center + 5),
      'text-anchor': 'middle',
      fill: 'var(--pai-text)',
      'font-size': '18'
    }, Math.round(value * 100) + '%'));

    return svg;
  }

  /** Vertical grouped bars for per-worker CPU and memory. */
  function workerChart(host, workers, options) {
    const opts = options || {};
    const width = 260;
    const height = opts.height || 110;
    const list = workers || [];

    const svg = host.svg('svg', {
      class: 'pai-chart',
      viewBox: '0 0 ' + width + ' ' + height,
      role: 'img',
      'aria-label': opts.label || 'Worker CPU and memory'
    });

    if (list.length === 0) {
      svg.appendChild(emptyChart(host, 'No worker metrics yet'));
      return svg;
    }

    const groupWidth = width / list.length;
    const barWidth = Math.max(6, Math.min(18, groupWidth / 3));

    list.forEach((worker, index) => {
      const center = groupWidth * index + groupWidth / 2;
      const cpu = RUNTIME.clamp(num(worker.cpu, 0), 0, 100);
      const memory = num(worker.memory, 0);

      // Memory is normalised against the highest reading in this sample so the
      // two metrics share a readable scale.
      const maxMemory = Math.max.apply(null, list.map((w) => num(w.memory, 0)).concat([1]));
      const memoryRatio = memory / maxMemory;

      const cpuHeight = (cpu / 100) * (height - 26);
      const memHeight = memoryRatio * (height - 26);

      svg.appendChild(host.svg('rect', {
        x: (center - barWidth - 2).toFixed(2),
        y: (height - 16 - cpuHeight).toFixed(2),
        width: barWidth.toFixed(2),
        height: Math.max(1, cpuHeight).toFixed(2),
        rx: '3',
        fill: 'var(--pai-accent)'
      }));

      svg.appendChild(host.svg('rect', {
        x: (center + 2).toFixed(2),
        y: (height - 16 - memHeight).toFixed(2),
        width: barWidth.toFixed(2),
        height: Math.max(1, memHeight).toFixed(2),
        rx: '3',
        fill: 'var(--pai-info)'
      }));

      svg.appendChild(host.svg('text', {
        x: center.toFixed(2), y: String(height - 4),
        'text-anchor': 'middle', fill: 'var(--pai-text-muted)', 'font-size': '10'
      }, worker.id));
    });

    return svg;
  }

  /**
   * Create the telemetry dashboard.
   *
   * @param {Object} options
   *   host     - { document, window } override for headless tests
   *   api      - IPC bridge (resolved automatically when omitted)
   *   capacity - number of samples retained per series
   * @returns {Object} dashboard instance
   */
  function createTelemetryDashboard(options) {
    const opts = options || {};
    const host = RUNTIME.createHost(opts.host || {});
    const api = opts.api || RUNTIME.resolveBridge({ host: opts.host });
    const emitter = RUNTIME.createEmitter();

    const compileSeries = createRing(opts.capacity || DEFAULT_CAPACITY);
    const pruneSeries = createRing(opts.capacity || DEFAULT_CAPACITY);
    const logs = createRing(LOG_CAPACITY);

    let workers = [];
    let cssReduction = null;
    let lastPhase = 'idle';
    let mounted = false;
    let received = 0;
    const cleanups = [];
    const refs = { root: null, kpis: {}, charts: {}, log: null, workers: null, phase: null, status: null };

    const unsubscribers = [];

    // ----------------------------------------------------------
    // Event ingestion
    // ----------------------------------------------------------

    /** Handle an `onBuildProgress` payload. Returns the normalised event. */
    function handleBuildProgress(raw) {
      const event = normaliseBuildEvent(raw);
      if (!event) return null;

      received++;
      lastPhase = event.phase;

      if (event.compileMs !== null) compileSeries.push({ value: event.compileMs, phase: event.phase });
      if (event.astNodesPruned !== null) {
        // The backend reports a running total, so the per-phase work is the
        // difference from the previous reading. Charting the raw cumulative
        // value would draw a staircase that hides which phase did the pruning.
        const previous = pruneSeries.latest();
        const delta = previous
          ? Math.max(0, event.astNodesPruned - previous.value)
          : event.astNodesPruned;
        pruneSeries.push({ phase: event.phase, value: event.astNodesPruned, delta });
      }
      if (event.cssReduction !== null) cssReduction = event.cssReduction;

      if (event.message) appendLog(event.message, event.level);

      renderKpis();
      renderCharts();
      emitter.emit('build:progress', event);
      return event;
    }

    /** Handle an `onWorkerMetrics` payload. Returns the normalised list. */
    function handleWorkerMetrics(raw) {
      const next = normaliseWorkerEvent(raw);
      if (next.length === 0) return [];

      received++;
      // Merge by id so a partial update only refreshes the named worker.
      const byId = new Map(workers.map((w) => [w.id, w]));
      next.forEach((worker) => byId.set(worker.id, worker));
      workers = Array.from(byId.values());

      renderWorkers();
      renderKpis();
      emitter.emit('worker:metrics', workers);
      return workers;
    }

    /** Append a line to the terminal buffer. */
    function appendLog(text, level) {
      const entry = {
        text: String(text === null || text === undefined ? '' : text),
        level: LOG_LEVELS.indexOf(String(level || '').toLowerCase()) !== -1 ? String(level).toLowerCase() : 'info',
        at: new Date()
      };
      logs.push(entry);
      renderLog(entry);
      emitter.emit('log', entry);
      return entry;
    }

    function clearLog() {
      logs.clear();
      if (refs.log) RUNTIME.clear(refs.log);
      return true;
    }

    function clearAll() {
      compileSeries.clear();
      pruneSeries.clear();
      workers = [];
      cssReduction = null;
      received = 0;
      clearLog();
      renderKpis();
      renderCharts();
      renderWorkers();
      return true;
    }

    function subscribe() {
      try {
        if (typeof api.onBuildProgress === 'function') {
          unsubscribers.push(api.onBuildProgress(handleBuildProgress));
        }
        if (typeof api.onWorkerMetrics === 'function') {
          unsubscribers.push(api.onWorkerMetrics(handleWorkerMetrics));
        }
      } catch (err) {
        appendLog('Failed to subscribe to telemetry channels: ' + (err && err.message ? err.message : err), 'error');
      }
      return unsubscribers.length;
    }

    // ----------------------------------------------------------
    // Rendering
    // ----------------------------------------------------------

    function kpi(label, key, initial) {
      const cell = host.el('div', { class: 'pai-kpi', 'data-kpi': key });
      const value = host.el('div', { class: 'v', 'data-kpi-value': key, textContent: initial });
      cell.appendChild(value);
      cell.appendChild(host.el('div', { class: 'k', textContent: label }));
      refs.kpis[key] = value;
      return cell;
    }

    function formatMs(value) {
      if (value === null || value === undefined) return '\u2014';
      return Math.round(value) + ' ms';
    }

    function renderKpis() {
      const lastCompile = compileSeries.latest();
      const lastPrune = pruneSeries.latest();
      const phases = new Set(pruneSeries.all().map((entry) => entry.phase));

      if (refs.kpis.compile) refs.kpis.compile.textContent = formatMs(lastCompile ? lastCompile.value : null);
      if (refs.kpis.pruned) refs.kpis.pruned.textContent = lastPrune ? String(lastPrune.value) : '0';
      if (refs.kpis.phases) refs.kpis.phases.textContent = String(phases.size);
      if (refs.kpis.css) refs.kpis.css.textContent = cssReduction === null ? '\u2014' : Math.round(cssReduction * 100) + '%';
      if (refs.kpis.workers) refs.kpis.workers.textContent = String(workers.length);
      if (refs.kpis.events) refs.kpis.events.textContent = String(received);
      if (refs.phase) refs.phase.textContent = 'Phase: ' + lastPhase;
    }

    function renderCharts() {
      if (refs.charts.compile) {
        RUNTIME.clear(refs.charts.compile);
        refs.charts.compile.appendChild(sparkline(host, compileSeries.all().map((e) => e.value), {
          label: 'Compilation time trend'
        }));
      }

      if (refs.charts.pruned) {
        RUNTIME.clear(refs.charts.pruned);
        // One bar per build phase, newest reading wins, showing that phase's
        // own share of the pruning rather than the running total.
        const byPhase = new Map();
        pruneSeries.all().forEach((entry) => byPhase.set(entry.phase, entry.delta));
        const data = Array.from(byPhase.entries()).map(([label, value]) => ({ label, value }));
        refs.charts.pruned.appendChild(barChart(host, data, { label: 'AST nodes pruned' }));
      }

      if (refs.charts.css) {
        RUNTIME.clear(refs.charts.css);
        refs.charts.css.appendChild(progressRing(host, cssReduction === null ? 0 : cssReduction, {
          label: 'CSS bundle reduction'
        }));
      }
    }

    function renderWorkers() {
      if (!refs.workers) return;
      RUNTIME.clear(refs.workers);
      refs.workers.appendChild(workerChart(host, workers, { label: 'Worker CPU and memory' }));

      const list = host.el('div', { class: 'pai-grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' } });
      workers.forEach((worker) => {
        const card = host.el('div', { class: 'pai-kpi', 'data-worker': worker.id });
        card.appendChild(host.el('div', { class: 'v', textContent: worker.cpu === null ? '\u2014' : Math.round(worker.cpu) + '%' }));
        card.appendChild(host.el('div', {
          class: 'k',
          textContent: worker.id + ' \u00B7 ' + (worker.memory === null ? '\u2014' : Math.round(worker.memory) + 'MB') + ' \u00B7 ' + worker.status
        }));
        list.appendChild(card);
      });
      refs.workers.appendChild(list);
    }

    function renderLog(entry) {
      if (!refs.log || !entry) return;

      const row = host.el('div', {
        class: 'pai-log-row',
        'data-level': entry.level,
        textContent: entry.text
      });
      refs.log.appendChild(row);

      // Trim rendered rows in step with the buffer ceiling.
      while (refs.log.childNodes && refs.log.childNodes.length > LOG_CAPACITY) {
        refs.log.removeChild(refs.log.firstChild);
      }

      if (typeof refs.log.scrollTop === 'number' && typeof refs.log.scrollHeight === 'number') {
        refs.log.scrollTop = refs.log.scrollHeight;
      }
    }

    function renderAllLogs() {
      if (!refs.log) return;
      RUNTIME.clear(refs.log);
      logs.all().forEach((entry) => {
        refs.log.appendChild(host.el('div', {
          class: 'pai-log-row', 'data-level': entry.level, textContent: entry.text
        }));
      });
    }

    // ----------------------------------------------------------
    // Mount
    // ----------------------------------------------------------

    function mount(container) {
      const target = container || host.document.body;
      if (!target) throw new Error('TelemetryDashboard.mount: no container element.');

      const layout = host.el('div', { 'data-role': 'telemetry-dashboard' });

      // KPIs
      const kpiCard = host.el('div', { class: 'pai-card' });
      kpiCard.appendChild(host.el('h3', { textContent: 'Build telemetry' }));
      const kpiGrid = host.el('div', {
        class: 'pai-grid',
        style: { gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }
      });
      kpiGrid.appendChild(kpi('Last compile', 'compile', '\u2014'));
      kpiGrid.appendChild(kpi('Nodes pruned', 'pruned', '0'));
      kpiGrid.appendChild(kpi('Phases', 'phases', '0'));
      kpiGrid.appendChild(kpi('CSS reduced', 'css', '\u2014'));
      kpiGrid.appendChild(kpi('Workers', 'workers', '0'));
      kpiGrid.appendChild(kpi('Events', 'events', '0'));
      kpiCard.appendChild(kpiGrid);

      refs.phase = host.el('p', { class: 'pai-status', 'data-role': 'phase', textContent: 'Phase: idle' });
      kpiCard.appendChild(refs.phase);
      layout.appendChild(kpiCard);

      // Charts
      const chartsCard = host.el('div', { class: 'pai-card' });
      chartsCard.appendChild(host.el('h3', { textContent: 'Compiler throughput' }));

      refs.charts.compile = host.el('div', { 'data-chart': 'compile-time' });
      refs.charts.pruned = host.el('div', { 'data-chart': 'ast-pruned' });
      refs.charts.css = host.el('div', { 'data-chart': 'css-reduction' });

      chartsCard.appendChild(refs.charts.compile);
      chartsCard.appendChild(host.el('h3', { textContent: 'Tree-shaker' }));
      chartsCard.appendChild(refs.charts.pruned);

      const cssRow = host.el('div', { class: 'pai-grid', style: { gridTemplateColumns: '140px 1fr', alignItems: 'center' } });
      cssRow.appendChild(refs.charts.css);
      refs.status = host.el('p', { class: 'pai-status', 'data-role': 'telemetry-status', textContent: 'Awaiting build events\u2026' });
      cssRow.appendChild(refs.status);
      chartsCard.appendChild(cssRow);
      layout.appendChild(chartsCard);

      // Workers
      const workerCard = host.el('div', { class: 'pai-card' });
      workerCard.appendChild(host.el('h3', { textContent: 'Worker pool' }));
      refs.workers = host.el('div', { 'data-role': 'workers' });
      workerCard.appendChild(refs.workers);
      layout.appendChild(workerCard);

      // Terminal
      const logCard = host.el('div', { class: 'pai-card' });
      logCard.appendChild(host.el('h3', { textContent: 'Build output' }));
      refs.log = host.el('div', {
        class: 'pai-log',
        'data-role': 'build-log',
        role: 'log',
        'aria-live': 'polite',
        tabindex: '0'
      });
      logCard.appendChild(refs.log);

      const logActions = host.el('div', { class: 'pai-field' });
      logActions.appendChild(host.el('button', {
        type: 'button', class: 'pai-btn', 'data-action': 'clear-log',
        textContent: 'Clear log', onClick: () => clearLog()
      }));
      logActions.appendChild(host.el('button', {
        type: 'button', class: 'pai-btn', 'data-action': 'clear-metrics',
        textContent: 'Reset metrics', onClick: () => clearAll()
      }));
      logCard.appendChild(logActions);
      layout.appendChild(logCard);

      target.appendChild(layout);
      refs.root = target;

      renderKpis();
      renderCharts();
      renderWorkers();
      renderAllLogs();

      subscribe();
      mounted = true;
      emitter.emit('mount', { subscriptions: unsubscribers.length });
      return layout;
    }

    function destroy() {
      while (unsubscribers.length) {
        const off = unsubscribers.pop();
        if (typeof off === 'function') {
          try { off(); } catch (_) { /* ignore */ }
        }
      }
      while (cleanups.length) {
        const fn = cleanups.pop();
        try { fn(); } catch (_) { /* ignore */ }
      }
      if (refs.root && refs.root.parentNode) refs.root.parentNode.removeChild(refs.root);
      mounted = false;
      emitter.removeAll();
    }

    const dashboard = {
      mount, destroy,
      // ingestion (public so tests and non-IPC transports can drive it)
      handleBuildProgress, handleWorkerMetrics, appendLog,
      clearLog, clearAll,
      // read models
      getCompileSeries: () => compileSeries.all(),
      getPruneSeries: () => pruneSeries.all(),
      getLogs: () => logs.all(),
      getWorkers: () => workers.slice(),
      getCssReduction: () => cssReduction,
      getEventCount: () => received,
      getPhase: () => lastPhase,
      // refs
      getElement: () => refs.root,
      getLogElement: () => refs.log,
      isMounted: () => mounted,
      on: emitter.on, off: emitter.off, emit: emitter.emit,
      _internals: { refs, getRefs: () => refs, normaliseBuildEvent, normaliseWorkerEvent }
    };

    return dashboard;
  }

  const telemetry = {
    createTelemetryDashboard,
    // chart primitives + normalisers exported for direct testing
    sparkline, barChart, progressRing, workerChart,
    normaliseBuildEvent, normaliseWorkerEvent,
    createRing, LOG_LEVELS, LOG_CAPACITY
  };

  if (root) root.PallettAITelemetryDashboard = telemetry;
  if (typeof module !== 'undefined' && module.exports) module.exports = telemetry;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
