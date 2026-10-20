const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compareDeadlines, deadlineMoment, isRepeatDoneForDate } = require('../todo-time');

function task(id, day, hour, minute = 0) {
  return { id, ddl: new Date(2026, 9, day, hour ?? 0, minute).getTime(), ddlHasTime: hour != null };
}
const order = (items, direction, sameDay) => [...items]
  .sort((a, b) => compareDeadlines(a, b, direction, sameDay)).map(t => t.id);

test('同一天升序：明确时间从早到晚，全天最后', () => {
  assert.deepEqual(order([task('全天', 19), task('18:10', 19, 18, 10), task('15:25', 19, 15, 25)], 'asc'),
    ['15:25', '18:10', '全天']);
});
test('同一天降序：明确时间从晚到早，全天仍最后', () => {
  assert.deepEqual(order([task('全天', 19), task('15:25', 19, 15, 25), task('18:10', 19, 18, 10)], 'desc'),
    ['18:10', '15:25', '全天']);
});
test('跨天升序保留日期顺序，今天全天早于明天的定时任务', () => {
  assert.deepEqual(order([task('明天9点', 20, 9), task('今天全天', 19), task('今天15点', 19, 15)], 'asc'),
    ['今天15点', '今天全天', '明天9点']);
});
test('跨天降序反转日期顺序，每天全天仍在该天最后', () => {
  assert.deepEqual(order([task('今天全天', 19), task('明天全天', 20), task('明天9点', 20, 9)], 'desc'),
    ['明天9点', '明天全天', '今天全天']);
});
test('没有日期始终最后，包括缺少 ddl 的旧数据', () => {
  for (const direction of ['asc', 'desc']) {
    assert.deepEqual(order([{ id: '无日期', ddl: null }, task('有日期', 19), { id: '旧数据' }], direction),
      ['有日期', '无日期', '旧数据']);
  }
});
test('显式零点有明确时刻，不与全天混为一谈', () => {
  assert.deepEqual(order([task('全天', 19), task('零点', 19, 0)], 'asc'), ['零点', '全天']);
});
test('日历中的循环任务按时刻比较，不受原始开始日期干扰', () => {
  const items = [task('早期全天', 1), task('早期18点', 1, 18), task('近期9点', 19, 9)];
  assert.deepEqual(order(items, 'asc', true), ['近期9点', '早期18点', '早期全天']);
  assert.deepEqual(order(items, 'desc', true), ['早期18点', '近期9点', '早期全天']);
});
test('全天任务到下一天零点才过期，不修改原始数据', () => {
  const t = task('全天', 19), original = t.ddl;
  assert.equal(deadlineMoment(t), new Date(2026, 9, 20).getTime());
  assert.ok(deadlineMoment(t) > new Date(2026, 9, 19, 23, 59).getTime());
  assert.equal(t.ddl, original);
});
test('有时分的逾期界限保留原时刻，无日期没有界限', () => {
  const t = task('定时', 19, 15, 25);
  assert.equal(deadlineMoment(t), t.ddl);
  assert.equal(deadlineMoment({ ddl: null }), null);
});

test('没有完成记录的循环任务返回 false，与普通未完成任务一致', () => {
  assert.equal(isRepeatDoneForDate({ repeat: 'daily' }, '2026-9-19'), false);
  assert.equal(isRepeatDoneForDate({ completedDates: [] }, '2026-9-19'), false);
  assert.equal(isRepeatDoneForDate({ completedDates: ['2026-9-19'] }, '2026-9-19'), true);
  assert.equal(isRepeatDoneForDate({ completedDates: ['2026-9-18'] }, '2026-9-19'), false);
});
