/**
 * 主题包 Profile 定义 —— 规则的唯一事实来源。
 *
 * 两个正交维度：
 *  - iconStyle: 'normal'（单图 webp）| 'adaptive'（_bg/_top 分层，mono 再加 _monochrome.xml）
 *  - type: 0（完整主题）| 1（纯图标主题）
 *
 * 规则来源：themeSource 4 个样本 + 与设计侧确认的约定（见 .workbuddy/memory）。
 */

const ICON_STYLE = { NORMAL: 'normal', ADAPTIVE: 'adaptive' };

// 品牌 → 平台映射：Tecno=HiOS，Infinix=XOS，itel=itel OS
// 平台差异体现在资源后缀（_hios/_xos）与桌面包名（hilauncher/XOSLauncher/itel.launcher）
const BRANDS = {
  tecno: { os: 'HiOS', launcher: 'com.transsion.hilauncher', resSuffix: 'hios' },
  infinix: { os: 'XOS', launcher: 'com.transsion.XOSLauncher', resSuffix: 'xos' },
  itel: { os: 'itel OS', launcher: 'com.transsion.itel.launcher', resSuffix: 'hios' },
};

// manifest.json 必填字段
const MANIFEST_REQUIRED = ['id', 'type', 'version', 'app_resource_dir', 'author', 'name', 'description', 'prebuilt'];

// color_mode 四种取值（不配置按 default 处理）：
//  default          默认样式——图标资源可为 normal 普通单图，也可为 adaptive 自适应
//  glass            玻璃样式——必须 adaptive
//  foreground_color 暗黑样式（系统中以此标识暗色模式）——必须 adaptive
//  mono             可着色样式——必须 adaptive，且每个应用还需 _monochrome.xml 上色资源
const COLOR_MODES = ['default', 'glass', 'foreground_color', 'mono'];

// color_mode 与图标风格的耦合：非 default 强制自适应
function colorModeRequiresAdaptive(colorMode) {
  return !!colorMode && colorMode !== 'default';
}

// icons/ 兜底模板三件套（webp 为标准，png 兼容识别）
const ICON_TEMPLATE_KEYS = ['icon_theme_background', 'icon_theme_foreground', 'icon_theme_mask'];

// icons/ 目录下的模板与特殊文件名（不参与包名配对校验）
const ICON_TEMPLATE_FILES = [
  'icon_theme_background.webp',
  'icon_theme_foreground.webp',
  'icon_theme_mask.webp',
  'description.xml',
];
const ICON_SPECIAL_PREFIXES = [
  'icon_style_preview',
  'hios_dynamic_icons_clock_',
  'com_android_launcher3_portal_ring_inner_holo',
  'transsion_calendarbg',
];

// 自适应图标推荐尺寸（样本中 324 为主，216/144 见于旧资源）
const ADAPTIVE_ICON_SIZE = 324;
// 普通主题单图尺寸
const NORMAL_ICON_SIZE = 162;

// 壁纸固定文件名（位于 wallpapers/drawable/）
const WALLPAPER_FILES = ['wallpaper_home', 'wallpaper_lock'];

// 预览图命名：preview_lock_<n> / preview_unlock_<n>（数量不限）；thumbnail 可选
const PREVIEW_NAME_RE = /^preview_(lock|unlock)_\d+$/;

// app/ 下允许的资源目录类型（Android overlay 风格，可带 -night / -xhdpi 等限定符）
const APP_RES_DIR_RE = /^(drawable|values|font|preview|raw|layout|mipmap|color|xml)(-[a-z0-9]+)*$/;

module.exports = {
  ICON_STYLE,
  BRANDS,
  MANIFEST_REQUIRED,
  COLOR_MODES,
  colorModeRequiresAdaptive,
  ICON_TEMPLATE_KEYS,
  ICON_TEMPLATE_FILES,
  ICON_SPECIAL_PREFIXES,
  ADAPTIVE_ICON_SIZE,
  NORMAL_ICON_SIZE,
  WALLPAPER_FILES,
  PREVIEW_NAME_RE,
  APP_RES_DIR_RE,
};
