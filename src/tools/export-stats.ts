/**
 * 统计数据导出工具
 * 
 * 使用方法:
 *   - 导出所有 round 的统计: ts-node src/tools/export-stats.ts
 *   - 导出特定 round 的统计: ts-node src/tools/export-stats.ts <roundId>
 *   - 列出所有可用的 circuit powers: ts-node src/tools/export-stats.ts --list-powers
 *   - 导出特定 circuit power 的所有 round: ts-node src/tools/export-stats.ts --power <power>
 * 
 * 所有文件将按 circuit power 分类保存在子文件夹中，如 round_stats/power_10/ 目录。
 */

import { initMonitor, commandLineExport } from '../lib/monitor';
import path from 'path';

console.log(`[DEBUG] Export Stats Tool - Starting`);
console.log(`[DEBUG] WORK_PATH environment variable: "${process.env.WORK_PATH || '(not set)'}"`);
console.log(`[DEBUG] Expected output directory: "${path.join(process.env.WORK_PATH || '.', 'round_stats')}"`);

// 初始化监控模块，加载已有数据
console.log(`[DEBUG] Initializing monitor module`);
initMonitor();

// 获取命令行参数（去掉前两个 node 和脚本路径）
const args = process.argv.slice(2);
console.log(`[DEBUG] Command line arguments: ${args.length ? args.join(', ') : '(none)'}`);

// 调用导出函数
console.log(`[DEBUG] Calling export function`);
commandLineExport(args); 