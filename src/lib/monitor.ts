import fs from 'fs';
import path from 'path';
import { log } from '../log';

// 定义操作类型
export type OperationType = 'tally' | 'deactivate';

// 定义每个操作的时间记录
export interface OperationRecord {
  startTime: number;
  endTime?: number;
  duration?: number;
  success: boolean;
  error?: string;
}

// 定义每个 round 的记录
export interface RoundRecord {
  id: string;
  operations: {
    tally?: OperationRecord[];
    deactivate?: OperationRecord[];
  };
}

// 存储所有 round 的记录
const records: Record<string, RoundRecord> = {};

// 数据存储路径
const MONITOR_FILE_PATH = path.join(process.env.WORK_PATH || '.', 'round_operations_monitor.json');
// Markdown 文件存储目录
const MARKDOWN_DIR_PATH = path.join(process.env.WORK_PATH || '.', 'round_stats');

// 输出一些调试信息
console.log(`[DEBUG] WORK_PATH environment variable: "${process.env.WORK_PATH || '(not set)'}"`);
console.log(`[DEBUG] Monitor data file path: "${MONITOR_FILE_PATH}"`);
console.log(`[DEBUG] Markdown directory path: "${MARKDOWN_DIR_PATH}"`);

// 初始化：从文件加载已有记录
export function initMonitor() {
  try {
    console.log(`[DEBUG] Checking if monitor file exists at: ${MONITOR_FILE_PATH}`);
    if (fs.existsSync(MONITOR_FILE_PATH)) {
      const data = fs.readFileSync(MONITOR_FILE_PATH, 'utf8');
      Object.assign(records, JSON.parse(data));
      log(`[MONITOR] Loaded ${Object.keys(records).length} round records`);
      console.log(`[DEBUG] Loaded records for rounds: ${Object.keys(records).join(', ') || '(none)'}`);
    } else {
      log('[MONITOR] No existing monitor file found, starting fresh');
      console.log(`[DEBUG] No monitor file found at: ${MONITOR_FILE_PATH}`);
    }
    
    // 确保 Markdown 文件目录存在
    console.log(`[DEBUG] Checking/creating Markdown directory at: ${MARKDOWN_DIR_PATH}`);
    if (!fs.existsSync(MARKDOWN_DIR_PATH)) {
      try {
        fs.mkdirSync(MARKDOWN_DIR_PATH, { recursive: true });
        log(`[MONITOR] Created Markdown stats directory at ${MARKDOWN_DIR_PATH}`);
        console.log(`[DEBUG] Successfully created directory: ${MARKDOWN_DIR_PATH}`);
      } catch (dirError: any) {
        console.log(`[DEBUG] ERROR creating directory: ${dirError.message}`);
        log(`[MONITOR] Error creating Markdown directory: ${dirError.message}`);
      }
    } else {
      console.log(`[DEBUG] Markdown directory already exists`);
    }
  } catch (error: any) {
    log(`[MONITOR] Error loading monitor data: ${error.message}`);
    console.log(`[DEBUG] ERROR in initMonitor: ${error.message}`);
  }
}

// 保存记录到文件
function saveRecords() {
  try {
    fs.writeFileSync(MONITOR_FILE_PATH, JSON.stringify(records, null, 2));
  } catch (error: any) {
    log(`[MONITOR] Error saving monitor data: ${error.message}`);
  }
}

// 开始记录操作
export function startOperation(roundId: string, operation: OperationType): number {
  // 确保 round 记录存在
  if (!records[roundId]) {
    records[roundId] = {
      id: roundId,
      operations: {}
    };
  }

  // 确保操作数组存在
  if (!records[roundId].operations[operation]) {
    records[roundId].operations[operation] = [];
  }

  // 记录开始时间
  const startTime = Date.now();
  // 使用非空断言，因为我们已经确保了它存在
  records[roundId].operations[operation]!.push({
    startTime,
    success: false
  });

  // 打印日志
  log(`[MONITOR] Started ${operation} operation for round ${roundId}`);
  
  // 保存记录
  saveRecords();
  
  return startTime;
}

// 结束记录操作
export function endOperation(
  roundId: string, 
  operation: OperationType, 
  success: boolean, 
  startTime: number,
  errorMsg: string | undefined
) {
  if (!records[roundId] || 
      !records[roundId].operations[operation] || 
      records[roundId].operations[operation]?.length === 0) {
    log(`[MONITOR] Error: Cannot find matching ${operation} operation for round ${roundId}`);
    return;
  }

  // 找到对应的操作记录（通过开始时间匹配）
  const opRecords = records[roundId].operations[operation];
  // TypeScript现在知道opRecords不为undefined
  if (!opRecords) {
    return;
  }
  const recordIndex = opRecords.findIndex(record => record.startTime === startTime && !record.endTime);
  
  if (recordIndex === -1) {
    log(`[MONITOR] Error: Cannot find matching ${operation} operation for round ${roundId} with start time ${startTime}`);
    return;
  }

  // 更新操作记录
  const endTime = Date.now();
  const duration = endTime - startTime;
  
  opRecords[recordIndex].endTime = endTime;
  opRecords[recordIndex].duration = duration;
  opRecords[recordIndex].success = success;
  if (errorMsg) {
    opRecords[recordIndex].error = errorMsg;
  }

  // 打印日志
  log(`[MONITOR] Completed ${operation} operation for round ${roundId} in ${duration}ms (${success ? 'Success' : 'Failed'})`);
  
  // 保存记录
  saveRecords();
  
  // 输出详细统计
  printRoundStats(roundId);
  
  // 导出为 Markdown
  exportRoundToMarkdown(roundId);
}

// 打印特定 round 的统计信息
export function printRoundStats(roundId: string) {
  if (!records[roundId]) {
    log(`[MONITOR] No statistics available for round ${roundId}`);
    return;
  }

  const round = records[roundId];
  log(`\n===== ROUND ${roundId} STATISTICS =====`);
  
  // Tally 统计
  if (round.operations.tally && round.operations.tally.length > 0) {
    const tallyOps = round.operations.tally;
    const successfulOps = tallyOps.filter(op => op.success && op.duration);
    
    log(`Tally operations: ${tallyOps.length} (${successfulOps.length} successful)`);
    
    if (successfulOps.length > 0) {
      const totalDuration = successfulOps.reduce((sum, op) => sum + (op.duration || 0), 0);
      const avgDuration = totalDuration / successfulOps.length;
      const maxDuration = Math.max(...successfulOps.map(op => op.duration || 0));
      
      log(`  - Total duration: ${totalDuration}ms`);
      log(`  - Average duration: ${Math.round(avgDuration)}ms`);
      log(`  - Maximum duration: ${maxDuration}ms`);
    }
  } else {
    log(`Tally operations: None`);
  }
  
  // Deactivate 统计
  if (round.operations.deactivate && round.operations.deactivate.length > 0) {
    const deactivateOps = round.operations.deactivate;
    const successfulOps = deactivateOps.filter(op => op.success && op.duration);
    
    log(`Deactivate operations: ${deactivateOps.length} (${successfulOps.length} successful)`);
    
    if (successfulOps.length > 0) {
      const totalDuration = successfulOps.reduce((sum, op) => sum + (op.duration || 0), 0);
      const avgDuration = totalDuration / successfulOps.length;
      const maxDuration = Math.max(...successfulOps.map(op => op.duration || 0));
      
      log(`  - Total duration: ${totalDuration}ms`);
      log(`  - Average duration: ${Math.round(avgDuration)}ms`);
      log(`  - Maximum duration: ${maxDuration}ms`);
    }
  } else {
    log(`Deactivate operations: None`);
  }
  
  log(`=====================================\n`);
}

// 打印所有 round 的汇总统计信息
export function printAllStats() {
  const roundIds = Object.keys(records);
  if (roundIds.length === 0) {
    log(`[MONITOR] No statistics available`);
    return;
  }

  log(`\n===== ALL ROUNDS STATISTICS SUMMARY =====`);
  log(`Total monitored rounds: ${roundIds.length}`);
  
  let totalTallyOps = 0;
  let successfulTallyOps = 0;
  let totalTallyDuration = 0;
  
  let totalDeactivateOps = 0;
  let successfulDeactivateOps = 0;
  let totalDeactivateDuration = 0;
  
  for (const roundId of roundIds) {
    const round = records[roundId];
    
    // Tally 统计
    if (round.operations.tally) {
      const tallyOps = round.operations.tally;
      totalTallyOps += tallyOps.length;
      
      const successful = tallyOps.filter(op => op.success && op.duration);
      successfulTallyOps += successful.length;
      totalTallyDuration += successful.reduce((sum, op) => sum + (op.duration || 0), 0);
    }
    
    // Deactivate 统计
    if (round.operations.deactivate) {
      const deactivateOps = round.operations.deactivate;
      totalDeactivateOps += deactivateOps.length;
      
      const successful = deactivateOps.filter(op => op.success && op.duration);
      successfulDeactivateOps += successful.length;
      totalDeactivateDuration += successful.reduce((sum, op) => sum + (op.duration || 0), 0);
    }
  }
  
  // 输出 Tally 统计
  log(`\nTally operations:`);
  log(`  - Total: ${totalTallyOps} (${successfulTallyOps} successful)`);
  if (successfulTallyOps > 0) {
    log(`  - Average duration: ${Math.round(totalTallyDuration / successfulTallyOps)}ms`);
  }
  
  // 输出 Deactivate 统计
  log(`\nDeactivate operations:`);
  log(`  - Total: ${totalDeactivateOps} (${successfulDeactivateOps} successful)`);
  if (successfulDeactivateOps > 0) {
    log(`  - Average duration: ${Math.round(totalDeactivateDuration / successfulDeactivateOps)}ms`);
  }
  
  log(`=========================================\n`);
}

// 将特定 round 的统计信息导出为 Markdown 文件
export function exportRoundToMarkdown(roundId: string) {
  console.log(`[DEBUG] Attempting to export statistics for round ${roundId}`);
  if (!records[roundId]) {
    log(`[MONITOR] No statistics available for round ${roundId} to export`);
    console.log(`[DEBUG] No records found for round ${roundId}`);
    return;
  }

  const round = records[roundId];
  const markdownPath = path.join(MARKDOWN_DIR_PATH, `round_${roundId}.md`);
  console.log(`[DEBUG] Will write Markdown to: ${markdownPath}`);
  
  let content = `# Round ${roundId} Operations Statistics\n\n`;
  content += `*Last updated: ${new Date().toISOString()}*\n\n`;
  
  // 总结部分
  content += `## Summary\n\n`;
  
  // Tally 统计汇总
  let tallyTotalDuration = 0;
  let tallySuccessCount = 0;
  let tallyTotalCount = 0;
  
  if (round.operations.tally && round.operations.tally.length > 0) {
    tallyTotalCount = round.operations.tally.length;
    const successfulOps = round.operations.tally.filter(op => op.success && op.duration);
    tallySuccessCount = successfulOps.length;
    
    if (successfulOps.length > 0) {
      tallyTotalDuration = successfulOps.reduce((sum, op) => sum + (op.duration || 0), 0);
    }
  }
  
  // Deactivate 统计汇总
  let deactivateTotalDuration = 0;
  let deactivateSuccessCount = 0;
  let deactivateTotalCount = 0;
  
  if (round.operations.deactivate && round.operations.deactivate.length > 0) {
    deactivateTotalCount = round.operations.deactivate.length;
    const successfulOps = round.operations.deactivate.filter(op => op.success && op.duration);
    deactivateSuccessCount = successfulOps.length;
    
    if (successfulOps.length > 0) {
      deactivateTotalDuration = successfulOps.reduce((sum, op) => sum + (op.duration || 0), 0);
    }
  }
  
  // 添加统计表格
  content += `| Operation | Total Count | Success Count | Total Duration (ms) | Avg Duration (ms) |\n`;
  content += `|-----------|-------------|---------------|---------------------|------------------|\n`;
  content += `| Tally | ${tallyTotalCount} | ${tallySuccessCount} | ${tallyTotalDuration} | ${tallySuccessCount > 0 ? Math.round(tallyTotalDuration / tallySuccessCount) : 'N/A'} |\n`;
  content += `| Deactivate | ${deactivateTotalCount} | ${deactivateSuccessCount} | ${deactivateTotalDuration} | ${deactivateSuccessCount > 0 ? Math.round(deactivateTotalDuration / deactivateSuccessCount) : 'N/A'} |\n\n`;
  
  // Tally 详细信息
  content += `## Tally Operations\n\n`;
  
  if (round.operations.tally && round.operations.tally.length > 0) {
    content += `| # | Start Time | End Time | Duration (ms) | Status | Error |\n`;
    content += `|---|------------|----------|---------------|--------|-------|\n`;
    
    round.operations.tally.forEach((op, index) => {
      const startTime = new Date(op.startTime).toISOString();
      const endTime = op.endTime ? new Date(op.endTime).toISOString() : 'N/A';
      const duration = op.duration || 'N/A';
      const status = op.success ? '✅ Success' : '❌ Failed';
      const error = op.error || 'N/A';
      
      content += `| ${index + 1} | ${startTime} | ${endTime} | ${duration} | ${status} | ${error} |\n`;
    });
    
    content += '\n';
  } else {
    content += `No tally operations recorded for this round.\n\n`;
  }
  
  // Deactivate 详细信息
  content += `## Deactivate Operations\n\n`;
  
  if (round.operations.deactivate && round.operations.deactivate.length > 0) {
    content += `| # | Start Time | End Time | Duration (ms) | Status | Error |\n`;
    content += `|---|------------|----------|---------------|--------|-------|\n`;
    
    round.operations.deactivate.forEach((op, index) => {
      const startTime = new Date(op.startTime).toISOString();
      const endTime = op.endTime ? new Date(op.endTime).toISOString() : 'N/A';
      const duration = op.duration || 'N/A';
      const status = op.success ? '✅ Success' : '❌ Failed';
      const error = op.error || 'N/A';
      
      content += `| ${index + 1} | ${startTime} | ${endTime} | ${duration} | ${status} | ${error} |\n`;
    });
    
    content += '\n';
  } else {
    content += `No deactivate operations recorded for this round.\n\n`;
  }
  
  // 写入文件
  try {
    fs.writeFileSync(markdownPath, content);
    log(`[MONITOR] Exported statistics for round ${roundId} to ${markdownPath}`);
    console.log(`[DEBUG] Successfully wrote file: ${markdownPath}`);
  } catch (error: any) {
    log(`[MONITOR] Error exporting to Markdown: ${error.message}`);
    console.log(`[DEBUG] ERROR writing file: ${error.message}`);
  }
}

// 导出所有 round 的统计信息为 Markdown
export function exportAllRoundsToMarkdown() {
  console.log(`[DEBUG] Attempting to export all rounds statistics to Markdown`);
  const roundIds = Object.keys(records);
  if (roundIds.length === 0) {
    log(`[MONITOR] No statistics available to export`);
    console.log(`[DEBUG] No round records found to export`);
    return;
  }
  
  log(`[MONITOR] Exporting statistics for ${roundIds.length} rounds to Markdown`);
  console.log(`[DEBUG] Found ${roundIds.length} rounds to export: ${roundIds.join(', ')}`);
  
  for (const roundId of roundIds) {
    exportRoundToMarkdown(roundId);
  }
  
  // 生成汇总 Markdown
  const summaryPath = path.join(MARKDOWN_DIR_PATH, 'all_rounds_summary.md');
  console.log(`[DEBUG] Will write summary Markdown to: ${summaryPath}`);
  let content = `# All Rounds Operations Summary\n\n`;
  content += `*Generated: ${new Date().toISOString()}*\n\n`;
  
  content += `## Rounds Summary\n\n`;
  content += `| Round ID | Tally Count | Tally Success | Tally Avg (ms) | Deactivate Count | Deactivate Success | Deactivate Avg (ms) |\n`;
  content += `|----------|-------------|--------------|----------------|------------------|-------------------|--------------------|\n`;
  
  for (const roundId of roundIds) {
    const round = records[roundId];
    
    // Tally stats
    let tallyCount = 0;
    let tallySuccessCount = 0;
    let tallyAvgDuration = 'N/A';
    
    if (round.operations.tally && round.operations.tally.length > 0) {
      tallyCount = round.operations.tally.length;
      const successfulOps = round.operations.tally.filter(op => op.success && op.duration);
      tallySuccessCount = successfulOps.length;
      
      if (successfulOps.length > 0) {
        const totalDuration = successfulOps.reduce((sum, op) => sum + (op.duration || 0), 0);
        tallyAvgDuration = Math.round(totalDuration / successfulOps.length).toString();
      }
    }
    
    // Deactivate stats
    let deactivateCount = 0;
    let deactivateSuccessCount = 0;
    let deactivateAvgDuration = 'N/A';
    
    if (round.operations.deactivate && round.operations.deactivate.length > 0) {
      deactivateCount = round.operations.deactivate.length;
      const successfulOps = round.operations.deactivate.filter(op => op.success && op.duration);
      deactivateSuccessCount = successfulOps.length;
      
      if (successfulOps.length > 0) {
        const totalDuration = successfulOps.reduce((sum, op) => sum + (op.duration || 0), 0);
        deactivateAvgDuration = Math.round(totalDuration / successfulOps.length).toString();
      }
    }
    
    content += `| ${roundId} | ${tallyCount} | ${tallySuccessCount} | ${tallyAvgDuration} | ${deactivateCount} | ${deactivateSuccessCount} | ${deactivateAvgDuration} |\n`;
  }
  
  // 写入文件
  try {
    fs.writeFileSync(summaryPath, content);
    log(`[MONITOR] Exported summary of all rounds to ${summaryPath}`);
    console.log(`[DEBUG] Successfully wrote summary file: ${summaryPath}`);
  } catch (error: any) {
    log(`[MONITOR] Error exporting summary to Markdown: ${error.message}`);
    console.log(`[DEBUG] ERROR writing summary file: ${error.message}`);
  }
}

// 导出一个用于获取所有记录的方法
export function getAllRecords(): Record<string, RoundRecord> {
  return { ...records };
}

// 命令行导出工具函数
export function commandLineExport(args: string[]) {
  // 如果没有参数，则导出所有 rounds
  if (args.length === 0) {
    console.log('Exporting statistics for all rounds...');
    exportAllRoundsToMarkdown();
    console.log(`Done! Files exported to ${MARKDOWN_DIR_PATH}`);
    return;
  }
  
  // 如果有参数，尝试导出特定 round
  const roundId = args[0];
  if (records[roundId]) {
    console.log(`Exporting statistics for round ${roundId}...`);
    exportRoundToMarkdown(roundId);
    console.log(`Done! File exported to ${path.join(MARKDOWN_DIR_PATH, `round_${roundId}.md`)}`);
  } else {
    console.log(`Round ${roundId} not found in records.`);
    console.log('Available rounds:');
    const roundIds = Object.keys(records);
    if (roundIds.length === 0) {
      console.log('No rounds recorded yet.');
    } else {
      roundIds.forEach(id => console.log(` - ${id}`));
    }
  }
} 