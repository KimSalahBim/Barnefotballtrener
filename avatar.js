// avatar.js — Avatar system for Barnefotballtrener
// Standalone IIFE. Exposes window.Avatar.
(function() {
  'use strict';

  var AVATAR_PATH = '/avatars/';
  var AVATAR_COUNT = 496;
  var PICKER_ID = 'avatarPickerModal';

  // =====================================================
  // METADATA: 496 avatars — visually verified
  // Char 1: J=Jente, G=Gutt
  // Char 2: A=6-10, B=11-15
  // Char 3: L=Lyst, M=Mørkt, R=Rødlig, H=Hodeplagg
  // =====================================================
  var _META = 'JBM,GAM,JBM,GAM,JAM,JAM,JAM,JAM,JBM,GAM,JBM,GAM,JAM,JAM,JAM,JAM,JBM,JBM,JBM,JBM,GBM,GAM,GAM,GAM,JAM,GAM,JAM,GAM,JAL,JAM,JAR,JBM,JBM,GBM,JBM,GAM,JAM,GAR,GAM,JAM,JAL,GAM,JAM,GAM,GAM,GAM,JAM,GAM,JBR,JBM,JBL,JBM,GAM,GAM,GAM,GAM,GAM,GAM,GAM,GAM,JAL,GAM,JBM,GAM,JAM,GAM,JAM,GAM,JAM,JAM,JAM,JAM,JBM,JBL,JBM,JBM,JBM,JBM,JBM,JBM,JBL,GBM,JBM,GBM,GBL,GBL,GAL,GAL,JAM,JAM,JAM,JAM,JBM,GAM,JAM,GAM,JAM,GAM,JAM,GAM,JAL,JAM,JAM,JAR,JAM,JAM,GAM,JBM,GAL,GAM,GAR,GAM,JBM,GAM,JBM,GAM,JBM,JBM,JBM,JBM,JBL,JBM,JBM,JBM,JAR,GAM,JAM,GAM,JBL,GAM,JAM,GBM,GAM,GAM,GAL,GAM,JBM,GBM,GBM,JBM,JBM,GBM,JBM,GBL,GAM,GBL,GBM,GBM,JBL,JBM,JBM,JBM,GAL,JBM,JAM,GAM,JAM,GAM,JAM,GAM,GAL,GAM,GAL,GAR,JAH,JAH,JAH,JAH,JAL,GAM,JAM,GAL,JAL,JAM,JAM,JAR,JAM,GAM,JAR,GAM,GBL,GBM,GAM,GBM,JAM,GAM,JAM,GAM,GAM,GAM,GAM,GBM,JAL,GAM,JAM,GAM,JAL,JAL,JAR,JBL,JBL,JAL,JBL,JAL,JAM,JBM,GBM,GAM,GBL,GBM,GBM,GBM,JAL,GAL,JAM,GAM,JAM,GAM,JAM,GAM,GAL,GBM,GAM,GAM,GAM,GBL,GBM,GBM,JAM,GAM,JAM,GAM,JAM,GAM,JAM,GAM,JBM,GBM,GBM,JBM,GAM,GAM,GAM,GAR,JAM,GAM,JAM,GAL,GAM,GAM,GAM,GAM,GAL,GBM,GBM,GAM,GBR,JBM,GBM,JBL,JBM,GAM,JBM,GAM,JAM,JAM,JAR,JAM,JBH,JBH,JBH,JAH,GAL,GAL,GAR,GAL,JAM,GAM,GAL,JAM,GAL,GAM,GAM,GAR,GBR,GBM,GBM,GBM,JAL,GBM,JAM,GAM,JAL,GAM,JAL,GAL,GAM,JBM,GAM,GAM,GAM,JBM,JBM,JBM,JAL,GAL,GAL,JAL,GAM,JAR,GAM,JAL,JAM,GAM,JAM,GAM,JBM,GBM,GBM,JBM,GAM,JAM,JAM,GAM,GBM,JBM,GAL,JAM,JBM,GBM,JBM,GBM,JBM,GBH,GBH,JBH,GAM,JAM,GAM,JAM,JBM,GBM,GBM,JBM,JBR,GBR,JBR,GBR,JAL,GAL,JAL,GAL,GBM,JBM,JBM,GBL,JBM,GBH,JAH,GBM,JBM,GAM,JAM,GAM,JAM,GAM,JAM,JAM,JAM,GAM,JAM,GAR,JBM,GAL,JAL,GBM,JAL,GAL,JAL,GAL,JAH,GAH,JAH,GAH,JBM,GBL,GBM,JBL,JAL,GAL,JAL,GAL,JAM,GAM,JAM,GBM,JAR,GAR,GAR,GAR,JAM,GAM,JAM,GAM,JBR,GBR,JBR,GBR,JBL,GBM,JBM,GBM,JBM,GAL,GAL,JAL,JBM,GBM,GAM,JBM,JAM,GAM,JAM,GAM,JBR,JBM,JAL,JAM,JBM,GBM,JBM,GBL,JBM,GAM,GAM,JBL,JBM,GAL,JAR,GAR,JAM,GAM,JAM,GAM,JAR,GAL,JAR,GAR,JBM,GBM,JBM,GBM,JAL,GAL,JAL,GAL,JAL,GAL,JAL,GAL,JBM,GAM,JBM,GAM,JBM,GBM,GBR,JBM,JAL,JAM,JAM,JAM,JAL,GAL,JAL,GAL,JAL,GAL,JAL,GAL,JAL,GAL,JAL,GAL,JAR,GAR,JBR,GAR,JAL,GAL,JAL,GAL,JAM,GBM,JAM,GAM'.split(',');

  function getMeta(avatarNum) {
    var code = _META[avatarNum - 1];
    if (!code || code.length !== 3) return null;
    return { gender: code[0], age: code[1], hair: code[2] };
  }

  // =====================================================
  // RENDER AVATAR
  // =====================================================
  function renderAvatar(filename, size, name) {
    size = size || 48;
    if (filename) {
      return '<img src="' + AVATAR_PATH + filename + '" ' +
        'alt="" width="' + size + '" height="' + size + '" ' +
        'style="border-radius:50%;display:block;object-fit:cover;" loading="lazy" ' +
        'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">' +
        '<div class="av-fallback" style="display:none;width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:var(--primary,#456C4B);color:#fff;align-items:center;justify-content:center;font-weight:800;font-size:' + Math.round(size * 0.4) + 'px;">' +
        (name ? name.charAt(0).toUpperCase() : '?') + '</div>';
    }
    return '<div class="av-fallback" style="display:flex;width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:var(--primary,#456C4B);color:#fff;align-items:center;justify-content:center;font-weight:800;font-size:' + Math.round(size * 0.4) + 'px;">' +
      (name ? name.charAt(0).toUpperCase() : '?') + '</div>';
  }

  // =====================================================
  // AVATAR PICKER WITH FILTERS
  // =====================================================
  function openAvatarPicker(currentAvatar, playerName, onSelect) {
    var existing = document.getElementById(PICKER_ID);
    if (existing) existing.remove();

    var filterGender = null;
    var filterAge = null;
    var filterHair = null;

    var modal = document.createElement('div');
    modal.id = PICKER_ID;
    modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.6);display:flex;align-items:flex-end;justify-content:center;';

    var sheet = document.createElement('div');
    sheet.style.cssText = 'background:var(--bg-card,#fff);border-radius:20px 20px 0 0;width:100%;max-width:480px;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;';

    // Header
    var header = document.createElement('div');
    header.style.cssText = 'padding:14px 20px;border-bottom:1px solid var(--border,#d8e4da);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;';
    header.innerHTML = '<div style="font-weight:800;font-size:15px;color:var(--text-900,#1a1a1a);">Velg avatar' + (playerName ? ' for ' + playerName : '') + '</div>' +
      '<button id="avPickerClose" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--text-600,#666);padding:4px 8px;">✕</button>';

    // Preview
    var preview = document.createElement('div');
    preview.style.cssText = 'padding:10px 20px;display:flex;align-items:center;gap:14px;border-bottom:1px solid var(--border,#d8e4da);flex-shrink:0;';
    preview.innerHTML = '<div id="avPickerPreview" style="flex-shrink:0;">' + renderAvatar(currentAvatar, 56, playerName) + '</div>' +
      '<div><div style="font-size:12px;color:var(--text-600,#888);">Nåværende</div>' +
      '<button id="avPickerRemove" style="margin-top:4px;border:1px solid var(--border,#d8e4da);background:var(--bg,#f3f6f3);border-radius:8px;padding:3px 10px;font-size:11px;cursor:pointer;font-weight:600;">Fjern avatar</button></div>';

    // Filter bar
    var filterBar = document.createElement('div');
    filterBar.style.cssText = 'padding:10px 16px;border-bottom:1px solid var(--border,#d8e4da);flex-shrink:0;display:flex;flex-direction:column;gap:6px;';

    var btnBase = 'border:1px solid var(--border,#d8e4da);border-radius:99px;padding:4px 10px;font-size:11px;cursor:pointer;font-weight:600;font-family:inherit;transition:all 0.12s;';
    var btnOff = btnBase + 'background:var(--bg,#f3f6f3);color:var(--text-700,#444);';
    var btnOn = btnBase + 'background:var(--primary,#456C4B);color:#fff;border-color:var(--primary,#456C4B);';

    function makeFilterRow(label, options) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:5px;flex-wrap:wrap;';
      row.innerHTML = '<span style="font-size:11px;font-weight:700;color:var(--text-500,#888);min-width:42px;">' + label + '</span>';
      for (var i = 0; i < options.length; i++) {
        var btn = document.createElement('button');
        btn.setAttribute('data-val', options[i].val);
        btn.textContent = options[i].label;
        btn.style.cssText = options[i].val === '' ? btnOn : btnOff;
        btn.type = 'button';
        row.appendChild(btn);
      }
      return row;
    }

    var genderRow = makeFilterRow('Kjønn', [
      { val: '', label: 'Alle' },
      { val: 'J', label: 'Jenter' },
      { val: 'G', label: 'Gutter' }
    ]);
    var ageRow = makeFilterRow('Alder', [
      { val: '', label: 'Alle' },
      { val: 'A', label: '6-10' },
      { val: 'B', label: '11-15' }
    ]);
    var hairRow = makeFilterRow('Hår', [
      { val: '', label: 'Alle' },
      { val: 'L', label: 'Lyst' },
      { val: 'M', label: 'Mørkt' },
      { val: 'R', label: 'Rødlig' },
      { val: 'H', label: 'Hodeplagg' }
    ]);

    filterBar.appendChild(genderRow);
    filterBar.appendChild(ageRow);
    filterBar.appendChild(hairRow);

    var countBadge = document.createElement('div');
    countBadge.id = 'avFilterCount';
    countBadge.style.cssText = 'padding:4px 16px 0;font-size:11px;color:var(--text-400,#999);flex-shrink:0;';

    var gridWrap = document.createElement('div');
    gridWrap.style.cssText = 'overflow-y:auto;padding:8px 12px 20px;flex:1;';
    var grid = document.createElement('div');
    grid.id = 'avPickerGrid';
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(52px,1fr));gap:5px;';
    gridWrap.appendChild(grid);

    function rebuildGrid() {
      grid.innerHTML = '';
      var count = 0;
      for (var i = 1; i <= AVATAR_COUNT; i++) {
        var m = getMeta(i);
        if (!m) continue;
        if (filterGender && m.gender !== filterGender) continue;
        if (filterAge && m.age !== filterAge) continue;
        if (filterHair && m.hair !== filterHair) continue;
        var fname = 'avatar-' + String(i).padStart(3, '0') + '.png';
        var btn = document.createElement('button');
        btn.setAttribute('data-avatar', fname);
        btn.type = 'button';
        var isSelected = fname === currentAvatar;
        btn.style.cssText = 'border:2px solid ' + (isSelected ? 'var(--primary,#456C4B)' : 'transparent') + ';border-radius:12px;padding:2px;cursor:pointer;background:' + (isSelected ? 'var(--bg,#eef4ee)' : 'transparent') + ';outline:none;';
        btn.innerHTML = '<img src="' + AVATAR_PATH + fname + '" width="44" height="44" style="border-radius:50%;display:block;" loading="lazy">';
        grid.appendChild(btn);
        count++;
      }
      countBadge.textContent = count + ' av ' + AVATAR_COUNT + ' avatarer';
    }

    function updateFilterButtons(row, activeVal) {
      var btns = row.querySelectorAll('button');
      for (var b = 0; b < btns.length; b++) {
        btns[b].style.cssText = btns[b].getAttribute('data-val') === activeVal ? btnOn : btnOff;
      }
    }

    function handleFilterClick(row, setter) {
      row.addEventListener('click', function(e) {
        var btn = e.target.closest('button[data-val]');
        if (!btn) return;
        var val = btn.getAttribute('data-val');
        setter(val || null);
        updateFilterButtons(row, val);
        rebuildGrid();
      });
    }

    handleFilterClick(genderRow, function(v) { filterGender = v; });
    handleFilterClick(ageRow, function(v) { filterAge = v; });
    handleFilterClick(hairRow, function(v) { filterHair = v; });

    sheet.appendChild(header);
    sheet.appendChild(preview);
    sheet.appendChild(filterBar);
    sheet.appendChild(countBadge);
    sheet.appendChild(gridWrap);
    modal.appendChild(sheet);
    document.body.appendChild(modal);

    rebuildGrid();

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
