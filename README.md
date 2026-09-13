# System-prepared Theme Editor

传音（Tecno / Infinix / itel）**系统预制主题打包工具** —— 面向设计师的桌面应用，让设计师自助完成预制主题资源的校验与打包，全程不需要手动搭建目录、不需要命令行。

## 功能概览

- **新建项目向导**：选主题类型（完整 / 图标）→ 样式风格（default / glass / foreground_color / mono）→ 图标资源格式 → 品牌（Tecno=HiOS / Infinix=XOS / itel），自动生成标准目录骨架、manifest.json（id 自动生成、prebuilt 锁定 `"1"`）与 description.xml 模板
- **兜底模板预置**：创建项目时自动放入 `icon_theme_background / foreground / mask` 三张 webp 模板图，防止遗漏
- **桌面动态功能配置**：自动预置 `app/com.transsion.launcher3/values` 五件套与基线字体（动态时钟/日历生效的前提），界面化编辑功能开关、日历颜色与排版
- **资源导入**：图标（按包名/应用名自动匹配、歧义裁决、进度反馈）、壁纸 / 预览图 / 字体一键归位，SVG 源自动白名单转换为 `_monochrome.xml`
- **图标预演**：清单行内一键查看图标经系统遮罩后的实际上机效果（双层合成 + 饱和度 + mask 裁切）
- **校验器**：manifest 字段、图标命名与分层配对（`_bg` / `_top` / `_monochrome`）、color_mode 与自适应耦合规则、description.xml 一致性、图片格式嗅探（伪装扩展名识别）、尺寸检查、launcher 配置与字体引用
- **打包器**：目录 → zip → `.xth`；**全包图片强制统一转 webp**（同时改写 description.xml 引用），**version 每次导出自动 +1** 并写回项目
- **适配清单映射**：设计师无需手写包名——按「工具内绑定 / 包名命名 / 应用名命名」三种方式自动归位，含歧义检测与覆盖率报告

## 主题包格式速览

详见 [docs/主题包格式与打包规范.md](docs/主题包格式与打包规范.md) 与 [docs/设计师资源输出规范.md](docs/设计师资源输出规范.md)。

```
<主题项目>/
├── manifest.json        # id / type(0 完整|1 图标) / version / color_mode / prebuilt:"1"
├── icons/               # 图标主体 + description.xml + 兜底模板三件套（全部 webp）
│   ├── <包名>_bg.webp / <包名>_top.webp      # 自适应分层
│   ├── <包名>_monochrome.xml                # mono 可着色主题的矢量上色资源
│   └── <包名>.webp                           # 普通单图（仅 default 样式可用）
├── app/<包名>/           # 应用资源覆盖（drawable/values/font，可选）
├── wallpapers/drawable/  # 壁纸（完整主题）
└── preview/              # 预览图（完整主题）
```

关键规则：

- `color_mode` 四值：`default` / `glass` / `foreground_color`（暗黑样式系统标识）/ `mono`；**非 default 必须使用自适应图标资源**，mono 另需每个应用的 `_monochrome.xml`
- 包内所有图片统一 webp，由工具强制转换，设计师交付源文件格式不限（png/jpg/svg）

## 开发

```bash
npm install          # 安装依赖（.npmrc 已配置 npmmirror 镜像）
npm run dev          # 开发模式（Vite + Electron 联动热更新）

# 命令行（无需界面）
node core/cli.js validate <主题目录>       # 校验
node core/cli.js pack <主题目录> <输出.xth> # 打包（强制 webp，version 自动 +1；--keep-version 关闭）
node core/cli.js new <目录> --name 名称 --type 0 --color-mode mono --brand tecno  # 生成项目骨架
node core/cli.js list:check <清单文件>     # 适配清单体检
```

## 分发构建（产出安装包）

```bash
npm run dist       # 构建前端 + electron-builder，产出到 release/：
                   #   NSIS 安装包（可选安装目录、桌面快捷方式）
                   #   便携版 exe（免安装，双击即用）
npm run dist:dir   # 只产出 win-unpacked 免安装目录（构建快，调试用）
npm run icon       # 重新生成应用图标 build/icon.png（占位图标，可替换后重新构建）
```

说明：

- 安装包为 Windows x64；macOS 构建需在 Mac 上执行（`electron-builder --mac`）
- sharp 原生模块已配置 `asarUnpack`，安装包内可直接读写
- 构建机如需下载 Electron/NSIS 二进制，已配置 npmmirror 镜像（`electronDownload.mirror` + 环境变量 `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`）

### macOS 分发（设计师用 Mac 的场景）

macOS 包**必须在 Mac 环境构建**（electron-builder 不支持在 Windows 上打 mac 包），两种方式：

**方式一：GitHub Actions 云端构建（推荐，无需 Mac）**

仓库已内置 `.github/workflows/build-mac.yml`：

1. 打开 GitHub 仓库 → **Actions** 页签 → 左侧选 **build-mac** → **Run workflow**
2. 等待构建完成（约 5-10 分钟），在该次运行页面的 **Artifacts** 区下载 `mac-dist`
3. 内含 `*-arm64.dmg`（Apple 芯片 Mac：M1/M2/M3/M4）和 `*-x64.dmg`（Intel Mac），按需分发给设计师

**方式二：找一台 Mac 本地构建**

```bash
git clone <仓库地址> && cd System-prepared-Theme-Editor
npm install
node scripts/dist.js --mac --arm64 --x64   # 产物在 release/
```

**设计师首次打开（未签名应用的必要操作）**：当前构建未做 Apple 签名/公证（需付费开发者账号），macOS 会拦截。首次使用任选其一：

- 访达中**右键 App → 打开** → 弹窗中再点"打开"（之后双击即可正常启动）
- 或终端执行：`xattr -cr "/Applications/System-prepared Theme Editor.app"`

若后续采购 Apple Developer 账号（$99/年），配置证书 + 公证后设计师即可无感安装。

## 适配清单接入（多台电脑 / 新同事上手）

适配清单（应用名 ↔ 包名 ↔ 分类）由项目方提供，**不入仓库**（含内部包名信息）。拿到清单文件后：

```bash
# 1. 放入项目根目录的 lists/ 文件夹（该目录已被 .gitignore 排除，不会误提交）
#    例如：lists/adaptation-list.json

# 2. 体检清单（可选）：查看 name 空缺统计、包名重复、必须适配但无名条目
node core/cli.js list:check lists/adaptation-list.json

# 3. 资源匹配：将设计师素材目录与清单匹配，输出归位方案、歧义/冲突与覆盖率报告
node core/cli.js map lists/adaptation-list.json <素材目录>
```

说明：

- 没有清单时，新建项目向导、校验、打包**均不受影响**——清单只影响「资源自动归位」和「覆盖率报告」
- 有样本主题包时可用 `list:init` 反向生成清单：
  `node core/cli.js list:init <样本目录...> -o lists/adaptation-list.json -p transsion`
- 界面版的清单自动发现与绑定（打开项目自动识别 `lists/*.json`、清单浏览、拖图归位、实时覆盖率）将在 P1③ 资源导入中提供

## 目录结构

```
core/       # 业务核心（与 UI 解耦，可独立单测）
├── profiles.js       # 规则唯一事实来源（命名/尺寸/color_mode/品牌映射）
├── validator.js      # 校验器
├── packager.js       # 打包器（zip → .xth，强制 webp，version 自动 +1）
├── scaffold.js       # 项目骨架生成
├── mapping.js        # 适配清单与资源映射
├── importer.js       # 资源导入（图标/壁纸/预览图/字体 + 覆盖率）
├── launcherConfig.js # 桌面动态功能配置读写与基线播种
├── svg2vd.js         # SVG → VectorDrawable 白名单转换
├── preview.js        # 图标 mask 合成预演
└── cli.js            # 命令行入口
electron/   # Electron 主进程 / 预加载（IPC 包裹 core）
app/        # Vue 3 + Vite 界面
assets/     # 随包分发的模板资源（兜底三件套、launcher 基线 XML/字体）
build/      # 应用图标（npm run icon 重新生成）
scripts/    # 开发/构建编排与回归测试脚本
docs/       # 格式规范与设计师交付规范
```

## 注意事项

- **兜底模板三件套已随仓库提供**（`assets/templates/`，当前为临时资源，正式设计稿到位后替换该目录）
- **`themeSource/`（主题资源样本）与 `lists/`（适配清单）不入库**（涉内部资源信息），接入方式见上文「适配清单接入」
- 打包产物 `.xth` 消费端为传音系统主题平台
