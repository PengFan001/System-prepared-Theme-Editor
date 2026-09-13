/**
 * SVG → Android VectorDrawable 转换器（mono 主题 monochrome 图标用，P2）。
 *
 * 设计要点：
 *  - 零依赖：内置迷你 XML 解析器（仅处理 well-formed SVG），与 core 无依赖风格一致
 *  - 白名单：仅放行 svg/g/path/rect/circle/ellipse/line/polyline/polygon；
 *    渐变、文字、位图、use/mask/clipPath/filter/动画、style 元素一律拒绝并给出中文原因
 *  - 危险引用检测：aapt: 命名空间、@color/@drawable、?attr、url(#…) 一律拒绝
 *    （这些依赖编译期资源解析，主题包内无法生效）
 *  - monochrome 语义：所有填充统一 #000000（系统着色），保留 fillAlpha/fillType；
 *    描边保留为 #000000 stroke
 *  - pathData：SVG 与 VD 指令集同源，但 VD 不支持 A/a 椭圆弧 → 自动转三次贝塞尔
 *  - transform：合并为矩阵后分解为 VD group 的 translate/scale/rotation；
 *    含 skew（斜切）无法表达 → 拒绝
 *
 * convertSvgToVd(svgText, opts?) → { ok, xml?, reason?, warnings[] }
 *   ok=false 时 reason 为面向设计师的中文失败原因
 */

// ---------- 白名单 ----------

const ALLOWED_TAGS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
]);

const FORBIDDEN_TAGS = {
  lineargradient: '渐变（linearGradient）', radialgradient: '渐变（radialGradient）',
  pattern: '图案填充（pattern）', image: '位图引用（image）', text: '文字（text）',
  tspan: '文字（tspan）', foreignobject: 'foreignObject', script: '脚本（script）',
  style: 'CSS 样式表（style 元素）', use: '引用复用（use）', symbol: '符号（symbol）',
  mask: '遮罩（mask）', clippath: '裁剪（clipPath）', filter: '滤镜（filter）',
  marker: '标记（marker）', animate: '动画（animate）', animatemotion: '动画（animateMotion）',
  animatetransform: '动画（animateTransform）', set: '动画（set）', switch: '条件分支（switch）',
  view: '视图（view）', cursor: '光标（cursor）', font: '字体（font）', glyph: '字形（glyph）',
};

/** 危险属性值模式：编译期资源引用在主题包内无法生效 */
const DANGEROUS_VALUE = [
  { re: /^@/, desc: '资源引用（@color/@drawable 等）' },
  { re: /^\?/, desc: '主题属性引用（?attr/…）' },
  { re: /url\s*\(/i, desc: 'url() 引用（渐变/滤镜/裁剪）' },
];

// ---------- 迷你 XML 解析 ----------

function parseXml(text) {
  let i = 0;
  const n = text.length;
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const err = (msg) => { throw new Error(`SVG 解析失败：${msg}`); };

  while (i < n) {
    if (text[i] !== '<') { i++; continue; }
    // 注释 / CDATA / PI / DOCTYPE
    if (text.startsWith('<!--', i)) { const e = text.indexOf('-->', i); if (e < 0) err('注释未闭合'); i = e + 3; continue; }
    if (text.startsWith('<![CDATA[', i)) { const e = text.indexOf(']]>', i); if (e < 0) err('CDATA 未闭合'); i = e + 3; continue; }
    if (text.startsWith('<?', i)) { const e = text.indexOf('?>', i); if (e < 0) err('处理指令未闭合'); i = e + 2; continue; }
    if (text.startsWith('<!', i)) { const e = text.indexOf('>', i); if (e < 0) err('DOCTYPE 未闭合'); i = e + 1; continue; }
    // 闭合标签
    if (text[i + 1] === '/') {
      const e = text.indexOf('>', i); if (e < 0) err('标签未闭合');
      const name = text.slice(i + 2, e).trim().toLowerCase();
      if (stack.length < 2 || stack[stack.length - 1].tag.toLowerCase() !== name) err(`闭合标签不匹配 </${name}>`);
      stack.pop(); i = e + 1; continue;
    }
    // 开始标签
    const m = /^<\s*([A-Za-z_][\w:.-]*)/.exec(text.slice(i));
    if (!m) err('无法识别的标签');
    const tag = m[1];
    let j = i + m[0].length;
    const attrs = {};
    for (;;) {
      while (j < n && /\s/.test(text[j])) j++;
      if (text[j] === '/' && text[j + 1] === '>') { j += 2; stack[stack.length - 1].children.push({ tag, attrs, children: [] }); break; }
      if (text[j] === '>') { j++; const node = { tag, attrs, children: [] }; stack[stack.length - 1].children.push(node); stack.push(node); break; }
      const am = /^([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/.exec(text.slice(j));
      if (!am) err(`属性解析失败（<${tag}> 附近）`);
      attrs[am[1]] = am[3] !== undefined ? am[3] : am[4];
      j += am[0].length;
      if (j >= n) err('文档意外结束');
    }
    i = j;
  }
  if (stack.length !== 1) err('存在未闭合的标签');
  return root.children.find(c => c.tag.toLowerCase() === 'svg') || null;
}

// ---------- 数值工具 ----------

function fmt(x) {
  const v = Math.round(x * 1000) / 1000;
  return Object.is(v, -0) ? '0' : String(v);
}

function parseNumList(s) {
  if (!s) return [];
  return (s.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
}

// ---------- 矩阵（SVG 约定 [a b c d e f]） ----------

const M_IDENT = [1, 0, 0, 1, 0, 0];

function mMul(m1, m2) {
  const [a1, b1, c1, d1, e1, f1] = m1, [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2, b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2, b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1,
  ];
}

function parseTransform(s) {
  if (!s || !s.trim()) return M_IDENT;
  let m = M_IDENT;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/gi;
  let mm;
  while ((mm = re.exec(s))) {
    const kind = mm[1].toLowerCase();
    const v = parseNumList(mm[2]);
    let t;
    if (kind === 'matrix') { if (v.length !== 6) throw new Error('matrix() 需要 6 个参数'); t = v; }
    else if (kind === 'translate') t = [1, 0, 0, 1, v[0] || 0, v[1] || 0];
    else if (kind === 'scale') t = [v[0] ?? 1, 0, 0, v.length > 1 ? v[1] : (v[0] ?? 1), 0, 0];
    else if (kind === 'rotate') {
      const rad = (v[0] || 0) * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
      const r = [cos, sin, -sin, cos, 0, 0];
      t = v.length > 2 ? mMul(mMul([1, 0, 0, 1, v[1], v[2]], r), [1, 0, 0, 1, -v[1], -v[2]]) : r;
    } else {
      throw new Error(`不支持 ${kind}() 斜切变换，请在设计工具中展开为路径后再导出`);
    }
    m = mMul(m, t);
  }
  return m;
}

const isIdent = (m) => m.every((v, i) => Math.abs(v - M_IDENT[i]) < 1e-9);

/** 分解为 VD group 属性；无法表达（含 skew）时返回 null */
function mDecompose(m) {
  const [a, b, c, d, e, f] = m;
  const sx = Math.hypot(a, b);
  const det = a * d - b * c;
  const sy = det < 0 ? -Math.hypot(c, d) : Math.hypot(c, d);
  const rot = Math.atan2(b, a) * 180 / Math.PI;
  // 校验：重建后与原始矩阵一致（排除 skew）
  const rad = rot * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const rebuilt = mMul(mMul([1, 0, 0, 1, e, f], [cos, sin, -sin, cos, 0, 0]), [sx, 0, 0, sy, 0, 0]);
  const ok = m.every((v, i) => Math.abs(v - rebuilt[i]) < 1e-6 * Math.max(1, Math.abs(v)));
  if (!ok) return null;
  return { translateX: e, translateY: f, scaleX: sx, scaleY: sy, rotation: rot };
}

// ---------- 形状 → pathData ----------

function shapeToPath(node) {
  const t = node.tag.toLowerCase();
  const g = (k) => parseFloat(node.attrs[k] ?? '0') || 0;
  if (t === 'rect') {
    const x = g('x'), y = g('y'), w = g('width'), h = g('height');
    if (w <= 0 || h <= 0) throw new Error('rect 尺寸非法');
    let rx = node.attrs.rx !== undefined ? g('rx') : (node.attrs.ry !== undefined ? g('ry') : 0);
    let ry = node.attrs.ry !== undefined ? g('ry') : rx;
    rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
    if (!rx && !ry) return `M${fmt(x)} ${fmt(y)}H${fmt(x + w)}V${fmt(y + h)}H${fmt(x)}Z`;
    const k = 0.5522847498; // 圆角用三次贝塞尔近似
    return `M${fmt(x + rx)} ${fmt(y)}H${fmt(x + w - rx)}C${fmt(x + w - rx + rx * k)} ${fmt(y)} ${fmt(x + w)} ${fmt(y + ry - ry * k)} ${fmt(x + w)} ${fmt(y + ry)}V${fmt(y + h - ry)}C${fmt(x + w)} ${fmt(y + h - ry + ry * k)} ${fmt(x + w - rx + rx * k)} ${fmt(y + h)} ${fmt(x + w - rx)} ${fmt(y + h)}H${fmt(x + rx)}C${fmt(x + rx - rx * k)} ${fmt(y + h)} ${fmt(x)} ${fmt(y + h - ry + ry * k)} ${fmt(x)} ${fmt(y + h - ry)}V${fmt(y + ry)}C${fmt(x)} ${fmt(y + ry - ry * k)} ${fmt(x + rx - rx * k)} ${fmt(y)} ${fmt(x + rx)} ${fmt(y)}Z`;
  }
  if (t === 'circle' || t === 'ellipse') {
    const cx = g('cx'), cy = g('cy');
    const rx = t === 'circle' ? g('r') : g('rx'), ry = t === 'circle' ? g('r') : g('ry');
    if (rx <= 0 || ry <= 0) throw new Error(`${t} 半径非法`);
    const k = 0.5522847498;
    return `M${fmt(cx - rx)} ${fmt(cy)}C${fmt(cx - rx)} ${fmt(cy - ry * k)} ${fmt(cx - rx * k)} ${fmt(cy - ry)} ${fmt(cx)} ${fmt(cy - ry)}C${fmt(cx + rx * k)} ${fmt(cy - ry)} ${fmt(cx + rx)} ${fmt(cy - ry * k)} ${fmt(cx + rx)} ${fmt(cy)}C${fmt(cx + rx)} ${fmt(cy + ry * k)} ${fmt(cx + rx * k)} ${fmt(cy + ry)} ${fmt(cx)} ${fmt(cy + ry)}C${fmt(cx - rx * k)} ${fmt(cy + ry)} ${fmt(cx - rx)} ${fmt(cy + ry * k)} ${fmt(cx - rx)} ${fmt(cy)}Z`;
  }
  if (t === 'line') {
    return `M${fmt(g('x1'))} ${fmt(g('y1'))}L${fmt(g('x2'))} ${fmt(g('y2'))}`;
  }
  if (t === 'polyline' || t === 'polygon') {
    const v = parseNumList(node.attrs.points || '');
    if (v.length < 4 || v.length % 2) throw new Error(`${t} 的 points 非法`);
    let d = `M${fmt(v[0])} ${fmt(v[1])}`;
    for (let i = 2; i < v.length; i += 2) d += `L${fmt(v[i])} ${fmt(v[i + 1])}`;
    if (t === 'polygon') d += 'Z';
    return d;
  }
  return node.attrs.d || '';
}

// ---------- pathData：A/a 椭圆弧 → 三次贝塞尔（VD 不支持弧指令） ----------

function arcToCubics(x1, y1, rx, ry, phi, largeArc, sweep, x2, y2) {
  if (rx === 0 || ry === 0) return [['C', x1, y1, x1, y1, x2, y2]];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const rad = phi * Math.PI / 180, cosP = Math.cos(rad), sinP = Math.sin(rad);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  let x1p = cosP * dx + sinP * dy, y1p = -sinP * dx + cosP * dy;
  let lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) co = -co;
  const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const d = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.min(1, Math.max(-1, (ux * vx + uy * vy) / d)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dth > 0) dth -= 2 * Math.PI;
  if (sweep && dth < 0) dth += 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2)));
  const delta = dth / segs;
  const out = [];
  for (let s = 0; s < segs; s++) {
    const t1 = th1 + s * delta, t2 = t1 + delta;
    const alpha = 4 / 3 * Math.tan((t2 - t1) / 4);
    const p = (t) => [cx + rx * Math.cos(t) * cosP - ry * Math.sin(t) * sinP,
                      cy + rx * Math.cos(t) * sinP + ry * Math.sin(t) * cosP];
    const dp = (t) => [-rx * Math.sin(t) * cosP - ry * Math.cos(t) * sinP,
                       -rx * Math.sin(t) * sinP + ry * Math.cos(t) * cosP];
    const [p1x, p1y] = p(t1), [p2x, p2y] = p(t2);
    const [d1x, d1y] = dp(t1), [d2x, d2y] = dp(t2);
    out.push(['C', p1x + alpha * d1x, p1y + alpha * d1y, p2x - alpha * d2x, p2y - alpha * d2y, p2x, p2y]);
  }
  return out;
}

/** 解析 pathData，把所有 A/a 转成 C；其余指令原样保留（VD 支持 M/L/H/V/C/S/Q/T/Z 及小写） */
function normalizePathData(d) {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
  const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  let out = '', i = 0, cmd = null;
  let cx = 0, cy = 0; // 当前点
  const next = () => {
    if (i >= tokens.length) throw new Error('pathData 参数不足');
    const v = parseFloat(tokens[i++]);
    if (Number.isNaN(v)) throw new Error('pathData 含非法数值');
    return v;
  };
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    if (!cmd) throw new Error('pathData 以数值开头');
    const up = cmd.toUpperCase(), rel = cmd !== up;
    if (up === 'Z') { out += 'Z'; cx = 0; cy = 0; cmd = null; continue; }
    // M 后续隐式为 L
    let first = true;
    while (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) {
      let c = cmd;
      if (up === 'M' && !first) c = rel ? 'l' : 'L';
      first = false;
      const uc = c.toUpperCase(), rl = c !== uc;
      const ar = ARITY[uc];
      const vals = [];
      for (let k = 0; k < ar; k++) vals.push(next());
      if (uc === 'A') {
        const [rx, ry, phi, laf, swf, x2r, y2r] = vals;
        const x2 = rl ? cx + x2r : x2r, y2 = rl ? cy + y2r : y2r;
        for (const seg of arcToCubics(cx, cy, rx, ry, phi, laf, swf, x2, y2)) {
          out += 'C' + seg.slice(1).map(fmt).join(' ');
        }
        cx = x2; cy = y2;
      } else {
        out += c + vals.map(fmt).join(' ');
        if (uc === 'M' || uc === 'L' || uc === 'T') { cx = rl ? cx + vals[0] : vals[0]; cy = rl ? cy + vals[1] : vals[1]; }
        else if (uc === 'H') cx = rl ? cx + vals[0] : vals[0];
        else if (uc === 'V') cy = rl ? cy + vals[0] : vals[0];
        else if (uc === 'C') { cx = rl ? cx + vals[4] : vals[4]; cy = rl ? cy + vals[5] : vals[5]; }
        else if (uc === 'S' || uc === 'Q') { cx = rl ? cx + vals[2] : vals[2]; cy = rl ? cy + vals[3] : vals[3]; }
      }
    }
    if (up !== 'Z' && first) throw new Error(`pathData 指令 ${cmd} 缺少参数`);
  }
  return out;
}

// ---------- 样式与属性 ----------

function collectStyle(node) {
  // 内联 style 拆成普通属性（低优先级：先放 style 再被显式属性覆盖）
  const attrs = {};
  const st = node.attrs.style;
  if (st) {
    for (const decl of st.split(';')) {
      const idx = decl.indexOf(':');
      if (idx > 0) attrs[decl.slice(0, idx).trim()] = decl.slice(idx + 1).trim();
    }
  }
  return { ...attrs, ...node.attrs };
}

/** 校验属性值，命中危险模式时抛出中文原因 */
function checkAttrs(node) {
  for (const [k, v] of Object.entries(node.attrs)) {
    if (/^aapt:/i.test(k)) throw new Error(`包含 aapt: 命名空间属性（${k}），属于编译期特性，主题包无法生效`);
    if (/^xmlns(:|$)/i.test(k)) continue;
    for (const d of DANGEROUS_VALUE) {
      if (d.re.test(v)) throw new Error(`属性 ${k}="${v}" 包含${d.desc}，主题包内无法生效`);
    }
  }
}

// ---------- 主转换 ----------

/**
 * @param {string} svgText SVG 源文本
 * @returns {{ ok: boolean, xml?: string, reason?: string, warnings: string[] }}
 */
function convertSvgToVd(svgText) {
  const warnings = [];
  try {
    if (/<!ENTITY/i.test(svgText)) throw new Error('包含自定义 ENTITY 声明，存在安全风险');
    const svg = parseXml(svgText);
    if (!svg) throw new Error('未找到 <svg> 根元素');

    // viewBox / 尺寸 → viewport
    let vw, vh;
    const vb = parseNumList(svg.attrs.viewBox || '');
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      vw = vb[2]; vh = vb[3];
      if (vb[0] !== 0 || vb[1] !== 0) {
        // viewBox 原点偏移：包一层平移
        svg.children = [{ tag: 'g', attrs: { transform: `translate(${-vb[0]} ${-vb[1]})` }, children: svg.children }];
      }
    } else {
      const w = parseFloat(svg.attrs.width), h = parseFloat(svg.attrs.height);
      if (!(w > 0 && h > 0)) throw new Error('缺少 viewBox 或有效的 width/height，无法确定画布');
      vw = w; vh = h;
    }

    let hasColor = false, pathCount = 0;

    const emit = (node) => {
      const tag = node.tag.toLowerCase();
      const bare = tag.includes(':') ? tag.slice(tag.indexOf(':') + 1) : tag;
      if (tag.includes(':') && !/^sodipodi:|^inkscape:/.test(tag)) {
        throw new Error(`包含外部命名空间元素 <${tag}>，请在设计工具中清理后导出`);
      }
      if (bare === 'defs' || bare === 'title' || bare === 'desc' || bare === 'metadata') return '';
      const forbid = FORBIDDEN_TAGS[bare];
      if (forbid) throw new Error(`包含不支持的${forbid}元素，monochrome 图标须为纯矢量路径`);
      if (!ALLOWED_TAGS.has(bare)) throw new Error(`包含不支持的元素 <${bare}>`);
      checkAttrs(node);
      const attrs = collectStyle(node);
      for (const [k, v] of Object.entries(attrs)) {
        for (const d of DANGEROUS_VALUE) {
          if (typeof v === 'string' && d.re.test(v)) throw new Error(`属性 ${k}="${v}" 包含${d.desc}`);
        }
      }

      if (bare === 'svg' || bare === 'g') {
        const m = parseTransform(attrs.transform);
        const inner = node.children.map(emit).filter(Boolean).join('\n');
        if (bare === 'svg') return inner;
        if (isIdent(m)) return inner ? `<group>\n${inner}\n</group>` : '';
        const dp = mDecompose(m);
        if (!dp) throw new Error('变换矩阵含斜切/翻转组合，无法表达，请在设计工具中展开变换');
        const ga = [];
        if (dp.rotation) { ga.push(`android:rotation="${fmt(dp.rotation)}"`); ga.push('android:pivotX="0"'); ga.push('android:pivotY="0"'); }
        if (dp.scaleX !== 1) ga.push(`android:scaleX="${fmt(dp.scaleX)}"`);
        if (dp.scaleY !== 1) ga.push(`android:scaleY="${fmt(dp.scaleY)}"`);
        if (dp.translateX) ga.push(`android:translateX="${fmt(dp.translateX)}"`);
        if (dp.translateY) ga.push(`android:translateY="${fmt(dp.translateY)}"`);
        return `<group ${ga.join(' ')}>\n${inner}\n</group>`;
      }

      // 形状/path
      const rawD = bare === 'path' ? (attrs.d || '') : shapeToPath({ tag: bare, attrs });
      if (!rawD.trim()) return '';
      const d = normalizePathData(rawD);
      const m = parseTransform(attrs.transform);

      const pa = [];
      const fill = (attrs.fill ?? '#000').trim().toLowerCase();
      const hasFill = fill !== 'none';
      if (hasFill) {
        if (fill && fill !== '#000' && fill !== '#000000' && fill !== 'black') hasColor = true;
        pa.push('android:fillColor="#000000"');
        const fo = attrs['fill-opacity'];
        if (fo !== undefined && parseFloat(fo) !== 1) pa.push(`android:fillAlpha="${fmt(parseFloat(fo))}"`);
        const fr = (attrs['fill-rule'] || '').toLowerCase();
        if (fr === 'evenodd') pa.push('android:fillType="evenOdd"');
      }
      const stroke = (attrs.stroke || '').trim().toLowerCase();
      if (stroke && stroke !== 'none') {
        pa.push('android:strokeColor="#000000"');
        const sw = parseFloat(attrs['stroke-width'] ?? '1') || 1;
        pa.push(`android:strokeWidth="${fmt(sw)}"`);
        const so = attrs['stroke-opacity'];
        if (so !== undefined && parseFloat(so) !== 1) pa.push(`android:strokeAlpha="${fmt(parseFloat(so))}"`);
        const lc = (attrs['stroke-linecap'] || '').toLowerCase();
        if (['butt', 'round', 'square'].includes(lc)) pa.push(`android:strokeLineCap="${lc}"`);
        const lj = (attrs['stroke-linejoin'] || '').toLowerCase();
        if (['miter', 'round', 'bevel'].includes(lj)) pa.push(`android:strokeLineJoin="${lj}"`);
      }
      if (!hasFill && (!stroke || stroke === 'none')) return '';
      pa.push(`android:pathData="${d}"`);
      pathCount++;

      const pathXml = `<path ${pa.join(' ')}/>`;
      if (isIdent(m)) return pathXml;
      const dp = mDecompose(m);
      if (!dp) throw new Error('图形变换含斜切/翻转组合，无法表达，请在设计工具中展开变换');
      const ga = [];
      if (dp.rotation) { ga.push(`android:rotation="${fmt(dp.rotation)}"`); ga.push('android:pivotX="0"'); ga.push('android:pivotY="0"'); }
      if (dp.scaleX !== 1) ga.push(`android:scaleX="${fmt(dp.scaleX)}"`);
      if (dp.scaleY !== 1) ga.push(`android:scaleY="${fmt(dp.scaleY)}"`);
      if (dp.translateX) ga.push(`android:translateX="${fmt(dp.translateX)}"`);
      if (dp.translateY) ga.push(`android:translateY="${fmt(dp.translateY)}"`);
      return `<group ${ga.join(' ')}>\n${pathXml}\n</group>`;
    };

    const body = emit(svg);
    if (!pathCount) throw new Error('未提取到任何可见路径（全部元素被跳过或为空）');
    if (hasColor) warnings.push('原 SVG 含彩色填充/描边，已按 monochrome 规范统一为单色（#000000，由系统着色）');

    const xml = `<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android"\n    android:width="108dp"\n    android:height="108dp"\n    android:viewportWidth="${fmt(vw)}"\n    android:viewportHeight="${fmt(vh)}">\n${body}\n</vector>\n`;
    return { ok: true, xml, warnings };
  } catch (e) {
    return { ok: false, reason: e.message, warnings };
  }
}

/**
 * 校验既有 monochrome.xml 是否符合白名单（validator 用）。
 * 定级依据（用户确认）：
 *  - 错误：非 vector 根、缺 pathData、@color/@drawable/?attr 资源引用、**aapt:attr 渐变**
 *    ——官方 mono 样本中 scb.phone/compass 两例含 aapt 渐变，经用户确认属于**资源错误**：
 *    无法被渲染上色，需视觉设计师移除 aapt 元素，不属于引擎能力
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
function checkMonochromeXml(xmlText) {
  const errors = [];
  const warnings = [];
  if (!/<vector[\s>]/i.test(xmlText)) errors.push('根元素不是 <vector>');
  if (/(android:\w+)\s*=\s*"[@?]/.test(xmlText)) errors.push('包含 @color/@drawable/?attr 等编译期资源引用（主题引擎无法解析）');
  if (/aapt:/i.test(xmlText)) errors.push('包含 aapt:attr 渐变（无法被渲染上色的错误资源，需移除 aapt 元素、改为单色填充）');
  if (!/android:pathData\s*=/.test(xmlText)) errors.push('未包含任何 pathData');
  try { parseXml(xmlText.replace(/<\?xml[^?]*\?>/, '')); } catch (e) { errors.push(e.message); }
  return { ok: errors.length === 0, errors, warnings };
}

module.exports = { convertSvgToVd, checkMonochromeXml, normalizePathData };
