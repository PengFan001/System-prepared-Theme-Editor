/**
 * 主题包校验器。
 *
 * 用法：validateTheme(themeDir) → { errors, warnings, profile, stats }
 *  - errors：阻断打包的问题
 *  - warnings：允许打包但建议修正的问题
 *  - profile：推断出的主题画像 { type, iconStyle, colorMode, isMono }
 */

const fs = require('fs');
const path = require('path');
const P = require('./profiles');
const { sniff, isImageFile, extOf } = require('./imageInfo');

function readFileSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function listDir(p) {
  try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; }
}

/** 解析 icons/description.xml，返回 { supportAdaptive: '0'|'1'|null, raw } */
function parseDescriptionXml(dir) {
  const raw = readFileSafe(path.join(dir, 'description.xml'));
  if (raw == null) return { supportAdaptive: null, raw: null };
  const m = raw.match(/support_adaptive_icon_feature[^>]*value="(\d)"/);
  return { supportAdaptive: m ? m[1] : null, raw };
}

function validateManifest(root, errors, warnings) {
  const mp = path.join(root, 'manifest.json');
  const raw = readFileSafe(mp);
  if (raw == null) {
    errors.push('缺少 manifest.json');
    return null;
  }
  let manifest;
  try { manifest = JSON.parse(raw); } catch (e) {
    errors.push(`manifest.json 不是合法 JSON：${e.message}`);
    return null;
  }
  for (const key of P.MANIFEST_REQUIRED) {
    if (!(key in manifest)) errors.push(`manifest.json 缺少必填字段 "${key}"`);
  }
  if (manifest.type !== 0 && manifest.type !== 1) {
    errors.push(`manifest.type 必须为 0（完整主题）或 1（图标主题），当前为 ${JSON.stringify(manifest.type)}`);
  }
  const v = Number(manifest.version);
  if (!Number.isInteger(v) || v <= 0) {
    errors.push(`manifest.version 必须为大于 0 的整数（资源更新时至少 +1），当前为 ${JSON.stringify(manifest.version)}`);
  }
  if ('prebuilt' in manifest && manifest.prebuilt !== '1') {
    warnings.push(`manifest.prebuilt 标准格式为字符串 "1"，当前为 ${JSON.stringify(manifest.prebuilt)}`);
  }
  if ('color_mode' in manifest && !P.COLOR_MODES.includes(manifest.color_mode)) {
    warnings.push(`manifest.color_mode 未知取值 ${JSON.stringify(manifest.color_mode)}（已知：${P.COLOR_MODES.join('/')}）`);
  }
  return manifest;
}

/** 校验 icons/ 目录，返回 { iconStyle, iconCount } */
function validateIcons(root, manifest, errors, warnings) {
  const iconsDir = path.join(root, 'icons');
  if (!fs.existsSync(iconsDir)) {
    errors.push('缺少 icons/ 目录');
    return { iconStyle: null, iconCount: 0 };
  }

  const colorMode = manifest && manifest.color_mode;
  const isMono = colorMode === 'mono';
  const files = listDir(iconsDir).filter(d => d.isFile()).map(d => d.name);

  // 区分模板/特殊文件与应用图标（模板三件套 webp 为标准，png 兼容识别）
  const TEMPLATE_RE = /^icon_theme_(background|foreground|mask)\.(webp|png)$/i;
  const isSpecial = (n) =>
    TEMPLATE_RE.test(n) ||
    P.ICON_TEMPLATE_FILES.includes(n) ||
    P.ICON_SPECIAL_PREFIXES.some(pre => n.startsWith(pre));
  const appIconFiles = files.filter(n => !isSpecial(n));

  // 图标风格推断：文件证据（fileStyle）与配置证据（description.xml / color_mode）分开看，
  // 再合成有效风格——空项目（尚无应用图标）不会误判
  const hasLayered = appIconFiles.some(n => /(_bg|_top)\.(webp|png)$/i.test(n));
  const fileStyle = hasLayered ? P.ICON_STYLE.ADAPTIVE
    : (appIconFiles.length > 0 ? P.ICON_STYLE.NORMAL : null);

  // description.xml 与风格交叉校验
  const desc = parseDescriptionXml(iconsDir);
  if (fileStyle === P.ICON_STYLE.ADAPTIVE && desc.supportAdaptive !== '1') {
    errors.push('自适应图标主题的 icons/description.xml 必须配置 <support_adaptive_icon_feature value="1"/>');
  }
  if (fileStyle === P.ICON_STYLE.NORMAL && desc.supportAdaptive === '1') {
    errors.push('普通（非自适应）图标主题的 icons/description.xml 中 support_adaptive_icon_feature 必须为 0 或不配置');
  }

  // color_mode 耦合规则：glass/foreground_color/mono 的应用图标必须是自适应分层资源
  if (P.colorModeRequiresAdaptive(colorMode) && fileStyle === P.ICON_STYLE.NORMAL) {
    errors.push(`manifest.color_mode=${colorMode}（玻璃/暗黑/可着色样式）要求 icons 必须为自适应图标资源（_bg/_top 分层），当前为普通单图格式`);
  }

  // 有效风格：mono 或配置声明 adaptive 或文件分层证据 → adaptive
  const iconStyle = (isMono || desc.supportAdaptive === '1' || fileStyle === P.ICON_STYLE.ADAPTIVE)
    ? P.ICON_STYLE.ADAPTIVE : P.ICON_STYLE.NORMAL;

  if (desc.raw == null) {
    warnings.push('icons/ 缺少 description.xml（未适配应用的兜底模板配置）');
  } else {
    // description.xml 引用的模板图路径必须真实存在
    for (const m of desc.raw.matchAll(/<(background|foreground|mask)\s+path="([^"]+)"/g)) {
      if (!files.includes(m[2])) {
        warnings.push(`icons/description.xml 引用的 ${m[1]} 路径 "${m[2]}" 在 icons/ 中不存在`);
      }
    }
  }
  // 兜底模板三件套：webp/png 任一存在即可
  for (const key of P.ICON_TEMPLATE_KEYS) {
    if (!files.some(n => n === `${key}.webp` || n === `${key}.png`)) {
      warnings.push(`icons/ 缺少兜底模板文件 ${key}.webp`);
    }
  }

  // 应用图标分组校验
  let iconCount = 0;
  if (iconStyle === P.ICON_STYLE.ADAPTIVE) {
    const groups = new Map(); // base → { bg, top, mono }
    for (const n of appIconFiles) {
      let m = n.match(/^(.*)_bg\.(webp|png)$/i);
      if (m) { (groups.get(m[1]) || groups.set(m[1], {}).get(m[1])).bg = n; continue; }
      m = n.match(/^(.*)_top\.(webp|png)$/i);
      if (m) { (groups.get(m[1]) || groups.set(m[1], {}).get(m[1])).top = n; continue; }
      m = n.match(/^(.*)_monochrome\.xml$/i);
      if (m) { (groups.get(m[1]) || groups.set(m[1], {}).get(m[1])).mono = n; continue; }
      warnings.push(`icons/${n}：无法识别的文件（自适应主题应命名为 <包名>_bg/_top.webp 或 <包名>_monochrome.xml）`);
    }
    for (const [base, g] of groups) {
      iconCount++;
      if (!g.bg) errors.push(`icons/${base}：缺少背景层 ${base}_bg.webp`);
      if (!g.top) errors.push(`icons/${base}：缺少前景层 ${base}_top.webp`);
      if (isMono && !g.mono) errors.push(`icons/${base}：mono 主题缺少上色资源 ${base}_monochrome.xml`);
      if (!isMono && g.mono) warnings.push(`icons/${base}：存在 _monochrome.xml 但 manifest.color_mode 不是 mono`);
      if (g.mono) {
        const raw = readFileSafe(path.join(iconsDir, g.mono)) || '';
        if (!raw.includes('<vector') || !raw.includes('pathData')) {
          errors.push(`icons/${g.mono}：不是合法的 VectorDrawable（应包含 <vector> 与 pathData）`);
        }
      }
    }
  } else {
    for (const n of appIconFiles) {
      if (!isImageFile(n)) {
        warnings.push(`icons/${n}：普通图标主题中应为单图资源（<包名>.webp）`);
        continue;
      }
      iconCount++;
    }
  }

  // 图片内容嗅探：格式与尺寸（按类别聚合，避免逐文件刷屏）
  const agg = { notWebp: 0, mismatch: [], badSize: [] };
  for (const n of files) {
    if (!isImageFile(n)) continue;
    const info = sniff(path.join(iconsDir, n));
    const ext = extOf(n);
    if (info.format === 'unknown') {
      errors.push(`icons/${n}：无法识别的图片内容`);
      continue;
    }
    if (info.format !== ext && !(ext === 'jpg' && info.format === 'jpeg')) {
      agg.mismatch.push(`${n}(.${ext}→实为${info.format})`);
    }
    if (ext !== 'webp') agg.notWebp++;
    const isAppIcon = !isSpecial(n);
    if (isAppIcon && info.width != null) {
      const expected = iconStyle === P.ICON_STYLE.ADAPTIVE ? P.ADAPTIVE_ICON_SIZE : P.NORMAL_ICON_SIZE;
      if (info.width !== expected || info.height !== expected) {
        agg.badSize.push(`${n}(${info.width}×${info.height})`);
      }
    }
  }
  if (agg.notWebp > 0) {
    warnings.push(`icons/ 有 ${agg.notWebp} 个图片不是 webp（打包时会统一转换）`);
  }
  if (agg.mismatch.length > 0) {
    const head = agg.mismatch.slice(0, 5).join('、');
    warnings.push(`icons/ 有 ${agg.mismatch.length} 个文件扩展名与真实内容不符：${head}${agg.mismatch.length > 5 ? ' 等' : ''}`);
  }
  if (agg.badSize.length > 0) {
    const expected = iconStyle === P.ICON_STYLE.ADAPTIVE ? P.ADAPTIVE_ICON_SIZE : P.NORMAL_ICON_SIZE;
    const head = agg.badSize.slice(0, 5).join('、');
    warnings.push(`icons/ 有 ${agg.badSize.length} 个图标尺寸非 ${expected}×${expected}：${head}${agg.badSize.length > 5 ? ' 等' : ''}`);
  }
  return { iconStyle, iconCount };
}

function validatePreview(root, errors, warnings) {
  const dir = path.join(root, 'preview');
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const d of listDir(dir)) {
    if (!d.isFile()) continue;
    const base = d.name.replace(/\.[^.]+$/, '');
    if (base === 'thumbnail') { /* 可选，任意格式 */ continue; }
    if (!P.PREVIEW_NAME_RE.test(base)) {
      warnings.push(`preview/${d.name}：命名不符合 preview_lock_<n> / preview_unlock_<n> 规范`);
      continue;
    }
    count++;
  }
  if (count === 0) warnings.push('preview/ 目录存在但没有有效预览图（preview_lock_<n>/preview_unlock_<n>）');
  return count;
}

function validateWallpapers(root, errors, warnings) {
  const dir = path.join(root, 'wallpapers', 'drawable');
  if (!fs.existsSync(dir)) return 0;
  const names = listDir(dir).filter(d => d.isFile()).map(d => d.name.replace(/\.[^.]+$/, ''));
  let count = 0;
  for (const w of P.WALLPAPER_FILES) {
    if (names.includes(w)) count++;
    else warnings.push(`wallpapers/drawable/ 缺少 ${w} 壁纸`);
  }
  return count;
}

function validateAppDir(root, errors, warnings) {
  const dir = path.join(root, 'app');
  if (!fs.existsSync(dir)) return 0;
  let pkgCount = 0;
  for (const pkg of listDir(dir)) {
    if (!pkg.isDirectory()) continue;
    pkgCount++;
    for (const resDir of listDir(path.join(dir, pkg.name))) {
      if (!resDir.isDirectory()) continue;
      if (!P.APP_RES_DIR_RE.test(resDir.name)) {
        warnings.push(`app/${pkg.name}/${resDir.name}：不是标准的 Android 资源目录名`);
      }
    }
  }
  return pkgCount;
}

/** 全包图片检查（icons/ 之外的目录）：格式与内容嗅探，按类别聚合 */
function validateImagesGlobal(root, errors, warnings) {
  const SKIP_DIRS = new Set(['icons']);
  let notWebp = 0;
  const mismatch = [];
  function walk(dir, rel) {
    for (const d of listDir(dir)) {
      const abs = path.join(dir, d.name);
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) { if (!SKIP_DIRS.has(d.name) || rel) walk(abs, r); continue; }
      if (!isImageFile(d.name)) continue;
      const info = sniff(abs);
      const ext = extOf(d.name);
      if (info.format === 'unknown') { errors.push(`${r}：无法识别的图片内容`); continue; }
      if (info.format !== ext && !(ext === 'jpg' && info.format === 'jpeg')) {
        mismatch.push(`${r}(.${ext}→实为${info.format})`);
      }
      if (ext !== 'webp') notWebp++;
    }
  }
  walk(root, '');
  if (notWebp > 0) warnings.push(`包内（icons/ 之外）有 ${notWebp} 个图片不是 webp，打包时会统一转换`);
  if (mismatch.length > 0) {
    const head = mismatch.slice(0, 5).join('、');
    warnings.push(`包内（icons/ 之外）有 ${mismatch.length} 个文件扩展名与真实内容不符：${head}${mismatch.length > 5 ? ' 等' : ''}，打包时会修正`);
  }
}

function validateTheme(themeDir) {
  const errors = [];
  const warnings = [];
  if (!fs.existsSync(themeDir) || !fs.statSync(themeDir).isDirectory()) {
    return { errors: [`目录不存在：${themeDir}`], warnings, profile: null, stats: {} };
  }

  const manifest = validateManifest(themeDir, errors, warnings);
  const { iconStyle, iconCount } = validateIcons(themeDir, manifest || {}, errors, warnings);
  const previewCount = validatePreview(themeDir, errors, warnings);
  const wallpaperCount = validateWallpapers(themeDir, errors, warnings);
  const appPkgCount = validateAppDir(themeDir, errors, warnings);
  validateImagesGlobal(themeDir, errors, warnings);

  if (manifest) {
    if (manifest.type === 1 && (previewCount > 0 || wallpaperCount > 0)) {
      warnings.push('type=1（图标主题）包含 preview/ 或 wallpapers/，这些属于完整主题资源');
    }
    if (manifest.type === 0) {
      if (previewCount === 0) warnings.push('type=0（完整主题）缺少 preview/ 预览图');
      if (wallpaperCount === 0) warnings.push('type=0（完整主题）缺少 wallpapers/ 壁纸');
    }
  }

  return {
    errors,
    warnings,
    profile: manifest ? {
      type: manifest.type,
      iconStyle,
      colorMode: manifest.color_mode || null,
      isMono: manifest.color_mode === 'mono',
    } : null,
    stats: { iconCount, previewCount, wallpaperCount, appPkgCount },
  };
}

module.exports = { validateTheme };
