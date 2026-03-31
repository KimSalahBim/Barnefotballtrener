// avatar.js — Avatar system for Barnefotballtrener
// Standalone IIFE. Exposes window.Avatar.
(function() {
  'use strict';

  var AVATAR_PATH = '/avatars/';
  var AVATAR_COUNT = 288;
  var PICKER_ID = 'avatarPickerModal';

  // Render an avatar <img> tag or fallback initial
  function renderAvatar(filename, size, name) {
    size = size || 48;
    if (filename) {
      return '<img src="' + AVATAR_PATH + filename + '" ' +
        'alt="" ' +
        'width="' + size + '" height="' + size + '" ' +
        'style="border-radius:50%;display:block;object-fit:cover;" ' +
        'loading="lazy" ' +
        'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">' +
        '<div class="av-fallback" style="display:' + (filename ? 'none' : 'flex') + ';width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:var(--primary,#456C4B);color:#fff;align-items:center;justify-content:center;font-weight:800;font-size:' + Math.round(size * 0.4) + 'px;">' +
        (name ? name.charAt(0).toUpperCase() : '?') + '</div>';
    }
    // No avatar — show initial
    return '<div class="av-fallback" style="display:flex;width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:var(--primary,#456C4B);color:#fff;align-items:center;justify-content:center;font-weight:800;font-size:' + Math.round(size * 0.4) + 'px;">' +
      (name ? name.charAt(0).toUpperCase() : '?') + '</div>';
  }

  // Open avatar picker modal
  // onSelect(filename) is called when user picks an avatar
  function openAvatarPicker(currentAvatar, playerName, onSelect) {
    // Remove existing
    var existing = document.getElementById(PICKER_ID);
    if (existing) existing.remove();

    var modal = document.createElement('div');
    modal.id = PICKER_ID;
    modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.6);display:flex;align-items:flex-end;justify-content:center;';

    var sheet = document.createElement('div');
    sheet.style.cssText = 'background:var(--bg-card,#fff);border-radius:20px 20px 0 0;width:100%;max-width:480px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;';

    // Header
    var header = document.createElement('div');
    header.style.cssText = 'padding:16px 20px;border-bottom:1px solid var(--border,#d8e4da);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;';
    header.innerHTML = '<div style="font-weight:800;font-size:16px;color:var(--text-900,#1a1a1a);">Velg avatar for ' + (playerName || 'spiller') + '</div>' +
      '<button id="avPickerClose" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--text-600,#666);padding:4px 8px;">✕</button>';

    // Preview
    var preview = document.createElement('div');
    preview.style.cssText = 'padding:12px 20px;display:flex;align-items:center;gap:16px;border-bottom:1px solid var(--border,#d8e4da);flex-shrink:0;';
    preview.innerHTML = '<div id="avPickerPreview" style="flex-shrink:0;">' + renderAvatar(currentAvatar, 64, playerName) + '</div>' +
      '<div><div style="font-size:13px;color:var(--text-600,#888);">Nåværende avatar</div>' +
      '<button id="avPickerRemove" style="margin-top:6px;border:1px solid var(--border,#d8e4da);background:var(--bg,#f3f6f3);border-radius:8px;padding:4px 12px;font-size:12px;cursor:pointer;font-weight:600;">Fjern avatar</button></div>';

    // Grid
    var gridWrap = document.createElement('div');
    gridWrap.style.cssText = 'overflow-y:auto;padding:12px 16px;flex:1;';
    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(56px,1fr));gap:6px;';

    for (var i = 1; i <= AVATAR_COUNT; i++) {
      var fname = 'avatar-' + String(i).padStart(3, '0') + '.png';
      var btn = document.createElement('button');
      btn.setAttribute('data-avatar', fname);
      btn.style.cssText = 'border:2px solid ' + (fname === currentAvatar ? 'var(--primary,#456C4B)' : 'transparent') + ';border-radius:12px;padding:3px;cursor:pointer;background:' + (fname === currentAvatar ? 'var(--bg,#eef4ee)' : 'transparent') + ';outline:none;';
      btn.innerHTML = '<img src="' + AVATAR_PATH + fname + '" width="48" height="48" style="border-radius:50%;display:block;" loading="lazy">';
      grid.appendChild(btn);
    }
    gridWrap.appendChild(grid);

    sheet.appendChild(header);
    sheet.appendChild(preview);
    sheet.appendChild(gridWrap);
    modal.appendChild(sheet);
    document.body.appendChild(modal);

    // Events
    function close() { modal.remove(); }
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    document.getElementById('avPickerClose').addEventListener('click', close);
    document.getElementById('avPickerRemove').addEventListener('click', function() {
      onSelect(null);
      close();
    });
    grid.addEventListener('click', function(e) {
      var target = e.target.closest('button[data-avatar]');
      if (!target) return;
      onSelect(target.getAttribute('data-avatar'));
      close();
    });
  }

  window.Avatar = {
    render: renderAvatar,
    openPicker: openAvatarPicker
  };
})();
