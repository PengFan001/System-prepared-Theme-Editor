/**
 * 生成应用图标 build/icon.png（512×512，electron-builder 自动转 ico）。
 * 设计：深蓝紫渐变圆角底 + 三层叠放卡片（象征主题分层资源）+ 高光。
 * 占位图标，后续设计师可替换 build/icon.png 后重新构建即可。
 */
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const S = 512;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3b5bfd"/>
      <stop offset="1" stop-color="#7a3bff"/>
    </linearGradient>
    <linearGradient id="hi" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.28"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="108" fill="url(#bg)"/>
  <rect x="16" y="16" width="480" height="480" rx="108" fill="url(#hi)"/>
  <!-- 三层卡片：底层壁纸 / 中层图标 / 顶层调色 -->
  <rect x="116" y="196" width="280" height="200" rx="36" fill="#ffffff" opacity="0.35" transform="rotate(-8 256 296)"/>
  <rect x="120" y="160" width="280" height="200" rx="36" fill="#ffffff" opacity="0.65" transform="rotate(-2 258 260)"/>
  <rect x="124" y="124" width="280" height="200" rx="36" fill="#ffffff"/>
  <!-- 顶卡上的山形（壁纸意象）与太阳 -->
  <circle cx="196" cy="184" r="26" fill="#ffb020"/>
  <path d="M124 288 L208 196 L268 260 L312 216 L404 288 L404 288 Q404 324 368 324 L160 324 Q124 324 124 288 Z" fill="#22c1a3"/>
</svg>`;

(async () => {
  const outDir = path.join(__dirname, '..', 'build');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'icon.png');
  await sharp(Buffer.from(svg)).resize(S, S).png().toFile(out);
  console.log('图标已生成:', out, fs.statSync(out).size, 'bytes');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
