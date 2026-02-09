// © 2026 Barnefotballtrener.no. All rights reserved.
// debug.js — Sherlock Debug Overlay (staging-only)
// Visible ONLY on *.vercel.app or localhost. No effect on production .no domain.
// Captures console logs and shows a small in-app panel for mobile/Safari troubleshooting.

(function () {
  try {
    const host = String(window.location.hostname || '').toLowerCase();
    const isDebugHost = host === 'localhost' || host.endsWith('.vercel.app');

    if (!isDebugHost) {
      // Ensure callers can reliably check debug mode
      window.__BF_DEBUG_ENABLED = false;
      return;
    }

    window.__BF_DEBUG_ENABLED = true;

    const MAX_LOGS = 250;
    const logs = [];
    window.__BF_DEBUG_LOGS = logs;

    function safeStringify(val) {
      try {
        if (val instanceof Error) return (val.stack || val.message || String(val));
        if (typeof val === 'string') return val;
        return JSON.stringify(val);
      } catch (_) {
        try { return String(val); } catch (_) { return '[unprintable]'; }
      }
    }

    function formatArgs(args) {
      return Array.from(args).map(safeStringify).join(' ');
    }

    // Wrap console
    const orig = {
      log: console.log.bind(console),
      info: console.info ? console.info.bind(console) : console.log.bind(console),
      warn: console.warn ? console.warn.bind(console) : console.log.bind(console),
      error: console.error ? console.error.bind(console) : console.log.bind(console),
      debug: console.debug ? console.debug.bind(console) : console.log.bind(console),
    };

    function push(level, args) {
      const entry = {
        ts: new Date().toISOString(),
        level,
        msg: formatArgs(args),
      };
      logs.push(entry);
      if (logs.length > MAX_LOGS) logs.shift();
      try { renderLine(entry); } catch (_) {}
    }

    console.log = function () { push('log', arguments); return orig.log.apply(null, arguments); };
    console.info = function () { push('info', arguments); return orig.info.apply(null, arguments); };
    console.warn = function () { push('warn', arguments); return orig.warn.apply(null, arguments); };
    console.error = function () { push('error', arguments); return orig.error.apply(null, arguments); };
    console.debug = function () { push('debug', arguments); return orig.debug.apply(null, arguments); };

    // Capture global errors
    window.addEventListener('error', (e) => {
      push('error', [`[window.error]`, e?.message || e]);
    });

    window.addEventListener('unhandledrejection', (e) => {
      push('error', [`[unhandledrejection]`, e?.reason || e]);
    });

    // UI
    const panel = document.createElement('div');
    panel.id = 'bf-debug-panel';
    panel.style.position = 'fixed';
    panel.style.left = '8px';
    panel.style.right = '8px';
    panel.style.bottom = '8px';
    panel.style.zIndex = '999999';
    panel.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
    panel.style.fontSize = '12px';
    panel.style.borderRadius = '12px';
    panel.style.boxShadow = '0 6px 24px rgba(0,0,0,0.25)';
    panel.style.overflow = 'hidden';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.gap = '8px';
    header.style.padding = '8px 10px';
    header.style.background = 'rgba(15, 23, 42, 0.95)';
    header.style.color = '#fff';

    const title = document.createElement('div');
    title.textContent = 'Sherlock Debug (staging)';
    title.style.fontWeight = '700';

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '6px';

    function btn(label) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.padding = '6px 8px';
      b.style.borderRadius = '10px';
      b.style.border = '1px solid rgba(255,255,255,0.25)';
      b.style.background = 'rgba(255,255,255,0.08)';
      b.style.color = '#fff';
      b.style.cursor = 'pointer';
      b.style.userSelect = 'none';
      return b;
    }

    const toggleBtn = btn('Skjul');
    const copyBtn = btn('Kopiér');
    const clearBtn = btn('Tøm');

    actions.appendChild(toggleBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(clearBtn);

    header.appendChild(title);
    header.appendChild(actions);

    const body = document.createElement('div');
    body.style.maxHeight = '42vh';
    body.style.overflow = 'auto';
    body.style.padding = '8px 10px';
    body.style.background = 'rgba(2, 6, 23, 0.92)';
    body.style.color = '#e2e8f0';
    body.style.whiteSpace = 'pre-wrap';
    body.style.wordBreak = 'break-word';

    function colorFor(level) {
      if (level === 'error') return '#fecaca';
      if (level === 'warn') return '#fde68a';
      if (level === 'info') return '#bfdbfe';
      if (level === 'debug') return '#ddd6fe';
      return '#e2e8f0';
    }

    function renderLine(entry) {
      if (!body.isConnected) return;
      const line = document.createElement('div');
      line.style.padding = '2px 0';
      line.style.borderBottom = '1px solid rgba(148,163,184,0.10)';
      line.style.color = colorFor(entry.level);
      line.textContent = `${entry.ts} [${entry.level}] ${entry.msg}`;
      body.appendChild(line);
      // Auto-scroll near bottom
      try {
        const nearBottom = (body.scrollTop + body.clientHeight) >= (body.scrollHeight - 80);
        if (nearBottom) body.scrollTop = body.scrollHeight;
      } catch (_) {}
    }

    function renderAll() {
      body.innerHTML = '';
      for (const entry of logs) renderLine(entry);
    }

    toggleBtn.addEventListener('click', () => {
      const hidden = body.style.display === 'none';
      body.style.display = hidden ? 'block' : 'none';
      toggleBtn.textContent = hidden ? 'Skjul' : 'Vis';
    });

    clearBtn.addEventListener('click', () => {
      logs.splice(0, logs.length);
      renderAll();
    });

    copyBtn.addEventListener('click', async () => {
      const text = logs.map(l => `${l.ts} [${l.level}] ${l.msg}`).join('\n');
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          console.info('✅ Debug-logg kopiert til utklippstavle');
        } else {
          prompt('Kopiér logg:', text);
        }
      } catch (e) {
        prompt('Kopiér logg:', text);
      }
    });

    panel.appendChild(header);
    panel.appendChild(body);

    function mount() {
      try {
        document.body.appendChild(panel);
        renderAll();
        console.info('🕵️ Sherlock Debug Overlay aktivert (staging-host).');
      } catch (_) {}
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount, { once: true });
    } else {
      mount();
    }

  } catch (_) {
    // Never break the app
    window.__BF_DEBUG_ENABLED = false;
  }
})();