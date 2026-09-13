/**
 * 桌面动态功能配置（app/com.transsion.launcher3/values 五件套）读写与基线播种。
 *
 * 背景：values 五件套是桌面动态图标（动态时钟/动态日历）与桌面特性的配置中枢，
 * 缺失会导致主题应用后动态图标直接失效、桌面功能异常。
 *
 * 基线来源：themeSource XOS 样本（3 个自适应样本的 arrays/strings/dimens/bools
 * 完全一致，colors 随主题配色不同，Painterly 为完整主题设计值不同）。
 * 基线文件入库 assets/templates/launcher_values|launcher_fonts（用户已确认可入库）。
 *
 * 数据模型：
 *  - bools   8 个开关（动态主题/图标变形/三键刷色/模拟时钟刻度/全球日历/星期显示/渐变）
 *  - colors  4 个颜色（日历日期/星期/渐变起止，#AARRGGBB 或 #RRGGBB）
 *  - dimens  6 个排版（日历位置/字号/间距，单位 dp）
 *  - strings 2 个字体路径（动态日历日期/星期，引用 font/ 下 ttf）
 *  - arrays  动态时钟图层配置（固定 4 层，不提供编辑）
 */

const fs = require('fs');
const path = require('path');

const LAUNCHER_DIR = path.join('app', 'com.transsion.launcher3');
const BASELINE_XML_DIR = path.join(__dirname, '..', 'assets', 'templates', 'launcher_values');
const BASELINE_FONT_DIR = path.join(__dirname, '..', 'assets', 'templates', 'launcher_fonts');

const VALUE_FILES = ['arrays.xml', 'strings.xml', 'colors.xml', 'dimens.xml', 'bools.xml'];
const BASELINE_FONTS = ['tos_1030_numerals_medium480.ttf', 'tran_calendar_week_font.ttf'];

// ---- 配置项规格（key → 注释/界面标签，默认值 = XOS 基线） ----
const BOOL_SPEC = [
  { key: 'is_dynamic_theme_overlay', def: false, label: '全局主题覆盖', desc: '是否是全局主题（完整主题通常开启）' },
  { key: 'global_theme_icon_morph_support', def: true, label: '图标拖拽变形', desc: '全局主题资源是否支持拖拽变形功能' },
  { key: 'is_icon_brush_color', def: false, label: '三键刷色', desc: '全局主题下三键是否刷色（三键为白色时需开启）' },
  { key: 'analog_clock_draw_minute_bottom', def: false, label: '模拟时钟底部分钟刻度', desc: '模拟时钟界面是否在底部显示分钟刻度' },
  { key: 'tran_global_calendar_support', def: true, label: '全球日历', desc: '是否支持全球日历功能，不用动态日历请关闭' },
  { key: 'transsion_calendar_short_week', def: true, label: '日历星期显示', desc: '是否展示日历的星期，不用动态日历请关闭' },
  { key: 'transsion_calendar_week', def: true, label: '星期功能', desc: '是否启用星期显示功能，不用动态日历请关闭' },
  { key: 'transsion_calendar_gradation', def: false, label: '日历渐变', desc: '是否在日历应用中启用渐变效果' },
];
const COLOR_SPEC = [
  { key: 'tran_calendar_date_color', def: '#FF393E40', label: '日历日期颜色' },
  { key: 'tran_calendar_week_color', def: '#FF1B8AF5', label: '日历星期颜色' },
  { key: 'tran_calendar_gradation_start_color', def: '#FF000000', label: '日历渐变起始颜色' },
  { key: 'tran_calendar_gradation_end_color', def: '#FF000000', label: '日历渐变结束颜色' },
];
const DIMEN_SPEC = [
  { key: 'tran_calendar_date_y', def: 48, label: '日期 Y 轴距离' },
  { key: 'tran_calendar_week_y', def: 15, label: '星期 Y 轴距离' },
  { key: 'tran_calendar_date_size', def: 28, label: '日期字号' },
  { key: 'tran_calendar_week_size', def: 10, label: '星期字号' },
  { key: 'tran_calendar_text_gap', def: 9, label: '日历距顶部边距' },
  { key: 'tran_calendar_top_gap', def: 1, label: '内容距顶部边距' },
];
const STRING_SPEC = [
  { key: 'tran_calendar_date_typeface', def: 'font/tos_1030_numerals_medium480.ttf', label: '日期字体路径' },
  { key: 'tran_calendar_week_typeface', def: 'font/tran_calendar_week_font.ttf', label: '星期字体路径' },
];

const COLOR_RE = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function defaults() {
  const c = { bools: {}, colors: {}, dimens: {}, strings: {} };
  for (const s of BOOL_SPEC) c.bools[s.key] = s.def;
  for (const s of COLOR_SPEC) c.colors[s.key] = s.def;
  for (const s of DIMEN_SPEC) c.dimens[s.key] = s.def;
  for (const s of STRING_SPEC) c.strings[s.key] = s.def;
  return c;
}

function readIfExists(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

/**
 * 读取项目当前 launcher 配置（缺失文件/缺失键用基线默认补齐）。
 * @returns {{ files: {arrays,strings,colors,dimens,bools: boolean},
 *             fonts: string[], config: {bools,colors,dimens,strings} }}
 *   files 标记各 XML 是否已存在；fonts 为 font/ 目录现有字体文件名列表
 */
function readLauncherConfig(themeDir) {
  const dir = path.join(themeDir, LAUNCHER_DIR);
  const vdir = path.join(dir, 'values');
  const fdir = path.join(dir, 'font');
  const config = defaults();
  const files = {};

  const xmls = {
    bools: readIfExists(path.join(vdir, 'bools.xml')),
    colors: readIfExists(path.join(vdir, 'colors.xml')),
    dimens: readIfExists(path.join(vdir, 'dimens.xml')),
    strings: readIfExists(path.join(vdir, 'strings.xml')),
    arrays: readIfExists(path.join(vdir, 'arrays.xml')),
  };
  for (const f of VALUE_FILES) files[f.replace('.xml', '')] = xmls[f.replace('.xml', '')] != null;

  if (xmls.bools) {
    for (const s of BOOL_SPEC) {
      const m = xmls.bools.match(new RegExp(`<bool\\s+name="${s.key}"\\s*>\\s*(true|false)\\s*</bool>`));
      if (m) config.bools[s.key] = m[1] === 'true';
    }
  }
  if (xmls.colors) {
    for (const s of COLOR_SPEC) {
      const m = xmls.colors.match(new RegExp(`<color\\s+name="${s.key}"\\s*>\\s*(#[0-9a-fA-F]{6,8})\\s*</color>`));
      if (m) config.colors[s.key] = m[1];
    }
  }
  if (xmls.dimens) {
    for (const s of DIMEN_SPEC) {
      const m = xmls.dimens.match(new RegExp(`<dimen\\s+name="${s.key}"\\s*>\\s*(-?[\\d.]+)(?:dp|sp)?\\s*</dimen>`));
      if (m) config.dimens[s.key] = parseFloat(m[1]);
    }
  }
  if (xmls.strings) {
    for (const s of STRING_SPEC) {
      const m = xmls.strings.match(new RegExp(`<string\\s+name="${s.key}"[^>]*>\\s*([^<]+?)\\s*</string>`));
      if (m) config.strings[s.key] = m[1];
    }
  }

  const fonts = fs.existsSync(fdir)
    ? fs.readdirSync(fdir).filter(f => /\.(ttf|otf)$/i.test(f))
    : [];
  return {
    files,
    fonts,
    config,
    spec: { bools: BOOL_SPEC, colors: COLOR_SPEC, dimens: DIMEN_SPEC, strings: STRING_SPEC },
  };
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 校验并规范化配置（写回前调用，非法值抛错） */
function sanitizeConfig(input) {
  const c = defaults();
  const src = input || {};
  for (const s of BOOL_SPEC) {
    const v = src.bools && src.bools[s.key];
    c.bools[s.key] = v === undefined ? s.def : !!v;
  }
  for (const s of COLOR_SPEC) {
    const v = src.colors && src.colors[s.key];
    if (v !== undefined) {
      if (!COLOR_RE.test(v)) throw new Error(`${s.label || s.key} 颜色格式非法：${v}（应为 #RRGGBB 或 #AARRGGBB）`);
      c.colors[s.key] = v.toUpperCase();
    }
  }
  for (const s of DIMEN_SPEC) {
    const v = src.dimens && src.dimens[s.key];
    if (v !== undefined) {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`${s.label || s.key} 必须是数字：${v}`);
      c.dimens[s.key] = n;
    }
  }
  for (const s of STRING_SPEC) {
    const v = src.strings && src.strings[s.key];
    if (v !== undefined) {
      const t = String(v).trim();
      if (t && !/^font\/[^/\\]+\.(ttf|otf)$/i.test(t)) {
        throw new Error(`${s.label || s.key} 必须形如 font/xxx.ttf：${t}`);
      }
      c.strings[s.key] = t || s.def;
    }
  }
  return c;
}

const dimenStr = (n) => (Number.isInteger(n) ? String(n) : String(n)) + 'dp';

function genBools(c) {
  const lines = BOOL_SPEC.map(s =>
    `\t<!-- ${s.desc} -->\n\t<bool name="${s.key}">${c.bools[s.key]}</bool>`);
  return `<?xml version='1.0' encoding='utf-8'?>\n<resources>\n${lines.join('\n')}\n</resources>\n`;
}
function genColors(c) {
  const lines = COLOR_SPEC.map(s =>
    `\t<!-- ${s.label} -->\n\t<color name="${s.key}">${c.colors[s.key]}</color>`);
  return `<?xml version='1.0' encoding='utf-8'?>\n<resources>\n${lines.join('\n')}\n</resources>\n`;
}
function genDimens(c) {
  const lines = DIMEN_SPEC.map(s =>
    `\t<!-- ${s.label} -->\n\t<dimen name="${s.key}">${dimenStr(c.dimens[s.key])}</dimen>`);
  return `<?xml version='1.0' encoding='utf-8'?>\n<resources>\n${lines.join('\n')}\n</resources>\n`;
}
function genStrings(c) {
  const lines = STRING_SPEC.map(s =>
    `\t<!-- 动态日历${s.label} -->\n\t<string name="${s.key}" translatable="false">${xmlEscape(c.strings[s.key])}</string>`);
  return `<?xml version='1.0' encoding='utf-8'?>\n<resources>\n${lines.join('\n')}\n</resources>\n`;
}
// arrays.xml 为固定动态时钟图层配置，与样本保持一致
const ARRAYS_XML = `<?xml version='1.0' encoding='utf-8'?>\n<resources>\n\t<!--动态时钟图标配置-->\n\t<array name="hios_dynamic_icons_clock">\n\t\t<item>hios_dynamic_icons_clock_bg</item>\n\t\t<item>hios_dynamic_icons_clock_h</item>\n\t\t<item>hios_dynamic_icons_clock_m</item>\n\t\t<item>hios_dynamic_icons_clock_point</item>\n\t</array>\n</resources>\n`;

/**
 * 把配置写回 values 五件套（整体重新生成，含中文注释）。
 * @returns {{ written: string[] }} 相对路径列表
 */
function writeLauncherConfig(themeDir, config) {
  const c = sanitizeConfig(config);
  const vdir = path.join(themeDir, LAUNCHER_DIR, 'values');
  fs.mkdirSync(vdir, { recursive: true });
  const map = {
    'bools.xml': genBools(c),
    'colors.xml': genColors(c),
    'dimens.xml': genDimens(c),
    'strings.xml': genStrings(c),
    'arrays.xml': ARRAYS_XML,
  };
  const written = [];
  for (const [f, content] of Object.entries(map)) {
    fs.writeFileSync(path.join(vdir, f), content);
    written.push(path.join(LAUNCHER_DIR, 'values', f));
  }
  return { written };
}

/**
 * 基线播种：把 assets/templates 中的五件套 + 两个基线字体复制到项目，
 * 只补缺失文件，绝不覆盖已有（保护设计师已改的配置）。
 * @returns {{ xmlSeeded: string[], fontsSeeded: string[], baselineMissing: string[] }}
 */
function seedLauncherBaseline(themeDir) {
  const xmlSeeded = [], fontsSeeded = [], baselineMissing = [];
  const vdir = path.join(themeDir, LAUNCHER_DIR, 'values');
  const fdir = path.join(themeDir, LAUNCHER_DIR, 'font');
  for (const f of VALUE_FILES) {
    const src = path.join(BASELINE_XML_DIR, f);
    const dst = path.join(vdir, f);
    if (fs.existsSync(dst)) continue;
    if (!fs.existsSync(src)) { baselineMissing.push(f); continue; }
    fs.mkdirSync(vdir, { recursive: true });
    fs.copyFileSync(src, dst);
    xmlSeeded.push(f);
  }
  for (const f of BASELINE_FONTS) {
    const src = path.join(BASELINE_FONT_DIR, f);
    const dst = path.join(fdir, f);
    if (fs.existsSync(dst)) continue;
    if (!fs.existsSync(src)) { baselineMissing.push(f); continue; }
    fs.mkdirSync(fdir, { recursive: true });
    fs.copyFileSync(src, dst);
    fontsSeeded.push(f);
  }
  return { xmlSeeded, fontsSeeded, baselineMissing };
}

module.exports = {
  LAUNCHER_DIR,
  VALUE_FILES,
  BASELINE_FONTS,
  BOOL_SPEC,
  COLOR_SPEC,
  DIMEN_SPEC,
  STRING_SPEC,
  readLauncherConfig,
  writeLauncherConfig,
  seedLauncherBaseline,
  sanitizeConfig,
};
