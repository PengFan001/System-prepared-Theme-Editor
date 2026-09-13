/**
 * 图标 mask 合成预演（P2）—— 用项目内的兜底模板（icon_theme_background/foreground/mask）
 * 与 description.xml 的 transform/saturation 配置，在打包前预览应用图标经系统遮罩后的效果。
 *
 * 合成规则（对齐样本语义）：
 *  - 自适应主题：bg + top 双层叠放（324×324）→ 饱和度调整 → mask 裁切（dest-in）
 *  - 普通主题：模板 background 为底 → 应用单图按 matrix 值缩放居中 → 模板 foreground 覆盖
 *    → 饱和度调整 → mask 裁切
 *  - description.xml 中 transform/matrix value 为缩放系数（默认 1），saturation 为饱和度（默认 1）
 *
 * composeIconPreview(themeDir, pkg, opts?) → Promise<{ dataUrl, mode, notes[] }>
 *   dataUrl 为 PNG data URL（输出尺寸 opts.size，默认 162）；失败抛出中文原因
 */

const fs = require('fs');
const path = require('path');

const CANVAS = 324; // 自适应分层资源的标准边长（与规范一致）

function readDesc(iconsDir) {
  const raw = fs.existsSync(path.join(iconsDir, 'description.xml'))
    ? fs.readFileSync(path.join(iconsDir, 'description.xml'), 'utf8') : '';
  const num = (tag) => {
    const m = raw.match(new RegExp(`<${tag}[^>]*value="([^"]+)"`));
    return m ? parseFloat(m[1]) : null;
  };
  return {
    matrix: num('matrix') ?? 1,
    saturation: num('saturation') ?? 1,
    bgRef: (raw.match(/<background\s+path="([^"]+)"/) || [])[1] || 'icon_theme_background.webp',
    fgRef: (raw.match(/<foreground\s+path="([^"]+)"/) || [])[1] || 'icon_theme_foreground.webp',
    maskRef: (raw.match(/<mask\s+path="([^"]+)"/) || [])[1] || 'icon_theme_mask.webp',
  };
}

async function composeIconPreview(themeDir, pkg, opts = {}) {
  const size = opts.size || 162;
  const iconsDir = path.join(themeDir, 'icons');
  if (!fs.existsSync(iconsDir)) throw new Error('项目缺少 icons/ 目录');
  let sharp;
  try { sharp = require('sharp'); } catch { throw new Error('缺少 sharp，无法合成预演'); }

  const desc = readDesc(iconsDir);
  const find = (name) => fs.existsSync(path.join(iconsDir, name)) ? path.join(iconsDir, name) : null;
  const notes = [];

  const bg = find(`${pkg}_bg.webp`) || find(`${pkg}_bg.png`);
  const top = find(`${pkg}_top.webp`) || find(`${pkg}_top.png`);
  const single = find(`${pkg}.webp`) || find(`${pkg}.png`);
  const isAdaptive = !!(bg || top);

  if (!isAdaptive && !single) throw new Error(`${pkg} 尚无图标资源（缺少 _bg/_top 或单图）`);

  // 统一一次 composite：sharp 的 composite 选项后写会覆盖先写，mask 必须为最后一层
  const blank = { create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } };
  const layers = [];
  const sq = (f) => sharp(f).resize(CANVAS, CANVAS, { fit: 'fill' }).toBuffer();

  let mode;
  if (isAdaptive) {
    mode = 'adaptive';
    if (bg) layers.push({ input: await sq(bg) });
    else notes.push('缺少背景层，以透明代替');
    if (top) layers.push({ input: await sq(top) });
    else notes.push('缺少前景层，以透明代替');
  } else {
    mode = 'normal';
    // 模板底 + 应用图缩放居中 + 模板前景
    const bgT = find(desc.bgRef);
    const fgT = find(desc.fgRef);
    if (bgT) layers.push({ input: await sq(bgT) });
    else notes.push(`缺少模板 ${desc.bgRef}，以透明底代替`);
    // 应用单图：162 基准 × matrix 缩放，居中放置
    const iconSize = Math.max(1, Math.round(162 * desc.matrix));
    const iconBuf = await sharp(single).resize(iconSize, iconSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
    layers.push({ input: iconBuf, left: Math.round((CANVAS - iconSize) / 2), top: Math.round((CANVAS - iconSize) / 2) });
    if (fgT) layers.push({ input: await sq(fgT) });
    else notes.push(`缺少模板 ${desc.fgRef}`);
  }

  // mask 裁切（最后一层）
  const maskF = find(desc.maskRef);
  if (maskF) {
    layers.push({ input: await sharp(maskF).resize(CANVAS, CANVAS, { fit: 'fill' }).png().toBuffer(), blend: 'dest-in' });
  } else {
    notes.push(`缺少模板 ${desc.maskRef}，未应用遮罩`);
  }

  // 注意：sharp 内部 resize 先于 composite 执行，最终缩放必须放在合成之后的独立流水线，
  // 否则 324 图层会对已缩小的底图报"尺寸必须相同或更小"
  const composed = await sharp(blank).composite(layers).png().toBuffer();
  let img = sharp(composed);
  if (desc.saturation !== 1) {
    img = img.modulate({ saturation: desc.saturation });
    notes.push(`已应用饱和度 ${desc.saturation}`);
  }
  const out = await img.resize(size, size).png().toBuffer();
  return { dataUrl: 'data:image/png;base64,' + out.toString('base64'), mode, notes };
}

module.exports = { composeIconPreview };
