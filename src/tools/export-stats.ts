/**
 * 统计数据导出工具
 * 
 * 使用方法:
 *   - 导出所有 round 的统计: ts-node src/tools/export-stats.ts
 *   - 导出特定 round 的统计: ts-node src/tools/export-stats.ts <roundId>
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