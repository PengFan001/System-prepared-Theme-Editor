/**
 * 分发构建编排：vite build → electron-builder。
 * 自动注入 npmmirror 二进制镜像（避免 GitHub 下载 Electron/NSIS 卡死），
 * 并清除宿主可能注入的 ELECTRON_RUN_AS_NODE 污染。
 * 用法：node scripts/dist.js [--dir]
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.ELECTRON_BUILDER_BINARIES_MIRROR = env.ELECTRON_BUILDER_BINARIES_MIRROR
  || 'https://npmmirror.com/mirrors/electron-builder-binaries/';

function run(cmd, args, label) {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(cmd, args, { cwd: root, env, stdio: 'inherit', shell: false });
  if (r.status !== 0) {
    console.error(`${label} 失败（exit ${r.status}）`);
    process.exit(r.status || 1);
  }
}

// 1. 构建前端
run(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'app/vite.config.js'], 'vite build');

// 2. electron-builder
// 显式 --publish never：CI 环境下 electron-builder 会隐式尝试发布到 GitHub Releases
// （无 GH_TOKEN 时直接报错退出，产物已生成却来不及上传）；本工具只出安装包，从不自动发布
const ebCli = path.join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
const extra = process.argv.slice(2);
if (!extra.includes('--publish')) extra.push('--publish', 'never');
run(process.execPath, [ebCli, ...extra], 'electron-builder');

console.log('\n构建完成，产物见 release/');
