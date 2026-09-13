/**
 * SVG→monochrome 代验收脚本（用户无 SVG 素材，委托工具侧验收）
 *
 * 验收层次：
 *  A. 单元断言（复用 test-svg2vd.js 的 42 项，不在此重复）
 *  B. 视觉等价性：源 SVG 与转换产物各自栅格化，逐像素对比 alpha 轮廓
 *     （monochrome 只看剪影；允许抗锯齿误差，阈值 1.5%）
 *  C. 设计师工作流端到端：新建 mono 项目 → 导入 PNG 分层 + SVG →
 *     校验 0 错误、覆盖率 full、产物 XML 合法
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { convertSvgToVd, checkMonochromeXml } = require('../core/svg2vd');
const { importAssets, coverage } = require('../core/importer');
const { validateTheme } = require('../core/validator');
const { createProject } = require('../core/scaffold');

const T = 'D:/test_theme_output/_svg_accept';
let passed = 0, failed = 0;
function ok(name, cond, extra = '') {
  if (!cond) { console.error(`  ✗ ${name} ${extra}`); failed++; }
  else { console.log(`  ✓ ${name}`); passed++; }
}

// ---------- B. 视觉等价性 ----------

/** 从 VD XML 重建等效 SVG（黑填充），用于栅格化对比 */
function vdToSvg(vdXml) {
  const vw = (vdXml.match(/viewportWidth="([^"]+)"/) || [])[1];
  const vh = (vdXml.match(/viewportHeight="([^"]+)"/) || [])[1];
  const paths = [];
  // group 变换也还原（本验收用例的变换都作用于整体平移/缩放/旋转）
  const groupRe = /<group ([^>]*)>([\s\S]*?)<\/group>/g;
  let body = vdXml;
  let gm;
  const groups = [];
  while ((gm = groupRe.exec(vdXml))) groups.push(gm);
  if (groups.length) {
    body = groups.map(g => {
      const attrs = g[1];
      const num = (k) => parseFloat((attrs.match(new RegExp(`${k}="([^"]+)"`)) || [])[1] || '0');
      const sx = num('scaleX') || 1, sy = num('scaleY') || 1, rot = num('rotation');
      const tx = num('translateX'), ty = num('translateY');
      const inner = [...g[2].matchAll(/<path ([^/>]+)\/>/g)].map(m => pathTag(m[1])).join('');
      return `<g transform="translate(${tx} ${ty}) rotate(${rot}) scale(${sx} ${sy})">${inner}</g>`;
    }).join('');
  } else {
    body = [...vdXml.matchAll(/<path ([^/>]+)\/>/g)].map(m => pathTag(m[1])).join('');
  }
  function pathTag(attrs) {
    const d = (attrs.match(/pathData="([^"]+)"/) || [])[1] || '';
    const alpha = (attrs.match(/fillAlpha="([^"]+)"/) || [])[1];
    const ft = /fillType="evenOdd"/.test(attrs) ? ' fill-rule="evenodd"' : '';
    const sw = (attrs.match(/strokeWidth="([^"]+)"/) || [])[1];
    const stroke = sw ? ` stroke="black" stroke-width="${sw}" fill="none"` : '';
    return `<path d="${d}"${stroke ? stroke : ` fill="black"${alpha ? ` fill-opacity="${alpha}"` : ''}`}${ft}/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" width="256" height="256">${body}</svg>`;
}

async function alphaOf(svgText) {
  const png = await sharp(Buffer.from(svgText), { density: 96 }).resize(256, 256, { fit: 'fill' }).png().toBuffer();
  const { data, info } = await sharp(png).extractChannel(3).raw().toBuffer({ resolveWithObject: true }).catch(async () => {
    // 无 alpha 通道（全不透明）时补全
    const raw = await sharp(png).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
    return raw;
  });
  return { data, w: info.width, h: info.height };
}

async function visualDiff(name, svgSrc, threshold = 1.5) {
  const r = convertSvgToVd(svgSrc);
  if (!r.ok) { ok(`视觉对比[${name}]：转换成功`, false, r.reason); return; }
  const a = await alphaOf(svgSrc.replace(/<svg /, '<svg width="256" height="256" ').replace(/fill="(?!none)[^"]*"/g, 'fill="black"'));
  const b = await alphaOf(vdToSvg(r.xml));
  let diff = 0;
  for (let i = 0; i < a.data.length; i++) {
    if (Math.abs(a.data[i] - b.data[i]) > 40) diff++;
  }
  const pct = diff / a.data.length * 100;
  ok(`视觉对比[${name}]：轮廓差异 ${pct.toFixed(2)}% ≤ ${threshold}%`, pct <= threshold, '');
}

// ---------- C. 端到端工作流 ----------

const CASES = {
  simple: `<svg viewBox="0 0 24 24"><path d="M12 2L2 22h20z" fill="#e53935"/></svg>`,
  shapes: `<svg viewBox="0 0 100 100"><rect x="10" y="10" width="40" height="30" rx="8" fill="#1e88e5"/><circle cx="70" cy="70" r="18" fill="#43a047"/></svg>`,
  arcs: `<svg viewBox="0 0 100 100"><path d="M10 50 A 40 40 0 1 1 90 50 A 40 40 0 1 1 10 50 Z" fill="#000"/></svg>`,
  transform: `<svg viewBox="0 0 100 100"><g transform="translate(20 10) scale(1.5) rotate(15)"><rect x="10" y="10" width="20" height="20" fill="#8e24aa"/></g></svg>`,
  evenodd: `<svg viewBox="0 0 100 100"><path fill-rule="evenodd" d="M10 10h80v80h-80zM30 30h40v40h-40z" fill="#ffb300"/></svg>`,
  stroke: `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="none" stroke="black" stroke-width="6"/></svg>`,
};

(async () => {
  console.log('== B. 视觉等价性（源 SVG vs 转换产物轮廓对比） ==');
  for (const [name, src] of Object.entries(CASES)) await visualDiff(name, src);

  console.log('\n== C. 设计师工作流端到端（新建 mono 项目 → 导入 → 校验 → 覆盖率） ==');
  fs.rmSync(T, { recursive: true, force: true });
  await createProject(T, { name: '_svg_accept', author: 'accept', type: 1, iconStyle: 'adaptive', colorMode: 'mono', brand: 'tecno' });
  const assetDir = path.join(T, '_assets');
  fs.mkdirSync(assetDir, { recursive: true });

  const apps = ['com.demo.alpha', 'com.demo.beta', 'com.demo.gamma'];
  const svgs = [CASES.shapes, CASES.arcs, CASES.transform];
  const tplBg = fs.readFileSync(path.join(__dirname, '../assets/templates/icon_theme_background.webp'));
  const tplTop = fs.readFileSync(path.join(__dirname, '../assets/templates/icon_theme_foreground.webp'));
  const matched = [];
  apps.forEach((pkg, i) => {
    fs.writeFileSync(path.join(assetDir, `${pkg}_bg.png`), tplBg);
    fs.writeFileSync(path.join(assetDir, `${pkg}_top.png`), tplTop);
    fs.writeFileSync(path.join(assetDir, `${pkg}.svg`), svgs[i]);
    matched.push({ file: `${pkg}_bg.png`, layer: 'bg', package: pkg });
    matched.push({ file: `${pkg}_top.png`, layer: 'top', package: pkg });
    matched.push({ file: `${pkg}.svg`, layer: 'mono', package: pkg });
  });
  // 一个不合规 SVG（渐变）→ 应暂存并说明
  fs.writeFileSync(path.join(assetDir, 'com.demo.bad.svg'),
    `<svg viewBox="0 0 24 24"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><path d="M0 0h24v24z" fill="url(#g)"/></svg>`);
  fs.writeFileSync(path.join(assetDir, 'com.demo.bad_bg.png'), tplBg);
  fs.writeFileSync(path.join(assetDir, 'com.demo.bad_top.png'), tplTop);
  matched.push({ file: 'com.demo.bad_bg.png', layer: 'bg', package: 'com.demo.bad' });
  matched.push({ file: 'com.demo.bad_top.png', layer: 'top', package: 'com.demo.bad' });
  matched.push({ file: 'com.demo.bad.svg', layer: 'mono', package: 'com.demo.bad' });

  const r = await importAssets(T, matched, { iconStyle: 'adaptive', colorMode: 'mono', assetDir });
  ok('SVG 转换 3 成功', r.convertedMono.length === 3, JSON.stringify(r.errors));
  ok('渐变 SVG 被拦截暂存并说明', r.pendingSvg.length === 1 && /渐变/.test(r.pendingSvg[0].reason), r.pendingSvg[0]?.reason);
  ok('图片落盘 8', r.placed.length === 8);

  // 产物合法性
  for (const pkg of apps) {
    const xml = fs.readFileSync(path.join(T, 'icons', `${pkg}_monochrome.xml`), 'utf8');
    ok(`${pkg} 产物合法`, checkMonochromeXml(xml).ok);
  }

  // 校验器视角：3 个全适配 0 错误，bad 缺 monochrome 报 1 错误
  const rep = validateTheme(T);
  ok('校验错误恰为 bad 应用缺 monochrome 1 条', rep.errors.length === 1 && rep.errors[0].includes('com.demo.bad'), rep.errors.join('|'));

  // 覆盖率视角
  const list = { apps: [...apps, 'com.demo.bad'].map(p => ({ package: p, name: p, category: 'third-party', required: false })) };
  const cov = coverage(T, list, { iconStyle: 'adaptive', colorMode: 'mono' });
  ok('覆盖率：3 full + 1 partial', cov.summary.full === 3 && cov.summary.partial === 1, JSON.stringify(cov.summary));

  try { fs.rmSync(T, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 }); } catch { /* 留待系统清理 */ }

  console.log(`\n代验收结果：通过 ${passed} 项，失败 ${failed} 项`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
