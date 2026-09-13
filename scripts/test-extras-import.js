// P1④ importExtras 端到端测试（临时项目，不动用户数据）
const fs = require('fs');
const path = require('path');
const { createProject } = require('../core/scaffold');
const { importExtras } = require('../core/importer');
const { validateTheme } = require('../core/validator');

const ROOT = path.join(__dirname, '..');
const T = path.join('D:\\test_theme_output', '_p14_test');
const SAMPLE = path.join(ROOT, 'themeSource', 'normal_theme', 'Painterly_Landscape');

(async () => {
  // 0. 清理并新建临时项目（type 0 / foreground_color / tecno）
  fs.rmSync(T, { recursive: true, force: true });
  await createProject(T, {
    name: '_p14_test', author: 'test', type: 0,
    iconStyle: 'adaptive', colorMode: 'foreground_color', brand: 'tecno',
  });
  console.log('[1] 项目创建 OK');

  // 1. 导入前校验：应有缺壁纸/预览图警告
  let r = await validateTheme(T);
  const before = r.warnings.filter(w => /wallpaper|preview|预览|壁纸/.test(w));
  console.log('[2] 导入前壁纸/预览相关警告', before.length, '条');
  before.forEach(w => console.log('    -', w));

  // 2. 导入壁纸 + 预览图（5 张 unlock 乱序）+ 字体
  const extras = {
    wallpaperHome: path.join(SAMPLE, 'wallpapers', 'drawable', 'wallpaper_home.png'),
    wallpaperLock: path.join(SAMPLE, 'wallpapers', 'drawable', 'wallpaper_lock.png'),
    previewLock: path.join(SAMPLE, 'preview', 'preview_lock_0.png'),
    previewUnlock: [
      path.join(SAMPLE, 'preview', 'preview_unlock_2.png'),
      path.join(SAMPLE, 'preview', 'preview_unlock_0.png'),
      path.join(SAMPLE, 'preview', 'preview_unlock_4.png'),
    ],
    thumbnail: path.join(SAMPLE, 'preview', 'thumbnail.png'),
    fonts: [path.join(ROOT, 'themeSource', 'support_adaptive_icon_feature_theme', 'XOS', 'app', 'com.transsion.launcher3', 'font', 'tos_1030_numerals_medium480.ttf')],
  };
  const res = await importExtras(T, extras, { onProgress: (d, t, f) => console.log(`    进度 ${d}/${t} ${f}`) });
  console.log('[3] 导入结果: placed', res.placed.length, '| overwritten', res.overwritten.length, '| errors', res.errors.length);
  res.placed.forEach(p => console.log('    +', p.target));
  res.errors.forEach(e => console.log('    !', e));
  if (res.errors.length) throw new Error('导入有失败项');

  // 3. 落盘断言
  const must = [
    'wallpapers/drawable/wallpaper_home.webp',
    'wallpapers/drawable/wallpaper_lock.webp',
    'preview/preview_lock_0.webp',
    'preview/preview_unlock_0.webp',
    'preview/preview_unlock_1.webp',
    'preview/preview_unlock_2.webp',
    'preview/thumbnail.webp',
    'app/com.transsion.launcher3/font/tos_1030_numerals_medium480.ttf',
  ];
  for (const m of must) {
    if (!fs.existsSync(path.join(T, m))) throw new Error('缺少落盘文件: ' + m);
  }
  // 不应残留非 webp 图片
  const leftover = [];
  for (const sub of ['wallpapers/drawable', 'preview']) {
    for (const f of fs.readdirSync(path.join(T, sub))) {
      if (!f.endsWith('.webp')) leftover.push(sub + '/' + f);
    }
  }
  if (leftover.length) throw new Error('残留非 webp: ' + leftover.join(', '));
  console.log('[4] 落盘断言 OK（8 个文件，无非 webp 残留）');

  // 4. 重导入 2 张 unlock：旧序列 preview_unlock_2 应被清空
  const res2 = await importExtras(T, { previewUnlock: [extras.previewUnlock[0], extras.previewUnlock[1]] });
  if (res2.errors.length) throw new Error('二次导入失败: ' + res2.errors.join('; '));
  const remaining = fs.readdirSync(path.join(T, 'preview')).filter(f => /^preview_unlock_\d+/.test(f));
  if (remaining.length !== 2) throw new Error('unlock 序列未清空残留: ' + remaining.join(', '));
  console.log('[5] unlock 序列重排 OK（旧 3 张 → 新 2 张，无残留）');

  // 5. 导入后校验：壁纸/预览图警告应消失
  r = await validateTheme(T);
  const after = r.warnings.filter(w => /wallpaper|preview|预览|壁纸/.test(w));
  console.log('[6] 导入后壁纸/预览相关警告', after.length, '条');
  after.forEach(w => console.log('    -', w));
  console.log('[7] 校验: errors', r.errors.length, '| warnings', r.warnings.length,
    '| 预览图', r.stats.previewCount, '| 壁纸', r.stats.wallpaperCount);
  if (r.errors.length) { r.errors.forEach(e => console.log('    [错误]', e)); throw new Error('校验有错误'); }

  console.log('\n全部通过 ✔');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
