# System-prepared Theme Editor

传音（Tecno / Infinix / itel）**系统预制主题打包工具** —— 面向设计师的桌面应用，让设计师自助完成预制主题资源的校验与打包，全程不需要手动搭建目录、不需要命令行。

## 功能概览

- **新建项目向导**：选主题类型（完整 / 图标）→ 样式风格（default / glass / foreground_color / mono）→ 图标资源格式 → 品牌（Tecno=HiOS / Infinix=XOS / itel），自动生成标准目录骨架、manifest.json（id 自动生成、prebuilt 锁定 `"1"`）与 description.xml 模板
- **兜底模板预置**：创建项目时自动放入 `icon_theme_background / foreground / mask` 三张 webp 模板图，防止遗漏
- **校验器**：manifest 字段、图标命名与分层配对（`_bg` / `_top` / `_monochrome`）、color_mode 与自适应耦合规则、description.xml 一致性、图片格式嗅探（伪装扩展名识别）、尺寸检查
- **打包器**：目录 → zip → `.xth`；**全包图片强制统一转 webp**（同时改写 description.xml 引用），保证包内零非 webp 图片
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
node core/cli.js pack <主题目录> <输出.xth> # 打包（强制 webp）
node core/cli.js new <目录> --name 名称 --type 0 --color-mode mono --brand tecno  # 生成项目骨架
node core/cli.js list:check <清单文件>     # 适配清单体检
```

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
├── profiles.js    # 规则唯一事实来源（命名/尺寸/color_mode/品牌映射）
├── validator.js   # 校验器
├── packager.js    # 打包器（zip → .xth，强制 webp）
├── scaffold.js    # 项目骨架生成
├── mapping.js     # 适配清单与资源映射
└── cli.js         # 命令行入口
electron/   # Electron 主进程 / 预加载（IPC 包裹 core）
app/        # Vue 3 + Vite 界面
docs/       # 格式规范与设计师交付规范
```

## 注意事项

- **兜底模板三件套已随仓库提供**（`assets/templates/`，当前为临时资源，正式设计稿到位后替换该目录）
- **`themeSource/`（主题资源样本）与 `lists/`（适配清单）不入库**（涉内部资源信息），接入方式见上文「适配清单接入」
- 打包产物 `.xth` 消费端为传音系统主题平台
