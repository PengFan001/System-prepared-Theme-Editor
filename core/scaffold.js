/**
 * 项目骨架生成：按 profile（type × 图标风格 × 品牌 × color_mode）创建标准目录结构与模板文件。
 *
 * 工具侧的项目配置（品牌、图标风格、关联清单）写入 .themeproject.json，
 * 不参与打包（packager 跳过点开头文件）。
 *
 * 兜底模板三件套（icon_theme_background/foreground/mask）在创建时
 * 从 themeSource 样本预置（统一转 webp），防止设计师忘记上传；
 * 设计师后续上传正式资源时替换即可。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = require('./profiles');

// 默认模板图源（mono 样本）
const TEMPLATE_SRC_DIR = path.join(__dirname, '..', 'themeSource',
  'support_adaptive_icon_feature_theme', 'mono', 'icons');

function descriptionXml(iconStyle, imgExt = 'webp') {
  const adaptive = iconStyle === P.ICON_STYLE.ADAPTIVE;
  return `<?xml version="1.0" encoding="utf-8"?>
<description>
    <transform>
        <matrix value="1" />
        <background path="icon_theme_background.${imgExt}" />
        <foreground path="icon_theme_foreground.${imgExt}" />
        <mask path="icon_theme_mask.${imgExt}" />
    </transform>
    <saturation value="1"/>
${adaptive ? '    <support_adaptive_icon_feature value="1"/>\n' : ''}</description>
`;
}

/**
 * 预置兜底模板三件套到 icons/。
 * 优先转 webp（需 sharp）；sharp 不可用或源缺失时退回直接复制 png。
 * 返回实际使用的扩展名（'webp' | 'png'），供 description.xml 引用。
 */
async function seedTemplateImages(iconsDir) {
  let sharp = null;
  try { sharp = require('sharp'); } catch { /* 无 sharp 时退回复制 */ }
  let usedExt = 'webp';
  for (const key of P.ICON_TEMPLATE_KEYS) {
    const src = path.join(TEMPLATE_SRC_DIR, `${key}.png`);
    if (!fs.existsSync(src)) continue;
    const dstWebp = path.join(iconsDir, `${key}.webp`);
    try {
      if (!sharp) throw new Error('no sharp');
      await sharp(src).webp({ quality: 95 }).toFile(dstWebp);
    } catch {
      fs.copyFileSync(src, path.join(iconsDir, `${key}.png`));
      usedExt = 'png';
    }
  }
  return usedExt;
}

/**
 * createProject(dir, opts)
 * opts: { name, author, description, type(0|1), iconStyle, colorMode?, brand? }
 *  - colorMode: default/glass/foreground_color/mono；非 default 强制 iconStyle=adaptive
 */
function createProject(dir, opts) {
  return createProjectAsync(dir, opts);
}

async function createProjectAsync(dir, opts) {
  const { name, author, description = name, type, iconStyle, colorMode = 'default', brand } = opts;
  if (!name) throw new Error('缺少主题名称');
  if (type !== 0 && type !== 1) throw new Error('type 必须为 0 或 1');
  if (!Object.values(P.ICON_STYLE).includes(iconStyle)) throw new Error('iconStyle 非法');
  if (!P.COLOR_MODES.includes(colorMode)) throw new Error(`colorMode 必须是 ${P.COLOR_MODES.join('/')} 之一`);
  if (brand && !P.BRANDS[brand]) throw new Error(`brand 必须是 ${Object.keys(P.BRANDS).join('/')} 之一`);

  // 护栏：目标目录若已是主题项目则拒绝，防止覆盖已有 manifest
  if (fs.existsSync(path.join(dir, 'manifest.json'))) {
    throw new Error(`目标目录已存在 manifest.json（已是主题项目）：${dir}`);
  }

  // 耦合规则：glass/foreground_color/mono 强制自适应
  const effStyle = P.colorModeRequiresAdaptive(colorMode) ? P.ICON_STYLE.ADAPTIVE : iconStyle;

  // 目录骨架
  const dirs = ['icons', 'app/com.transsion.launcher3/font', 'app/com.transsion.launcher3/values'];
  if (type === 0) dirs.push('preview', 'wallpapers/drawable');
  for (const d of dirs) fs.mkdirSync(path.join(dir, d), { recursive: true });

  // manifest.json（严格按样本字段，prebuilt 锁定字符串 "1"）
  const manifest = {
    id: crypto.randomUUID(),
    type,
    version: 1,
    app_resource_dir: 'app',
    author: author || 'unknown',
    name,
    description,
    color_mode: colorMode,
    prebuilt: '1',
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  // icons/：预置兜底模板三件套 + description.xml（引用实际写入的扩展名）
  const iconsDir = path.join(dir, 'icons');
  const imgExt = await seedTemplateImages(iconsDir);
  fs.writeFileSync(path.join(iconsDir, 'description.xml'), descriptionXml(effStyle, imgExt));

  // 工具侧项目配置
  const project = { tool: 'System-prepared Theme Editor', iconStyle: effStyle, colorMode, brand: brand || null, listFile: null };
  fs.writeFileSync(path.join(dir, '.themeproject.json'), JSON.stringify(project, null, 2) + '\n');

  return { dir, manifest, project };
}

function loadProject(dir) {
  const p = path.join(dir, '.themeproject.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

module.exports = { createProject, loadProject };
