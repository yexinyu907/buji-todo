(() => {
  const $ = id => document.getElementById(id);
  let info, restore, busy = false, recording = false, sliderTimer, messageTimer;
  let currentSection = '', sectionRevision = 0, sliderSaving = false, sliderOrigin;
  const sliderDraft = {};
  const context = () => ({ section: currentSection, revision: sectionRevision });
  function message(value, error = false, origin = context()) {
    if (origin.section !== currentSection || origin.revision !== sectionRevision) return;
    clearTimeout(messageTimer);
    $('settings-message').textContent = value || ''; $('settings-message').hidden = !value;
    $('settings-message').classList.toggle('error', error);
    if (value && !error) messageTimer = setTimeout(() => message(''), 3000);
  }
  function section(value) {
    const name = ['general', 'appearance', 'data', 'about'].includes(value) ? value : 'data';
    if (name !== currentSection) { currentSection = name; sectionRevision++; recording = false; message(''); if (info) render(); }
    document.querySelectorAll('[data-settings-page]').forEach(el => { el.hidden = el.dataset.settingsPage !== name; if (!el.hidden) el.prepend($('settings-message')); });
    document.querySelectorAll('[data-section]').forEach(el => el.setAttribute('aria-selected', String(el.dataset.section === name)));
    const origin = context();
    window.scrollTo(0, 0);
  }
  let customColorOpen = false;
  let hsv = { h: 0, s: 0, v: 1 }, lastHex;
  function renderColor(hex) {
    let preset = false;
    for (const button of document.querySelectorAll('[data-color]')) {
      const selected = button.dataset.color === hex; preset ||= selected; button.setAttribute('aria-pressed', String(selected)); button.style.backgroundColor = button.dataset.color;
    }
    $('custom-color').setAttribute('aria-pressed', String(!preset)); $('custom-color').setAttribute('aria-expanded', String(customColorOpen));
    $('custom-color-picker').hidden = !customColorOpen;
    $('custom-color').style.backgroundColor = preset ? '#fff' : hex; $('custom-color').style.color = !preset && window.TodoColor.isDark(hex) ? '#fff' : '#666';
    if (hex !== lastHex) { const next = window.TodoColor.toHSV(hex); if (!next.s) next.h = hsv.h; hsv = next; lastHex = hex; }
    $('color-board').style.setProperty('--hue-color', window.TodoColor.fromHSV(hsv.h, 1, 1));
    $('color-cursor').style.left = hsv.s * 100 + '%'; $('color-cursor').style.top = (1 - hsv.v) * 100 + '%';
    $('color-board').setAttribute('aria-label', '选色画板，饱和度 ' + Math.round(hsv.s * 100) + '%，明度 ' + Math.round(hsv.v * 100) + '%；方向键调整');
    $('color-hue').value = Math.round(hsv.h); $('current-color').style.backgroundColor = hex;
    if (document.activeElement !== $('color-hex')) $('color-hex').value = hex.toUpperCase();
  }
  function changeColor() {
    lastHex = window.TodoColor.fromHSV(hsv.h, hsv.s, hsv.v);
    $('color-hex').value = lastHex.toUpperCase(); $('color-error').hidden = true; $('color-hex').removeAttribute('aria-invalid');
    slide('backgroundColor', lastHex);
  }
  function pointColor(e) {
    const rect = $('color-board').getBoundingClientRect();
    hsv.s = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    hsv.v = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)); changeColor();
  }
  $('color-board').tabIndex = 0;
  $('color-board').onpointerdown = e => { if (e.button !== 0) return; e.preventDefault(); $('color-board').focus(); $('color-board').setPointerCapture(e.pointerId); pointColor(e); };
  $('color-board').onpointermove = e => { if ($('color-board').hasPointerCapture(e.pointerId)) pointColor(e); };
  $('color-board').onpointerup = e => { if ($('color-board').hasPointerCapture(e.pointerId)) { pointColor(e); $('color-board').releasePointerCapture(e.pointerId); flushSliders(); } };
  $('color-board').onpointercancel = flushSliders;
  $('color-board').onkeydown = e => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault(); const step = e.shiftKey ? .1 : .01;
    if (e.key === 'ArrowLeft') hsv.s -= step; if (e.key === 'ArrowRight') hsv.s += step;
    if (e.key === 'ArrowUp') hsv.v += step; if (e.key === 'ArrowDown') hsv.v -= step;
    hsv.s = Math.max(0, Math.min(1, hsv.s)); hsv.v = Math.max(0, Math.min(1, hsv.v)); changeColor();
  };
  $('color-hue').oninput = () => { hsv.h = Number($('color-hue').value); changeColor(); };
  $('color-hue').onchange = flushSliders;
  function acceptHex(final = false) {
    const value = $('color-hex').value, hex = window.TodoColor.normalizeHex(value);
    if (hex && (final || /^#?[a-f0-9]{6}$/i.test(value.trim()))) {
      $('color-error').hidden = true; $('color-hex').removeAttribute('aria-invalid');
      slide('backgroundColor', hex); if (final) { $('color-hex').value = hex.toUpperCase(); flushSliders(); }
    } else if (final) { $('color-error').hidden = false; $('color-hex').setAttribute('aria-invalid', 'true'); }
  }
  $('color-hex').oninput = () => acceptHex(); $('color-hex').onblur = () => acceptHex(true);
  $('color-hex').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); acceptHex(true); } if (e.key === 'Escape') { e.preventDefault(); $('color-hex').value = lastHex.toUpperCase(); $('color-error').hidden = true; $('color-hex').removeAttribute('aria-invalid'); } };
  $('reset-color').onclick = () => { $('color-error').hidden = true; $('color-hex').removeAttribute('aria-invalid'); slide('backgroundColor', '#faf9f6'); flushSliders(); };
  function shortcutLabel(value) {
    return value ? value.split('+').map(key => ({ CommandOrControl: info?.platform === 'darwin' ? '⌘' : 'Ctrl', Command: '⌘', Control: 'Ctrl', Shift: 'Shift', Alt: info?.platform === 'darwin' ? '⌥' : 'Alt', Space: 'Space' }[key] || key)).join(' + ') : '未设置';
  }
  function render() {
    const p = { ...info.preferences, ...sliderDraft };
    $('pref-login').checked = p.openAtLogin; $('pref-login').disabled = !info.loginSupported;
    $('pref-close').value = p.closeBehavior; $('pref-font').value = p.fontScale; $('pref-density').value = p.cardSpacing;
    $('font-value').textContent = p.fontScale + '%'; $('spacing-value').textContent = p.cardSpacing;
    renderColor(p.backgroundColor);
    $('pref-opacity').value = p.opacity; $('opacity-value').textContent = p.opacity + '%';
    const avatar = $('reminder-avatar-preview'), src = info.avatar?.src || 'assets/cats/cat1.png';
    if (avatar.getAttribute('src') !== src) avatar.src = src;
    avatar.classList.toggle('framed', !!info.avatar?.framed); $('avatar-count').textContent = '图库（' + info.avatarCount + '）';
    if (!recording) $('shortcut-value').textContent = shortcutLabel(p.shortcut);
    $('clear-shortcut').disabled = !p.shortcut;
    $('app-version').textContent = info.version;
    $('release-notes').replaceChildren(); for (const note of info.notes) { const li = document.createElement('li'); li.textContent = note; $('release-notes').append(li); }
  }
  async function refresh() { info = await window.api.settingsCall('get'); render(); }
  async function save(patch, origin = context()) {
    try { info = await window.api.settingsCall('save', patch); render(); }
    catch (error) { message(error.message, true, origin); await refresh(); }
  }
  async function flushSliders() {
    clearTimeout(sliderTimer); if (sliderSaving || !Object.keys(sliderDraft).length) return;
    sliderSaving = true; const patch = { ...sliderDraft }, origin = sliderOrigin;
    try { info = await window.api.settingsCall('save', patch); }
    catch (error) { message(error.message, true, origin); }
    finally {
      for (const key of Object.keys(patch)) if (sliderDraft[key] === patch[key]) delete sliderDraft[key];
      sliderSaving = false; render(); if (Object.keys(sliderDraft).length) flushSliders();
    }
  }
  function slide(key, value) {
    sliderOrigin = context(); sliderDraft[key] = value; render(); clearTimeout(sliderTimer); sliderTimer = setTimeout(flushSliders, 60);
  }
  async function action(fn) {
    if (busy) return; const origin = context(); busy = true; message('');
    const buttons = [...document.querySelectorAll('#backup-section button, #app-reminder-section button, #check-update')];
    buttons.forEach(b => b.disabled = true);
    try { await fn(origin); } catch (error) { message(error.message, true, origin); if (origin.revision === sectionRevision) $('settings-message').scrollIntoView({ block: 'nearest' }); }
    finally { busy = false; buttons.forEach(b => b.disabled = false); render(); }
  }
  function preview(value) {
    if (value.canceled) return; restore = value;
    $('restore-summary').textContent = new Date(value.createdAt).toLocaleString('zh-CN') + ' · 未完成 ' + value.incomplete + ' 条，已完成 ' + value.completed + ' 条，图片 ' + value.images + ' 张';
    $('restore-tasks').replaceChildren();
    for (const task of value.tasks) { const p = document.createElement('p'); p.textContent = (task.done ? '✓ ' : '○ ') + task.text; $('restore-tasks').append(p); }
    if (value.total > value.tasks.length) { const p = document.createElement('p'); p.textContent = '仅预览前 ' + value.tasks.length + ' 条，恢复包含全部 ' + value.total + ' 条。'; $('restore-tasks').append(p); }
    $('restore-preview').hidden = false; if (currentSection === 'data') $('restore-preview').scrollIntoView({ block: 'nearest' });
  }
  document.querySelectorAll('[data-section]').forEach(button => { button.onclick = () => section(button.dataset.section); });
  for (const [id, key] of [['pref-login', 'openAtLogin'], ['pref-close', 'closeBehavior']]) {
    $(id).onchange = () => save({ [key]: $(id).type === 'checkbox' ? $(id).checked : $(id).value });
  }
  for (const [id, key] of [['pref-font', 'fontScale'], ['pref-density', 'cardSpacing'], ['pref-opacity', 'opacity']]) {
    $(id).oninput = () => slide(key, Number($(id).value));
    $(id).onchange = flushSliders;
  }
  for (const button of document.querySelectorAll('[data-color]')) button.onclick = () => { customColorOpen = false; slide('backgroundColor', button.dataset.color); flushSliders(); };
  $('custom-color').onclick = () => { customColorOpen = !customColorOpen; render(); };
  $('record-shortcut').onclick = () => { recording = true; $('shortcut-value').textContent = '请按下组合键…'; message('按 Esc 取消录入。'); };
  $('clear-shortcut').onclick = () => { recording = false; save({ shortcut: '' }); };
  document.addEventListener('keydown', e => {
    if (!recording) return; e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { recording = false; render(); message('已取消'); return; }
    const key = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit[0-9]$/.test(e.code) ? e.code.slice(5) : e.code === 'Space' ? 'Space' : /^F(?:[1-9]|1[0-2])$/.test(e.code) ? e.code : '';
    if (!key || !(e.metaKey || e.ctrlKey || e.altKey)) return;
    const modifiers = [];
    if (e.metaKey) modifiers.push('Command'); if (e.ctrlKey) modifiers.push('Control'); if (e.altKey) modifiers.push('Alt'); if (e.shiftKey) modifiers.push('Shift');
    recording = false; save({ shortcut: [...modifiers, key].join('+') });
  }, true);
  $('export-backup').onclick = () => action(async origin => { const result = await window.api.settingsCall('export'); if (!result.canceled) message('已导出：' + result.filename, false, origin); });
  $('import-backup').onclick = () => action(async () => preview(await window.api.settingsCall('importPreview')));
  $('cancel-restore').onclick = () => { restore = null; $('restore-preview').hidden = true; };
  $('confirm-restore').onclick = () => action(async origin => {
    if (!restore) return; $('confirm-restore').textContent = '正在导入…';
    try { const result = await window.api.settingsCall('restore', restore.token); restore = null; $('restore-preview').hidden = true; message('已导入 ' + result.restored + ' 条待办，同步已暂停。', false, origin); }
    finally { $('confirm-restore').textContent = '替换并导入'; }
  });
  function external(action) { const origin = context(); window.api.settingsCall(action).catch(e => message(e.message, true, origin)); }
  let galleryItems = [], gallerySelection = new Set(), galleryBusy = false;
  function galleryButtons() {
    const count = gallerySelection.size;
    $('delete-gallery-items').textContent = count ? '删除（' + count + '）' : '删除';
    $('delete-gallery-items').disabled = !count || count === galleryItems.length;
    $('delete-gallery-items').title = count === galleryItems.length ? '请至少保留一个形象' : '删除选中的形象';
    $('add-default-cats').hidden = galleryItems.filter(e => e.kind === 'builtin').length === 6;
  }
  function renderGallery(items) {
    galleryItems = items; gallerySelection = new Set([...gallerySelection].filter(id => items.some(e => e.id === id)));
    $('gallery-grid').replaceChildren();
    for (const item of items) {
      const tile = document.createElement('div'); tile.className = 'gallery-tile';
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = gallerySelection.has(item.id); check.setAttribute('aria-label', '选择 ' + item.name);
      check.onchange = () => { if (check.checked) gallerySelection.add(item.id); else gallerySelection.delete(item.id); galleryButtons(); };
      const button = document.createElement('button'); button.className = 'gallery-image-button'; button.setAttribute('aria-label', '查看 ' + item.name);
      const image = document.createElement('img'); image.src = item.src; image.alt = item.name; image.classList.toggle('framed', item.framed); button.append(image);
      button.onclick = () => { $('avatar-viewer-image').src = item.src; $('avatar-viewer-image').alt = item.name; $('avatar-viewer').showModal(); };
      const name = document.createElement('span'); name.className = 'gallery-item-name'; name.textContent = item.name; name.title = item.name;
      tile.append(check, button, name); $('gallery-grid').append(tile);
    }
    galleryButtons();
  }
  async function galleryAction(fn) {
    if (galleryBusy) return; galleryBusy = true; $('gallery-error').hidden = true;
    const controls = [...document.querySelectorAll('#avatar-gallery button:not(#close-avatar-gallery), #avatar-gallery input')]; controls.forEach(e => e.disabled = true);
    try { await fn(); await refresh(); }
    catch (error) { $('gallery-error').textContent = error.message; $('gallery-error').hidden = false; }
    finally { galleryBusy = false; controls.forEach(e => e.disabled = false); galleryButtons(); }
  }
  $('open-avatar-gallery').onclick = () => { $('avatar-gallery').showModal(); galleryAction(async () => renderGallery(await window.api.settingsCall('avatarList'))); };
  $('close-avatar-gallery').onclick = () => $('avatar-gallery').close();
  $('close-avatar-viewer').onclick = () => $('avatar-viewer').close();
  for (const id of ['avatar-gallery','avatar-viewer']) $(id).onclick = e => { const r = $(id).getBoundingClientRect(); if (e.target === $(id) && (e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom)) $(id).close(); };
  $('delete-gallery-items').onclick = () => galleryAction(async () => { const items = await window.api.settingsCall('avatarDelete', [...gallerySelection]); gallerySelection.clear(); renderGallery(items); });
  $('add-default-cats').onclick = () => galleryAction(async () => renderGallery(await window.api.settingsCall('avatarDefaults')));
  $('pick-reminder-avatar').onclick = () => galleryAction(async () => {
    const selected = await window.api.settingsCall('avatarPick'); if (selected.canceled) return;
    const prepared = [];
    for (const file of selected.files) {
      const image = new Image(); image.src = file.src;
      try { await image.decode(); } catch { throw new Error('无法读取图片：' + file.name); }
      if (image.naturalWidth<16 || image.naturalHeight<16 || image.naturalWidth>4096 || image.naturalHeight>4096) throw new Error('图片边长需在16到4096像素之间：' + file.name);
      const scale = Math.min(1,256/Math.max(image.naturalWidth,image.naturalHeight)), canvas = document.createElement('canvas');
      canvas.width = Math.max(1,Math.round(image.naturalWidth*scale)); canvas.height = Math.max(1,Math.round(image.naturalHeight*scale));
      canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
      prepared.push({name:file.name,png:canvas.toDataURL('image/png').split(',')[1]});
    }
    renderGallery(await window.api.settingsCall('avatarCommit', prepared));
  });
  $('test-reminder').onclick = () => action(() => window.api.settingsCall('testReminder'));
  $('check-update').onclick = () => action(async () => {
    $('update-result').textContent = '正在检查…';
    try { const result = await window.api.settingsCall('update'); $('update-result').textContent = result.newer ? '发现新版本 ' + result.latest + '，可前往发布页下载。' : result.ahead ? '公开最新版本为 ' + result.latest + '，你正在使用更新的开发版本。' : '当前已是最新公开版本。'; }
    catch (error) { $('update-result').textContent = error.message; }
  });
  $('release-page').onclick = () => external('releasePage');
  $('feedback').onclick = () => external('feedback');
  window.api.onPreferencesUpdated(() => { const origin = context(); refresh().catch(e => message(e.message, true, origin)); });
  window.api.onSettingsSection(section); window.addEventListener('focus', () => { const origin = context(); refresh().catch(e => message(e.message, true, origin)); });
  refresh().then(() => { section(new URLSearchParams(location.search).get('section')); if (info.error) message(info.error, true); }).catch(e => message(e.message, true));
})();
