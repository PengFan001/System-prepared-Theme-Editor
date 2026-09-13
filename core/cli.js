#!/usr/bin/env node
/**
 * ThemePackager CLI
 *
 *   node core/cli.js validate <主题目录>
 *   node core/cli.js pack <主题目录> <输出.xth> [--webp]
 */

const { validateTheme } = require('./validator');
const { packTheme } = require('./packager');
const { generateList, loadList, matchAssets, checkList } = require('./mapping');
const { createProject } = require('./scaffold');
const fs = require('fs');

function printReport(dir, r) {
  console.log(`\n=== ${dir} ===`);
  if (r.profile) {
    const p = r.profile;
    console.log(`画像: type=${p.type}(${p.type === 0 ? '完整主题' : '图标主题'}) iconStyle=${p.iconStyle} colorMode=${p.colorMode || '-'} mono=${p.isMono}`);
  }
  console.log(`统计: 图标=${r.stats.iconCount ?? 0} 预览图=${r.stats.previewCount ?? 0} 壁纸=${r.stats.wallpaperCount ?? 0} app覆盖=${r.stats.appPkgCount ?? 0}`);
  if (r.errors.length) {
    console.log(`\n错误 (${r.errors.length}):`);
    r.errors.forEach(e => console.log(`  [E] ${e}`));
  }
  if (r.warnings.length) {
    console.log(`警告 (${r.warnings.length}):`);
    r.warnings.slice(0, 20).forEach(w => console.log(`  [W] ${w}`));
    if (r.warnings.length > 20) console.log(`  ... 其余 ${r.warnings.length - 20} 条警告省略`);
  }
  if (!r.errors.length && !r.warnings.length) console.log('校验通过，无问题。');
  return r.errors.length ? 1 : 0;
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'validate') {
    const dir = args[0];
    if (!dir) { console.error('用法: validate <主题目录>'); process.exit(2); }
    process.exit(printReport(dir, validateTheme(dir)));
  }
  if (cmd === 'list:init') {
    // list:init <主题目录...> -o <清单输出.json> [-p 项目名]
    const oi = args.indexOf('-o');
    const pi = args.indexOf('-p');
    if (oi < 0 || oi === 0) { console.error('用法: list:init <主题目录...> -o <清单输出.json> [-p 项目名]'); process.exit(2); }
    const dirs = args.slice(0, oi).filter(a => !a.startsWith('-'));
    const out = args[oi + 1];
    const project = pi >= 0 ? args[pi + 1] : 'default';
    const list = generateList(dirs, project);
    fs.mkdirSync(require('path').dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(list, null, 2));
    const cats = { system: 0, 'third-party': 0, special: 0 };
    list.apps.forEach(a => cats[a.category]++);
    console.log(`清单已生成: ${out}（共 ${list.apps.length} 个条目：system ${cats.system} / third-party ${cats['third-party']} / special ${cats.special}）`);
    console.log('提示：name 字段为空的条目请补充应用名，供设计师按名匹配。');
    return;
  }
  if (cmd === 'list:check') {
    const listFile = args[0];
    if (!listFile) { console.error('用法: list:check <清单.json>'); process.exit(2); }
    const { stats, issues } = checkList(loadList(listFile));
    console.log(`\n=== 清单自检 ===`);
    console.log(`共 ${stats.total} 个条目，已补名 ${stats.named} 个`);
    console.log(`name 空缺：system ${stats.missingName.system} / third-party ${stats.missingName['third-party']} / special ${stats.missingName.special}`);
    if (issues.length) {
      console.log(`\n需处理 (${issues.length}):`);
      issues.slice(0, 30).forEach(i => console.log(`  - ${i}`));
      if (issues.length > 30) console.log(`  ... 其余 ${issues.length - 30} 条省略`);
    } else {
      console.log('无问题。');
    }
    return;
  }
  if (cmd === 'map') {
    const [listFile, assetDir] = args;
    if (!listFile || !assetDir) { console.error('用法: map <清单.json> <资源目录>'); process.exit(2); }
    const r = matchAssets(loadList(listFile), assetDir);
    console.log(`\n=== 匹配结果 ===`);
    console.log(`已匹配 ${r.matched.length} 个文件：`);
    r.matched.forEach(m => console.log(`  [${m.method}] ${m.file} → ${m.package}（${m.layer}层）`));
    if (r.ambiguous.length) {
      console.log(`\n歧义待确认 ${r.ambiguous.length} 个：`);
      r.ambiguous.forEach(a => console.log(`  ${a.file} → 候选: ${a.candidates.join(' / ')}`));
    }
    if (r.unmatched.length) {
      console.log(`\n无法匹配 ${r.unmatched.length} 个（不在清单内）：`);
      r.unmatched.forEach(f => console.log(`  ${f}`));
    }
    if (r.conflicts && r.conflicts.length) {
      console.log(`\n图层冲突 ${r.conflicts.length} 个（同一应用同一层有多个文件）：`);
      r.conflicts.forEach(c => console.log(`  ${c.package}（${c.layer}层）: ${c.files.join(' vs ')}`));
    }
    console.log(`\n=== 覆盖率 ===`);
    const total = r.matched.length ? new Set(r.matched.map(m => m.package)).size : 0;
    console.log(`清单已覆盖 ${total} 个应用，未适配 ${r.uncovered.length} 个（将走 mask 兜底）：`);
    r.uncovered.slice(0, 15).forEach(u => console.log(`  [${u.category}] ${u.name || u.package}${u.required ? '（必须适配！）' : ''}`));
    if (r.uncovered.length > 15) console.log(`  ... 其余 ${r.uncovered.length - 15} 个省略`);
    process.exit((r.unmatched.length || r.ambiguous.length || (r.conflicts && r.conflicts.length)) ? 1 : 0);
  }
  if (cmd === 'new') {
    // new <目录> --name 名称 --author 作者 --type 0|1 --style normal|adaptive --color-mode mono? --brand tecno|infinix|itel
    const dir = args[0];
    const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
    if (!dir || !opt('--name')) {
      console.error('用法: new <目录> --name 名称 [--author 作者] [--type 0|1] [--style normal|adaptive] [--color-mode default|glass|foreground_color|mono] [--brand tecno|infinix|itel]');
      process.exit(2);
    }
    const r = await createProject(dir, {
      name: opt('--name'),
      author: opt('--author'),
      type: Number(opt('--type') ?? 0),
      iconStyle: opt('--style') || 'adaptive',
      colorMode: opt('--color-mode'),
      brand: opt('--brand'),
    });
    console.log(`项目已创建: ${r.dir}`);
    console.log(`manifest: type=${r.manifest.type} name="${r.manifest.name}" prebuilt="1"${r.manifest.color_mode ? ' color_mode=' + r.manifest.color_mode : ''}`);
    return;
  }
  if (cmd === 'pack') {
    const [dir, out] = args;
    const keepFormat = args.includes('--keep-format');
    const keepVersion = args.includes('--keep-version');
    if (!dir || !out) { console.error('用法: pack <主题目录> <输出.xth> [--keep-format] [--keep-version]'); process.exit(2); }
    const r = validateTheme(dir);
    printReport(dir, r);
    if (r.errors.length) { console.error('\n存在错误，已阻断打包。'); process.exit(1); }
    const res = await packTheme(dir, out, { keepFormat, bumpVersion: !keepVersion });
    if (res.version) console.log(`version: ${res.version.from} → ${res.version.to}`);
    console.log(`\n打包完成: ${res.outFile}（${res.fileCount} 个文件，${(res.bytes / 1024 / 1024).toFixed(2)} MB）`);
    return;
  }
  console.error('命令: new | validate | pack | list:init | list:check | map');
  process.exit(2);
}

main().catch(e => { console.error(e.message); process.exit(1); });
