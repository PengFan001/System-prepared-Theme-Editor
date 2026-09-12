/**
 * 适配应用清单（adaptation list）—— 包名映射的唯一事实来源。
 *
 * 清单格式（JSON）：
 * {
 *   "project": "XOS",            // 项目/平台标识
 *   "version": 1,
 *   "apps": [
 *     {
 *       "package": "com.tencent.mm",   // 包名（或 Activity 级 / alias 名）
 *       "name": "微信",                // 应用名（设计师认这个），可后补
 *       "category": "third-party",     // system | third-party | special
 *       "required": false              // 是否必须适配（false=可走 mask 兜底）
 *     }
 *   ]
 * }
 *
 * 本模块负责：
 *  - generateList(themeDirs)：从已有主题包反向生成清单初版
 *  - loadList(file)：加载清单
 *  - matchAssets(list, assetDir)：把设计师的一堆资源文件匹配到清单条目，
 *    产出归位计划 + 歧义确认 + 覆盖率报告
 */

const fs = require('fs');
const path = require('path');
const P = require('./profiles');
const { isImageFile } = require('./imageInfo');

// 预装/系统应用的包名前缀（命中即归为 system）
const SYSTEM_PREFIXES = [
  'com.transsion', 'com.transtech', 'com.transsnet', 'com.mediatek',
  'com.android', 'com.sh.smart', 'com.funbase', 'com.rlk', 'com.smartlife',
  'com.idea', 'com.gallery20', 'net.bat.store', 'tech.palm',
];
// 平台特殊资源（非应用图标）
const SPECIAL_RE = /^(alias[._]|hios_|x_.*folder|.*widget_icon|com_android_|lockscreen_|memory_|transsion_calendarbg)/;

function classify(base) {
  if (SPECIAL_RE.test(base)) return 'special';
  if (SYSTEM_PREFIXES.some(pre => base.startsWith(pre))) return 'system';
  return 'third-party';
}

// 常见应用中文名（让初版清单更可读，可持续补充）
const KNOWN_NAMES = {
  'com.tencent.mm': '微信', 'com.eg.android.AlipayGphone': '支付宝',
  'com.taobao.taobao': '淘宝', 'com.jingdong.app.mall': '京东',
  'com.sina.weibo': '微博', 'com.ss.android.article.news': '今日头条',
  'com.tencent.mobileqq': 'QQ', 'com.netease.cloudmusic': '网易云音乐',
  'com.autonavi.minimap': '高德地图', 'com.baidu.BaiduMap': '百度地图',
  'com.sankuai.meituan': '美团', 'com.dianping.v1': '大众点评',
  'com.sdu.didi.psnger': '滴滴出行', 'com.alibaba.android.rimet': '钉钉',
  'com.tencent.wemeet.app': '腾讯会议', 'com.xingin.xhs': '小红书',
  'com.zhihu.android': '知乎', 'com.douban.frodo': '豆瓣',
  'ctrip.android.view': '携程', 'com.youku.phone': '优酷',
  'com.qiyi.video': '爱奇艺', 'com.android.settings': '设置',
  'com.android.chrome': 'Chrome', 'com.android.vending': 'Google Play',
  'com.facebook.katana': 'Facebook', 'com.instagram.android': 'Instagram',
  'org.telegram.messenger': 'Telegram', 'com.whatsapp': 'WhatsApp',
  'com.openai.chatgpt': 'ChatGPT', 'com.einnovation.temu': 'Temu',
  'com.shopee.sg': 'Shopee', 'com.lazada.android': 'Lazada',
  'com.spotify.music': 'Spotify', 'com.google.android.apps.maps': 'Google 地图',
};

/** 从 icons/ 文件名提取应用条目的 base 名（去掉分层后缀） */
function baseNameOf(fileName) {
  let m = fileName.match(/^(.*)\.(webp|png|jpg|jpeg)$/i);
  if (!m) return null;
  let base = m[1];
  base = base.replace(/_(bg|top)$/i, '');
  return base;
}

/** 从若干主题目录反向生成清单（取 icons/ 并集） */
function generateList(themeDirs, project = 'default') {
  const seen = new Map(); // base → 出现于哪些主题
  for (const dir of themeDirs) {
    const iconsDir = path.join(dir, 'icons');
    if (!fs.existsSync(iconsDir)) continue;
    const themeName = path.basename(dir);
    for (const f of fs.readdirSync(iconsDir)) {
      const mono = f.match(/^(.*)_monochrome\.xml$/i);
      let base = mono ? mono[1] : baseNameOf(f);
      if (!base) continue;
      if (P.ICON_TEMPLATE_FILES.includes(f) || P.ICON_SPECIAL_PREFIXES.some(p => f.startsWith(p))) continue;
      if (!seen.has(base)) seen.set(base, new Set());
      seen.get(base).add(themeName);
    }
  }
  const apps = [...seen.keys()].sort().map(base => ({
    package: base,
    name: KNOWN_NAMES[base] || '',
    category: classify(base),
    required: false,
  }));
  return { project, version: 1, apps };
}

function loadList(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(raw.apps)) throw new Error('清单格式错误：缺少 apps 数组');
  return raw;
}

/** 清单自检：name 空缺统计与清单质量问题 */
function checkList(list) {
  const issues = [];
  const stats = { total: list.apps.length, missingName: { system: 0, 'third-party': 0, special: 0 }, named: 0 };
  const seen = new Set();
  for (const a of list.apps) {
    if (!a.package) { issues.push('存在缺少 package 字段的条目'); continue; }
    if (seen.has(a.package)) issues.push(`包名重复：${a.package}`);
    seen.add(a.package);
    if (a.name && a.name.trim()) { stats.named++; continue; }
    const cat = a.category || 'third-party';
    stats.missingName[cat] = (stats.missingName[cat] || 0) + 1;
    if (a.required) issues.push(`必须适配的 ${a.package} 缺少应用名（设计师无法按名匹配）`);
    if (cat === 'system') issues.push(`系统应用 ${a.package} 缺少应用名（建议优先补齐）`);
  }
  return { stats, issues };
}

const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, '');

/**
 * 匹配设计师资源到清单。
 * 识别规则（按优先级）：
 *  B. 文件名（去扩展名/分层后缀）与清单包名完全一致
 *  C. 文件名与清单应用名一致（norm 后）；多个命中 → 歧义，需人工确认
 * 返回 { matched, ambiguous, unmatched, uncovered }
 */
function matchAssets(list, assetDir) {
  const byPackage = new Map(list.apps.map(a => [a.package, a]));
  const byName = new Map(); // norm(name) → [app]
  for (const a of list.apps) {
    if (!a.name) continue;
    const k = norm(a.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(a);
  }

  const matched = [];   // { file, layer, package, method }
  const ambiguous = []; // { file, candidates }
  const unmatched = []; // [file]
  const conflicts = []; // { package, layer, files }
  const layerSeen = new Map(); // `${package}|${layer}` → file
  const covered = new Set();

  const files = fs.readdirSync(assetDir).filter(f =>
    isImageFile(f) || f.toLowerCase().endsWith('.svg'));

  const accept = (f, layer, pkg, method) => {
    const key = `${pkg}|${layer}`;
    if (layerSeen.has(key)) {
      conflicts.push({ package: pkg, layer, files: [layerSeen.get(key), f] });
      return;
    }
    layerSeen.set(key, f);
    matched.push({ file: f, layer, package: pkg, method });
    covered.add(pkg);
  };

  for (const f of files) {
    let layer = 'single';
    let stem = f.replace(/\.[^.]+$/, '');
    let m = stem.match(/^(.*)_(bg|top)$/i);
    if (m) { stem = m[1]; layer = m[2].toLowerCase(); }
    else if (/mono|monochrome/i.test(stem) && f.toLowerCase().endsWith('.svg')) { layer = 'mono'; }

    if (byPackage.has(stem)) {
      accept(f, layer, stem, '包名匹配');
      continue;
    }
    const cands = byName.get(norm(stem)) || [];
    if (cands.length === 1) {
      accept(f, layer, cands[0].package, '应用名匹配');
    } else if (cands.length > 1) {
      ambiguous.push({ file: f, candidates: cands.map(c => `${c.name}(${c.package})`) });
    } else {
      unmatched.push(f);
    }
  }

  const uncovered = list.apps
    .filter(a => !covered.has(a.package))
    .map(a => ({ package: a.package, name: a.name, category: a.category, required: a.required }));

  return { matched, ambiguous, unmatched, conflicts, uncovered };
}

module.exports = { generateList, loadList, matchAssets, checkList, classify };
