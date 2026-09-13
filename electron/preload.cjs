/**
 * 预加载脚本：把主进程能力安全暴露给界面（contextIsolation 开启）。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('themeAPI', {
  selectDir: (title) => ipcRenderer.invoke('dialog:selectDir', title),
  selectFile: (title, filters) => ipcRenderer.invoke('dialog:selectFile', title, filters),
  selectFiles: (title, filters) => ipcRenderer.invoke('dialog:selectFiles', title, filters),
  saveFile: (title, defaultPath, filters) => ipcRenderer.invoke('dialog:saveFile', title, defaultPath, filters),

  validate: (dir) => ipcRenderer.invoke('theme:validate', dir),
  pack: (dir, out) => ipcRenderer.invoke('theme:pack', dir, out),
  createProject: (dir, opts) => ipcRenderer.invoke('theme:create', dir, opts),
  loadProject: (dir) => ipcRenderer.invoke('theme:loadProject', dir),

  loadList: (file) => ipcRenderer.invoke('list:load', file),
  initList: (dirs, project) => ipcRenderer.invoke('list:init', dirs, project),
  checkList: (file) => ipcRenderer.invoke('list:check', file),
  matchAssets: (listFile, assetDir) => ipcRenderer.invoke('assets:match', listFile, assetDir),
  importAssets: (themeDir, matched, opts) => ipcRenderer.invoke('assets:import', themeDir, matched, opts),
  importExtras: (themeDir, extras) => ipcRenderer.invoke('extras:import', themeDir, extras),
  onExtrasProgress: (callback) => {
    const listener = (_e, p) => callback(p);
    ipcRenderer.on('extras:import-progress', listener);
    return () => ipcRenderer.removeListener('extras:import-progress', listener);
  },
  scanLists: (themeDir) => ipcRenderer.invoke('list:scan', themeDir),
  bindList: (themeDir, listFile) => ipcRenderer.invoke('list:bind', themeDir, listFile),
  coverage: (themeDir, listFile, profile) => ipcRenderer.invoke('list:coverage', themeDir, listFile, profile),
  launcherGetConfig: (themeDir) => ipcRenderer.invoke('launcher:getConfig', themeDir),
  launcherSaveConfig: (themeDir, config) => ipcRenderer.invoke('launcher:saveConfig', themeDir, config),
  launcherSeedBaseline: (themeDir) => ipcRenderer.invoke('launcher:seedBaseline', themeDir),
  onImportProgress: (callback) => {
    const listener = (_e, p) => callback(p);
    ipcRenderer.on('assets:import-progress', listener);
    return () => ipcRenderer.removeListener('assets:import-progress', listener);
  },

  // 菜单事件订阅：channel 只允许白名单内的菜单事件
  onMenu: (channel, callback) => {
    const allowed = ['menu:new-project', 'menu:open-theme', 'menu:export'];
    if (!allowed.includes(channel)) return () => {};
    const listener = () => callback();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
