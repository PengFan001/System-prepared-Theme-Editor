/**
 * Electron 主进程 —— System-prepared Theme Editor
 * 只做壳：窗口、文件对话框、IPC 转发到 core/。业务规则全部在 core。
 */

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');

const { validateTheme } = require('../core/validator');
const { packTheme } = require('../core/packager');
const { generateList, loadList, matchAssets, checkList } = require('../core/mapping');
const { createProject, loadProject, bindList } = require('../core/scaffold');
const { importAssets, coverage, scanLists } = require('../core/importer');

// ---- 中文应用菜单 ----
function buildMenu() {
  const send = (channel) => (_item, win) => { if (win) win.webContents.send(channel); };
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '新建主题项目…', accelerator: 'CmdOrCtrl+N', click: send('menu:new-project') },
        { label: '打开主题目录…', accelerator: 'CmdOrCtrl+O', click: send('menu:open-theme') },
        { type: 'separator' },
        { label: '导出 .xth…', accelerator: 'CmdOrCtrl+E', click: send('menu:export') },
        { type: 'separator' },
        { label: '退出', role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', role: 'reload' },
        { label: '开发者工具', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '实际大小', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { type: 'separator' },
        { label: '切换全屏', role: 'togglefullscreen' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', role: 'minimize' },
        { label: '关闭窗口', role: 'close' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 System-prepared Theme Editor',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: '关于',
              message: 'System-prepared Theme Editor',
              detail: `传音预制主题打包工具（Tecno / Infinix / itel）\n版本 ${app.getVersion()}\nElectron ${process.versions.electron}`,
            });
          },
        },
        {
          label: '打开项目文件夹',
          click: () => shell.openPath(path.join(__dirname, '..')),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: 'System-prepared Theme Editor',
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, '../app/dist/index.html'));
}

// ---- IPC：目录/文件对话框 ----
ipcMain.handle('dialog:selectDir', async (_e, title) => {
  const r = await dialog.showOpenDialog({ title: title || '选择目录', properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:selectFile', async (_e, title, filters) => {
  const r = await dialog.showOpenDialog({ title: title || '选择文件', filters, properties: ['openFile'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:saveFile', async (_e, title, defaultPath, filters) => {
  const r = await dialog.showSaveDialog({ title: title || '保存', defaultPath, filters });
  return r.canceled ? null : r.filePath;
});

// ---- IPC：core 能力 ----
ipcMain.handle('theme:validate', (_e, dir) => validateTheme(dir));
ipcMain.handle('theme:pack', async (_e, dir, out) => packTheme(dir, out));
ipcMain.handle('theme:create', (_e, dir, opts) => createProject(dir, opts));
ipcMain.handle('theme:loadProject', (_e, dir) => loadProject(dir));
ipcMain.handle('list:load', (_e, file) => loadList(file));
ipcMain.handle('list:init', (_e, dirs, project) => generateList(dirs, project));
ipcMain.handle('list:check', (_e, file) => checkList(loadList(file)));
ipcMain.handle('assets:match', (_e, listFile, assetDir) => matchAssets(loadList(listFile), assetDir));
ipcMain.handle('assets:import', (e, themeDir, matched, opts) =>
  importAssets(themeDir, matched, {
    ...opts,
    onProgress: (done, total) => {
      if (!e.sender.isDestroyed()) e.sender.send('assets:import-progress', { done, total });
    },
  }));
ipcMain.handle('list:scan', (_e, themeDir) => scanLists(themeDir));
ipcMain.handle('list:bind', (_e, themeDir, listFile) => bindList(themeDir, listFile));
ipcMain.handle('list:coverage', (_e, themeDir, listFile, profile) =>
  coverage(themeDir, loadList(listFile), profile));

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
