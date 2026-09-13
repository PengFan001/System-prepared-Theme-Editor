/**
 * svg2vd 转换器 + 导入链路 + validator 联动测试
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { convertSvgToVd, checkMonochromeXml, normalizePathData } = require('../core/svg2vd');
const { importAssets } = require('../core/importer');
const { validateTheme } = require('../core/validator');
const { createProject } = require('../core/scaffold');

const T = 'D:/test_theme_output/_svg2vd_test';
let passed = 0;
function ok(name, cond, extra = '') {
  if (!cond) { console.error(`  ✗ ${name} ${extra}`); process.exitCode = 1; }
  else { console.log(`  ✓ ${name}`); passed++; }
}

// ---------- 1. 基本转换：path 直通 ----------
console.log('== 基本转换 ==');
{
  const r = convertSvgToVd(`<svg viewBox="0 0 24 24"><path d="M12 2L2 22h20z" fill="#ff5722"/></svg>`);
  ok('path 转换成功', r.ok, r.reason);
  ok('填充统一为 #000000', r.ok && r.xml.includes('android:fillColor="#000000"'));
  ok('viewport 取自 viewBox', r.ok && r.xml.includes('android:viewportWidth="24"'));
  ok('彩色警告已提示', r.warnings.some(w => w.includes('单色')));
  ok('pathData 保留', r.ok && r.xml.includes('M12 2L2 22h20'));
}

// ---------- 2. 形状转换 ----------
console.log('== 形状转换 ==');
{
  const r = convertSvgToVd(`<svg viewBox="0 0 100 100">
    <rect x="10" y="10" width="30" height="20" rx="5"/>
    <circle cx="70" cy="30" r="15"/>
    <ellipse cx="30" cy="70" rx="20" ry="10"/>
    <line x1="0" y1="0" x2="10" y2="10" stroke="red" stroke-width="2"/>
    <polygon points="50,50 60,50 55,60"/>
  </svg>`);
  ok('五种形状全部转换', r.ok, r.reason);
  ok('圆角矩形无 A 指令（已转贝塞尔）', r.ok && !/pathData="[^"]*[Aa]/.test(r.xml));
  ok('圆形转 C 曲线', r.ok && /pathData="M[^"]*C/.test(r.xml));
  ok('描边保留', r.ok && r.xml.includes('android:strokeColor="#000000"') && r.xml.includes('android:strokeWidth="2"'));
}

// ---------- 3. 弧指令转换 ----------
console.log('== 弧指令 A→C ==');
{
  const d = normalizePathData('M10 10 A 20 20 0 0 1 50 50');
  ok('A 已转 C', d.includes('C') && !/A/.test(d.replace(/[A-Z]/g, m => m === 'C' ? '' : m)));
  const d2 = normalizePathData('M0 0a5 5 0 1 0 10 0z');
  ok('相对弧 a 已转 C', d2.includes('C'));
  ok('H/V/S/Q/T 原样保留', normalizePathData('M0 0H5V5Q1 1 2 2T3 3S4 4 5 5Z') === 'M0 0H5V5Q1 1 2 2T3 3S4 4 5 5Z');
}

// ---------- 4. transform → group ----------
console.log('== transform ==');
{
  const r = convertSvgToVd(`<svg viewBox="0 0 100 100"><g transform="translate(10 20) scale(2)"><path d="M0 0h10v10z"/></g></svg>`);
  ok('g transform 转 group', r.ok && r.xml.includes('<group') && r.xml.includes('android:translateX="10"') && r.xml.includes('android:scaleX="2"'), r.reason);
  const r2 = convertSvgToVd(`<svg viewBox="0 0 100 100"><g transform="rotate(45 50 50)"><path d="M0 0h10v10z"/></g></svg>`);
  ok('rotate(cx cy) 分解成功', r2.ok && r2.xml.includes('android:rotation="45"'), r2.reason);
  const r3 = convertSvgToVd(`<svg viewBox="0 0 100 100"><g transform="skewX(30)"><path d="M0 0h10v10z"/></g></svg>`);
  ok('skewX 拒绝并说明', !r3.ok && r3.reason.includes('斜切'));
}

// ---------- 5. 白名单拦截 ----------
console.log('== 白名单 ==');
{
  const cases = [
    ['渐变', `<svg viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><path d="M0 0h10v10z" fill="url(#g)"/></svg>`, '渐变'],
    ['aapt 命名空间', `<svg viewBox="0 0 10 10" xmlns:aapt="http://schemas.android.com/aapt"><path aapt:attr="x" d="M0 0h10v10z"/></svg>`, 'aapt'],
    ['@color 引用', `<svg viewBox="0 0 10 10"><path d="M0 0h10v10z" fill="@color/red"/></svg>`, '@color'],
    ['?attr 引用', `<svg viewBox="0 0 10 10"><path d="M0 0h10v10z" fill="?attr/colorPrimary"/></svg>`, '?attr'],
    ['text 元素', `<svg viewBox="0 0 10 10"><text x="0" y="5">A</text></svg>`, '文字'],
    ['image 元素', `<svg viewBox="0 0 10 10"><image href="a.png"/></svg>`, '位图'],
    ['use 元素', `<svg viewBox="0 0 10 10"><use href="#x"/></svg>`, 'use'],
    ['空 SVG', `<svg viewBox="0 0 10 10"></svg>`, '可见路径'],
    ['无 viewBox/尺寸', `<svg><path d="M0 0h10v10z"/></svg>`, '画布'],
  ];
  for (const [name, svg, kw] of cases) {
    const r = convertSvgToVd(svg);
    ok(`拦截：${name}`, !r.ok && r.reason.includes(kw), r.ok ? '未拦截' : `（实际：${r.reason}）`);
  }
}

// ---------- 6. fill-rule / fill-opacity / style 内联 ----------
console.log('== 样式细节 ==');
{
  const r = convertSvgToVd(`<svg viewBox="0 0 24 24"><path d="M0 0h24v24z" fill-rule="evenodd" fill-opacity="0.4"/></svg>`);
  ok('fillType evenOdd', r.ok && r.xml.includes('android:fillType="evenOdd"'));
  ok('fillAlpha 0.4', r.ok && r.xml.includes('android:fillAlpha="0.4"'));
  const r2 = convertSvgToVd(`<svg viewBox="0 0 24 24"><path d="M0 0h24v24z" style="fill:#f00;fill-opacity:.5"/></svg>`);
  ok('内联 style 解析', r2.ok && r2.xml.includes('android:fillAlpha="0.5"'), r2.reason);
  const r3 = convertSvgToVd(`<svg viewBox="0 0 24 24"><path d="M0 0h24v24z" fill="none" stroke="black"/></svg>`);
  ok('fill=none 只留描边', r3.ok && !r3.xml.includes('fillColor') && r3.xml.includes('strokeColor'));
}

// ---------- 7. viewBox 原点偏移 ----------
{
  const r = convertSvgToVd(`<svg viewBox="-12 -12 24 24"><path d="M0 0h10v10z"/></svg>`);
  ok('viewBox 原点偏移包平移 group', r.ok && r.xml.includes('android:translateX="12"'), r.reason);
}

// ---------- 8. checkMonochromeXml ----------
console.log('== checkMonochromeXml ==');
{
  const sample = fs.readFileSync(path.join(__dirname, '../themeSource/support_adaptive_icon_feature_theme/mono/icons/com.discord_monochrome.xml'), 'utf8');
  ok('样本 monochrome 通过', checkMonochromeXml(sample).ok);
  const aaptSample = fs.readFileSync(path.join(__dirname, '../themeSource/support_adaptive_icon_feature_theme/mono/icons/com.scb.phone_monochrome.xml'), 'utf8');
  const aaptCheck = checkMonochromeXml(aaptSample);
  ok('样本 aapt 渐变为错误（用户确认：无法渲染上色的错误资源）', !aaptCheck.ok && aaptCheck.errors.some(e => e.includes('aapt')));
  ok('检出非 vector 根', !checkMonochromeXml('<html></html>').ok);
  ok('检出 @color 引用为错误', !checkMonochromeXml('<vector><path android:fillColor="@color/red" android:pathData="M0 0"/></vector>').ok);
  ok('检出缺 pathData', !checkMonochromeXml('<vector></vector>').ok);
}

// ---------- 9. 端到端：导入 mono 主题 ----------
(async () => {
console.log('== 端到端：导入链路 ==');
fs.rmSync(T, { recursive: true, force: true });
await createProject(T, { name: '_svg2vd_test', author: 't', type: 1, iconStyle: 'adaptive', colorMode: 'mono', brand: 'tecno' });
const assetDir = path.join(T, '_assets');
fs.mkdirSync(assetDir, { recursive: true });
fs.writeFileSync(path.join(assetDir, 'com.good.app_monochrome.svg'), `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#3366ff"/></svg>`);
fs.writeFileSync(path.join(assetDir, 'com.bad.app_monochrome.svg'), `<svg viewBox="0 0 24 24"><text x="2" y="12">bad</text></svg>`);
fs.writeFileSync(path.join(assetDir, 'com.good.app_bg.png'), fs.readFileSync(path.join(__dirname, '../assets/templates/icon_theme_background.webp')));
fs.writeFileSync(path.join(assetDir, 'com.good.app_top.png'), fs.readFileSync(path.join(__dirname, '../assets/templates/icon_theme_foreground.webp')));
fs.writeFileSync(path.join(assetDir, 'com.bad.app_bg.png'), fs.readFileSync(path.join(__dirname, '../assets/templates/icon_theme_background.webp')));
fs.writeFileSync(path.join(assetDir, 'com.bad.app_top.png'), fs.readFileSync(path.join(__dirname, '../assets/templates/icon_theme_foreground.webp')));

const matched = [
  { file: 'com.good.app_bg.png', layer: 'bg', package: 'com.good.app' },
  { file: 'com.good.app_top.png', layer: 'top', package: 'com.good.app' },
  { file: 'com.good.app_monochrome.svg', layer: 'mono', package: 'com.good.app' },
  { file: 'com.bad.app_bg.png', layer: 'bg', package: 'com.bad.app' },
  { file: 'com.bad.app_top.png', layer: 'top', package: 'com.bad.app' },
  { file: 'com.bad.app_monochrome.svg', layer: 'mono', package: 'com.bad.app' },
];
const r = await importAssets(T, matched, { iconStyle: 'adaptive', colorMode: 'mono', assetDir });
ok('图片落盘 4', r.placed.length === 4, JSON.stringify(r.errors));
ok('SVG 转换成功 1', r.convertedMono.length === 1 && r.convertedMono[0].target === 'com.good.app_monochrome.xml');
ok('SVG 失败降级暂存 1 且带原因', r.pendingSvg.length === 1 && r.pendingSvg[0].reason.includes('文字'));
const monoXml = fs.readFileSync(path.join(T, 'icons', 'com.good.app_monochrome.xml'), 'utf8');
ok('落盘 XML 合法', checkMonochromeXml(monoXml).ok);

// 非 mono 主题：SVG 应暂存不转换
const T2 = T + '_nonmono';
fs.rmSync(T2, { recursive: true, force: true });
await createProject(T2, { name: '_svg2vd_nonmono', author: 't', type: 1, iconStyle: 'adaptive', colorMode: 'default', brand: 'tecno' });
const assetDir2 = path.join(T2, '_assets');
fs.mkdirSync(assetDir2, { recursive: true });
fs.writeFileSync(path.join(assetDir2, 'com.x.app.svg'), `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>`);
const r2 = await importAssets(T2, [{ file: 'com.x.app.svg', layer: 'mono', package: 'com.x.app' }], { iconStyle: 'adaptive', colorMode: 'default', assetDir: assetDir2 });
ok('非 mono 主题 SVG 暂存不转换', r2.convertedMono.length === 0 && r2.pendingSvg.length === 1 && r2.pendingSvg[0].reason.includes('不是 mono'));

// validator 联动：转换产物通过校验；转换失败的应用被正确报出缺 monochrome（校验兜底有效）
const rep = validateTheme(T);
ok('校验精确报出转换失败应用缺 monochrome', rep.errors.length === 1 && rep.errors[0].includes('com.bad.app') && rep.errors[0].includes('monochrome'), rep.errors.join(' | '));
ok('转换成功应用无校验错误', !rep.errors.some(e => e.includes('com.good.app')));
ok('校验未把 _pending_svg 当无法识别文件', !rep.warnings.some(w => w.includes('_pending_svg')), rep.warnings.filter(w => w.includes('pending')).join('|'));

for (const d of [T, T2]) {
  try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 }); } catch { /* Windows 文件锁：留待系统清理 */ }
}
console.log(`\n通过 ${passed} 项断言${process.exitCode ? '（存在失败）' : ''}`);
process.exit(process.exitCode || 0);
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
