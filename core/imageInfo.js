/**
 * 图片内容嗅探：读取文件头判断真实格式与尺寸。
 * 不依赖第三方库，支持 PNG / JPEG / WebP（VP8/VP8L/VP8X）。
 * 用于发现"扩展名与内容不符"的资源（样本中存在 JPEG 伪装 .png）。
 */

const fs = require('fs');

function sniff(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(64);
    fs.readSync(fd, head, 0, 64, 0);

    // PNG
    if (head.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return { format: 'png', width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
    }

    // JPEG —— 遍历 SOF 段取尺寸
    if (head[0] === 0xff && head[1] === 0xd8) {
      const size = fs.fstatSync(fd).size;
      const data = Buffer.alloc(size);
      fs.readSync(fd, data, 0, size, 0);
      let i = 2;
      while (i < data.length - 9) {
        if (data[i] !== 0xff) { i++; continue; }
        const marker = data[i + 1];
        if (marker >= 0xc0 && marker <= 0xc2) {
          return { format: 'jpeg', width: data.readUInt16BE(i + 7), height: data.readUInt16BE(i + 5) };
        }
        i += 2 + data.readUInt16BE(i + 2);
      }
      return { format: 'jpeg', width: null, height: null };
    }

    // WebP
    if (head.slice(0, 4).toString() === 'RIFF' && head.slice(8, 12).toString() === 'WEBP') {
      const fmt = head.slice(12, 16).toString();
      if (fmt === 'VP8 ') {
        return { format: 'webp', width: head.readUInt16LE(26) & 0x3fff, height: head.readUInt16LE(28) & 0x3fff };
      }
      if (fmt === 'VP8L') {
        const v = head.readUInt32LE(21);
        return { format: 'webp', width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 };
      }
      if (fmt === 'VP8X') {
        const w = head[24] | (head[25] << 8) | (head[26] << 16);
        const h = head[27] | (head[28] << 8) | (head[29] << 16);
        return { format: 'webp', width: w + 1, height: h + 1 };
      }
      return { format: 'webp', width: null, height: null };
    }

    return { format: 'unknown', width: null, height: null };
  } finally {
    fs.closeSync(fd);
  }
}

const IMAGE_EXTS = new Set(['.png', '.webp', '.jpg', '.jpeg']);

function isImageFile(name) {
  const lower = name.toLowerCase();
  for (const ext of IMAGE_EXTS) if (lower.endsWith(ext)) return true;
  return false;
}

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

module.exports = { sniff, isImageFile, extOf };
