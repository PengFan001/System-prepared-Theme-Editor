/**
 * 开发模式启动：先起 Vite dev server，再起 Electron 指向它。
 */
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const isWin = process.platform === 'win32';
const bin = (name) => path.join(root, 'node_modules', '.bin', isWin ? `${name}.cmd` : name);

const vite = spawn(bin('vite'), ['--config', 'app/vite.config.js'], { cwd: root, stdio: 'inherit' });

// WorkBuddy 等宿主环境会注入 ELECTRON_RUN_AS_NODE=1，
// 它会让 electron 退化成纯 Node（require('electron') 只返回路径字符串），必须剔除
const cleanEnv = () => {
  const env = { ...process.env, VITE_DEV_SERVER_URL: 'http://localhost:5199' };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
};

let electron = null;
const startElectron = () => {
  if (electron) return;
  electron = spawn(bin('electron'), ['.'], {
    cwd: root,
    stdio: 'inherit',
    env: cleanEnv(),
  });
  electron.on('close', () => { vite.kill(); process.exit(0); });
};

// 等 Vite 起来（简单起见轮询端口）
const http = require('http');
const wait = setInterval(() => {
  const req = http.get('http://localhost:5199', () => { clearInterval(wait); startElectron(); });
  req.on('error', () => {});
  req.end();
}, 500);

process.on('SIGINT', () => { vite.kill(); if (electron) electron.kill(); process.exit(0); });
