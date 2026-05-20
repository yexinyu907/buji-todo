// 不记Todo v0.7 - app.js
(function() {
  'use strict';

  // ===================== Constants =====================
  const COLLAPSED_WIN_H = 240; // 折叠模式窗口高度（含菜单透明区域）

  // ===================== State =====================
  let todos = [];
  let tagGroupOrder = []; // 分类模式下的组间排序：元素为 tag 字符串或 todo id（无标签）
  let tagCollapsed = {}; // 分类模式下各标签的折叠状态 { tagName: true/false }
  let isPinned = true;
  let doneExpanded = false;
  let sortMode = 'default'; // 'default' | 'pri-asc' | 'pri-desc' | 'ddl-asc' | 'ddl-desc' | 'tag'
  let viewMode = 'list'; // 'list' | 'calendar'
  let cvMonth = new Date(); // calendar view current month
  let cvSelectedDate = null; // selected date string 'YYYY-M-D'

  // 添加面板状态
  let panelOpen = false;
  let curPri = 'normal';
  let curDdlDate = null;
  let curDdlH = null;
  let curDdlM = null;
  let curNote = '';
  let curRepeat = null;
  let curTag = ''; // 当前添加面板选择的标签
  let curImages = []; // [{filename, path}] - 主内容图片
  let curNoteImages = []; // [{filename, path}] - 备注图片
  let calMonth = new Date();

  // 记住用户窗口高度（不自动撑大）
  let userWindowHeight = null;

  // 时间滚轮选择器（需要在 bindEvents 和 resetPanelState 之间共享）
  let twContainer = null;
  let addWheelPicker = null;

  // DOM
  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  const elGreeting = $('#greeting');
  const elStat = $('#header-stat');
  const elBtnAdd = $('#btn-add');
  const elPanel = $('#add-panel');
  const elInput = $('#todo-input');
  const elListArea = $('#list-area');
  const elEmpty = $('#empty-state');
  const elDoneSection = $('#done-section');
  const elDoneCount = $('#done-count');
  const elDoneList = $('#done-list');
  const elDoneToggle = $('#done-toggle');
  const elDoneArrow = $('#done-arrow');
  const elEditOverlay = $('#edit-overlay');
  const elEditPopup = $('#edit-popup');

  // ===================== Time Wheel Picker =====================
  // 创建 iOS 风格双列滚轮时间选择器
  // 时间选择器：紧凑文本框 + 浮动弹出滚轮
  function createTimeWheelPicker(container, initH, initM, onChange) {
    const ITEM_H = 28;
    const VISIBLE = 5;
    const CENTER = Math.floor(VISIBLE / 2);

    let curH = initH, curM = initM;
    let opened = false;
    let hasValue = false;

    // 文本框行
    const row = document.createElement('div');
    row.className = 'tw-row';
    row.innerHTML = `
      <span class="tw-label">时间</span>
      <span class="tw-field" tabindex="0">
        <span class="tw-val tw-hh">--</span><span class="tw-colon">:</span><span class="tw-val tw-mm">--</span>
      </span>
    `;
    container.appendChild(row);

    const field = row.querySelector('.tw-field');
    const hhEl = row.querySelector('.tw-hh');
    const mmEl = row.querySelector('.tw-mm');

    function updateDisplay() {
      if (hasValue) {
        hhEl.textContent = String(curH).padStart(2, '0');
        mmEl.textContent = String(curM).padStart(2, '0');
        field.classList.add('has-value');
      } else {
        hhEl.textContent = '--';
        mmEl.textContent = '--';
        field.classList.remove('has-value');
      }
    }

    // 浮动弹出层
    const popup = document.createElement('div');
    popup.className = 'tw-popup';
    popup.innerHTML = '<div class="tw-wheel"></div>';
    document.body.appendChild(popup);
    const wheelEl = popup.querySelector('.tw-wheel');

    function createColumn(max, initVal) {
      const col = document.createElement('div');
      col.className = 'tw-col';

      const highlight = document.createElement('div');
      highlight.className = 'tw-col-hl';
      col.appendChild(highlight);

      const list = document.createElement('div');
      list.className = 'tw-col-list';
      col.appendChild(list);

      const items = [];
      for (let i = 0; i <= max; i++) {
        const item = document.createElement('div');
        item.className = 'tw-col-item';
        item.textContent = String(i).padStart(2, '0');
        list.appendChild(item);
        items.push(item);
      }

      let val = initVal;
      const total = max + 1;

      function position(anim) {
        const offset = CENTER * ITEM_H - val * ITEM_H;
        list.style.transition = anim ? 'transform .15s cubic-bezier(.2,.8,.4,1)' : 'none';
        list.style.transform = `translateY(${offset}px)`;
        items.forEach((it, i) => {
          it.classList.remove('sel', 'near');
          const d = Math.abs(i - val);
          if (d === 0) it.classList.add('sel');
          else if (d === 1) it.classList.add('near');
        });
      }

      function setVal(v, anim = true) {
        val = ((v % total) + total) % total;
        position(anim);
      }
      function getVal() { return val; }

      // 滚轮
      col.addEventListener('wheel', (e) => {
        e.preventDefault();
        setVal(val + (e.deltaY > 0 ? 1 : -1));
        sync();
      }, { passive: false });

      // 拖拽
      let dragging = false, startY = 0, startVal = 0;
      col.addEventListener('mousedown', (e) => {
        dragging = true; startY = e.clientY; startVal = val;
        list.style.transition = 'none'; e.preventDefault();
      });
      document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const dv = Math.round((startY - e.clientY) / ITEM_H);
        const nv = ((startVal + dv) % total + total) % total;
        if (nv !== val) { val = nv; position(false); }
      });
      document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false; position(true); sync();
      });

      // 点击选中
      items.forEach((it, i) => {
        it.addEventListener('click', (e) => { e.stopPropagation(); setVal(i); sync(); });
      });

      position(false);
      return { el: col, setVal, getVal };
    }

    let hourCol, minCol;

    function buildWheel() {
      wheelEl.innerHTML = '';
      hourCol = createColumn(23, curH);
      const sep = document.createElement('span');
      sep.className = 'tw-sep';
      sep.textContent = ':';
      minCol = createColumn(59, curM);
      wheelEl.appendChild(hourCol.el);
      wheelEl.appendChild(sep);
      wheelEl.appendChild(minCol.el);
    }

    function sync() {
      curH = hourCol.getVal();
      curM = minCol.getVal();
      hasValue = true;
      updateDisplay();
      if (onChange) onChange(curH, curM);
    }

    function positionPopup() {
      const rect = field.getBoundingClientRect();
      popup.style.left = rect.left + 'px';
      popup.style.top = (rect.bottom + 4) + 'px';
    }

    function open() {
      if (opened) return;
      opened = true;
      if (!hasValue) { curH = new Date().getHours(); curM = new Date().getMinutes(); }
      buildWheel();
      positionPopup();
      popup.classList.add('show');
      field.classList.add('active');
    }

    function close() {
      if (!opened) return;
      opened = false;
      popup.classList.remove('show');
      field.classList.remove('active');
    }

    // 事件
    field.addEventListener('click', (e) => { e.stopPropagation(); opened ? close() : open(); });
    popup.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => { if (opened) close(); });

    function destroy() {
      popup.remove();
      document.removeEventListener('click', close);
    }

    return {
      el: row,
      getHour: () => curH,
      getMinute: () => curM,
      hasValue: () => hasValue,
      setTime: (h, m) => { curH = h; curM = m; hasValue = true; updateDisplay(); if (hourCol) { hourCol.setVal(h); minCol.setVal(m); } },
      open, close, destroy,
    };
  }

  // ===================== Init =====================
  async function init() {
    const data = await window.api.loadData();
    todos = data.todos || [];
    tagGroupOrder = data.tagGroupOrder || [];

    // 一次性数据迁移：合并旧版重复创建的循环待办
    migrateRepeatTodos();

    setGreeting();
    bindEvents();
    render();
    setInterval(setGreeting, 60000);

    // 对有占位标题或无标题的链接重新获取真实标题
    refreshStaleTitles();

    // 监听主进程数据更新（来自猫咪提醒操作按钮）
    if (window.api.onTodosUpdated) {
      window.api.onTodosUpdated(async () => {
        const freshData = await window.api.loadData();
        todos = freshData.todos || [];
        tagGroupOrder = freshData.tagGroupOrder || [];
        render();
        if (viewMode === 'calendar') renderCalView();
      });
    }
  }

  // 迁移旧版循环待办数据：将同文本同循环类型的多条合并为一条 + completedDates
  function migrateRepeatTodos() {
    // 按 text + repeat 分组，只处理有 repeat 的
    const groups = {};
    todos.forEach(t => {
      if (!t.repeat || !t.ddl) return;
      const key = `${t.text}|||${t.repeat}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });

    let changed = false;
    for (const key of Object.keys(groups)) {
      const group = groups[key];
      if (group.length <= 1) continue; // 没有重复，跳过

      // 找到"保留项"：优先取最早创建的未完成项；若全部完成则取最早DDL的
      const undone = group.filter(t => !t.done);
      const keeper = undone.length > 0
        ? undone.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0]
        : group.sort((a, b) => (a.ddl || 0) - (b.ddl || 0))[0];

      // 收集所有已完成项的日期
      const completedDates = [];
      const toRemoveIds = new Set();
      group.forEach(t => {
        if (t.id === keeper.id) return;
        if (t.done && t.ddl) {
          const dk = ds(new Date(t.ddl));
          if (!completedDates.includes(dk)) completedDates.push(dk);
        }
        toRemoveIds.add(t.id);
      });

      // 更新保留项
      keeper.done = false;
      keeper.completedDates = completedDates;
      // 清除旧的 _lastCreatedNextId 字段
      delete keeper._lastCreatedNextId;

      // 移除多余项
      todos = todos.filter(t => !toRemoveIds.has(t.id));
      changed = true;
    }

    // 额外处理：单条循环待办如果 done=true（旧版遗留），转为 completedDates 机制
    todos.forEach(t => {
      if (t.repeat && t.ddl && t.done) {
        t.done = false;
        if (!t.completedDates) t.completedDates = [];
        const dk = ds(new Date(t.ddl));
        if (!t.completedDates.includes(dk)) t.completedDates.push(dk);
        changed = true;
      }
    });

    if (changed) {
      // 同步清除所有 todo 的 _lastCreatedNextId 残留
      todos.forEach(t => { delete t._lastCreatedNextId; });
      window.api.saveData({ todos });
    }
  }

  // 刷新所有含占位标题的链接
  async function refreshStaleTitles() {
    for (const todo of todos) {
      if (!todo.links || todo.links.length === 0) continue;
      const needsFetch = todo.links.some(l =>
        !l.title || l.title.startsWith('学城文档 #')
      );
      if (needsFetch) {
        // 清除占位标题，强制重新获取
        for (const link of todo.links) {
          if (link.title && link.title.startsWith('学城文档 #')) {
            link.title = null;
          }
        }
        await fetchTitlesForTodo(todo.id);
      }
    }
  }

  // ===================== Greeting =====================
  const GREETINGS = {
    // 凌晨 0-6
    night: {
      few: ['夜深了，早点休息', '星星都困了，你呢', '熬夜一时爽…明早火葬场', '月亮已读不回了'],
      some: ['深夜战士，注意身体', '凌晨还有任务？佩服佩服', '这个时间还在肝…尊重'],
      many: ['别肝了，任务又不会跑', '明天再说吧，来日方长', '这么多任务…先睡一觉再想']
    },
    // 早晨 6-9
    morning: {
      few: ['早安，今天很轻松', '新的一天，元气满满', '早起的鸟儿有虫吃', '清晨的空气都是甜的'],
      some: ['早安，今天安排刚刚好', '状态拉满，开始营业', '一日之计在于晨'],
      many: ['早起就被安排了…', '今天任务有点多，冲！', '深吸一口气，开干']
    },
    // 上午 9-12
    amWork: {
      few: ['轻松的上午，享受节奏', '没什么事？摸鱼合法化', '上午真好，不卷不累', '效率拉满，早收工'],
      some: ['专注模式 ON', '一件一件来，不急', '你已经很棒了', '节奏感很重要'],
      many: ['上午火力全开！', '任务虽多，你更强', '逐个击破，稳住', '忙碌使人充实（吧？）']
    },
    // 中午 12-14
    noon: {
      few: ['午安，记得吃饭', '饭后走走消消食', '中场休息一下', '小憩15分钟，事半功倍'],
      some: ['先吃饭，任务不急', '干饭人干饭魂', '午休是第二次起跑线'],
      many: ['先吃饭！任务又跑不了', '别边吃边想工作啦', '饭是一定要恰的']
    },
    // 下午 14-18
    pmWork: {
      few: ['下午轻松愉快～', '今天效率好高', '提前收工不是梦', '摸鱼快乐指数 MAX'],
      some: ['下午继续！离下班不远了', '再坚持一会儿', '稳扎稳打搞起来', '保持节奏'],
      many: ['下午苦战中…加油', '一件一件消灭它们', '坚持住，你可以的', '干完就收工！']
    },
    // 傍晚 18-21
    evening: {
      few: ['收工啦，enjoy 晚上', '今天辛苦了', '准时下班，合理合法', '今天很棒，犒劳自己'],
      some: ['还有几个，搞完收工', '晚饭后精力满格', '最后冲刺！', '快了快了'],
      many: ['今天任务还剩这么多？', '能搞完就搞，搞不完明天', '别太卷了，身体要紧']
    },
    // 深夜 21-24
    lateNight: {
      few: ['今天完美收官 ✓', '没啥事了，放松吧', '晚安的前奏', '睡前别刷手机了'],
      some: ['还有几个？速战速决', '最后一波，冲完睡觉', '不要熬夜！（很重要）'],
      many: ['明天还有明天的活', '放过自己吧今天', '别太卷了，健康第一']
    }
  };

  function setGreeting() {
    const h = new Date().getHours();
    const todayK = dateKey(new Date());
    const activeCount = todos.filter(t => !t.done && !(t.repeat && t.ddl && isRepeatDoneForDate(t, todayK))).length;

    // 确定时段
    let period;
    if (h < 6) period = 'night';
    else if (h < 9) period = 'morning';
    else if (h < 12) period = 'amWork';
    else if (h < 14) period = 'noon';
    else if (h < 18) period = 'pmWork';
    else if (h < 21) period = 'evening';
    else period = 'lateNight';

    // 确定任务量级别
    let level;
    if (activeCount <= 2) level = 'few';
    else if (activeCount <= 6) level = 'some';
    else level = 'many';

    const pool = GREETINGS[period][level];
    // 基于当天日期做伪随机（同一天内不会反复变化，但每天不同）
    const day = new Date().getDate();
    const idx = (day + h) % pool.length;
    elGreeting.textContent = pool[idx];
  }

  // ===================== Events =====================
  function bindEvents() {
    $('#btn-close').onclick = () => window.api.hide();
    $('#btn-minimize').onclick = () => window.api.minimize();
    $('#btn-pin').onclick = async () => {
      isPinned = await window.api.toggleTop();
      $('#btn-pin').classList.toggle('pinned', isPinned);
    };

    elBtnAdd.onclick = () => {
      closeAllMenus();
      if (isCollapsed) {
        if (panelOpen) {
          // 折叠模式下面板已打开，关闭面板回到折叠
          closePanelToCollapse();
        } else {
          // 折叠模式下打开添加面板
          openPanelFromCollapse();
        }
        return;
      }
      panelOpen ? closePanel() : openPanel();
    };

    // 选项按钮
    $('#opt-pri').onclick = () => toggleExpand('pri');
    $('#opt-ddl').onclick = () => toggleExpand('ddl');
    $('#opt-note').onclick = () => toggleExpand('note');
    $('#opt-tag').onclick = () => toggleExpand('tag');

    // 优先级
    $$('.pri-opt').forEach(b => {
      b.onclick = () => {
        curPri = b.dataset.p;
        $$('.pri-opt').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        updatePriBtn();
        hideExpand('pri');
      };
    });

    // DDL 快捷
    updateQuickDateLabels($$('.qd'));
    $$('.qd').forEach(b => {
      b.onclick = () => {
        const d = b.dataset.d;
        const today = new Date(); today.setHours(0,0,0,0);
        if (d === 'next-mon') {
          const day = today.getDay();
          today.setDate(today.getDate() + (day === 0 ? 1 : 8 - day));
        } else {
          today.setDate(today.getDate() + parseInt(d));
        }
        curDdlDate = today;
        calMonth = new Date(today);
        renderCal();
        $$('.qd').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
      };
    });

    // 日历导航
    $('#cal-prev').onclick = () => { calMonth.setMonth(calMonth.getMonth()-1); renderCal(); };
    $('#cal-next').onclick = () => { calMonth.setMonth(calMonth.getMonth()+1); renderCal(); };

    // DDL区域回车 → 直接添加（选完日期后不需要再点按钮）
    $('#exp-ddl').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.target.classList.contains('t-inp')) addTodo();
    });

    // 循环下拉框
    $('#sel-repeat').onchange = () => { curRepeat = $('#sel-repeat').value || null; };

    // 时间滚轮选择器（初始化移到 bindEvents 外部，resetPanelState 也需要访问）
    twContainer = $('#time-wheel-container');
    addWheelPicker = createTimeWheelPicker(
      twContainer, 0, 0,
      (h, m) => { curDdlH = h; curDdlM = m; }
    );

    // 备注
    $('#note-input').oninput = () => { curNote = $('#note-input').value; };
    // 备注输入框回车 → 直接添加
    $('#note-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) addTodo(); });

    // 标签
    $('#tag-input').oninput = () => {
      curTag = $('#tag-input').value.trim();
      updateTagSuggestions();
      updateTagBtn();
    };
    $('#tag-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) addTodo(); });

    // 取消/确认
    $('#btn-cancel').onclick = () => { isCollapsed ? closePanelToCollapse() : closePanel(); };
    $('#btn-confirm').onclick = addTodo;
    elInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.isComposing) addTodo();
    });

    // Done 展开/收起
    elDoneToggle.onclick = (e) => {
      // 如果点击的是清空按钮，不触发折叠/展开
      if (e.target.id === 'done-clear') return;
      toggleDoneSection();
    };
    // 清空已完成待办
    $('#done-clear').onclick = (e) => {
      e.stopPropagation();
      clearDoneTodos();
    };

    // 编辑弹层关闭
    elEditOverlay.onclick = (e) => {
      if (e.target === elEditOverlay) closeEditPopup();
    };

    // 链接点击代理
    document.addEventListener('click', (e) => {
      const link = e.target.closest('.card-link');
      if (link) { e.preventDefault(); e.stopPropagation(); window.api.openExternal(link.dataset.url); }
    });

    // 输入框粘贴时检测链接
    elInput.addEventListener('input', onInputChange);

    // === 下拉菜单互斥管理 ===
    const sortBtn = document.getElementById('btn-sort');
    const sortMenu = document.getElementById('sort-menu');
    const viewBtn = $('#btn-view');
    const viewMenu = document.getElementById('view-menu');

    function closeAllMenus() {
      if (sortMenu) sortMenu.classList.add('hidden');
      if (viewMenu) viewMenu.classList.add('hidden');
    }

    // 定位 fixed 菜单到按钮下方
    function positionMenu(btn, menu) {
      const rect = btn.getBoundingClientRect();
      menu.style.top = (rect.bottom + 4) + 'px';
      menu.style.right = (window.innerWidth - rect.right) + 'px';
      menu.style.left = '';
    }

    // 排序下拉菜单
    if (sortBtn && sortMenu) {
      sortBtn.onclick = (e) => {
        e.stopPropagation();
        const willShow = sortMenu.classList.contains('hidden');
        closeAllMenus();
        if (willShow) { positionMenu(sortBtn, sortMenu); sortMenu.classList.remove('hidden'); }
      };
      sortMenu.onclick = (e) => {
        const opt = e.target.closest('.sort-opt');
        if (!opt) return;
        const mode = opt.dataset.mode;
        if (mode) selectSortMode(mode);
        closeAllMenus();
      };
    }

    // 视图模式下拉菜单
    if (viewBtn && viewMenu) {
      viewBtn.onclick = (e) => {
        e.stopPropagation();
        const willShow = viewMenu.classList.contains('hidden');
        closeAllMenus();
        if (willShow) { positionMenu(viewBtn, viewMenu); viewMenu.classList.remove('hidden'); updateViewMenuOptions(); }
      };
      viewMenu.onclick = (e) => {
        const opt = e.target.closest('.view-opt');
        if (!opt) return;
        const mode = opt.dataset.mode;
        if (mode === 'list') {
          if (isCollapsed) toggleCollapse();
          if (viewMode === 'calendar') toggleViewMode();
        } else if (mode === 'calendar') {
          if (isCollapsed) toggleCollapse();
          if (viewMode !== 'calendar') toggleViewMode();
        } else if (mode === 'collapse') {
          toggleCollapse();
        }
        closeAllMenus();
      };
    }

    // 点击其他地方关闭所有菜单
    document.addEventListener('click', closeAllMenus);
    $('#cv-prev').onclick = () => { cvMonth.setMonth(cvMonth.getMonth() - 1); renderCalView(); };
    $('#cv-next').onclick = () => { cvMonth.setMonth(cvMonth.getMonth() + 1); renderCalView(); };
    $('#cv-today').onclick = () => { cvMonth = new Date(); cvSelectedDate = ds(new Date()); renderCalView(); };

    // === 图片相关事件 ===
    // 在主输入框粘贴图片
    elInput.addEventListener('paste', (e) => handlePasteImage(e, 'main'));

    // 在备注输入框粘贴图片
    $('#note-input').addEventListener('paste', (e) => handlePasteImage(e, 'note'));

    // 拖拽图片到添加面板
    elPanel.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        elPanel.classList.add('drop-active');
      }
    });
    elPanel.addEventListener('dragleave', (e) => {
      if (!elPanel.contains(e.relatedTarget)) {
        elPanel.classList.remove('drop-active');
      }
    });
    elPanel.addEventListener('drop', handleDropImage);

    // 点击卡片图片查看大图
    document.addEventListener('click', (e) => {
      const imgWrap = e.target.closest('.card-img-wrap');
      if (imgWrap && !e.target.closest('.card-img-del')) {
        e.stopPropagation();
        openLightbox(imgWrap.dataset.path);
      }
    });

    // 点击卡片图片删除按钮
    document.addEventListener('click', (e) => {
      const delBtn = e.target.closest('.card-img-del');
      if (delBtn) {
        e.stopPropagation();
        const wrap = delBtn.closest('.card-img-wrap');
        const card = delBtn.closest('.todo-card');
        if (wrap && card) {
          const filename = wrap.dataset.filename;
          const todoId = card.dataset.id;
          removeImageFromTodo(todoId, filename);
        }
      }
    });
  }

  // ===================== Sort Toggle =====================
  const SORT_MODES = ['default', 'pri-asc', 'pri-desc', 'ddl-asc', 'ddl-desc', 'tag'];
  const SORT_LABELS = { 'default': '默认', 'pri-asc': '优先↑', 'pri-desc': '优先↓', 'ddl-asc': '时间↑', 'ddl-desc': '时间↓', 'tag': '分类' };

  function selectSortMode(mode) {
    sortMode = mode;
    updateSortBtn();
    render();
    if (viewMode === 'calendar') renderCalView();
  }

  function updateSortBtn() {
    const btn = document.getElementById('btn-sort');
    if (!btn) return;
    btn.textContent = SORT_LABELS[sortMode] || '排序';
    btn.classList.toggle('active', sortMode !== 'default');
    // 同步下拉菜单选中态
    const menu = document.getElementById('sort-menu');
    if (menu) {
      menu.querySelectorAll('.sort-opt').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.mode === sortMode);
      });
    }
  }

  // ===================== Panel =====================
  let prePanelHeight = null; // 记住打开面板前的窗口高度，用于面板关闭后恢复

  function openPanel() {
    const app = document.getElementById('app');
    panelOpen = true;
    // 进入 "adding" 模式：面板完整铺开覆盖列表，不受原窗口高度限制
    app.classList.add('panel-adding');
    elPanel.classList.remove('hidden');
    elBtnAdd.classList.add('active');
    elInput.focus();
    renderCal();
    // 记住当前窗口高度
    window.api.getBounds().then(b => {
      if (b) prePanelHeight = b.height;
    });
    // 自适应面板内容高度（双 rAF 确保 DOM 布局完成）
    requestAnimationFrame(() => {
      requestAnimationFrame(() => adjustWindowHeight());
    });
  }

  function closePanel() {
    const app = document.getElementById('app');
    panelOpen = false;
    elPanel.classList.add('hidden');
    elBtnAdd.classList.remove('active');
    app.classList.remove('panel-adding');
    resetPanelState();
    // 恢复到面板打开前的高度
    if (prePanelHeight) {
      window.api.resizeHeight(prePanelHeight);
      prePanelHeight = null;
    } else {
      requestAnimationFrame(adjustWindowHeight);
    }
  }

  // 折叠状态下打开添加面板
  function openPanelFromCollapse() {
    const app = document.getElementById('app');
    // 临时移除 collapsed 的 display:none 限制，让面板可显示
    app.classList.add('collapsed-adding');
    panelOpen = true;
    elPanel.classList.remove('hidden');
    elBtnAdd.classList.add('active');
    elInput.focus();
    renderCal();
    // 关闭鼠标穿透（面板需要全局交互）
    disableCollapsedMouseForward();
    // 自适应窗口高度，让面板完全展开
    requestAnimationFrame(adjustWindowHeight);
  }

  // 折叠状态下关闭面板，恢复折叠
  function closePanelToCollapse() {
    const app = document.getElementById('app');
    panelOpen = false;
    elPanel.classList.add('hidden');
    elBtnAdd.classList.remove('active');
    resetPanelState();
    app.classList.remove('collapsed-adding');
    window.api.resizeHeight(COLLAPSED_WIN_H);
    // 重新启用鼠标穿透
    enableCollapsedMouseForward();
  }

  function resetPanelState() {
    elInput.value = '';
    elInput._detectedLinks = null;
    $('#link-preview').classList.add('hidden');
    curPri = 'normal'; curDdlDate = null; curDdlH = null; curDdlM = null; curNote = ''; curRepeat = null;
    curTag = '';
    curImages = []; curNoteImages = [];
    $$('.pri-opt').forEach(b => b.classList.toggle('active', b.dataset.p === 'normal'));
    $$('.qd').forEach(b => b.classList.remove('active'));
    $('#note-input').value = '';
    $('#tag-input').value = '';
    $('#tag-suggestions').innerHTML = '';
    $('#sel-repeat').value = '';
    // 重置时间滚轮
    addWheelPicker.destroy();
    twContainer.innerHTML = '';
    addWheelPicker = createTimeWheelPicker(
      twContainer, 0, 0,
      (h, m) => { curDdlH = h; curDdlM = m; }
    );
    // 清除图片预览
    elPanel.querySelectorAll('.inline-img-preview').forEach(el => el.remove());
    updatePriBtn();
    updateTagBtn();
    ['pri','ddl','note','tag'].forEach(hideExpand);
    $$('.opt-btn').forEach(b => b.classList.remove('active'));
  }

  function toggleExpand(name) {
    const el = $(`#exp-${name}`);
    const btn = $(`#opt-${name}`);
    const willShow = el.classList.contains('hidden');
    ['pri','ddl','note','tag'].forEach(n => {
      $(`#exp-${n}`).classList.add('hidden');
      $(`#opt-${n}`).classList.remove('active');
    });
    if (willShow) {
      el.classList.remove('hidden');
      btn.classList.add('active');
      if (name === 'ddl') renderCal();
      if (name === 'note') $('#note-input').focus();
      if (name === 'tag') { $('#tag-input').focus(); updateTagSuggestions(); }
    }
    requestAnimationFrame(adjustWindowHeight);
  }

  function hideExpand(name) {
    $(`#exp-${name}`).classList.add('hidden');
    $(`#opt-${name}`).classList.remove('active');
  }

  function updatePriBtn() {
    const map = { urgent:'紧急', important:'重要', normal:'普通' };
    $('#pri-text').textContent = map[curPri];
  }

  function updateTagBtn() {
    const el = $('#tag-text');
    if (el) el.textContent = curTag || '标签';
    const btn = $('#opt-tag');
    if (btn) btn.classList.toggle('active', !!curTag);
  }

  function getExistingTags() {
    const tags = new Set();
    todos.forEach(t => { if (t.tag) tags.add(t.tag); });
    return [...tags].sort();
  }

  function updateTagSuggestions() {
    const container = $('#tag-suggestions');
    if (!container) return;
    container.innerHTML = '';
    const existing = getExistingTags();
    const filter = curTag.toLowerCase();
    const filtered = filter ? existing.filter(t => t.toLowerCase().includes(filter)) : existing;
    if (filtered.length === 0) return;
    filtered.forEach(tag => {
      const btn = document.createElement('button');
      btn.className = 'tag-sug-btn';
      btn.textContent = tag;
      btn.onclick = (e) => {
        e.stopPropagation();
        curTag = tag;
        $('#tag-input').value = tag;
        updateTagBtn();
        container.innerHTML = '';
      };
      container.appendChild(btn);
    });
  }

  // ===================== Calendar =====================
  function renderCal() {
    const y = calMonth.getFullYear(), m = calMonth.getMonth();
    $('#cal-title').textContent = `${y}年${m+1}月`;
    const grid = $('#cal-grid');
    grid.innerHTML = '';

    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m+1, 0).getDate();
    const prevDays = new Date(y, m, 0).getDate();
    const today = new Date(); today.setHours(0,0,0,0);
    const selStr = curDdlDate ? ds(curDdlDate) : '';

    for (let i = firstDay - 1; i >= 0; i--) grid.appendChild(mkCalBtn(prevDays - i, true));
    for (let i = 1; i <= daysInMonth; i++) {
      const d = new Date(y, m, i);
      const btn = mkCalBtn(i, false);
      if (ds(d) === ds(today)) btn.classList.add('today');
      if (ds(d) === selStr) btn.classList.add('sel');
      btn.onclick = () => {
        curDdlDate = d;
        $$('.qd').forEach(x => x.classList.remove('active'));
        renderCal();
      };
      grid.appendChild(btn);
    }
    const total = grid.children.length;
    const rem = (7 - total % 7) % 7;
    for (let i = 1; i <= rem; i++) grid.appendChild(mkCalBtn(i, true));
  }

  function mkCalBtn(num, isOther) {
    const btn = document.createElement('button');
    btn.className = 'cal-d' + (isOther ? ' ot' : '');
    btn.textContent = num;
    return btn;
  }

  function ds(d) { return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }

  // 为快捷日期按钮添加周几提示（如 "今天 三"、"明天 四"）
  const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];
  function updateQuickDateLabels(btns) {
    // 快捷按钮保持简洁文案，不加周几后缀
  }

  // ===================== Add Todo =====================
  function addTodo() {
    try {
      const text = elInput.value.trim();
      if (!text) return;

      // DDL：用户没选时分就不存时分（只存日期 00:00:00，展示时也只显示日期）
      let ddl = null;
      let ddlHasTime = false;
      if (curDdlDate) {
        ddl = new Date(curDdlDate);
        if (curDdlH != null || curDdlM != null) {
          ddl.setHours(curDdlH || 0, curDdlM || 0, 0, 0);
          ddlHasTime = true;
        } else {
          ddl.setHours(0, 0, 0, 0);
        }
        ddl = ddl.getTime();
      }

      const todo = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
        text, priority: curPri, ddl, ddlHasTime, note: curNote || null,
        repeat: curRepeat, tag: curTag || null,
        done: false, createdAt: Date.now(), order: 0, tagOrder: 0, links: [],
        images: curImages.map(img => img.filename),
        noteImages: curNoteImages.map(img => img.filename)
      };

      // 使用已缓存的链接标题（输入时即时获取过的）
      if (elInput._detectedLinks && elInput._detectedLinks.length > 0) {
        todo.links = elInput._detectedLinks;
        elInput._detectedLinks = null;
      } else {
        todo.links = detectLinks(text);
      }

      todos.unshift(todo);
      // 折叠模式下添加完成后保持折叠
      if (isCollapsed) {
        closePanelToCollapse();
      } else {
        closePanel();
      }
      render(); save();
      // 日历模式下刷新日历视图
      if (viewMode === 'calendar') renderCalView();
      // 对还没标题的链接继续异步获取
      if (todo.links.some(l => !l.title)) fetchTitlesForTodo(todo.id);
    } catch (err) {
      console.error('[addTodo] error:', err.message, err.stack);
      // 出错时也尝试保存和渲染
      try { render(); save(); } catch(e2) { console.error('[addTodo fallback] error:', e2.message); }
    }
  }

  // ===================== Link Detection =====================
  // 支持 https://xxx 和 无协议的 xxx.com/path 格式，含 query string
  const URL_RE = /(?:https?:\/\/)?(?:[\w-]+\.)+(?:com|cn|net|org|io|dev)(?:\/[^\s,，;；、!！)\]）】"'"']*)?/gi;

  function detectLinks(text) {
    const matches = text.match(URL_RE);
    if (!matches) return [];
    return matches.map(raw => {
      let url = raw.trim();
      const rawText = url; // 保存原始文本，用于 renderTextWithLinks 替换
      // 补全协议头
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      return { url, rawText, title: null };
    });
  }

  // 输入框变化时即时检测链接并获取标题，实时显示预览
  const elLinkPreview = $('#link-preview');
  let inputFetchTimer = null;

  function onInputChange() {
    clearTimeout(inputFetchTimer);
    const text = elInput.value;
    const links = detectLinks(text);

    if (links.length === 0) {
      elLinkPreview.classList.add('hidden');
      elInput._detectedLinks = null;
      return;
    }

    // 先立即用 guessTitle 显示，学城链接显示"识别中..."
    for (const link of links) {
      link.title = guessTitle(link.url);
      if (!link.title && extractKmContentId(link.url)) {
        link._loading = true;
      }
    }
    showLinkPreview(links);
    elInput._detectedLinks = links;

    // 立即尝试获取标题（不延迟，用户等不了）
    inputFetchTimer = setTimeout(async () => {
      for (const link of links) {
        if (link.title) continue;
        // 学城链接用 citadel 获取真实标题
        const kmId = extractKmContentId(link.url);
        if (kmId) {
          try {
            const fetched = await window.api.fetchKmTitle(kmId);
            if (fetched) { link.title = fetched; link._loading = false; showLinkPreview(links); continue; }
          } catch (e) { /* ignore */ }
        }
        // 通用 HTTP 抓取
        try {
          const fetched = await window.api.fetchTitle(link.url);
          if (fetched) { link.title = fetched; link._loading = false; showLinkPreview(links); continue; }
        } catch {}
        // 获取失败也要更新预览（移除"识别中"状态）
        link._loading = false;
      }
      // 确保最终状态更新
      showLinkPreview(links);
      elInput._detectedLinks = links;
    }, 200);
  }

  function showLinkPreview(links) {
    const titles = links.map(l => {
      if (l.title) return l.title;
      if (l._loading) return '识别标题中...';
      return shortenUrl(l.url);
    });
    elLinkPreview.textContent = titles.join(', ');
    elLinkPreview.classList.remove('hidden');
  }

  async function fetchTitlesForTodo(id) {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    let changed = false;
    for (const link of todo.links) {
      if (link.title) continue;
      // 优先尝试学城 citadel 接口获取真实标题
      const kmId = extractKmContentId(link.url);
      if (kmId) {
        try {
          const title = await window.api.fetchKmTitle(kmId);
          if (title) { link.title = title; changed = true; continue; }
        } catch {}
      }
      // 通用 guessTitle 尝试
      const guessed = guessTitle(link.url);
      if (guessed) { link.title = guessed; changed = true; continue; }
      // 最后用 HTTP 抓取
      try {
        const title = await window.api.fetchTitle(link.url);
        if (title) { link.title = title; changed = true; }
      } catch {}
    }
    if (changed) { render(); save(); }
  }

  function guessTitle(url) {
    // 不再给学城链接返回占位文本，统一走异步获取真实标题
    if (url.includes('bi.sankuai.com') || url.includes('moshu')) return '魔数看板';
    return null;
  }

  // 从 km URL 中提取 contentId
  function extractKmContentId(url) {
    // 支持 km.sankuai.com / m.sankuai.com 等学城域名
    if (!url.includes('sankuai.com')) return null;
    const m = url.match(/collabpage\/(\d+)/) || url.match(/page\/(\d+)/);
    return m ? m[1] : null;
  }

  // ===================== Auto Sort Compare =====================
  function autoCompare(a, b) {
    const priRank = { urgent: 0, important: 1, normal: 2 };
    const pa = priRank[a.priority] ?? 2, pb = priRank[b.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    if (a.ddl && !b.ddl) return -1;
    if (!a.ddl && b.ddl) return 1;
    if (a.ddl && b.ddl) return a.ddl - b.ddl;
    return b.createdAt - a.createdAt;
  }

  // ===================== Save =====================
  async function save() { await window.api.saveData({ todos, tagGroupOrder }); }

  // ===================== Render =====================
  function render() {
    const todayKey = dateKey(new Date());
    const active = todos.filter(t => !t.done);
    const done = todos.filter(t => t.done);

    // 排序逻辑：sortMode 优先级最高
    // 循环待办已完成今天的从活跃列表隐藏
    const repeatDoneTodayCheck = (t) => t.repeat && t.ddl && isRepeatDoneForDate(t, todayKey);
    const visibleActive = active.filter(t => !repeatDoneTodayCheck(t));
    const repeatDoneToday = active.filter(t => repeatDoneTodayCheck(t));

    if (sortMode === 'tag') {
      // 分类模式：不在这里排序，交给 renderTagView
    } else if (sortMode !== 'default') {
      visibleActive.sort((a, b) => {
        if (sortMode === 'pri-asc') {
          const priRank = { urgent: 0, important: 1, normal: 2 };
          return (priRank[b.priority] ?? 2) - (priRank[a.priority] ?? 2);
        } else if (sortMode === 'pri-desc') {
          const priRank = { urgent: 0, important: 1, normal: 2 };
          return (priRank[a.priority] ?? 2) - (priRank[b.priority] ?? 2);
        } else if (sortMode === 'ddl-asc') {
          if (a.ddl && !b.ddl) return -1;
          if (!a.ddl && b.ddl) return 1;
          if (a.ddl && b.ddl) return a.ddl - b.ddl;
          return 0;
        } else if (sortMode === 'ddl-desc') {
          if (a.ddl && !b.ddl) return -1;
          if (!a.ddl && b.ddl) return 1;
          if (a.ddl && b.ddl) return b.ddl - a.ddl;
          return 0;
        }
        return 0;
      });
    } else {
      // 默认模式：手动拖拽排序 > 自动规则
      const hasManualOrder = visibleActive.some(t => t.order > 0);
      if (hasManualOrder) {
        visibleActive.sort((a, b) => {
          if (a.order > 0 && b.order > 0) return a.order - b.order;
          if (a.order > 0 && b.order === 0) return -1;
          if (a.order === 0 && b.order > 0) return 1;
          return autoCompare(a, b);
        });
      } else {
        visibleActive.sort((a, b) => autoCompare(a, b));
      }
    }

    // 统计：只计入可见的活跃待办
    elStat.textContent = visibleActive.length > 0 ? `${visibleActive.length}件` : '';
    elEmpty.classList.toggle('hidden', visibleActive.length > 0);

    // 清除旧卡片
    elListArea.querySelectorAll('.todo-card').forEach(c => c.remove());
    elListArea.querySelectorAll('.drag-indicator').forEach(c => c.remove());
    elListArea.querySelectorAll('.tag-group').forEach(c => c.remove());

    if (sortMode === 'tag') {
      // 分类模式渲染
      renderTagView(visibleActive);
    } else {
      // 普通模式渲染
      visibleActive.forEach((todo, idx) => {
        const card = createCard(todo, false, idx);
        elListArea.appendChild(card);
      });
    }

    // Done：包含普通已完成 + 今天已完成的循环待办
    const allDone = [...done, ...repeatDoneToday];
    if (allDone.length > 0) {
      elDoneSection.classList.remove('hidden');
      elDoneCount.textContent = allDone.length;
      elDoneList.innerHTML = '';
      allDone.slice(0, 30).forEach(todo => {
        elDoneList.appendChild(createCard(todo, true));
      });
      // 同步 Done 列表展开状态和清空按钮
      elDoneList.classList.toggle('hidden', !doneExpanded);
      $('#done-clear').classList.toggle('hidden', !doneExpanded);
      elDoneArrow.classList.toggle('open', doneExpanded);
    } else {
      elDoneSection.classList.add('hidden');
    }

    requestAnimationFrame(adjustWindowHeight);
  }

  // ===================== Tag View (分类模式) =====================
  function renderTagView(visibleActive) {
    // 分离有标签和无标签的 todo
    const tagged = visibleActive.filter(t => t.tag);
    const untagged = visibleActive.filter(t => !t.tag);

    // 按标签分组
    const groups = {};
    tagged.forEach(t => {
      if (!groups[t.tag]) groups[t.tag] = [];
      groups[t.tag].push(t);
    });

    // 组内排序：按 tagOrder > createdAt
    Object.values(groups).forEach(list => {
      const hasOrder = list.some(t => t.tagOrder > 0);
      if (hasOrder) {
        list.sort((a, b) => {
          if (a.tagOrder > 0 && b.tagOrder > 0) return a.tagOrder - b.tagOrder;
          if (a.tagOrder > 0 && b.tagOrder === 0) return -1;
          if (a.tagOrder === 0 && b.tagOrder > 0) return 1;
          return (a.createdAt || 0) - (b.createdAt || 0);
        });
      } else {
        list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      }
    });

    // 构建扁平化的排序项列表：每一项是 {type:'group', tag, todos} 或 {type:'item', todo}
    const allTags = Object.keys(groups);
    const allItems = [
      ...allTags.map(tag => ({ type: 'group', tag, key: 'tag:' + tag })),
      ...untagged.map(t => ({ type: 'item', todo: t, key: 'id:' + t.id }))
    ];

    // 按 tagGroupOrder 排序，未出现的追加到末尾（按首条 todo 的 createdAt）
    const orderMap = {};
    tagGroupOrder.forEach((key, i) => { orderMap[key] = i; });

    // 为未在 tagGroupOrder 中的项生成排序 key（按最早创建时间）
    const getDefaultSortKey = (item) => {
      if (item.type === 'group') {
        return Math.min(...groups[item.tag].map(t => t.createdAt || 0));
      }
      return item.todo.createdAt || 0;
    };

    allItems.sort((a, b) => {
      const aIdx = orderMap[a.key];
      const bIdx = orderMap[b.key];
      if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx;
      if (aIdx !== undefined) return -1;
      if (bIdx !== undefined) return 1;
      return getDefaultSortKey(a) - getDefaultSortKey(b);
    });

    // 渲染
    allItems.forEach(item => {
      if (item.type === 'group') {
        const groupEl = createTagGroup(item.tag, groups[item.tag]);
        elListArea.appendChild(groupEl);
      } else {
        const card = createCard(item.todo, false);
        card.classList.add('tag-ungrouped');
        elListArea.appendChild(card);
        // 无标签 todo 在分类模式下也支持拖拽
        setupTagDrag(card, item.todo, null);
      }
    });
  }

  function createTagGroup(tag, todoList) {
    const group = document.createElement('div');
    group.className = 'tag-group';
    group.dataset.tag = tag;

    const isCollapsed = !!tagCollapsed[tag];

    // 标题栏
    const header = document.createElement('div');
    header.className = 'tag-group-header';
    header.innerHTML = `
      <span class="tag-group-arrow${isCollapsed ? '' : ' open'}">▸</span>
      <span class="tag-group-name">${escHtml(tag)}</span>
      <span class="tag-group-count">${todoList.length}</span>
    `;
    header.onclick = () => {
      tagCollapsed[tag] = !tagCollapsed[tag];
      render();
    };
    group.appendChild(header);

    // 让整个标签组标题支持拖拽排序
    setupTagGroupDrag(header, tag);

    // 条目容器
    if (!isCollapsed) {
      const body = document.createElement('div');
      body.className = 'tag-group-body';
      todoList.forEach(todo => {
        const card = createCard(todo, false);
        body.appendChild(card);
        setupTagDrag(card, todo, tag);
      });
      group.appendChild(body);
    }

    return group;
  }

  // 分类模式下：组内拖拽（组内调序）
  function setupTagDrag(card, todo, tagName) {
    let pendingDrag = null;

    card.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, select, a, input, textarea, .card-check, .card-delete, .card-img-del, .lbl-native-select')) return;
      if (e.button !== 0) return;
      pendingDrag = { startY: e.clientY, pointerId: e.pointerId };
    });

    card.addEventListener('pointermove', (e) => {
      if (pendingDrag && !_drag) {
        const dy = e.clientY - pendingDrag.startY;
        if (Math.abs(dy) < 6) return;
        card.setPointerCapture(pendingDrag.pointerId);
        _drag = {
          id: todo.id, card, tagName,
          startY: pendingDrag.startY,
          origTop: card.getBoundingClientRect().top,
          clone: null, indicator: null, targetId: null, insertBefore: true
        };
        pendingDrag = null;
        const clone = card.cloneNode(true);
        clone.className = 'todo-card drag-clone';
        clone.style.cssText = `position:fixed;left:${card.getBoundingClientRect().left}px;top:${card.getBoundingClientRect().top}px;width:${card.offsetWidth}px;opacity:0.85;pointer-events:none;z-index:9999;transition:none;`;
        document.body.appendChild(clone);
        _drag.clone = clone;
        card.classList.add('dragging');
      }
      if (_drag && _drag.id === todo.id) {
        const dy = e.clientY - _drag.startY;
        if (_drag.clone) _drag.clone.style.top = (_drag.origTop + dy) + 'px';
        updateTagDropTarget(e.clientY, tagName);
      }
    });

    card.addEventListener('pointerup', (e) => {
      if (pendingDrag) pendingDrag = null;
      if (_drag && _drag.id === todo.id) {
        card.releasePointerCapture(e.pointerId);
        finishTagDrag();
      }
    });

    card.addEventListener('pointercancel', () => {
      pendingDrag = null;
      if (_drag && _drag.id === todo.id) finishTagDrag();
    });
  }

  function updateTagDropTarget(clientY, tagName) {
    if (!_drag) return;
    if (_drag.indicator) { _drag.indicator.remove(); _drag.indicator = null; }

    // 只在同组内寻找目标
    let container;
    if (tagName) {
      const groupEl = elListArea.querySelector(`.tag-group[data-tag="${CSS.escape(tagName)}"] .tag-group-body`);
      if (!groupEl) return;
      container = groupEl;
    } else {
      // 无标签 todo 之间的拖拽：在 list-area 顶层的 .tag-ungrouped 之间
      container = elListArea;
    }

    const cards = [...container.querySelectorAll('.todo-card:not(.dragging)')];
    if (tagName === null) {
      // 只看 ungrouped 的
      const ungroupedCards = cards.filter(c => c.classList.contains('tag-ungrouped'));
      findDropTarget(ungroupedCards, clientY);
    } else {
      findDropTarget(cards, clientY);
    }
  }

  function findDropTarget(cards, clientY) {
    let targetCard = null;
    let insertBefore = true;
    for (const c of cards) {
      const rect = c.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        targetCard = c;
        insertBefore = true;
        break;
      }
      targetCard = c;
      insertBefore = false;
    }
    if (!targetCard) return;
    const targetId = targetCard.dataset.id;
    if (targetId === _drag.id) return;
    _drag.targetId = targetId;
    _drag.insertBefore = insertBefore;
    const indicator = document.createElement('div');
    indicator.className = 'drag-indicator';
    if (insertBefore) {
      targetCard.parentNode.insertBefore(indicator, targetCard);
    } else {
      targetCard.parentNode.insertBefore(indicator, targetCard.nextSibling);
    }
    _drag.indicator = indicator;
  }

  function finishTagDrag() {
    if (!_drag) return;
    const { id, card, clone, indicator, targetId, insertBefore, tagName } = _drag;
    if (clone) clone.remove();
    if (indicator) indicator.remove();
    card.classList.remove('dragging');

    if (targetId && targetId !== id) {
      reorderTagMode(id, targetId, insertBefore, tagName);
    }
    _drag = null;
  }

  function reorderTagMode(fromId, toId, insertBefore, tagName) {
    if (tagName) {
      // 组内排序
      const group = todos.filter(t => !t.done && t.tag === tagName);
      const hasOrder = group.some(t => t.tagOrder > 0);
      if (hasOrder) {
        group.sort((a, b) => {
          if (a.tagOrder > 0 && b.tagOrder > 0) return a.tagOrder - b.tagOrder;
          if (a.tagOrder > 0 && b.tagOrder === 0) return -1;
          if (a.tagOrder === 0 && b.tagOrder > 0) return 1;
          return (a.createdAt || 0) - (b.createdAt || 0);
        });
      } else {
        group.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      }

      const fromIdx = group.findIndex(t => t.id === fromId);
      const toIdx = group.findIndex(t => t.id === toId);
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;

      const [moved] = group.splice(fromIdx, 1);
      let newToIdx = group.findIndex(t => t.id === toId);
      if (newToIdx < 0) newToIdx = group.length;
      const insertIdx = insertBefore ? newToIdx : newToIdx + 1;
      group.splice(insertIdx, 0, moved);
      group.forEach((t, i) => { t.tagOrder = i + 1; });
    } else {
      // 无标签 todo 之间的排序：更新 tagGroupOrder
      const untaggedItems = tagGroupOrder.filter(k => k.startsWith('id:'));
      // 也可能不在 tagGroupOrder 里，需要先确保它们存在
      rebuildTagGroupOrder();
      const fromKey = 'id:' + fromId;
      const toKey = 'id:' + toId;
      const fromIdx = tagGroupOrder.indexOf(fromKey);
      const toIdx = tagGroupOrder.indexOf(toKey);
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;

      tagGroupOrder.splice(fromIdx, 1);
      let newToIdx = tagGroupOrder.indexOf(toKey);
      if (newToIdx < 0) newToIdx = tagGroupOrder.length;
      const insertIdx = insertBefore ? newToIdx : newToIdx + 1;
      tagGroupOrder.splice(insertIdx, 0, fromKey);
    }
    render(); save();
  }

  // 分类模式下：标签组整体拖拽
  function setupTagGroupDrag(header, tag) {
    let pendingDrag = null;

    header.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      pendingDrag = { startY: e.clientY, pointerId: e.pointerId };
    });

    header.addEventListener('pointermove', (e) => {
      if (pendingDrag && !_drag) {
        const dy = e.clientY - pendingDrag.startY;
        if (Math.abs(dy) < 6) return;
        const groupEl = header.closest('.tag-group');
        header.setPointerCapture(pendingDrag.pointerId);
        _drag = {
          id: 'tag:' + tag, card: groupEl, tagName: '__group__',
          startY: pendingDrag.startY,
          origTop: groupEl.getBoundingClientRect().top,
          clone: null, indicator: null, targetId: null, insertBefore: true
        };
        pendingDrag = null;
        const clone = groupEl.cloneNode(true);
        clone.className = 'tag-group drag-clone';
        clone.style.cssText = `position:fixed;left:${groupEl.getBoundingClientRect().left}px;top:${groupEl.getBoundingClientRect().top}px;width:${groupEl.offsetWidth}px;opacity:0.7;pointer-events:none;z-index:9999;transition:none;`;
        document.body.appendChild(clone);
        _drag.clone = clone;
        groupEl.classList.add('dragging');
      }
      if (_drag && _drag.id === 'tag:' + tag) {
        const dy = e.clientY - _drag.startY;
        if (_drag.clone) _drag.clone.style.top = (_drag.origTop + dy) + 'px';
        updateGroupDropTarget(e.clientY);
      }
    });

    header.addEventListener('pointerup', (e) => {
      if (pendingDrag) pendingDrag = null;
      if (_drag && _drag.id === 'tag:' + tag) {
        header.releasePointerCapture(e.pointerId);
        finishGroupDrag();
      }
    });

    header.addEventListener('pointercancel', () => {
      pendingDrag = null;
      if (_drag && _drag.id === 'tag:' + tag) finishGroupDrag();
    });
  }

  function updateGroupDropTarget(clientY) {
    if (!_drag) return;
    if (_drag.indicator) { _drag.indicator.remove(); _drag.indicator = null; }

    // 在 list-area 的顶层子元素之间找目标（tag-group 或 tag-ungrouped）
    const items = [...elListArea.querySelectorAll('.tag-group:not(.dragging), .todo-card.tag-ungrouped:not(.dragging)')];
    let targetEl = null;
    let insertBefore = true;
    for (const el of items) {
      const rect = el.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        targetEl = el;
        insertBefore = true;
        break;
      }
      targetEl = el;
      insertBefore = false;
    }
    if (!targetEl) return;
    const targetKey = targetEl.classList.contains('tag-group') ? 'tag:' + targetEl.dataset.tag : 'id:' + targetEl.dataset.id;
    if (targetKey === _drag.id) return;
    _drag.targetId = targetKey;
    _drag.insertBefore = insertBefore;
    const indicator = document.createElement('div');
    indicator.className = 'drag-indicator';
    if (insertBefore) {
      targetEl.parentNode.insertBefore(indicator, targetEl);
    } else {
      targetEl.parentNode.insertBefore(indicator, targetEl.nextSibling);
    }
    _drag.indicator = indicator;
  }

  function finishGroupDrag() {
    if (!_drag) return;
    const { id, card, clone, indicator, targetId, insertBefore } = _drag;
    if (clone) clone.remove();
    if (indicator) indicator.remove();
    if (card) card.classList.remove('dragging');

    if (targetId && targetId !== id) {
      rebuildTagGroupOrder();
      const fromIdx = tagGroupOrder.indexOf(id);
      const toIdx = tagGroupOrder.indexOf(targetId);
      if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
        tagGroupOrder.splice(fromIdx, 1);
        let newToIdx = tagGroupOrder.indexOf(targetId);
        if (newToIdx < 0) newToIdx = tagGroupOrder.length;
        const insertIdx = insertBefore ? newToIdx : newToIdx + 1;
        tagGroupOrder.splice(insertIdx, 0, id);
      }
      render(); save();
    }
    _drag = null;
  }

  // 确保 tagGroupOrder 包含当前所有标签组和无标签 todo
  function rebuildTagGroupOrder() {
    const todayKey = dateKey(new Date());
    const repeatDoneTodayCheck = (t) => t.repeat && t.ddl && isRepeatDoneForDate(t, todayKey);
    const active = todos.filter(t => !t.done && !repeatDoneTodayCheck(t));

    const allTags = [...new Set(active.filter(t => t.tag).map(t => t.tag))];
    const untaggedIds = active.filter(t => !t.tag).map(t => 'id:' + t.id);
    const allKeys = [...allTags.map(t => 'tag:' + t), ...untaggedIds];

    // 保留已有顺序中仍有效的项
    const validKeys = new Set(allKeys);
    const preserved = tagGroupOrder.filter(k => validKeys.has(k));
    const preservedSet = new Set(preserved);

    // 追加新出现的项（按默认排序：最早 createdAt）
    const newKeys = allKeys.filter(k => !preservedSet.has(k));
    const getCreatedAt = (key) => {
      if (key.startsWith('tag:')) {
        const tag = key.slice(4);
        const group = active.filter(t => t.tag === tag);
        return Math.min(...group.map(t => t.createdAt || 0));
      }
      const id = key.slice(3);
      const todo = active.find(t => t.id === id);
      return todo ? (todo.createdAt || 0) : 0;
    };
    newKeys.sort((a, b) => getCreatedAt(a) - getCreatedAt(b));

    tagGroupOrder = [...preserved, ...newKeys];
  }

  // ===================== Card =====================
  function createCard(todo, isDone, idx) {
    // 循环待办在列表视图中：判断"今天"是否已完成
    const repeatDoneToday = !isDone && todo.repeat && todo.ddl && isRepeatDoneForDate(todo, dateKey(new Date()));
    const card = document.createElement('div');
    card.className = 'todo-card' + (isDone ? ' completed' : '') + (repeatDoneToday ? ' repeat-done-today' : '');
    card.dataset.id = todo.id;
    if (idx !== undefined) card.dataset.idx = idx;

    const colors = { urgent: '#ff6b6b', important: '#ffa94d', normal: '#74b9ff' };
    card.style.setProperty('--card-color', colors[todo.priority] || colors.normal);

    // Check
    const check = document.createElement('div');
    check.className = 'card-check' + (repeatDoneToday ? ' checked' : '');
    check.onclick = (e) => { e.stopPropagation(); toggleDone(todo.id); };

    // Body
    const body = document.createElement('div');
    body.className = 'card-body';

    // Text（限制3行，单击展开/收起，双击编辑）
    const textEl = document.createElement('div');
    textEl.className = 'card-text';
    textEl.innerHTML = renderTextWithLinks(todo);
    textEl.onclick = (e) => {
      // 点击链接不触发展开
      if (e.target.closest('.card-link')) return;
      // 检查是否文本被截断（scrollHeight > clientHeight）
      if (textEl.scrollHeight > textEl.clientHeight + 2 || textEl.classList.contains('expanded')) {
        textEl.classList.toggle('expanded');
        requestAnimationFrame(adjustWindowHeight);
      }
    };
    textEl.ondblclick = () => startInlineEdit(textEl, todo);
    body.appendChild(textEl);

    // Labels — 顺序：优先级 → 时间+铃铛+循环 → 标签 → 备注
    const labels = document.createElement('div');
    labels.className = 'card-labels';

    // 优先级标签 — 内嵌 select 覆盖在标签上
    const plWrap = document.createElement('span');
    plWrap.className = `card-lbl pri-${todo.priority} lbl-select-wrap`;
    const priMap = { urgent: '紧急', important: '重要', normal: '普通' };
    plWrap.textContent = priMap[todo.priority] || '普通';
    const priSel = document.createElement('select');
    priSel.className = 'lbl-native-select';
    priSel.innerHTML = `<option value="urgent"${todo.priority==='urgent'?' selected':''}>紧急</option><option value="important"${todo.priority==='important'?' selected':''}>重要</option><option value="normal"${todo.priority==='normal'?' selected':''}>普通</option>`;
    priSel.onchange = (e) => { e.stopPropagation(); todo.priority = priSel.value; render(); save(); if (viewMode === 'calendar') renderCalView(); };
    priSel.onclick = (e) => e.stopPropagation();
    plWrap.appendChild(priSel);
    labels.appendChild(plWrap);

    // DDL标签（有DDL显示时间，没有也显示入口）
    const dl = document.createElement('span');
    dl.className = 'card-lbl ddl-lbl';
    if (todo.ddl) {
      const ddlDate = new Date(todo.ddl);
      const diff = ddlDate - new Date();
      if (diff < 0) dl.classList.add('overdue');
      else if (diff < 24*3600000) dl.classList.add('soon');
      dl.textContent = fmtDdl(ddlDate, todo.ddlHasTime);
    } else {
      dl.textContent = '+ 时间';
      dl.style.opacity = '0.5';
    }
    dl.onclick = (e) => { e.stopPropagation(); openEditPopup(todo.id, 'ddl'); };
    labels.appendChild(dl);

    // 提醒铃铛（仅有DDL且设置了具体时间时显示）
    if (todo.ddl && todo.ddlHasTime && !isDone) {
      const bell = document.createElement('span');
      bell.className = 'card-lbl bell-lbl' + (todo.noReminder ? ' muted' : '');
      bell.textContent = todo.noReminder ? '🔕' : '🔔';
      bell.title = todo.noReminder ? '点击开启提醒' : '点击关闭提醒';
      bell.onclick = async (e) => {
        e.stopPropagation();
        const isOn = await window.api.toggleReminder(todo.id);
        todo.noReminder = !isOn;
        bell.textContent = isOn ? '🔔' : '🔕';
        bell.title = isOn ? '点击关闭提醒' : '点击开启提醒';
        bell.classList.toggle('muted', !isOn);
      };
      labels.appendChild(bell);
    }

    // 循环标签 — 仅当有循环时显示，内嵌 select（紧凑格式）
    if (todo.repeat) {
      const rlWrap = document.createElement('span');
      rlWrap.className = 'card-lbl repeat-lbl lbl-select-wrap';
      const repeatMap = { daily: '🔄日', weekly: '🔄周' };
      rlWrap.textContent = repeatMap[todo.repeat] || '';
      const rpSel = document.createElement('select');
      rpSel.className = 'lbl-native-select';
      rpSel.innerHTML = `<option value="">不循环</option><option value="daily"${todo.repeat==='daily'?' selected':''}>每天</option><option value="weekly"${todo.repeat==='weekly'?' selected':''}>每周</option>`;
      rpSel.onchange = (e) => { e.stopPropagation(); todo.repeat = rpSel.value || null; render(); save(); if (viewMode === 'calendar') renderCalView(); };
      rpSel.onclick = (e) => e.stopPropagation();
      rlWrap.appendChild(rpSel);
      labels.appendChild(rlWrap);
    }

    // 标签（有标签显示名称，没有也显示入口）
    const tl = document.createElement('span');
    tl.className = 'card-lbl tag-lbl';
    if (todo.tag) {
      tl.textContent = '#' + (todo.tag.length > 6 ? todo.tag.slice(0,6)+'…' : todo.tag);
      tl.classList.add('has-tag');
    } else {
      tl.textContent = '+ 标签';
      tl.style.opacity = '0.5';
    }
    tl.onclick = (e) => { e.stopPropagation(); openEditPopup(todo.id, 'tag'); };
    labels.appendChild(tl);

    // 备注标签（有备注显示内容，没有也显示入口）
    const nl = document.createElement('span');
    nl.className = 'card-lbl note-lbl';
    if (todo.note) {
      nl.textContent = todo.note.length > 8 ? todo.note.slice(0,8)+'…' : todo.note;
    } else {
      nl.textContent = '+ 备注';
      nl.style.opacity = '0.5';
    }
    nl.onclick = (e) => { e.stopPropagation(); openEditPopup(todo.id, 'note'); };
    labels.appendChild(nl);

    body.appendChild(labels);

    // Images (inline with content)
    const allImages = [...(todo.images || []), ...(todo.noteImages || [])];
    if (allImages.length > 0) {
      const imgContainer = document.createElement('div');
      imgContainer.className = 'card-images';
      allImages.forEach(filename => {
        const wrap = document.createElement('div');
        wrap.className = 'card-img-wrap';
        wrap.dataset.filename = filename;
        const img = document.createElement('img');
        img.className = 'card-img';
        window.api.getImagePath(filename).then(p => {
          img.src = 'file://' + p;
          wrap.dataset.path = p;
        });
        // 删除按钮（hover 显示）
        const del = document.createElement('button');
        del.className = 'card-img-del';
        del.innerHTML = '\u00d7';
        wrap.appendChild(img);
        wrap.appendChild(del);
        imgContainer.appendChild(wrap);
      });
      body.appendChild(imgContainer);
    }

    // Delete
    const del = document.createElement('button');
    del.className = 'card-delete';
    del.innerHTML = '×';
    del.onclick = (e) => { e.stopPropagation(); deleteTodo(todo.id); };

    card.appendChild(check);
    card.appendChild(body);
    card.appendChild(del);

    // Drag（仅 active 且默认排序模式）
    if (!isDone && sortMode === 'default') setupDrag(card, todo);

    return card;
  }

  function renderTextWithLinks(todo) {
    let text = escHtml(todo.text);
    if (todo.links && todo.links.length > 0) {
      for (const link of todo.links) {
        const display = link.title || shortenUrl(link.url);
        const linkHtml = `<a class="card-link" data-url="${escAttr(link.url)}">${escHtml(display)}</a>`;
        // 优先用 rawText（原始匹配文本）替换，兼容无协议 URL
        const searchText = escHtml(link.rawText || link.url);
        text = text.replace(searchText, linkHtml);
      }
    }
    return text;
  }

  function shortenUrl(url) {
    // 学城链接特殊处理：显示为"学城文档"而非长 URL
    const kmId = extractKmContentId(url);
    if (kmId) return '学城文档';
    try { const u = new URL(url); let s = u.hostname + u.pathname; return s.length > 28 ? s.slice(0,26)+'…' : s; }
    catch { return url.slice(0, 28); }
  }

  // ===================== Drag & Drop (pointer events) =====================
  let _drag = null; // { id, card, startY, clone, indicator, started }

  function setupDrag(card, todo) {
    // 使用 pointer events 实现手动拖拽，避免 Electron 原生 DnD 的各种问题
    let pendingDrag = null;

    card.addEventListener('pointerdown', (e) => {
      // 忽略交互元素上的按下
      if (e.target.closest('button, select, a, input, textarea, .card-check, .card-delete, .card-img-del, .lbl-native-select')) return;
      if (e.button !== 0) return;
      // 不在这里 preventDefault — 让 click 等事件正常触发
      pendingDrag = { startY: e.clientY, pointerId: e.pointerId };
    });

    card.addEventListener('pointermove', (e) => {
      // 阶段1：还未确认拖拽，检查是否超过阈值
      if (pendingDrag && !_drag) {
        const dy = e.clientY - pendingDrag.startY;
        if (Math.abs(dy) < 6) return;
        // 确认开始拖拽
        card.setPointerCapture(pendingDrag.pointerId);
        _drag = {
          id: todo.id, card,
          startY: pendingDrag.startY,
          origTop: card.getBoundingClientRect().top,
          clone: null, indicator: null, targetId: null, insertBefore: true
        };
        pendingDrag = null;
        // 创建拖拽幽灵
        const clone = card.cloneNode(true);
        clone.className = 'todo-card drag-clone';
        clone.style.cssText = `position:fixed;left:${card.getBoundingClientRect().left}px;top:${card.getBoundingClientRect().top}px;width:${card.offsetWidth}px;opacity:0.85;pointer-events:none;z-index:9999;transition:none;`;
        document.body.appendChild(clone);
        _drag.clone = clone;
        card.classList.add('dragging');
      }
      // 阶段2：拖拽进行中
      if (_drag && _drag.id === todo.id) {
        const dy = e.clientY - _drag.startY;
        if (_drag.clone) _drag.clone.style.top = (_drag.origTop + dy) + 'px';
        updateDropTarget(e.clientY);
      }
    });

    card.addEventListener('pointerup', (e) => {
      if (pendingDrag) pendingDrag = null; // 没有开始拖拽，让 click 正常触发
      if (_drag && _drag.id === todo.id) {
        card.releasePointerCapture(e.pointerId);
        finishDrag();
      }
    });

    card.addEventListener('pointercancel', () => {
      pendingDrag = null;
      if (_drag && _drag.id === todo.id) finishDrag();
    });
  }

  function updateDropTarget(clientY) {
    if (!_drag) return;
    // 移除旧 indicator
    if (_drag.indicator) { _drag.indicator.remove(); _drag.indicator = null; }
    // 遍历所有非拖拽中的卡片，找到目标
    const cards = [...elListArea.querySelectorAll('.todo-card:not(.dragging)')];
    let targetCard = null;
    let insertBefore = true;
    for (const c of cards) {
      const rect = c.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        targetCard = c;
        insertBefore = true;
        break;
      }
      targetCard = c;
      insertBefore = false;
    }
    if (!targetCard) return;
    const targetId = targetCard.dataset.id;
    if (targetId === _drag.id) return;
    _drag.targetId = targetId;
    _drag.insertBefore = insertBefore;
    // 显示 indicator
    const indicator = document.createElement('div');
    indicator.className = 'drag-indicator';
    if (insertBefore) {
      targetCard.parentNode.insertBefore(indicator, targetCard);
    } else {
      targetCard.parentNode.insertBefore(indicator, targetCard.nextSibling);
    }
    _drag.indicator = indicator;
  }

  function finishDrag() {
    if (!_drag) return;
    const { id, card, clone, indicator, targetId, insertBefore } = _drag;
    // 清理 DOM
    if (clone) clone.remove();
    if (indicator) indicator.remove();
    card.classList.remove('dragging');
    // 执行排序
    if (targetId && targetId !== id) {
      reorder(id, targetId, insertBefore);
    }
    _drag = null;
  }

  function reorder(fromId, toId, insertBefore) {
    // 先按当前渲染顺序获取 active 列表（已排序后的，与 render 一致）
    const todayKey = dateKey(new Date());
    const repeatDoneTodayCheck = (t) => t.repeat && t.ddl && isRepeatDoneForDate(t, todayKey);
    // 只对可见的活跃待办排序（循环待办今天完成的不参与拖拽）
    const active = todos.filter(t => !t.done && !repeatDoneTodayCheck(t));

    const hasManualOrder = active.some(t => t.order > 0);
    if (hasManualOrder) {
      active.sort((a, b) => {
        if (a.order > 0 && b.order > 0) return a.order - b.order;
        if (a.order > 0 && b.order === 0) return -1;
        if (a.order === 0 && b.order > 0) return 1;
        return autoCompare(a, b);
      });
    } else {
      active.sort((a, b) => autoCompare(a, b));
    }

    const fromIdx = active.findIndex(t => t.id === fromId);
    const toIdx = active.findIndex(t => t.id === toId);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;

    // 从当前位置取出
    const [moved] = active.splice(fromIdx, 1);
    // 找到目标位置（splice后 toId 可能已偏移，重新找）
    let newToIdx = active.findIndex(t => t.id === toId);
    if (newToIdx < 0) newToIdx = active.length;
    const insertIdx = insertBefore ? newToIdx : newToIdx + 1;
    active.splice(insertIdx, 0, moved);

    // 给所有 active 设置 order（1-based），确保写入原始 todos 数组
    active.forEach((t, i) => { t.order = i + 1; });

    render(); save();
  }

  // ===================== Actions =====================

  // 辅助：获取给定日期的 dateKey（用于循环待办 completedDates）
  // 格式与 ds() 一致：YYYY-M-D（M 为 0-indexed 月份）
  function dateKey(date) {
    const d = date instanceof Date ? date : new Date(date);
    return ds(d);
  }

  // 循环待办：获取指定日期是否已完成
  function isRepeatDoneForDate(todo, dateStr) {
    return todo.completedDates && todo.completedDates.includes(dateStr);
  }

  // 循环待办：获取当前应该显示的"目标日期"（列表视图用今天，日历视图用选中日期）
  function getRepeatTargetDate() {
    if (viewMode === 'calendar' && cvSelectedDate) {
      const parts = cvSelectedDate.split('-');
      return new Date(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]));
    }
    return new Date();
  }

  function toggleDone(id, forDateStr) {
    const t = todos.find(x => x.id === id);
    if (!t) return;

    // 循环待办：使用 completedDates 机制
    if (t.repeat && t.ddl) {
      if (!t.completedDates) t.completedDates = [];
      const targetDate = forDateStr || dateKey(new Date());
      const idx = t.completedDates.indexOf(targetDate);
      if (idx === -1) {
        // 标记该天为已完成
        t.completedDates.push(targetDate);
      } else {
        // 撤回该天的完成
        t.completedDates.splice(idx, 1);
      }
      // 循环待办永远不设置 t.done = true
      t.done = false;
    } else {
      // 普通待办：正常切换
      t.done = !t.done;
      if (t.done) t.order = 0;
    }

    render(); save();
    if (viewMode === 'calendar') renderCalView();
  }

  function deleteTodo(id) {
    todos = todos.filter(x => x.id !== id);
    render(); save();
    if (viewMode === 'calendar') renderCalView();
  }

  // ===================== Done Section Toggle =====================
  function toggleDoneSection() {
    doneExpanded = !doneExpanded;
    elDoneList.classList.toggle('hidden', !doneExpanded);
    elDoneArrow.classList.toggle('open', doneExpanded);
    // 展开时显示清空按钮
    $('#done-clear').classList.toggle('hidden', !doneExpanded);
    requestAnimationFrame(adjustWindowHeight);
  }

  function clearDoneTodos() {
    const todayKey = dateKey(new Date());
    const doneCount = todos.filter(x => x.done).length;
    const repeatDoneCount = todos.filter(x => !x.done && x.repeat && x.ddl && isRepeatDoneForDate(x, todayKey)).length;
    if (doneCount === 0 && repeatDoneCount === 0) return;
    // 删除普通已完成待办
    todos = todos.filter(x => !x.done);
    // 撤回循环待办今天的完成记录
    todos.forEach(t => {
      if (t.repeat && t.ddl && t.completedDates) {
        const idx = t.completedDates.indexOf(todayKey);
        if (idx !== -1) t.completedDates.splice(idx, 1);
      }
    });
    render(); save();
    if (viewMode === 'calendar') renderCalView();
  }

  // ===================== Calendar View =====================
  function toggleViewMode() {
    viewMode = viewMode === 'list' ? 'calendar' : 'list';
    if (viewMode === 'calendar') {
      elListArea.style.display = 'none';
      elDoneSection.style.display = 'none';
      $('#cal-view').classList.remove('hidden');
      cvMonth = new Date();
      cvSelectedDate = ds(new Date());
      renderCalView();
    } else {
      elListArea.style.display = '';
      elDoneSection.style.display = '';
      $('#cal-view').classList.add('hidden');
      render();
    }
    updateViewBtn();
    requestAnimationFrame(adjustWindowHeight);
  }

  // 构建日历的待办日期索引（含循环待办展开）
  function buildTodosByDate() {
    const map = {};
    const viewStart = new Date(cvMonth.getFullYear(), cvMonth.getMonth() - 1, 1);
    const viewEnd = new Date(cvMonth.getFullYear(), cvMonth.getMonth() + 2, 0);

    todos.forEach(t => {
      if (!t.ddl) return;
      const key = ds(new Date(t.ddl));
      if (!map[key]) map[key] = [];
      map[key].push(t);

      // 循环待办：在日历范围内展开未来日期
      if (t.repeat && !t.done) {
        const step = t.repeat === 'daily' ? 1 : 7;
        let next = new Date(t.ddl);
        for (let i = 0; i < 60; i++) { // 最多展开60次
          next = new Date(next.getTime() + step * 86400000);
          if (next > viewEnd) break;
          if (next < viewStart) continue;
          const nk = ds(next);
          if (nk === key) continue; // 跳过原始日期
          if (!map[nk]) map[nk] = [];
          // 避免重复添加
          if (!map[nk].some(x => x.id === t.id)) {
            map[nk].push(t);
          }
        }
      }
    });
    return map;
  }

  function renderCalView() {
    const y = cvMonth.getFullYear(), m = cvMonth.getMonth();
    $('#cv-title').textContent = `${y}年${m + 1}月`;

    const grid = $('#cv-grid');
    grid.innerHTML = '';

    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const prevDays = new Date(y, m, 0).getDate();
    const todayStr = ds(new Date());
    const todosByDate = buildTodosByDate();

    // 上月填充
    for (let i = firstDay - 1; i >= 0; i--) {
      const day = prevDays - i;
      const d = new Date(y, m - 1, day);
      grid.appendChild(createCvCell(d, day, true, todayStr, todosByDate));
    }
    // 本月
    for (let i = 1; i <= daysInMonth; i++) {
      const d = new Date(y, m, i);
      grid.appendChild(createCvCell(d, i, false, todayStr, todosByDate));
    }
    // 下月填充
    const total = grid.children.length;
    const rem = (7 - total % 7) % 7;
    for (let i = 1; i <= rem; i++) {
      const d = new Date(y, m + 1, i);
      grid.appendChild(createCvCell(d, i, true, todayStr, todosByDate));
    }

    renderCvDayDetail(todosByDate);

    // 更新"今天"按钮状态：如果当前选中的就是今天且在本月，则灰显
    const todayBtn = $('#cv-today');
    const isOnToday = cvSelectedDate === todayStr &&
      cvMonth.getFullYear() === new Date().getFullYear() &&
      cvMonth.getMonth() === new Date().getMonth();
    todayBtn.classList.toggle('inactive', isOnToday);
  }

  function createCvCell(date, dayNum, isOtherMonth, todayStr, todosByDate) {
    const key = ds(date);
    const cell = document.createElement('div');
    cell.className = 'cv-cell';
    if (isOtherMonth) cell.classList.add('other-month');
    if (key === todayStr) cell.classList.add('today');
    if (key === cvSelectedDate) cell.classList.add('selected');

    const dayEl = document.createElement('span');
    dayEl.className = 'cv-cell-day';
    dayEl.textContent = dayNum;
    cell.appendChild(dayEl);

    const dayTodos = todosByDate[key];
    if (dayTodos && dayTodos.length > 0) {
      const dots = document.createElement('div');
      dots.className = 'cv-dots';
      const cellDateKey = dateKey(date);
      const undone = dayTodos.filter(t => {
        if (t.repeat && t.ddl) return !isRepeatDoneForDate(t, cellDateKey);
        return !t.done;
      });
      const doneCount = dayTodos.length - undone.length;
      const maxDots = 3;
      undone.slice(0, maxDots).forEach(t => {
        const dot = document.createElement('span');
        dot.className = 'cv-dot ' + (t.priority || 'normal');
        dots.appendChild(dot);
      });
      if (doneCount > 0) {
        const dot = document.createElement('span');
        dot.className = 'cv-dot done';
        dots.appendChild(dot);
      }
      // 超出时显示 +N
      const extra = undone.length - maxDots;
      if (extra > 0) {
        const more = document.createElement('span');
        more.className = 'cv-dot-more';
        more.textContent = `+${extra}`;
        dots.appendChild(more);
      }
      cell.appendChild(dots);
    }

    cell.onclick = () => {
      cvSelectedDate = key;
      $$('.cv-cell.selected').forEach(c => c.classList.remove('selected'));
      cell.classList.add('selected');
      renderCvDayDetail(todosByDate);
    };

    return cell;
  }

  function renderCvDayDetail(todosByDate) {
    const detail = $('#cv-day-detail');
    const titleEl = $('#cv-day-title');
    const listEl = $('#cv-day-list');

    if (!cvSelectedDate) { detail.classList.add('hidden'); return; }

    const dayTodos = todosByDate[cvSelectedDate] || [];

    // 从 ds 格式解析日期 (YYYY-M-D)
    const parts = cvSelectedDate.split('-');
    const selDate = new Date(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]));
    const weekdays = ['日','一','二','三','四','五','六'];

    // 标题行：日期信息
    titleEl.textContent = `${selDate.getMonth()+1}月${selDate.getDate()}日 周${weekdays[selDate.getDay()]}` +
      (dayTodos.length ? ` · ${dayTodos.length}条` : '');

    renderCvDayListOnly(dayTodos);
    detail.classList.remove('hidden');
    requestAnimationFrame(adjustWindowHeight);
  }

  // 日历视图仅重新渲染列表项（复用顶部全局 sortMode）
  function renderCvDayListOnly(dayTodos) {
    const listEl = $('#cv-day-list');
    listEl.innerHTML = '';
    if (!dayTodos || dayTodos.length === 0) {
      listEl.innerHTML = '<div class="cv-empty">暂无待办</div>';
      return;
    }

    // 当前选中日期的 dateKey（cvSelectedDate 已是 ds() 格式，直接使用）
    const selDateKey = cvSelectedDate || dateKey(new Date());

    // 辅助：判断某条待办在选中日期是否"已完成"
    function isDoneForDay(t) {
      if (t.repeat && t.ddl) return isRepeatDoneForDate(t, selDateKey);
      return t.done;
    }

    // 排序逻辑：复用全局 sortMode（与待办模式完全一致）
    const priOrder = { urgent: 0, important: 1, normal: 2 };
    const sorted = [...dayTodos].sort((a, b) => {
      // 未完成始终在前
      const aDone = isDoneForDay(a), bDone = isDoneForDay(b);
      if (aDone !== bDone) return aDone ? 1 : -1;
      if (sortMode === 'pri-asc') return (priOrder[b.priority] ?? 2) - (priOrder[a.priority] ?? 2);
      if (sortMode === 'pri-desc') return (priOrder[a.priority] ?? 2) - (priOrder[b.priority] ?? 2);
      if (sortMode === 'ddl-asc') {
        if (a.ddlHasTime && b.ddlHasTime) return a.ddl - b.ddl;
        if (a.ddlHasTime) return -1;
        if (b.ddlHasTime) return 1;
        return 0;
      }
      if (sortMode === 'ddl-desc') {
        if (a.ddlHasTime && b.ddlHasTime) return b.ddl - a.ddl;
        if (a.ddlHasTime) return -1;
        if (b.ddlHasTime) return 1;
        return 0;
      }
      // default: 时间优先 → 优先级
      if (a.ddlHasTime && b.ddlHasTime) return a.ddl - b.ddl;
      if (a.ddlHasTime) return -1;
      if (b.ddlHasTime) return 1;
      return (priOrder[a.priority] ?? 2) - (priOrder[b.priority] ?? 2);
    });

    sorted.forEach(t => {
      const done = isDoneForDay(t);
      const item = document.createElement('div');
      item.className = 'cv-day-item' + (done ? ' completed' : '');
      item.dataset.id = t.id;

      // 左侧勾选框
      const check = document.createElement('div');
      check.className = 'cv-item-check';
      if (done) check.classList.add('checked');
      check.style.borderColor = done ? 'var(--text-faint)' :
        t.priority === 'urgent' ? 'var(--red)' :
        t.priority === 'important' ? 'var(--orange)' : 'var(--blue)';
      if (done) check.style.background = 'var(--text-faint)';
      check.onclick = (e) => {
        e.stopPropagation();
        toggleDone(t.id, selDateKey);
      };
      item.appendChild(check);

      // 内容区
      const content = document.createElement('div');
      content.className = 'cv-item-content';

      const textEl = document.createElement('span');
      textEl.className = 'cv-item-text';
      // 与待办模式一致：链接渲染为标题
      textEl.innerHTML = renderTextWithLinks(t);
      // 双击编辑
      textEl.ondblclick = (e) => {
        e.stopPropagation();
        startCvInlineEdit(textEl, t);
      };
      content.appendChild(textEl);

      // 底部信息行：时间 + 循环标记
      const meta = document.createElement('div');
      meta.className = 'cv-item-meta';
      if (t.ddlHasTime) {
        const dd = new Date(t.ddl);
        meta.textContent = `${String(dd.getHours()).padStart(2,'0')}:${String(dd.getMinutes()).padStart(2,'0')}`;
      }
      if (t.repeat) {
        meta.textContent += (meta.textContent ? ' · ' : '') + (t.repeat === 'daily' ? '每天' : '每周');
      }
      if (meta.textContent) content.appendChild(meta);

      item.appendChild(content);

      // 右侧跳转按钮
      const goBtn = document.createElement('span');
      goBtn.className = 'cv-item-go';
      goBtn.textContent = '›';
      goBtn.title = '在列表中查看';
      goBtn.onclick = (e) => {
        e.stopPropagation();
        viewMode = 'list';
        updateViewBtn();
        elListArea.style.display = '';
        elDoneSection.style.display = '';
        $('#cal-view').classList.add('hidden');
        render();
        setTimeout(() => {
          const card = document.querySelector(`[data-id="${t.id}"]`);
          if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.style.boxShadow = '0 0 0 2px var(--blue)';
            setTimeout(() => { card.style.boxShadow = ''; }, 1500);
          }
        }, 100);
      };
      item.appendChild(goBtn);

      listEl.appendChild(item);
    });
  }

  // 日历视图内联编辑
  function startCvInlineEdit(el, todo) {
    if (el.classList.contains('cv-editing')) return;
    el.classList.add('cv-editing');
    el.contentEditable = 'true';
    el.style.whiteSpace = 'normal';
    el.textContent = todo.text;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);

    const finish = () => {
      el.contentEditable = 'false';
      el.classList.remove('cv-editing');
      el.style.whiteSpace = '';
      const newText = el.textContent.trim();
      if (newText && newText !== todo.text) {
        todo.text = newText;
        todo.links = detectLinks(newText);
        save();
        if (todo.links.length > 0) fetchTitlesForTodo(todo.id);
      }
      // 恢复为渲染链接的 HTML（与初始渲染一致）
      el.innerHTML = renderTextWithLinks(todo);
      el.removeEventListener('blur', finish);
      el.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(); }
      if (e.key === 'Escape') { el.textContent = todo.text; finish(); }
    };
    el.addEventListener('blur', finish);
    el.addEventListener('keydown', onKey);
  }

  // ===================== Window Height =====================
  let resizeTimer = null;
  async function adjustWindowHeight() {
    // 纯折叠状态（没有在添加面板）不调整
    const app = document.getElementById('app');
    if (isCollapsed && !app.classList.contains('collapsed-adding')) return;
    // 防抖
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(async () => {
      const contentH = app.scrollHeight + 2;
      const bounds = await window.api.getBounds();
      if (!bounds) return;
      // 添加面板模式（折叠或普通）：完全适应内容高度
      if (app.classList.contains('collapsed-adding') || app.classList.contains('panel-adding')) {
        const targetH = Math.max(100, Math.min(contentH, 700));
        if (Math.abs(targetH - bounds.height) > 5) {
          window.api.resizeHeight(targetH);
        }
        return;
      }
      // 普通模式下：计算目标高度
      let targetH = Math.max(180, Math.min(contentH, 700));
      if (Math.abs(targetH - bounds.height) > 5) {
        window.api.resizeHeight(targetH);
      }
    }, 60);
  }

  // ===================== Collapse / Expand =====================
  let isCollapsed = false;
  let preCollapseHeight = null;

  function toggleCollapse() {
    const app = document.getElementById('app');
    isCollapsed = !isCollapsed;
    app.classList.toggle('collapsed', isCollapsed);
    if (isCollapsed) {
      // 收起前先关闭添加面板
      if (panelOpen) closePanel();
      // 记住当前高度，收起为只留 header + 菜单透明区域
      window.api.getBounds().then(b => {
        if (b) preCollapseHeight = b.height;
        window.api.resizeHeight(COLLAPSED_WIN_H);
      });
      // 启用鼠标穿透：透明区域不拦截鼠标事件
      enableCollapsedMouseForward();
    } else {
      // 恢复高度
      const restoreH = preCollapseHeight || 420;
      preCollapseHeight = null;
      window.api.resizeHeight(restoreH);
      setTimeout(() => requestAnimationFrame(adjustWindowHeight), 100);
      // 关闭鼠标穿透
      disableCollapsedMouseForward();
    }
    updateViewBtn();
    updateCollapsedDisabledState();
  }

  // 折叠模式鼠标穿透：透明区域不拦截鼠标，有内容区域恢复拦截
  let _mouseForwardActive = false;
  function enableCollapsedMouseForward() {
    _mouseForwardActive = true;
    window.api.setIgnoreMouseEvents(true, { forward: true });
    document.body.classList.add('collapsed-forward');
  }
  function disableCollapsedMouseForward() {
    _mouseForwardActive = false;
    window.api.setIgnoreMouseEvents(false);
    document.body.classList.remove('collapsed-forward');
  }

  // 当鼠标移入有内容区域时恢复鼠标事件拦截，移出时重新穿透
  document.addEventListener('mouseenter', (e) => {
    if (!_mouseForwardActive) return;
    const el = e.target;
    if (el.closest('.header') || el.closest('.sort-menu') || el.closest('.view-menu') || el.closest('.add-panel')) {
      window.api.setIgnoreMouseEvents(false);
    }
  }, true);
  document.addEventListener('mouseleave', (e) => {
    if (!_mouseForwardActive) return;
    const el = e.target;
    if (el.closest('.header') || el.closest('.sort-menu') || el.closest('.view-menu') || el.closest('.add-panel')) {
      // 检查鼠标是否还在其他可交互元素上
      const related = e.relatedTarget;
      if (!related || !(related.closest('.header') || related.closest('.sort-menu') || related.closest('.view-menu') || related.closest('.add-panel'))) {
        window.api.setIgnoreMouseEvents(true, { forward: true });
      }
    }
  }, true);

  function updateCollapsedDisabledState() {
    // 排序按钮在折叠模式下也可用（改变排序后展开列表即可看到效果）
  }

  function updateViewBtn() {
    const btn = $('#btn-view');
    if (!btn) return;
    if (isCollapsed) {
      btn.textContent = '📌';
      btn.classList.add('active');
    } else if (viewMode === 'calendar') {
      btn.textContent = '📅';
      btn.classList.add('active');
    } else {
      btn.textContent = '📋';
      btn.classList.remove('active');
    }
  }

  function updateViewMenuOptions() {
    const menu = document.getElementById('view-menu');
    if (!menu) return;
    const listOpt = menu.querySelector('[data-mode="list"]');
    const calOpt = menu.querySelector('[data-mode="calendar"]');
    const colOpt = menu.querySelector('[data-mode="collapse"]');
    // 根据当前状态，动态显示/隐藏和高亮
    if (listOpt) {
      listOpt.classList.toggle('active', !isCollapsed && viewMode !== 'calendar');
    }
    if (calOpt) {
      calOpt.classList.toggle('active', !isCollapsed && viewMode === 'calendar');
    }
    if (colOpt) {
      colOpt.textContent = isCollapsed ? '📌 展开' : '📌 折叠';
      colOpt.classList.toggle('active', isCollapsed);
    }
  }

  // ===================== Inline Edit =====================
  function startInlineEdit(el, todo) {
    if (el.classList.contains('editing')) return;
    el.classList.add('editing');
    el.contentEditable = 'true';
    el.textContent = todo.text;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);

    const finish = () => {
      el.contentEditable = 'false';
      el.classList.remove('editing');
      const newText = el.textContent.trim();
      if (newText && newText !== todo.text) {
        todo.text = newText;
        todo.links = detectLinks(newText);
        render(); save();
        if (todo.links.length > 0) fetchTitlesForTodo(todo.id);
      } else {
        el.innerHTML = renderTextWithLinks(todo);
      }
      el.removeEventListener('blur', finish);
      el.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(); }
      if (e.key === 'Escape') { el.textContent = todo.text; finish(); }
    };
    el.addEventListener('blur', finish);
    el.addEventListener('keydown', onKey);
  }

  // ===================== Inline Edit Popup (轻量气泡) =====================
  let activePopover = null;

  let activePopoverCleanups = [];
  function closePopover() {
    activePopoverCleanups.forEach(fn => fn());
    activePopoverCleanups = [];
    if (activePopover) {
      activePopover.remove();
      activePopover = null;
    }
    document.removeEventListener('click', onDocClickClosePopover);
  }

  function onDocClickClosePopover(e) {
    if (activePopover && !activePopover.contains(e.target)) {
      closePopover();
    }
  }

  function openEditPopup(id, field) {
    closePopover();
    const todo = todos.find(t => t.id === id);
    if (!todo) return;

    // 找到对应卡片和标签元素
    const card = elListArea.querySelector(`.todo-card[data-id="${id}"]`)
      || elDoneList.querySelector(`.todo-card[data-id="${id}"]`);
    if (!card) return;

    const popover = document.createElement('div');
    popover.className = 'inline-popover';

    if (field === 'priority') {
      popover.innerHTML = `
        <select class="ip-select-pri">
          <option value="urgent"${todo.priority==='urgent'?' selected':''}>紧急</option>
          <option value="important"${todo.priority==='important'?' selected':''}>重要</option>
          <option value="normal"${todo.priority==='normal'?' selected':''}>普通</option>
        </select>`;
      const sel = popover.querySelector('.ip-select-pri');
      sel.onchange = (e) => {
        e.stopPropagation();
        todo.priority = sel.value;
        closePopover(); render(); save();
        if (viewMode === 'calendar') renderCalView();
      };
      // 自动打开下拉
      setTimeout(() => sel.focus(), 30);
    } else if (field === 'ddl') {
      popover.classList.add('ip-ddl-popover');
      const cur = todo.ddl ? new Date(todo.ddl) : null;
      let editDdlDate = cur ? new Date(cur.getFullYear(), cur.getMonth(), cur.getDate()) : null;
      let editDdlH = cur && todo.ddlHasTime ? cur.getHours() : null;
      let editDdlM = cur && todo.ddlHasTime ? cur.getMinutes() : null;
      let editCalMonth = editDdlDate ? new Date(editDdlDate) : new Date();

      popover.innerHTML = `
        <div class="ip-quick-dates">
          <button class="ip-qd" data-d="0">今天</button>
          <button class="ip-qd" data-d="1">明天</button>
          <button class="ip-qd" data-d="2">后天</button>
          <button class="ip-qd" data-d="next-mon">下周一</button>
          <button class="ip-qd ip-qd-clear" data-d="clear">清除</button>
        </div>
        <div class="ip-cal-nav">
          <button class="ip-cal-prev">‹</button>
          <span class="ip-cal-title"></span>
          <button class="ip-cal-next">›</button>
        </div>
        <div class="ip-cal-wk"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div>
        <div class="ip-cal-grid"></div>
        <div class="ip-wheel-container"></div>
        <div class="time-repeat-row">
          <span class="tr-lbl">循环</span>
          <select class="ip-sel-repeat tr-select">
            <option value="">不循环</option>
            <option value="daily"${todo.repeat === 'daily' ? ' selected' : ''}>每天</option>
            <option value="weekly"${todo.repeat === 'weekly' ? ' selected' : ''}>每周</option>
          </select>
        </div>
        <div class="ip-foot"><button class="ip-save">确定</button></div>`;

      // 时间滚轮选择器
      const editWheelContainer = popover.querySelector('.ip-wheel-container');
      let editHasTime = editDdlH != null;
      const editWheelPicker = createTimeWheelPicker(
        editWheelContainer, editDdlH || 0, editDdlM || 0, () => { editHasTime = true; }
      );
      if (editDdlH != null) {
        editWheelPicker.setTime(editDdlH, editDdlM || 0);
      }
      activePopoverCleanups.push(() => editWheelPicker.destroy());

      // 循环下拉框逻辑
      let editRepeat = todo.repeat || null;
      const selRepeat = popover.querySelector('.ip-sel-repeat');
      selRepeat.onchange = (ev) => { ev.stopPropagation(); editRepeat = selRepeat.value || null; };

      // 渲染迷你日历
      function renderEditCal() {
        const y = editCalMonth.getFullYear(), m = editCalMonth.getMonth();
        popover.querySelector('.ip-cal-title').textContent = `${y}年${m+1}月`;
        const grid = popover.querySelector('.ip-cal-grid');
        grid.innerHTML = '';
        const firstDay = new Date(y, m, 1).getDay();
        const daysInMonth = new Date(y, m+1, 0).getDate();
        const prevDays = new Date(y, m, 0).getDate();
        const todayDate = new Date(); todayDate.setHours(0,0,0,0);
        const selStr = editDdlDate ? ds(editDdlDate) : '';

        for (let i = firstDay - 1; i >= 0; i--) {
          const btn = document.createElement('button');
          btn.className = 'cal-d ot'; btn.textContent = prevDays - i;
          grid.appendChild(btn);
        }
        for (let i = 1; i <= daysInMonth; i++) {
          const d = new Date(y, m, i);
          const btn = document.createElement('button');
          btn.className = 'cal-d';
          if (ds(d) === ds(todayDate)) btn.classList.add('today');
          if (ds(d) === selStr) btn.classList.add('sel');
          btn.textContent = i;
          btn.onclick = (ev) => {
            ev.stopPropagation();
            editDdlDate = d;
            popover.querySelectorAll('.ip-qd').forEach(x => x.classList.remove('active'));
            renderEditCal();
          };
          grid.appendChild(btn);
        }
        const total = grid.children.length;
        const rem = (7 - total % 7) % 7;
        for (let i = 1; i <= rem; i++) {
          const btn = document.createElement('button');
          btn.className = 'cal-d ot'; btn.textContent = i;
          grid.appendChild(btn);
        }
      }

      // 快捷日期
      updateQuickDateLabels(popover.querySelectorAll('.ip-qd'));
      popover.querySelectorAll('.ip-qd').forEach(b => {
        b.onclick = (ev) => {
          ev.stopPropagation();
          const d = b.dataset.d;
          if (d === 'clear') {
            editDdlDate = null;
            popover.querySelectorAll('.ip-qd').forEach(x => x.classList.remove('active'));
            renderEditCal();
            return;
          }
          const td = new Date(); td.setHours(0,0,0,0);
          if (d === 'next-mon') {
            const day = td.getDay();
            td.setDate(td.getDate() + (day === 0 ? 1 : 8 - day));
          } else {
            td.setDate(td.getDate() + parseInt(d));
          }
          editDdlDate = td;
          editCalMonth = new Date(td);
          popover.querySelectorAll('.ip-qd').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
          renderEditCal();
        };
      });

      // 日历导航
      popover.querySelector('.ip-cal-prev').onclick = (ev) => { ev.stopPropagation(); editCalMonth.setMonth(editCalMonth.getMonth()-1); renderEditCal(); };
      popover.querySelector('.ip-cal-next').onclick = (ev) => { ev.stopPropagation(); editCalMonth.setMonth(editCalMonth.getMonth()+1); renderEditCal(); };

      // 确定按钮
      popover.querySelector('.ip-save').onclick = (e) => {
        e.stopPropagation();
        if (editDdlDate) {
          const d = new Date(editDdlDate);
          if (editHasTime && editWheelPicker) {
            d.setHours(editWheelPicker.getHour(), editWheelPicker.getMinute(), 0, 0);
            todo.ddlHasTime = true;
          } else {
            d.setHours(0, 0, 0, 0);
            todo.ddlHasTime = false;
          }
          todo.ddl = d.getTime();
        } else {
          todo.ddl = null; todo.ddlHasTime = false;
        }
        // 保存循环设置
        todo.repeat = editRepeat;
        closePopover(); render(); save();
      };

      renderEditCal();
    } else if (field === 'repeat') {
      popover.innerHTML = `
        <select class="ip-select-repeat">
          <option value=""${!todo.repeat?' selected':''}>不循环</option>
          <option value="daily"${todo.repeat==='daily'?' selected':''}>每天</option>
          <option value="weekly"${todo.repeat==='weekly'?' selected':''}>每周</option>
        </select>`;
      const sel = popover.querySelector('.ip-select-repeat');
      sel.onchange = (e) => {
        e.stopPropagation();
        todo.repeat = sel.value || null;
        closePopover(); render(); save();
        if (viewMode === 'calendar') renderCalView();
      };
      setTimeout(() => sel.focus(), 30);
    } else if (field === 'note') {
      popover.innerHTML = `<input type="text" class="ip-note" value="${escAttr(todo.note||'')}" placeholder="备注..." />`;
      const inp = popover.querySelector('.ip-note');
      setTimeout(() => inp.focus(), 50);
      inp.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); todo.note = inp.value.trim() || null; closePopover(); render(); save(); }
        if (e.key === 'Escape') { closePopover(); }
      };
      inp.onblur = () => { todo.note = inp.value.trim() || null; closePopover(); render(); save(); };
    } else if (field === 'tag') {
      const existingTags = getExistingTags();
      let sugHtml = '';
      if (existingTags.length > 0) {
        sugHtml = `<div class="ip-tag-suggestions">${existingTags.map(t => `<button class="ip-tag-sug" data-tag="${escAttr(t)}">${escHtml(t)}</button>`).join('')}</div>`;
      }
      popover.innerHTML = `<input type="text" class="ip-tag" value="${escAttr(todo.tag||'')}" placeholder="输入标签名..." />${sugHtml}<button class="ip-tag-clear">清除标签</button>`;
      const inp = popover.querySelector('.ip-tag');
      setTimeout(() => inp.focus(), 50);
      inp.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); todo.tag = inp.value.trim() || null; closePopover(); render(); save(); }
        if (e.key === 'Escape') { closePopover(); }
      };
      inp.onblur = () => {
        // 延迟关闭以允许点击建议按钮
        setTimeout(() => {
          if (activePopover === popover) {
            todo.tag = inp.value.trim() || null; closePopover(); render(); save();
          }
        }, 150);
      };
      popover.querySelectorAll('.ip-tag-sug').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          inp.value = btn.dataset.tag;
          todo.tag = btn.dataset.tag;
          closePopover(); render(); save();
        };
      });
      popover.querySelector('.ip-tag-clear').onclick = (e) => {
        e.stopPropagation();
        todo.tag = null;
        closePopover(); render(); save();
      };
    }

    // 定位：插入到卡片后面作为兄弟元素，自适应宽度
    popover.style.position = 'relative';
    popover.style.zIndex = '99';
    popover.style.width = '100%';
    popover.style.maxHeight = '50vh';
    popover.style.overflowY = 'auto';
    popover.style.boxSizing = 'border-box';
    card.insertAdjacentElement('afterend', popover);

    // 确保弹层可见（滚动到视图内）
    setTimeout(() => popover.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);

    activePopover = popover;

    // 点击其他区域关闭
    setTimeout(() => document.addEventListener('click', onDocClickClosePopover), 10);
  }

  function closeEditPopup() { closePopover(); }

  // ===================== Format =====================
  function fmtDdl(d, hasTime) {
    const now = new Date();
    const today = new Date(); today.setHours(0,0,0,0);
    const tom = new Date(today); tom.setDate(tom.getDate()+1);
    const dayAfterTom = new Date(today); dayAfterTom.setDate(dayAfterTom.getDate()+2);
    const ddlDay = new Date(d); ddlDay.setHours(0,0,0,0);
    const wkNames = ['日','一','二','三','四','五','六'];

    const time = hasTime ? ` ${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
    if (ddlDay.getTime() === today.getTime()) return `今天${time}`;
    if (ddlDay.getTime() === tom.getTime()) return `明天${time}`;
    if (ddlDay.getTime() === dayAfterTom.getTime()) return `后天${time}`;

    const m = d.getMonth()+1;
    const day = d.getDate();
    const wk = wkNames[d.getDay()];
    if (d.getFullYear() === now.getFullYear()) return `${m}/${day} 周${wk}${time}`;
    return `${d.getFullYear()}/${m}/${day} 周${wk}${time}`;
  }

  function pad(n) { return n < 10 ? '0'+n : ''+n; }
  function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function escAttr(s) { return s.replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  // ===================== Image Handling =====================

  // 从 file 对象读取 base64 并保存
  async function saveFileAsImage(file) {
    if (!file || !file.type.startsWith('image/')) return null;
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        const filename = await window.api.saveImage(base64);
        if (filename) {
          const imgPath = await window.api.getImagePath(filename);
          resolve({ filename, path: imgPath });
        } else {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  // 粘贴事件处理（区分 main / note）
  async function handlePasteImage(e, target) {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        const img = await saveFileAsImage(file);
        if (img) {
          if (target === 'note') {
            curNoteImages.push(img);
            renderInlineImagePreview('note');
          } else {
            curImages.push(img);
            renderInlineImagePreview('main');
          }
        }
        return;
      }
    }
  }

  // 拖放事件处理（默认归到 main）
  async function handleDropImage(e) {
    e.preventDefault();
    elPanel.classList.remove('drop-active');
    const files = e.dataTransfer.files;
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const img = await saveFileAsImage(file);
        if (img) {
          curImages.push(img);
        }
      }
    }
    if (curImages.length > 0) renderInlineImagePreview('main');
  }

  // 渲染内嵌图片预览（紧跟在对应输入框下方）
  function renderInlineImagePreview(target) {
    const images = target === 'note' ? curNoteImages : curImages;
    const className = target === 'note' ? 'note-img-preview' : 'input-img-preview';
    const afterEl = target === 'note' ? $('#note-input') : elInput;

    // 移除旧的预览
    let existing = elPanel.querySelector('.' + className);
    if (existing) existing.remove();

    if (images.length === 0) return;

    const container = document.createElement('div');
    container.className = className + ' inline-img-preview';
    images.forEach((img, idx) => {
      const wrap = document.createElement('div');
      wrap.className = 'img-thumb-wrap';
      const imgEl = document.createElement('img');
      imgEl.className = 'img-thumb';
      imgEl.src = 'file://' + img.path;
      imgEl.onclick = () => openLightbox(img.path);
      const del = document.createElement('button');
      del.className = 'img-thumb-del';
      del.innerHTML = '\u00d7';
      del.onclick = (ev) => {
        ev.stopPropagation();
        images.splice(idx, 1);
        renderInlineImagePreview(target);
      };
      wrap.appendChild(imgEl);
      wrap.appendChild(del);
      container.appendChild(wrap);
    });

    // 插入到输入框后面
    afterEl.parentNode.insertBefore(container, afterEl.nextSibling);
    requestAnimationFrame(adjustWindowHeight);
  }

  // 从已有 todo 删除图片
  function removeImageFromTodo(todoId, filename) {
    const todo = todos.find(t => t.id === todoId);
    if (!todo) return;
    if (todo.images) todo.images = todo.images.filter(f => f !== filename);
    if (todo.noteImages) todo.noteImages = todo.noteImages.filter(f => f !== filename);
    // 删除文件
    window.api.deleteImage(filename);
    render(); save();
  }

  // 查看大图
  function openLightbox(imgPath) {
    const lb = document.createElement('div');
    lb.className = 'img-lightbox';
    const img = document.createElement('img');
    img.src = 'file://' + imgPath;
    lb.appendChild(img);
    lb.onclick = () => lb.remove();
    document.body.appendChild(lb);
  }

  // ===================== Start =====================
  // 全局错误捕获（方便调试 Windows 问题）
  window.onerror = (msg, src, line, col, err) => {
    console.error('[GLOBAL ERROR]', msg, src, line, col, err && err.stack);
    document.title = '⚠ ' + msg;
  };
  window.onunhandledrejection = (e) => {
    console.error('[UNHANDLED REJECTION]', e.reason);
  };
  init();
})();
