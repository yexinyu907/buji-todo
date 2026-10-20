const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeHex,toRGB,toHSV,fromHSV,isDark}=require('../color-utils');
test('十六进制校验与规范化拒绝CSS内容及不完整颜色',()=>{
  assert.equal(normalizeHex(' #AbC '),'#aabbcc');assert.equal(normalizeHex('ABCDEF'),'#abcdef');
  for(const value of [null,123,'#12','#12345g','#ffffffff','red','url(x)'])assert.equal(normalizeHex(value),null);
});
test('画板色相饱和度明度转换保留原色与灰阶，任意色往返不丢失',()=>{
  assert.equal(fromHSV(0,1,1),'#ff0000');assert.equal(fromHSV(120,1,1),'#00ff00');assert.equal(fromHSV(240,1,1),'#0000ff');assert.equal(fromHSV(360,1,1),'#ff0000');
  assert.equal(fromHSV(100,0,1),'#ffffff');assert.equal(fromHSV(100,1,0),'#000000');
  for(let i=0;i<256;i++){const hex='#'+[i,255-i,(i*37)%256].map(n=>n.toString(16).padStart(2,'0')).join(''),{h,s,v}=toHSV(hex);assert.equal(fromHSV(h,s,v),hex);}
});
test('深浅背景的对比度选择不会改变白色任务卡片内容',()=>{
  assert.equal(isDark('#000000'),true);assert.equal(isDark('#ffffff'),false);assert.equal(isDark('#faf9f6'),false);assert.equal(isDark('#0000ff'),true);assert.equal(isDark('#ffff00'),false);
  assert.deepEqual(toRGB('#aabbcc'),[170,187,204]);
});
