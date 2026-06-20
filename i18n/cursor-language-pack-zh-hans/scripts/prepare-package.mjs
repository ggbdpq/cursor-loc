/**
 * 将 @cursor-loc/patch-core 构建产物复制到 bundled/patch-core，供 vsce --no-dependencies 打包。
 *
 * 扩展运行时由 patchService 动态 import bundled 副本，避免 VSIX 依赖 node_modules 解析。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extRoot = path.resolve(__dirname, '..');
const patchCoreRoot = path.resolve(extRoot, '..', '..', 'packages', 'patch-core');
const distSrc = path.join(patchCoreRoot, 'dist');
const targetRoot = path.join(extRoot, 'bundled', 'patch-core');

/**
 * 递归复制文件或目录。
 *
 * @param {string} src 源路径。
 * @param {string} dest 目标路径。
 */
function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

if (!fs.existsSync(distSrc)) {
  console.error(`错误: 未找到 ${distSrc}，请先 npm run build -w @cursor-loc/patch-core`);
  process.exit(1);
}

if (fs.existsSync(targetRoot)) {
  fs.rmSync(targetRoot, { recursive: true, force: true });
}
fs.mkdirSync(targetRoot, { recursive: true });

copyRecursive(distSrc, path.join(targetRoot, 'dist'));
fs.copyFileSync(path.join(patchCoreRoot, 'package.json'), path.join(targetRoot, 'package.json'));

console.log(`已准备 VSIX 依赖: ${targetRoot}`);
