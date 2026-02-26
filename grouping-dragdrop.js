// © 2026 Barnefotballtrener.no. All rights reserved.
// grouping-dragdrop.js — shared drag-and-drop for group editing
// Used by: core.js (Gruppeinndeling) + workout.js (Bygg din treningsøkt)
//
// Pattern: modelled after kampdag.js production-tested touch drag.
//   - Document-level move/end listeners (set up ONCE)
//   - State on container element prevents listener stacking
//   - Touch: hold 300ms to activate (scroll-safe for lists)
//   - Mouse: threshold movement to activate (no HTML5 drag API)
//
// Usage:
//   window.GroupDragDrop.enable(container, groups, onChanged, { notify })
//   - container: DOM wrapper element
//   - groups:    Array<Array<PlayerObj>> — mutated on swap/move
//   - onChanged: function(groups) — re-render callback
//   - notify:    function(msg, type) — optional toast

(() => {
  'use strict';

  // ---- Module-level drag state (one active drag at a time) ----
  var drag = null;
  // drag = { container, gi, pi, startX, startY, isDragging, ghostEl, holdTimer }

  var MOVE_THRESHOLD = 8;       // px manhattan distance before mouse drag activates
  var HOLD_MS = 300;            // ms hold-still for touch drag activation
  var HOLD_MOVE_LIMIT = 8;      // px max movement during hold period
  var docListenersReady = false; // one-time flag

  // ---- Retrieve stored context from container ----
  function getCtx(container) {
    return container && container._grpddCtx || null;
  }

  // ---- Find drop target under pointer ----
  function findTarget(container, x, y) {
    var els = document.elementsFromPoint(x, y);
    // Priority 1: player (swap)
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.classList.contains('grpdd-player') && el.dataset.grpddGi != null && container.contains(el)) {
        return { type: 'player', gi: Number(el.dataset.grpddGi), pi: Number(el.dataset.grpddPi), el: el };
      }
    }
    // Priority 2: group card (move)
    for (var j = 0; j < els.length; j++) {
      var el2 = els[j];
      if (el2.classList.contains('grpdd-group') && el2.dataset.grpddGi != null && container.contains(el2)) {
        return { type: 'group', gi: Number(el2.dataset.grpddGi), el: el2 };
      }
    }
    return null;
  }

  // ---- Visual helpers ----
  function clearHighlights(container) {
    container.querySelectorAll('.grpdd-drop-swap').forEach(function (e) { e.classList.remove('grpdd-drop-swap'); });
    container.querySelectorAll('.grpdd-drop-move').forEach(function (e) { e.classList.remove('grpdd-drop-move'); });
    container.querySelectorAll('.grpdd-dragging').forEach(function (e) { e.classList.remove('grpdd-dragging'); });
  }

  function markSourceDragging(container) {
    if (!drag) return;
    var srcEl = container.querySelector('.grpdd-player[data-grpdd-gi="' + drag.gi + '"][data-grpdd-pi="' + drag.pi + '"]');
    if (srcEl) srcEl.classList.add('grpdd-dragging');
  }

  function highlightTarget(target) {
    if (!target || !drag) return;
    if (target.type === 'player' && !(target.gi === drag.gi && target.pi === drag.pi)) {
      target.el.classList.add('grpdd-drop-swap');
    } else if (target.type === 'group' && target.gi !== drag.gi) {
      target.el.classList.add('grpdd-drop-move');
    }
  }

  function removeGhost() {
    if (drag && drag.ghostEl) {
      drag.ghostEl.remove();
      drag.ghostEl = null;
    }
  }

  function createGhost(text, x, y) {
    removeGhost();
    var ghost = document.createElement('div');
    ghost.className = 'grpdd-ghost';
    ghost.textContent = text;
    ghost.style.left = x + 'px';
    ghost.style.top = y + 'px';
    document.body.appendChild(ghost);
    return ghost;
  }

  function moveGhost(x, y) {
    if (drag && drag.ghostEl) {
      drag.ghostEl.style.left = x + 'px';
      drag.ghostEl.style.top = y + 'px';
    }
  }

  // ---- Activate drag (creates ghost, marks source) ----
  function activateDrag(x, y) {
    if (!drag || drag.isDragging) return;
    drag.isDragging = true;

    var ctx = getCtx(drag.container);
    var name = '';
    if (ctx && ctx.groups[drag.gi] && ctx.groups[drag.gi][drag.pi]) {
      name = ctx.groups[drag.gi][drag.pi].name || '';
    }
    drag.ghostEl = createGhost(name, x, y);
    markSourceDragging(drag.container);

    if (navigator.vibrate) navigator.vibrate(30);
  }

  // ---- Perform swap or move ----
  function performAction(x, y) {
    if (!drag || !drag.isDragging) return;
    var ctx = getCtx(drag.container);
    if (!ctx) return;

    var target = findTarget(drag.container, x, y);
    if (!target) return;

    var groups = ctx.groups;
    var srcGi = drag.gi;
    var srcPi = drag.pi;

    if (target.type === 'player') {
      if (srcGi === target.gi && srcPi === target.pi) return;
      var srcPlayer = groups[srcGi][srcPi];
      var tgtPlayer = groups[target.gi][target.pi];
      groups[srcGi][srcPi] = tgtPlayer;
      groups[target.gi][target.pi] = srcPlayer;
      ctx.notify('Byttet ' + srcPlayer.name + ' \u2194 ' + tgtPlayer.name, 'success');
    } else if (target.type === 'group') {
      if (srcGi === target.gi) return;
      // Guard: don't empty a group (BUG 6 fix)
      if (groups[srcGi].length <= 1) {
        ctx.notify('Kan ikke t\u00f8mme en gruppe helt', 'error');
        return;
      }
      var player = groups[srcGi].splice(srcPi, 1)[0];
      groups[target.gi].push(player);
      ctx.notify('Flyttet ' + player.name + ' til Gruppe ' + (target.gi + 1), 'success');
    }

    if (typeof ctx.onChanged === 'function') ctx.onChanged(groups);
  }

  // ---- Cleanup ----
  function cleanupDrag() {
    if (!drag) return;
    if (drag.holdTimer) { clearTimeout(drag.holdTimer); drag.holdTimer = null; }
    removeGhost();
    if (drag.container) clearHighlights(drag.container);
    drag = null;
  }

  // ---- Handle move (shared mouse + touch) ----
  function handleMove(clientX, clientY, isTouch) {
    if (!drag) return false;

    if (!drag.isDragging) {
      var dist = Math.abs(clientX - drag.startX) + Math.abs(clientY - drag.startY);

      if (isTouch) {
        // Touch: if finger moved during hold wait, cancel drag entirely
        if (drag.holdTimer && dist > HOLD_MOVE_LIMIT) {
          clearTimeout(drag.holdTimer);
          drag.holdTimer = null;
          drag = null;
          return false; // allow scroll
        }
        return false; // still waiting for hold timer, don't block scroll
      } else {
        // Mouse: threshold activation
        if (dist < MOVE_THRESHOLD) return false;
        activateDrag(clientX, clientY);
      }
    }

    // Active drag: move ghost, highlight targets
    moveGhost(clientX, clientY);
    clearHighlights(drag.container);
    markSourceDragging(drag.container);
    highlightTarget(findTarget(drag.container, clientX, clientY));
    return true; // caller should preventDefault
  }

  // ---- Handle end (shared mouse + touch) ----
  function handleEnd(clientX, clientY) {
    if (!drag) return;
    try {
      if (drag.isDragging) {
        performAction(clientX, clientY);
      }
    } finally {
      cleanupDrag();
    }
  }

  // ---- Document-level listeners (ONE-TIME setup) ----
  function ensureDocListeners() {
    if (docListenersReady) return;
    docListenersReady = true;

    // Mouse
    document.addEventListener('mousemove', function (e) {
      if (!drag) return;
      if (handleMove(e.clientX, e.clientY, false)) e.preventDefault();
    }, { passive: false });

    document.addEventListener('mouseup', function (e) {
      if (!drag) return;
      handleEnd(e.clientX, e.clientY);
    });

    // Touch
    document.addEventListener('touchmove', function (e) {
      if (!drag) return;
      var t = e.touches[0];
      if (handleMove(t.clientX, t.clientY, true)) e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchend', function (e) {
      if (!drag) return;
      var t = e.changedTouches[0];
      handleEnd(t.clientX, t.clientY);
    });

    document.addEventListener('touchcancel', function () {
      cleanupDrag();
    });

    // Tab-switch / app-switch safety (H5)
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) cleanupDrag();
    });
  }

  // ---- Public API ----
  function enable(container, groups, onChanged, options) {
    if (!container || !groups) return;

    var notify = (options && options.notify) || function () {};

    // Already enabled: update references only (fixes BUG 1 — no new listeners)
    if (container._grpddCtx) {
      container._grpddCtx.groups = groups;
      container._grpddCtx.onChanged = onChanged;
      container._grpddCtx.notify = notify;
      return;
    }

    // First-time enable for this container
    container._grpddCtx = {
      groups: groups,
      onChanged: onChanged,
      notify: notify
    };

    ensureDocListeners();

    // Container: mousedown
    container.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      var playerEl = e.target.closest('.grpdd-player');
      if (!playerEl || playerEl.dataset.grpddGi == null) return;

      e.preventDefault(); // prevent text selection on desktop

      // Clean up any stale drag (e.g. tab-switch without mouseup — H5)
      cleanupDrag();

      drag = {
        container: container,
        gi: Number(playerEl.dataset.grpddGi),
        pi: Number(playerEl.dataset.grpddPi),
        startX: e.clientX,
        startY: e.clientY,
        isDragging: false,
        ghostEl: null,
        holdTimer: null
      };
    });

    // Container: touchstart (passive: true — never blocks scroll — fixes BUG 4)
    container.addEventListener('touchstart', function (e) {
      var playerEl = e.target.closest('.grpdd-player');
      if (!playerEl || playerEl.dataset.grpddGi == null) return;

      var t = e.touches[0];
      var sx = t.clientX;
      var sy = t.clientY;

      // Clean up any stale drag / pending hold timer (H5, H9)
      cleanupDrag();

      drag = {
        container: container,
        gi: Number(playerEl.dataset.grpddGi),
        pi: Number(playerEl.dataset.grpddPi),
        startX: sx,
        startY: sy,
        isDragging: false,
        ghostEl: null,
        holdTimer: null
      };

      // Hold timer: activates drag after 300ms if finger stays still
      drag.holdTimer = setTimeout(function () {
        if (!drag) return;
        drag.holdTimer = null;
        activateDrag(sx, sy);
      }, HOLD_MS);
    }, { passive: true });
  }

  window.GroupDragDrop = window.GroupDragDrop || {};
  window.GroupDragDrop.enable = enable;
})();
