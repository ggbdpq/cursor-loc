/**
 * patch-core 构建后脚本：将 src/assets 复制到 dist/assets。
 *
 * tsc 只编译 TypeScript，不会自动带上 cursor.inject.js 等运行时资源；
 * 此脚本在 `npm run build` 的 tsc 步骤之后执行。
 */
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distAssets = join(root, 'dist', 'assets');

mkdirSync(distAssets, { recursive: true });
cpSync(join(root, 'src', 'assets'), distAssets, { recursive: true });
