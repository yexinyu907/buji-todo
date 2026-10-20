(() => {
  const $ = id => document.getElementById(id);
  let current, preview, busy = false, refreshing = false;
  const show = (id, visible) => { $(id).hidden = !visible; };
  const text = (tag, value, className) => { const e = document.createElement(tag); e.textContent = value; if (className) e.className = className; return e; };
  function message(value) {
    $('error').textContent = value || ''; show('error', !!value);
    $('merge-feedback').textContent = value || ''; show('merge-feedback', !!value && !!preview);
  }
  async function action(fn) {
    if (busy) return;
    busy = true; message(''); document.querySelectorAll('#reminder-sync button').forEach(b => b.disabled = true);
    try { await fn(); } catch (error) {
      message(error.message);
      if (!document.activeElement?.closest('.duplicate.invalid')) {
        const alert = preview && !$('merge-panel').hidden ? $('merge-feedback') : $('error');
        alert.scrollIntoView({ block: 'nearest' });
      }
    }
    finally { busy = false; document.querySelectorAll('#reminder-sync button').forEach(b => b.disabled = false); await refresh(false); }
  }
  function describe(value) {
    if (!value) return '任务已删除或移出所选清单';
    const date = value.date?.value == null ? '没有截止日期' : new Date(value.date.value).toLocaleString('zh-CN', value.date.hasTime ? {} : { year: 'numeric', month: 'numeric', day: 'numeric' });
    return `${value.text}\n${value.note || '无备注'}\n${date}\n${{ urgent: '紧急', important: '重要', normal: '普通' }[value.priority]} · ${value.done ? '已完成' : '未完成'}`;
  }
  function renderConflicts(conflicts) {
    $('conflicts').replaceChildren(); show('conflict-panel', conflicts.length > 0);
    for (const conflict of conflicts) {
      const box = text('div', '', 'decision'); box.append(text('h3', conflict.text));
      const labels = { fields: '两边同时修改了相同内容', orphan: '上次同步记录未完整保存，请确认要保留的内容', delete: '桌面已删除，但手机又修改了这条任务', deletedRemote: '手机已删除，但桌面有新的修改', moved: '任务已移出所选清单', identifier: '任务关联发生变化，不能可靠自动匹配', missingLocal: '桌面记录缺失，需要选择处理方式' };
      box.append(text('p', labels[conflict.type] || '任务发生冲突'));
      const values = text('div', '', 'values');
      for (const [label, value] of [['桌面内容', conflict.local], ['苹果内容', conflict.remote]]) {
        const column = text('div', ''); column.append(text('strong', label), text('p', describe(value))); values.append(column);
      }
      box.append(values); const actions = text('div', '', 'actions');
      const localLabel = conflict.type === 'delete' ? '仍从两边删除' : ['fields', 'orphan'].includes(conflict.type) && conflict.remote ? '采用桌面内容' : '保留为本地任务';
      const remoteLabel = ['fields', 'orphan'].includes(conflict.type) && conflict.remote ? '采用苹果内容' : conflict.remote ? '保留苹果内容' : '从桌面移除';
      for (const [choice, label] of [['local', localLabel], ['remote', remoteLabel]]) {
        const button = text('button', label); button.onclick = () => action(async () => {
          if ((conflict.type === 'delete' && choice === 'local') && !window.confirm('这会同时删除手机上的对应任务，确定继续吗？')) return;
          await window.api.syncCall('resolve', { id: conflict.id, choice });
        }); actions.append(button);
      }
      box.append(actions); $('conflicts').append(box);
    }
  }
  async function refresh(clearError = true) {
    if (refreshing) return; refreshing = true;
    try {
      current = await window.api.syncCall('status');
      $('cats').checked = current.catReminders;
      $('restore-sync-note').hidden = !current.restorePaused;
      $('authorize').textContent = current.restorePaused ? '重新连接并核对' : '连接提醒事项';
      show('unsupported', !current.supported); show('disconnected', !current.enabled && current.supported);
      show('connected', current.enabled); if (current.enabled) { show('list-picker', false); show('merge-panel', false); }
      const permissionNeeded = current.supported && current.authorization !== 'authorized';
      show('permission-actions', permissionNeeded && (current.enabled || current.errorCode === 'NOT_AUTHORIZED'));
      $('reauthorize').textContent = current.authorization === 'notDetermined' ? '允许访问提醒事项' : '重新检查权限';
      const attention = permissionNeeded && current.enabled || current.error || current.conflicts.length || current.uncertain;
      $('status').textContent = current.busy ? '正在双向同步…' : permissionNeeded && current.enabled ? '等待授权' : attention ? '需要处理' : current.enabled ? '自动同步已开启' : '未连接';
      $('status').dataset.state = attention ? 'attention' : current.enabled ? 'connected' : '';
      $('calendar-name').textContent = current.calendar ? `${current.calendar.title} · ${current.calendar.source}` : '';
      $('last-sync').textContent = current.lastSyncAt ? `上次成功同步 ${new Date(current.lastSyncAt).toLocaleString('zh-CN')}` : '首次同步尚未完成';
      show('last-attempt', !!current.error && !!current.lastAttemptAt);
      $('last-attempt').textContent = current.lastAttemptAt ? `最近尝试 ${new Date(current.lastAttemptAt).toLocaleString('zh-CN')} · 未完成` : '';
      if (permissionNeeded && (current.enabled || current.errorCode === 'NOT_AUTHORIZED')) message(current.authorization === 'notDetermined' ? '尚未允许访问苹果提醒事项。点击下方“允许访问提醒事项”，在弹出的系统窗口中选择“允许”。' : '提醒事项权限未开启。点击“打开权限设置”，在“隐私与安全性 → 提醒事项”中开启不记Todo，然后重新同步。');
      else if (current.errorCode === 'NOT_AUTHORIZED' && current.authorization === 'authorized') message('权限已开启，点击“立即同步”继续。');
      else if (current.error) message(current.error); else if (clearError && !busy) message('');
      renderConflicts(current.conflicts);
      show('uncertain-panel', !!current.uncertain);
      if (current.uncertain) {
        $('uncertain-text').textContent = current.uncertain.fields.text;
        const select = $('uncertain-choice'); select.replaceChildren(new Option('请选择处理方式', ''));
        for (const task of current.uncertain.candidates || []) select.add(new Option(`关联已有任务：${task.text}`, task.id));
        select.add(new Option('已检查，保留为本地任务，不重复新增', 'local-only'));
        select.add(new Option('已确认苹果端没有新增，重新尝试', 'retry-confirmed'));
      }
      $('authorize').disabled = !current.supported;
    } catch (error) { message(error.message); }
    finally { refreshing = false; }
  }
  $('authorize').onclick = () => action(async () => {
    const auth = await window.api.syncCall('authorize');
    if (auth.authorization !== 'authorized') throw new Error('尚未获得授权。你可以在系统设置的“隐私与安全性 → 提醒事项”中允许不记Todo。');
    const lists = (await window.api.syncCall('lists')).filter(list => list.iCloud);
    $('calendar').replaceChildren(new Option('请选择清单', ''));
    for (const list of lists) $('calendar').add(new Option(`${list.title} · ${list.source}`, list.id));
    const recommended = lists.filter(list => list.title === '提醒');
    if (current.calendar && lists.some(l => l.id === current.calendar.id)) $('calendar').value = current.calendar.id;
    else if (recommended.length === 1) $('calendar').value = recommended[0].id;
    show('list-picker', true);
    if (!lists.length) throw new Error('没有找到可写入的 iCloud 清单。请先在 Mac 提醒事项中登录同一苹果账号，并开启 iCloud 同步。');
  });
  $('privacy').onclick = () => action(() => window.api.syncCall('privacy'));
  $('preview').onclick = () => action(async () => {
    if (!$('calendar').value) throw new Error('请先选择你平时使用的清单。');
    preview = await window.api.syncCall('preview', $('calendar').value);
    $('merge-title').textContent = preview.restoring ? '恢复后的同步预览' : '首次合并预览';
    $('merge-count').textContent = `桌面 ${preview.exportCount} 条、苹果 ${preview.importCount} 条待同步；${preview.duplicates.length} 组任务需要确认。`;
    $('merge-tasks').replaceChildren();
    for (const [label, tasks] of [['桌面 → 苹果', preview.localTasks], ['苹果 → 桌面', preview.remoteTasks]]) {
      $('merge-tasks').append(text('strong', label)); for (const task of tasks) $('merge-tasks').append(text('p', task.text));
    }
    $('duplicates').replaceChildren();
    show('merge-toolbar', preview.duplicates.length > 0);
    for (const row of preview.duplicates) {
      const box = text('div', '', 'duplicate'); box.dataset.localId = row.localId;
      box.setAttribute('role', 'group'); box.setAttribute('aria-label', row.text);
      const header = text('div', '', 'duplicate-row');
      const title = text('h3', row.text); title.title = row.text; header.append(title);
      const options = text('div', '', 'duplicate-options');
      for (const [value, label] of [['merge', '合并'], ['separate', '独立']]) {
        const choice = text('label', '', 'duplicate-mode');
        const input = document.createElement('input'); input.type = 'radio'; input.name = `duplicate-${row.localId}`; input.value = value;
        input.setAttribute('aria-label', `${label}：${row.text}`);
        choice.append(input, text('span', label)); options.append(choice);
      }
      const detailButton = text('button', '详情', 'duplicate-detail-button'); detailButton.setAttribute('aria-expanded', 'false');
      header.append(options, detailButton); box.append(header);
      const details = text('div', '', 'duplicate-detail'); details.hidden = true;
      detailButton.onclick = () => { details.hidden = !details.hidden; detailButton.setAttribute('aria-expanded', String(!details.hidden)); };
      if (row.candidates.length > 1) {
        const candidates = text('div', '', 'candidate-picker'); candidates.hidden = true;
        candidates.append(text('p', '苹果里有多条同名任务，请选择要合并的那一条：', 'fine'));
        for (const candidate of row.candidates) {
          const label = text('label', '', 'candidate-choice'), input = document.createElement('input');
          input.type = 'radio'; input.name = `candidate-${row.localId}`; input.value = candidate.id;
          label.append(input, text('span', describe(candidate), 'fine')); candidates.append(label);
        }
        details.append(candidates);
        details.append(text('p', '选择“独立”会保留双方所有任务；选择“合并”只关联你选中的苹果任务。', 'fine'));
      } else details.append(text('p', `苹果当前内容\n${describe(row.candidates[0])}`, 'fine'));
      if (row.fromBackup) {
        const label = text('label', '合并时采用：', 'restore-side-label'), select = document.createElement('select'); select.className = 'restore-side';
        select.add(new Option('苹果当前内容', 'remote')); select.add(new Option('本次恢复的内容（会更新苹果）', 'local'));
        label.append(select); details.prepend(label); box.querySelector('.duplicate-detail-button').textContent = '核对';
      }
      box.append(details);
      const error = text('p', '', 'duplicate-error'); error.hidden = true; error.setAttribute('role', 'alert'); box.append(error);
      box.onchange = () => { updateDuplicateRow(box); message(''); updateMergeProgress(); };
      $('duplicates').append(box);
    }
    updateMergeProgress();
    show('merge-panel', true); $('merge-panel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  $('confirm-merge').onclick = () => action(async () => {
    if (!preview) return;
    const choices = {};
    const used = new Set();
    let firstInvalid;
    for (const box of document.querySelectorAll('.duplicate')) {
      const row = preview.duplicates.find(row => row.localId === box.dataset.localId);
      const selected = box.querySelector('.duplicate-options input:checked')?.value;
      const candidate = row.candidates.length === 1 ? row.candidates[0].id : box.querySelector('.candidate-picker input:checked')?.value;
      if (!selected || (selected === 'merge' && !candidate)) {
        box.classList.add('invalid'); const error = box.querySelector('.duplicate-error');
        error.textContent = !selected ? '请选择“合并为一条”或“保留为独立任务”。' : '请选择要合并的苹果任务。'; error.hidden = false;
        firstInvalid ||= box; continue;
      }
      if (selected === 'merge' && used.has(candidate)) {
        box.classList.add('invalid'); const error = box.querySelector('.duplicate-error');
        error.textContent = '这条苹果任务已被另一条桌面任务选中，请改选或保留独立。'; error.hidden = false;
        firstInvalid ||= box; continue;
      }
      if (selected === 'merge') used.add(candidate);
      choices[row.localId] = selected === 'separate' ? 'separate' : row.fromBackup ? { remoteId: candidate, side: box.querySelector('.restore-side').value } : candidate;
    }
    if (firstInvalid) {
      firstInvalid.querySelector('input').focus({ preventScroll: true }); firstInvalid.scrollIntoView({ block: 'center' });
      throw new Error('还有同名任务未选择处理方式，已标出，请处理后再确认。');
    }
    $('confirm-merge').textContent = '正在合并并双向同步…';
    $('merge-progress').textContent = '正在交换双方任务，请稍候；完成后会显示自动同步状态。';
    document.querySelectorAll('.duplicate input').forEach(input => input.disabled = true);
    try {
      const result = await window.api.syncCall('connect', { token: preview.token, choices });
      if (!result.enabled || !result.lastSyncAt || result.error || result.uncertain) throw new Error(result.error || (result.uncertain ? '上次新增的结果需要确认，请查看下方的处理提示。' : '首次同步尚未完成，请查看同步状态。'));
      preview = null; show('merge-panel', false); $('connected').scrollIntoView({ block: 'center' });
    } finally {
      $('confirm-merge').textContent = '确认合并并开始同步';
      document.querySelectorAll('.duplicate input').forEach(input => input.disabled = false);
    }
  });
  function updateDuplicateRow(box) {
    box.classList.remove('invalid'); box.querySelector('.duplicate-error').hidden = true;
    const picker = box.querySelector('.candidate-picker');
    if (box.querySelector('.restore-side') && box.querySelector('.duplicate-options input:checked')?.value === 'merge') { box.querySelector('.duplicate-detail').hidden = false; box.querySelector('.duplicate-detail-button').setAttribute('aria-expanded', 'true'); }
    if (picker) {
      const merge = box.querySelector('.duplicate-options input:checked')?.value === 'merge';
      picker.hidden = !merge;
      if (merge) { box.querySelector('.duplicate-detail').hidden = false; box.querySelector('.duplicate-detail-button').setAttribute('aria-expanded', 'true'); }
    }
  }
  for (const [id, value] of [['merge-all', 'merge'], ['separate-all', 'separate']]) {
    $(id).onclick = () => {
      for (const box of document.querySelectorAll('.duplicate')) {
        box.querySelector(`.duplicate-options input[value="${value}"]`).checked = true;
        updateDuplicateRow(box);
      }
      message(''); updateMergeProgress();
    };
  }
  function updateMergeProgress() {
    if (!preview) return;
    const rows = [...document.querySelectorAll('.duplicate')];
    const selected = rows.filter(box => {
      const value = box.querySelector('.duplicate-options input:checked')?.value;
      return value === 'separate' || (value === 'merge' && (!box.querySelector('.candidate-picker') || !!box.querySelector('.candidate-picker input:checked')));
    }).length;
    const merged = rows.filter(box => box.querySelector('.duplicate-options input:checked')?.value === 'merge').length;
    const separate = rows.filter(box => box.querySelector('.duplicate-options input:checked')?.value === 'separate').length;
    $('merge-progress').textContent = preview.duplicates.length
      ? `已处理 ${selected} / ${preview.duplicates.length} 组 · 合并 ${merged} 组，独立 ${separate} 组`
      : '没有同名任务，可直接确认。';
  }
  $('cancel-merge').onclick = () => { preview = null; show('merge-panel', false); };
  async function synchronizeNow() {
    const button = $('sync-now'), feedback = $('sync-feedback');
    button.textContent = '正在同步…'; feedback.hidden = false; feedback.classList.remove('error'); feedback.textContent = '正在检查并同步…';
    try {
      let status = await window.api.syncCall('status');
      if (status.authorization !== 'authorized') {
        const auth = await window.api.syncCall('authorize');
        if (auth.authorization !== 'authorized') throw new Error('提醒事项权限未开启，请点击“打开权限设置”后开启不记Todo。');
      }
      const result = await window.api.syncCall('now');
      if (!result.enabled || result.error || !result.lastSyncAt) throw new Error(result.error || '尚未连接，请先连接提醒事项。');
      feedback.hidden = true; feedback.textContent = '';
    } catch (error) { feedback.classList.add('error'); feedback.textContent = '本次同步未完成：' + error.message; throw error; }
    finally { button.textContent = '立即同步'; }
  }
  $('sync-now').onclick = () => action(synchronizeNow);
  $('reauthorize').onclick = () => action(async () => {
    const auth = await window.api.syncCall('authorize');
    if (auth.authorization !== 'authorized') { await window.api.syncCall('privacy'); return; }
    if (current.enabled) await synchronizeNow(); else await refresh();
  });
  $('disconnect').onclick = () => action(async () => {
    if (!window.confirm('断开后两边的任务都会保留，只停止后续同步。确定断开吗？')) return;
    await window.api.syncCall('disconnect');
  });
  $('cats').onchange = () => action(() => window.api.syncCall('cats', $('cats').checked));
  $('resolve-create').onclick = () => action(() => {
    const choice = $('uncertain-choice').value;
    if (choice === 'retry-confirmed' && !window.confirm('请先到提醒事项确认这条任务确实没有新增。若苹果端已存在，重试可能产生重复。确认重新尝试吗？')) return;
    return window.api.syncCall('resolveCreate', choice);
  });
  window.api.onSyncUpdated(() => refresh(false)); window.addEventListener('focus', () => refresh(false));
  refresh();
})();
