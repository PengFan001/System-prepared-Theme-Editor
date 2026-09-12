/**
 * 预加载脚本：把主进程能力安全暴露给界面（contextIsolation 开启）。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('themeAPI', {
  selectDir: (title) => ipcRenderer.invoke('dialog:selectDir', title),
  selectFile: (title, filters) => ipcRenderer.invoke('dialog:selectFile', title, filters),
  saveFile: (title, defaultPath, filters) => ipcRenderer.invoke('dialog:saveFile', title, defaultPath, filters),

  validate: (dir) => ipcRenderer.invoke('theme:validate', dir),
  pack: (dir, out) => ipcRenderer.invoke('theme:pack', dir, out),
  createProject: (dir, opts) => ipcRenderer.invoke('theme:create', dir, opts),
  loadProject: (dir) => ipcRenderer.invoke('theme:loadProject', dir),

  loadList: (file) => ipcRenderer.invoke('list:load', file),
  initList: (dirs, project) => ipcRenderer.invoke('list:init', dirs, project),
  checkList: (file) => ipcRenderer.invoke('list:check', file),
  matchAssets: (listFile, assetDir) => ipcRenderer.invoke('assets:match', listFile, assetDir),

  // 菜单事件订阅：channel 只允许白名单内的菜单事件
  onMenu: (channel, callback) => {
    const allowed = ['menu:new-project', 'menu:open-theme', 'menu:export'];
    if (!allowed.includes(channel)) return () => {};
    const listener = () => callback();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
