const fs = require('node:fs');
const path = require('node:path');
function normalizeImage(bytes, decode) {
    if (!Buffer.isBuffer(bytes) || bytes.length>8*1024*1024) throw new Error('图片不能超过 8MB。');
    let image = decode(bytes);
    if (image.isEmpty()) throw new Error('图片无法读取，请换一张。');
    const { width, height } = image.getSize();
    if (width<16 || height<16 || width>4096 || height>4096) throw new Error('图片边长需在 16 到 4096 像素之间。');
    const scale=Math.min(1,256/Math.max(width,height));
    if (scale<1) image=image.resize({width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale)),quality:'best'});
    return image.toPNG();
}
class ReminderAvatar {
  constructor(directory, decode) { this.file = path.join(directory, 'reminder-avatar.png'); this.decode = decode; }
  preview() {
    if (!fs.existsSync(this.file)) return null;
    const bytes = fs.readFileSync(this.file), image = this.decode(bytes);
    if (image.isEmpty()) return null;
    const bitmap = image.toBitmap(); let transparent = false;
    for (let i=3;i<bitmap.length;i+=4) if (bitmap[i]<255) { transparent=true; break; }
    return { src: 'data:image/png;base64,' + bytes.toString('base64'), framed: !transparent };
  }
  import(file, commit) {
    if (!/\.(png|webp|jpe?g)$/i.test(file) || fs.statSync(file).size > 8*1024*1024) throw new Error('请选择 8MB 以内的 PNG、WebP 或 JPG 图片。');
    return this.importBuffer(fs.readFileSync(file), commit);
  }
  importBuffer(bytes, commit) {
    const png = normalizeImage(bytes, this.decode);
    const previous=fs.existsSync(this.file)?fs.readFileSync(this.file):null;
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
    fs.writeFileSync(this.file+'.tmp',png,{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);
    try { commit(); } catch(error) { if(previous)fs.writeFileSync(this.file,previous,{mode:0o600});else fs.unlinkSync(this.file);throw error; }
    return this.preview();
  }
}
module.exports={ReminderAvatar, normalizeImage};
