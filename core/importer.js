/**
 * 资源导入器 —— 把 mapping 匹配结果落地到主题项目目录。
 *
 * 职责：
 *  - importAssets(themeDir, matched, opts)：按主题图标风格归位命名
 *      normal   → icons/<包名>.webp
 *      adaptive → icons/<包名>_bg.webp / icons/<包名>_top.webp
 *      mono     → 同上 + SVG 暂存 icons/_pending_svg/（VectorDrawable 转换属 P2）
 *    源图统一转 webp（sharp），与设计规范「包内产物一律 webp」对齐
 *  - coverage(themeDir, list, profile)：按清单逐应用统计适配状态，
 *    供覆盖率报告与清单面板使用
 */

const fs = require('fs');
const path = require('path');

const PENDING_SVG_DIR = '_pending_svg';

function extOf(f) { return (f.match(/\.([^.]+)$/) || [])[1] || ''; }

/** 目标文件名：按风格与图层 */
function targetName(pkg, layer, iconStyle) {
  if (iconStyle === 'normal') return `${pkg}.webp`;
  if (layer === 'bg') return `${pkg}_bg.webp`;
  if (layer === 'top') return `${pkg}_top.webp`;
  return null; // mono svg 等不走图片命名
}

/**
 * 导入匹配成功的资源。
 * @param {string} themeDir 主题项目目录
 * @param {Array} matched matchAssets 返回的 matched（可含人工裁决后的条目）
 * @param {object} opts { iconStyle: 'normal'|'adaptive', assetDir, overwrite?: true }
 * @returns {Promise<{placed, overwritten, pendingSvg, errors}>}
 */
async function importAssets(themeDir, matched, opts) {
  const { iconStyle, assetDir, onProgress = null } = opts;
  if (!iconStyle) throw new Error('缺少 iconStyle（normal/adaptive）');
  const iconsDir = path.join(themeDir, 'icons');
  fs.mkdirSync(iconsDir, { recursive: true });

  let sharp = null;
  try { sharp = require('sharp'); } catch { /* 退化：直接复制原格式 */ }

  const placed = [];      // { file, target, layer, package }
  const overwritten = []; // [target]
  const pendingSvg = [];  // { file, target, package }
  const errors = [];      // string

  let done = 0;
  const total = matched.length;
  for (const m of matched) {
    done++;
    if (onProgress) onProgress(done, total, m.file);
    const src = path.join(assetDir, m.file);
    const isSvg = m.file.toLowerCase().endsWith('.svg');
    try {
      if (isSvg || m.layer === 'mono') {
        // SVG → VectorDrawable 属于 P2 能力，先暂存不丢失
        const dir = path.join(iconsDir, PENDING_SVG_DIR);
        fs.mkdirSync(dir, { recursive: true });
        const target = path.join(PENDING_SVG_DIR, `${m.package}.svg`);
        fs.copyFileSync(src, path.join(iconsDir, target));
        pendingSvg.push({ file: m.file, target, package: m.package });
        continue;
      }
      const name = targetName(m.package, m.layer, iconStyle);
      if (!name) { errors.push(`${m.file}：无法确定目标文件名（layer=${m.layer}）`); continue; }
      const dst = path.join(iconsDir, name);
      if (fs.existsSync(dst)) overwritten.push(name);
      if (sharp) {
        await sharp(src).webp({ quality: 95 }).toFile(dst);
      } else {
        // 无 sharp：复制原文件，保留原扩展名（打包时仍会强制转 webp）
        const rawName = name.replace(/\.webp$/, '.' + extOf(m.file));
        fs.copyFileSync(src, path.join(iconsDir, rawName));
      }
      placed.push({ file: m.file, target: name, layer: m.layer, package: m.package });
    } catch (e) {
      errors.push(`${m.file}：${e.message}`);
    }
  }
  return { placed, overwritten, pendingSvg, errors };
}

/**
 * 覆盖率：按清单逐应用统计主题项目内的适配状态。
 * @param {string} themeDir
 * @param {object} list 清单
 * @param {object} profile { iconStyle, colorMode }
 * @returns {{ apps: [{package,name,category,required,status,missing}], summary }}
 *   status: 'full' | 'partial' | 'none'
 */
function coverage(themeDir, list, profile) {
  const { iconStyle } = profile;
  const isMono = profile.colorMode === 'mono';
  const iconsDir = path.join(themeDir, 'icons');
  const files = fs.existsSync(iconsDir) ? fs.readdirSync(iconsDir) : [];
  const stems = new Set(files.map(f => f.replace(/\.[^.]+$/, '')));

  const has = (s) => stems.has(s);
  const apps = list.apps.map(a => {
    const pkg = a.package;
    let status, missing = [];
    if (iconStyle === 'normal') {
      status = has(pkg) ? 'full' : 'none';
      if (status === 'none') missing = ['图标'];
    } else {
      const bg = has(`${pkg}_bg`), top = has(`${pkg}_top`);
      if (!bg) missing.push('背景层');
      if (!top) missing.push('前景层');
      if (isMono) {
        const mono = files.includes(`${pkg}_monochrome.xml`);
        if (!mono) missing.push('monochrome');
        const got = [bg, top, mono].filter(Boolean).length;
        status = got === 3 ? 'full' : (got > 0 ? 'partial' : 'none');
      } else {
        const got = [bg, top].filter(Boolean).length;
        status = got === 2 ? 'full' : (got > 0 ? 'partial' : 'none');
      }
    }
    return { package: pkg, name: a.name, category: a.category, required: !!a.required, status, missing };
  });

  const summary = {
    total: apps.length,
    full: apps.filter(a => a.status === 'full').length,
    partial: apps.filter(a => a.status === 'partial').length,
    none: apps.filter(a => a.status === 'none').length,
    requiredMissing: apps.filter(a => a.required && a.status !== 'full').length,
  };
  return { apps, summary };
}

/** 扫描项目内可用清单（lists/*.json） */
function scanLists(themeDir) {
  const dir = path.join(themeDir, 'lists');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith('.json'))
    .map(f => path.join(dir, f));
}

// ---------- 其他资源导入：壁纸 / 预览图 / 字体（P1④） ----------

// 字体落点与 scaffold 骨架保持一致（样本即 com.transsion.launcher3）
const LAUNCHER_FONT_DIR = path.join('app', 'com.transsion.launcher3', 'font');
const FONT_EXTS = new Set(['ttf', 'otf']);

/** 单图转 webp 落盘；无 sharp 时退回复制原格式（打包时仍会强制转 webp） */
async function imageToWebp(sharp, src, dstWebp) {
  if (sharp) {
    await sharp(src).webp({ quality: 95 }).toFile(dstWebp);
    return path.basename(dstWebp);
  }
  const raw = dstWebp.replace(/\.webp$/, '.' + extOf(src));
  fs.copyFileSync(src, raw);
  return path.basename(raw);
}

/**
 * 导入壁纸 / 预览图 / 字体。
 * @param {string} themeDir 主题项目目录
 * @param {object} extras 全部为可选字段，传什么导入什么：
 *   {
 *     wallpaperHome?: string            桌面壁纸源图（png/jpg/webp…）
 *     wallpaperLock?: string            锁屏壁纸源图
 *     previewLock?: string              锁屏预览图（1 张 → preview_lock_0.webp）
 *     previewUnlock?: string[]          解锁预览图（有序 → preview_unlock_0..n-1.webp，
 *                                       导入前清空旧的 preview_unlock_* 避免序号残留）
 *     thumbnail?: string                缩略图（可选 → preview/thumbnail.webp）
 *     fonts?: string[]                  字体文件（ttf/otf 原样拷贝，不转 webp）
 *   }
 * @param {object} opts { onProgress?(done, total, file) }
 * @returns {Promise<{placed, overwritten, errors}>}
 *   placed: [{ file, target }]（target 为相对 themeDir 的路径）
 */
async function importExtras(themeDir, extras, opts = {}) {
  const { onProgress = null } = opts;
  let sharp = null;
  try { sharp = require('sharp'); } catch { /* 退化：直接复制原格式 */ }

  const jobs = []; // { src, dst, convert: 'webp'|'copy' }

  // 壁纸（固定文件名，直接覆盖）
  if (extras.wallpaperHome) {
    jobs.push({ src: extras.wallpaperHome, dst: path.join(themeDir, 'wallpapers', 'drawable', 'wallpaper_home.webp'), convert: 'webp' });
  }
  if (extras.wallpaperLock) {
    jobs.push({ src: extras.wallpaperLock, dst: path.join(themeDir, 'wallpapers', 'drawable', 'wallpaper_lock.webp'), convert: 'webp' });
  }

  // 预览图
  const previewDir = path.join(themeDir, 'preview');
  if (extras.previewUnlock && extras.previewUnlock.length) {
    // 清空旧的 unlock 序列，防止新序列比旧序列短时残留多余序号
    if (fs.existsSync(previewDir)) {
      for (const f of fs.readdirSync(previewDir)) {
        const stem = f.replace(/\.[^.]+$/, '');
        if (/^preview_unlock_\d+$/.test(stem)) fs.unlinkSync(path.join(previewDir, f));
      }
    }
    extras.previewUnlock.forEach((src, i) => {
      jobs.push({ src, dst: path.join(previewDir, `preview_unlock_${i}.webp`), convert: 'webp' });
    });
  }
  if (extras.previewLock) {
    jobs.push({ src: extras.previewLock, dst: path.join(previewDir, 'preview_lock_0.webp'), convert: 'webp' });
  }
  if (extras.thumbnail) {
    jobs.push({ src: extras.thumbnail, dst: path.join(previewDir, 'thumbnail.webp'), convert: 'webp' });
  }

  // 字体（原样拷贝）
  for (const src of (extras.fonts || [])) {
    jobs.push({ src, dst: path.join(themeDir, LAUNCHER_FONT_DIR, path.basename(src)), convert: 'copy' });
  }

  const placed = [];
  const overwritten = [];
  const errors = [];
  let done = 0;
  for (const j of jobs) {
    done++;
    const base = path.basename(j.src);
    if (onProgress) onProgress(done, jobs.length, base);
    try {
      if (j.convert === 'copy') {
        const ext = extOf(base).toLowerCase();
        if (!FONT_EXTS.has(ext)) { errors.push(`${base}：仅支持 ttf/otf 字体`); continue; }
        fs.mkdirSync(path.dirname(j.dst), { recursive: true });
        if (fs.existsSync(j.dst)) overwritten.push(path.relative(themeDir, j.dst));
        fs.copyFileSync(j.src, j.dst);
        placed.push({ file: base, target: path.relative(themeDir, j.dst) });
      } else {
        fs.mkdirSync(path.dirname(j.dst), { recursive: true });
        if (fs.existsSync(j.dst)) overwritten.push(path.relative(themeDir, j.dst));
        const name = await imageToWebp(sharp, j.src, j.dst);
        placed.push({ file: base, target: path.relative(themeDir, path.join(path.dirname(j.dst), name)) });
      }
    } catch (e) {
      errors.push(`${base}：${e.message}`);
    }
  }
  return { placed, overwritten, errors };
}

module.exports = { importAssets, importExtras, coverage, scanLists, PENDING_SVG_DIR };
