// 日期任务按天比较；未指定时分的任务在同一天内排在最后。
(function (root) {
  function compareDeadlines(a, b, direction = 'asc', sameDay = false) {
    const hasA = a.ddl != null, hasB = b.ddl != null;
    if (hasA !== hasB) return hasA ? -1 : 1;
    if (!hasA) return 0;
    const ad = new Date(a.ddl), bd = new Date(b.ddl);
    const sign = direction === 'desc' ? -1 : 1;
    if (!sameDay) {
      const dayDiff = new Date(ad.getFullYear(), ad.getMonth(), ad.getDate()) -
        new Date(bd.getFullYear(), bd.getMonth(), bd.getDate());
      if (dayDiff) return sign * dayDiff;
    }
    if (!!a.ddlHasTime !== !!b.ddlHasTime) return a.ddlHasTime ? -1 : 1;
    if (!a.ddlHasTime) return 0;
    // 日历中的循环任务沿用原始 DDL，仅比较当天时刻。
    const seconds = d => d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
    return sign * (seconds(ad) - seconds(bd));
  }

  function deadlineMoment(todo) {
    if (todo.ddl == null) return null;
    if (todo.ddlHasTime) return todo.ddl;
    const d = new Date(todo.ddl);
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }

  function isRepeatDoneForDate(todo, dateStr) {
    if (todo.appleReminderId || todo.restoreAppleLink) return false;
    return !!(todo.completedDates && todo.completedDates.includes(dateStr));
  }

  const api = { compareDeadlines, deadlineMoment, isRepeatDoneForDate };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TodoTime = api;
})(typeof window === 'object' ? window : globalThis);
