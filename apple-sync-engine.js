const crypto = require('node:crypto');
const FIELDS = ['text', 'note', 'date', 'priority', 'repeat', 'done'];
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function fields(todo) {
  const today = new Date();
  const key = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  return {
    text: String(todo.text || ''), note: todo.note || '',
    date: { value: todo.ddl ?? null, hasTime: todo.ddl != null && !!todo.ddlHasTime },
    priority: todo.priority || 'normal', repeat: todo.repeat || '',
    done: !!todo.done || (!todo.appleReminderId && !todo.restoreAppleLink && !!todo.repeat && !!todo.completedDates?.includes(key)),
  };
}
function remoteFields(reminder) {
  return Object.fromEntries(FIELDS.map(key => [key, reminder[key]]));
}
function mergeFields(base, local, remote) {
  const merged = {}, conflicts = [], patch = {};
  for (const key of FIELDS) {
    const lc = !equal(local[key], base[key]), rc = !equal(remote[key], base[key]);
    if (lc && rc && !equal(local[key], remote[key])) conflicts.push(key);
    merged[key] = lc ? local[key] : remote[key];
    if (!equal(merged[key], remote[key])) patch[key] = merged[key];
  }
  return { merged, conflicts, patch };
}
function applyFields(todo, next, remote) {
  delete todo.restoreAppleLink;
  Object.assign(todo, { text: next.text, note: next.note || null, ddl: next.date.value,
    ddlHasTime: next.date.hasTime, priority: next.priority, repeat: next.repeat || null, done: next.done,
    appleReminderId: remote.id, appleUrl: remote.url || null, appleRepeatCustom: next.repeat === 'custom' });
  // Link previews are regenerated locally; never retain stale text replacements.
  const matches = todo.text.match(/https?:\/\/[^\s，,；;]+/g) || [];
  todo.links = matches.map(url => ({ url, rawText: url, title: (todo.links || []).find(link => link.url === url)?.title || null }));
  return todo;
}
function createLocal(remote) {
  return applyFields({ id: crypto.randomUUID(), createdAt: Date.now(), order: 0, tagOrder: 0,
    tag: null, images: [], noteImages: [], links: [] }, remoteFields(remote), remote);
}
function fingerprint(todos, reminders) {
  const sort = items => items.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return crypto.createHash('sha256').update(JSON.stringify({
    local: sort(todos.map(t => ({ id: t.id, fields: fields(t) }))),
    remote: sort(reminders.map(r => ({ id: r.id, stamp: r.stamp, fields: remoteFields(r) }))),
  })).digest('hex');
}
// Apply only fields actually edited by this renderer, retaining concurrent sync imports.
function mergeRendererTodos(current, incoming, baseline) {
  if (!Array.isArray(baseline)) return incoming;
  const before = new Map(baseline.map(t => [t.id, t]));
  const now = new Map(current.map(t => [t.id, t]));
  const result = incoming.map(t => {
    const base = before.get(t.id), fresh = now.get(t.id);
    if (!base) return { ...t };
    if (!fresh) return equal(t, base) ? null : { ...t };
    const merged = { ...fresh };
    for (const key of new Set([...Object.keys(base), ...Object.keys(t)])) {
      if (key.startsWith('apple')) continue;
      if (!equal(t[key], base[key])) {
        if (t[key] === undefined) delete merged[key]; else merged[key] = t[key];
      }
    }
    return merged;
  }).filter(Boolean);
  const ids = new Set(result.map(t => t.id));
  for (const t of current) if (!before.has(t.id) && !ids.has(t.id)) result.push(t);
  return result;
}
module.exports = { FIELDS, equal, fields, remoteFields, mergeFields, applyFields, createLocal, fingerprint, mergeRendererTodos };
