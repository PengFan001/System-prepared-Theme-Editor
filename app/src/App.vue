<template>
  <div class="header">
    <h1>System-prepared Theme Editor</h1>
    <span class="sub">传音预制主题打包工具 · Tecno / Infinix / itel</span>
  </div>

  <!-- ========== 首页 ========== -->
  <div v-if="view === 'home'" class="main home">
    <div class="home-card" @click="startWizard">
      <div class="home-title">新建主题项目</div>
      <div class="home-desc">三步生成标准目录骨架：选类型与品牌 → 填主题信息 → 选择存放位置</div>
    </div>
    <div class="home-card" @click="pickDir">
      <div class="home-title">打开主题目录</div>
      <div class="home-desc">打开已有的主题项目进行校验、资源管理与导出 .xth</div>
    </div>
  </div>

  <!-- ========== 新建项目向导 ========== -->
  <div v-else-if="view === 'wizard'" class="main">
    <div class="panel">
      <div class="steps">
        <span v-for="(s, i) in ['类型与品牌', '主题信息', '存放位置']" :key="i"
              class="step" :class="{ active: wizStep === i + 1, done: wizStep > i + 1 }">
          {{ i + 1 }}. {{ s }}
        </span>
      </div>
    </div>

    <!-- 第 1 步：类型与品牌 -->
    <div v-if="wizStep === 1" class="panel">
      <h2>主题类型</h2>
      <div class="opt-row">
        <div class="opt-card" :class="{ on: wiz.type === 0 }" @click="wiz.type = 0">
          <div class="opt-title">完整主题</div>
          <div class="opt-desc">type 0 · 图标 + 壁纸 + 预览图 + 应用资源覆盖</div>
        </div>
        <div class="opt-card" :class="{ on: wiz.type === 1 }" @click="wiz.type = 1">
          <div class="opt-title">图标主题</div>
          <div class="opt-desc">type 1 · 只换图标，不含壁纸/预览图</div>
        </div>
      </div>

      <h2>样式风格（color_mode）</h2>
      <div class="opt-row">
        <div v-for="c in colorModes" :key="c.key" class="opt-card"
             :class="{ on: wiz.colorMode === c.key }" @click="wiz.colorMode = c.key">
          <div class="opt-title">{{ c.label }}</div>
          <div class="opt-desc">{{ c.desc }}</div>
        </div>
      </div>

      <h2>图标资源格式</h2>
      <div v-if="wiz.colorMode === 'default'" class="opt-row">
        <div class="opt-card" :class="{ on: wiz.style === 'normal' }" @click="wiz.style = 'normal'">
          <div class="opt-title">普通图标</div>
          <div class="opt-desc">单图 webp 162×162 · 非自适应</div>
        </div>
        <div class="opt-card" :class="{ on: wiz.style === 'adaptive' }" @click="wiz.style = 'adaptive'">
          <div class="opt-title">自适应图标</div>
          <div class="opt-desc">前景 _top + 背景 _bg 分层 webp 324×324</div>
        </div>
      </div>
      <div v-else class="form-note" style="margin-bottom:20px">
        {{ colorModes.find(c => c.key === wiz.colorMode).label }}样式必须使用自适应图标资源（_bg/_top 分层 webp 324×324{{
          wiz.colorMode === 'mono' ? ' + _monochrome.xml 上色资源' : '' }}），已自动锁定。
      </div>

      <h2>品牌平台</h2>
      <div class="opt-row">
        <div v-for="b in brands" :key="b.key" class="opt-card" :class="{ on: wiz.brand === b.key }" @click="wiz.brand = b.key">
          <div class="opt-title">{{ b.label }}</div>
          <div class="opt-desc">{{ b.desc }}</div>
        </div>
      </div>
    </div>

    <!-- 第 2 步：主题信息 -->
    <div v-if="wizStep === 2" class="panel">
      <h2>主题信息（写入 manifest.json）</h2>
      <div class="form">
        <label>主题名称 *</label>
        <input v-model="wiz.name" placeholder="例如：晨曦晨光" />
        <label>作者 *</label>
        <input v-model="wiz.author" placeholder="设计师或团队名" />
        <label>描述</label>
        <input v-model="wiz.description" placeholder="不填则与名称一致" />
        <div class="form-note">
          id 由工具自动生成（UUID）；version 从 1 开始，后续资源更新时递增；prebuilt 锁定为 "1"（系统预制）。
        </div>
      </div>
    </div>

    <!-- 第 3 步：存放位置 -->
    <div v-if="wizStep === 3" class="panel">
      <h2>存放位置</h2>
      <div class="form">
        <label>项目根目录 *</label>
        <div>
          <button class="btn" @click="pickParent">选择目录…</button>
          <span class="dir-line" style="display:inline">{{ wiz.parent || '未选择' }}</span>
        </div>
        <label>项目文件夹名 *</label>
        <input v-model="wiz.folder" placeholder="主题项目的文件夹名" />
        <div v-if="wiz.parent && wiz.folder" class="form-note">
          将创建：{{ wiz.parent }}{{ sep }}{{ wiz.folder }}
        </div>
      </div>
    </div>

    <div v-if="wizError" class="issue error">{{ wizError }}</div>

    <div class="panel wiz-actions">
      <button class="btn" @click="view = 'home'">取消</button>
      <button class="btn" :disabled="wizStep === 1" @click="wizStep--">上一步</button>
      <button v-if="wizStep < 3" class="btn primary" :disabled="!canNext" @click="wizStep++">下一步</button>
      <button v-else class="btn primary" :disabled="!canCreate || creating" @click="doCreate">
        {{ creating ? '创建中…' : '创建项目' }}
      </button>
    </div>
  </div>

  <!-- ========== 项目工作台 ========== -->
  <div v-else class="main">
    <div class="panel">
      <h2>主题项目</h2>
      <button class="btn" @click="view = 'home'">返回首页</button>
      <button class="btn" @click="pickDir">打开其他目录…</button>
      <button class="btn primary" :disabled="!dir || packing" @click="doPack">
        {{ packing ? '打包中…' : '导出 .xth' }}
      </button>
      <div v-if="dir" class="dir-line">{{ dir }}</div>
      <div v-if="projectMeta" class="profile" style="margin-top:8px">
        <span class="tag">工具项目</span>
        <span v-if="projectMeta.brand" class="tag">{{ brandLabel(projectMeta.brand) }}</span>
        <span class="tag">{{ projectMeta.iconStyle === 'adaptive' ? '自适应图标' : '普通图标' }}</span>
        <span v-if="projectMeta.colorMode" class="tag">{{ colorModes.find(c => c.key === projectMeta.colorMode)?.label || projectMeta.colorMode }}</span>
      </div>
    </div>

    <div v-if="report" class="panel">
      <h2>校验报告</h2>
      <div v-if="report.profile" class="profile">
        <span class="tag">{{ report.profile.type === 0 ? '完整主题' : '图标主题' }}</span>
        <span class="tag">{{ report.profile.iconStyle === 'adaptive' ? '自适应图标' : '普通图标' }}</span>
        <span v-if="report.profile.colorMode" class="tag">color_mode: {{ report.profile.colorMode }}</span>
        <span v-if="report.profile.isMono" class="tag">mono 可着色</span>
      </div>
      <div class="stats">
        图标 {{ report.stats.iconCount }} · 预览图 {{ report.stats.previewCount }} ·
        壁纸 {{ report.stats.wallpaperCount }} · 应用覆盖 {{ report.stats.appPkgCount }}
      </div>
      <div v-if="!report.errors.length && !report.warnings.length" class="ok-line">校验通过，无问题。</div>
      <div class="issue-list">
        <div v-for="(e, i) in report.errors" :key="'e' + i" class="issue error">[错误] {{ e }}</div>
        <div v-for="(w, i) in report.warnings" :key="'w' + i" class="issue warn">[警告] {{ w }}</div>
      </div>
    </div>

    <div v-if="packResult" class="panel">
      <h2>打包结果</h2>
      <div class="pack-result">
        {{ packResult.outFile }}（{{ packResult.fileCount }} 个文件，{{ (packResult.bytes / 1024 / 1024).toFixed(2) }} MB）
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';

const view = ref('home'); // home | wizard | project
const dir = ref(null);
const report = ref(null);
const packing = ref(false);
const packResult = ref(null);
const projectMeta = ref(null);

// ---------- 向导状态 ----------
const wizStep = ref(1);
const wizError = ref('');
const creating = ref(false);
const sep = '\\';
const brands = [
  { key: 'tecno', label: 'Tecno', desc: 'HiOS 桌面（hilauncher）' },
  { key: 'infinix', label: 'Infinix', desc: 'XOS 桌面（XOSLauncher）' },
  { key: 'itel', label: 'itel', desc: 'itel OS 桌面（itel.launcher）' },
];
const colorModes = [
  { key: 'default', label: '默认样式', desc: 'default · 无特殊效果，配什么图标显示什么' },
  { key: 'glass', label: '玻璃样式', desc: 'glass · 玻璃质感，须自适应图标资源' },
  { key: 'foreground_color', label: '暗黑样式', desc: 'foreground_color · 系统暗色模式标识，须自适应图标资源' },
  { key: 'mono', label: '可着色样式', desc: 'mono · 图标可上色成任意颜色，须自适应 + monochrome' },
];
const wiz = ref({
  type: 0,
  colorMode: 'default',
  style: 'adaptive',
  brand: 'tecno',
  name: '',
  author: '',
  description: '',
  parent: '',
  folder: '',
});

const canNext = computed(() => {
  if (wizStep.value === 1) return !!wiz.value.colorMode && !!wiz.value.brand &&
    (wiz.value.colorMode !== 'default' || !!wiz.value.style);
  if (wizStep.value === 2) return !!wiz.value.name.trim() && !!wiz.value.author.trim();
  return true;
});
const canCreate = computed(() => !!wiz.value.parent && !!wiz.value.folder.trim());

function startWizard() {
  wizStep.value = 1;
  wizError.value = '';
  view.value = 'wizard';
}

function pickParent() {
  window.themeAPI.selectDir('选择项目根目录').then(d => { if (d) wiz.value.parent = d; });
}

async function doCreate() {
  wizError.value = '';
  creating.value = true;
  try {
    const target = `${wiz.value.parent}${sep}${wiz.value.folder.trim()}`;
    await window.themeAPI.createProject(target, {
      name: wiz.value.name.trim(),
      author: wiz.value.author.trim(),
      description: wiz.value.description.trim() || undefined,
      type: wiz.value.type,
      iconStyle: wiz.value.colorMode === 'default' ? wiz.value.style : 'adaptive',
      colorMode: wiz.value.colorMode,
      brand: wiz.value.brand,
    });
    await openDir(target);
  } catch (e) {
    wizError.value = String(e.message || e);
  } finally {
    creating.value = false;
  }
}

// ---------- 打开 / 校验 / 打包 ----------
async function openDir(d) {
  dir.value = d;
  packResult.value = null;
  projectMeta.value = await window.themeAPI.loadProject(d);
  report.value = await window.themeAPI.validate(d);
  view.value = 'project';
}

async function pickDir() {
  const d = await window.themeAPI.selectDir('选择主题目录');
  if (d) await openDir(d);
}

async function doPack() {
  const themeName = dir.value.split(/[\\/]/).pop();
  const out = await window.themeAPI.saveFile('导出主题包', `${themeName}.xth`, [
    { name: '主题包', extensions: ['xth'] },
  ]);
  if (!out) return;
  packing.value = true;
  try {
    const r = await window.themeAPI.validate(dir.value);
    report.value = r;
    if (r.errors.length) { alert('存在错误，已阻断打包'); return; }
    packResult.value = await window.themeAPI.pack(dir.value, out);
  } finally {
    packing.value = false;
  }
}

function brandLabel(key) {
  const b = brands.find(x => x.key === key);
  return b ? `${b.label}（${b.desc}）` : key;
}

// ---------- 菜单事件联动 ----------
const unsubs = [];
onMounted(() => {
  unsubs.push(window.themeAPI.onMenu('menu:new-project', startWizard));
  unsubs.push(window.themeAPI.onMenu('menu:open-theme', pickDir));
  unsubs.push(window.themeAPI.onMenu('menu:export', () => {
    if (view.value === 'project' && dir.value && !packing.value) doPack();
  }));
});
onUnmounted(() => unsubs.forEach(u => u && u()));
</script>
