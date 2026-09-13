// launcher values 五件套：scaffold 预置 / 读写往返 / 基线补齐 / 校验联动 端到端测试
const fs = require('fs');
const path = require('path');
const { createProject } = require('../core/scaffold');
const { readLauncherConfig, writeLauncherConfig, seedLauncherBaseline, sanitizeConfig } = require('../core/launcherConfig');
const { validateTheme } = require('../core/validator');

const T = path.join('D:\\test_theme_output', '_launcher_test');
const LDIR = path.join('app', 'com.transsion.launcher3');

function assert(cond, msg) { if (!cond) throw new Error('断言失败: ' + msg); }

(async () => {
  // 1. 新建项目自动带五件套 + 基线字体
  fs.rmSync(T, { recursive: true, force: true });
  const r = await createProject(T, {
    name: '_launcher_test', author: 'test', type: 0,
    iconStyle: 'adaptive', colorMode: 'foreground_color', brand: 'tecno',
  });
  assert(r.baseline.xmlSeeded.length === 5, '应播种 5 个 XML: ' + JSON.stringify(r.baseline));
  assert(r.baseline.fontsSeeded.length === 2, '应播种 2 个字体: ' + JSON.stringify(r.baseline));
  for (const f of ['arrays', 'strings', 'colors', 'dimens', 'bools']) {
    assert(fs.existsSync(path.join(T, LDIR, 'values', f + '.xml')), '缺 values/' + f + '.xml');
  }
  for (const f of ['tos_1030_numerals_medium480.ttf', 'tran_calendar_week_font.ttf']) {
    assert(fs.existsSync(path.join(T, LDIR, 'font', f)), '缺 font/' + f);
  }
  console.log('[1] scaffold 预置 OK（5 XML + 2 ttf）');

  // 2. 新项目校验：无 launcher 相关警告
  let v = await validateTheme(T);
  let lw = v.warnings.filter(w => /launcher3/.test(w));
  assert(lw.length === 0, '新项目不应有 launcher 警告: ' + lw.join(' | '));
  console.log('[2] 新项目 0 launcher 警告 OK');

  // 3. 读取基线配置：关键默认值正确
  let cfg = readLauncherConfig(T);
  assert(Object.values(cfg.files).every(Boolean), 'files 应全部存在');
  assert(cfg.fonts.length === 2, 'fonts 应列出 2 个 ttf');
  assert(cfg.config.bools.tran_global_calendar_support === true, '基线应开全球日历');
  assert(cfg.config.bools.is_dynamic_theme_overlay === false, '基线 is_dynamic_theme_overlay=false');
  assert(cfg.config.colors.tran_calendar_date_color.toUpperCase() === '#FF393E40', '基线日期颜色');
  assert(cfg.config.dimens.tran_calendar_date_y === 48, '基线 date_y=48');
  assert(cfg.config.strings.tran_calendar_date_typeface === 'font/tos_1030_numerals_medium480.ttf', '基线日期字体路径');
  assert(cfg.spec.bools.length === 8 && cfg.spec.colors.length === 4 && cfg.spec.dimens.length === 6 && cfg.spec.strings.length === 2, 'spec 项数');
  console.log('[3] 基线读取 OK（8 开关/4 颜色/6 排版/2 字体路径）');

  // 4. 修改写回 → 重读往返一致
  const mod = JSON.parse(JSON.stringify(cfg.config));
  mod.bools.is_dynamic_theme_overlay = true;
  mod.bools.tran_global_calendar_support = false;
  mod.colors.tran_calendar_date_color = '#80FF0000';
  mod.dimens.tran_calendar_date_y = 52.5;
  mod.strings.tran_calendar_week_typeface = 'font/tran_calendar_week_font.ttf';
  writeLauncherConfig(T, mod);
  cfg = readLauncherConfig(T);
  assert(cfg.config.bools.is_dynamic_theme_overlay === true, '写回 bool 未生效');
  assert(cfg.config.bools.tran_global_calendar_support === false, '写回 bool2 未生效');
  assert(cfg.config.colors.tran_calendar_date_color === '#80FF0000', '写回 color 未生效: ' + cfg.config.colors.tran_calendar_date_color);
  assert(cfg.config.dimens.tran_calendar_date_y === 52.5, '写回 dimen 未生效');
  console.log('[4] 写回→重读往返一致 OK');

  // 5. 非法输入必须抛错
  for (const [bad, msg] of [
    [{ colors: { tran_calendar_date_color: 'red' } }, '非法颜色'],
    [{ dimens: { tran_calendar_date_y: 'abc' } }, '非法 dimen'],
    [{ strings: { tran_calendar_date_typeface: 'fonts/x.ttf' } }, '非法字体路径'],
  ]) {
    let threw = false;
    try { sanitizeConfig(bad); } catch { threw = true; }
    assert(threw, msg + '应抛错');
  }
  console.log('[5] 非法输入拦截 OK');

  // 6. 存量项目补齐：删掉 2 个 XML + 全部字体 → seedBaseline 只补缺失，不覆盖已改
  fs.rmSync(path.join(T, LDIR, 'values', 'colors.xml'));
  fs.rmSync(path.join(T, LDIR, 'values', 'bools.xml'));
  fs.rmSync(path.join(T, LDIR, 'font'), { recursive: true, force: true });
  v = await validateTheme(T);
  lw = v.warnings.filter(w => /launcher3/.test(w));
  assert(lw.length >= 1, '缺文件应有 launcher 警告');
  console.log('[6] 缺失检出 OK：', lw[0]);
  const seed = seedLauncherBaseline(T);
  assert(seed.xmlSeeded.length === 2, '只补 2 个缺失 XML: ' + seed.xmlSeeded);
  assert(seed.fontsSeeded.length === 2, '补 2 个字体');
  // 已修改的 dimens.xml 不应被基线覆盖
  cfg = readLauncherConfig(T);
  assert(cfg.config.dimens.tran_calendar_date_y === 52.5, 'seedBaseline 覆盖了已修改的 dimens！');
  v = await validateTheme(T);
  lw = v.warnings.filter(w => /launcher3/.test(w));
  assert(lw.length === 0, '补齐后不应再有 launcher 警告: ' + lw.join(' | '));
  console.log('[7] seedBaseline 只补缺失、不覆盖已改 OK；补齐后 0 警告');

  console.log('\n全部通过 ✔');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
