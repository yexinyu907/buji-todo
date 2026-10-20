(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TodoColor = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function normalizeHex(input) {
    if (typeof input !== 'string') return null;
    let hex = input.trim().replace(/^#/, '');
    if (/^[\da-f]{3}$/i.test(hex)) hex = [...hex].map(c => c + c).join('');
    return /^[\da-f]{6}$/i.test(hex) ? '#' + hex.toLowerCase() : null;
  }
  function toRGB(hex) { return normalizeHex(hex).slice(1).match(/../g).map(n => parseInt(n, 16)); }
  function toHSV(hex) {
    const [r,g,b] = toRGB(hex).map(n => n / 255), max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
    let h = 0;
    if (d) h = max === r ? ((g-b)/d)%6 : max === g ? (b-r)/d+2 : (r-g)/d+4;
    return { h: (h*60+360)%360, s: max ? d/max : 0, v: max };
  }
  function fromHSV(h,s,v) {
    h = ((h%360)+360)%360; s=Math.min(1,Math.max(0,s)); v=Math.min(1,Math.max(0,v));
    const c=v*s, x=c*(1-Math.abs((h/60)%2-1)), m=v-c;
    const rgb = h<60 ? [c,x,0] : h<120 ? [x,c,0] : h<180 ? [0,c,x] : h<240 ? [0,x,c] : h<300 ? [x,0,c] : [c,0,x];
    return '#' + rgb.map(n => Math.round((n+m)*255).toString(16).padStart(2,'0')).join('');
  }
  function isDark(hex) {
    const rgb = toRGB(hex).map(n => { n/=255; return n<=.04045 ? n/12.92 : ((n+.055)/1.055)**2.4; });
    return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722 < .179;
  }
  return { normalizeHex, toRGB, toHSV, fromHSV, isDark };
});
