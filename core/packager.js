/**
 * 打包器：主题目录 → zip → .xth
 *
 * 产物结构：zip 根目录直接放 manifest.json、icons/、preview/ 等
 * （不带外层主题文件夹，与样本目录内容一一对应）。
 *
 * 选项：
 *  - keepFormat：保留图片原始格式（默认 false，即全部图片统一转为 webp——这是硬规则；
 *    主题包内不允许出现非 webp 图片，转换需要 sharp）
 */

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { isImageFile, extOf } = require('./imageInfo');

async function packTheme(themeDir, outFile, opts = {}) {
  const { keepFormat = false, onProgress = null } = opts;
  const convertToWebp = !keepFormat;
  if (!fs.existsSync(themeDir)) throw new Error(`目录不存在：${themeDir}`);

  let sharp = null;
  if (convertToWebp) {
    try { sharp = require('sharp'); }
    catch { throw new Error('图片统一转 webp 需要 sharp：请先 npm install sharp'); }
  }

  if (!outFile.endsWith('.xth')) outFile += '.xth';
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  const output = fs.createWriteStream(outFile);
  const archive = archiver('zip', { zlib: { level: 9 } });

  const done = new Promise((resolve, reject) => {
    output.on('close', resolve);
    archive.on('error', reject);
  });
  archive.pipe(output);

  // 递归收集文件（跳过隐藏文件与系统垃圾）
  const SKIP = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
  function walk(dir, rel = '') {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (d.name.startsWith('.') || SKIP.has(d.name.toLowerCase())) continue;
      const abs = path.join(dir, d.name);
      const entryName = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) walk(abs, entryName);
      else entries.push({ abs, entryName });
    }
  }
  const entries = [];
  walk(themeDir);

  for (const { abs, entryName } of entries) {
    if (convertToWebp && isImageFile(entryName) && extOf(entryName) !== 'webp') {
      const buf = await sharp(abs).webp({ quality: 95 }).toBuffer();
      archive.append(buf, { name: entryName.replace(/\.[^.]+$/, '.webp') });
    } else if (convertToWebp && entryName === 'icons/description.xml') {
      // 图片统一转 webp 后，同步改写 description.xml 中的图片引用，避免路径断裂
      const xml = fs.readFileSync(abs, 'utf8')
        .replace(/(path="[^"]+)\.(png|jpg|jpeg)(")/gi, '$1.webp$3');
      archive.append(xml, { name: entryName });
    } else {
      archive.file(abs, { name: entryName });
    }
    if (onProgress) onProgress(entryName);
  }

  await archive.finalize();
  await done;
  return { outFile, fileCount: entries.length, bytes: fs.statSync(outFile).size };
}

module.exports = { packTheme };
