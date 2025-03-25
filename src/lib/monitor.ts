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
  circuitPower?: string;
  operations: {
    tally?: OperationRecord[];
    deactivate?: OperationRecord[];
  };
}

// 存储所有 round 的记录
const records: Record<string, RoundRecord> = {};

// 数据存储路径
const MONITOR_FILE_PATH = path.join(process.env.BENCH_DATA || '.', 'round_operations_monitor.json');
// Markdown 文件存储目录
const MARKDOWN_DIR_PATH = path.join(process.env.BENCH_DATA || '.', 'round_stats');

// 输出一些调试信息
console.log(`[DEBUG] BENCH_DATA environment variable: "${process.env.BENCH_DATA || '(not set)'}"`);
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
  
  // 只在确定完成时清理
  // 根据您的业务逻辑，定义清理条件
  if (operation === 'tally' && success) {
    console.log(`[MONITOR] Round ${roundId} completed with successful tally, cleaning up memory...`);
    
    // 在删除前确保已成功导出到 Markdown
    // 根据 circuitPower 确定子文件夹
    let subDir = 'unknown_power';
    
    if (records[roundId].circuitPower) {
      subDir = `power_${records[roundId].circuitPower}`;
    }
    
    // 使用正确的子文件夹路径检查文件是否存在
    const powerDirPath = path.join(MARKDOWN_DIR_PATH, subDir);
    const markdownPath = path.join(powerDirPath, `round_${roundId}.md`);
    
    console.log(`[DEBUG] Checking for Markdown file at: ${markdownPath}`);
    if (fs.existsSync(markdownPath)) {
      // 删除内存中的记录
      delete records[roundId];
      console.log(`[MONITOR] Round ${roundId} data removed from memory`);
    } else {
      console.log(`[MONITOR] Warning: Could not find Markdown file for round ${roundId} at ${markdownPath}, keeping in memory`);
    }
  }
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

// 将 circuitPower 信息保存到记录
export function setRoundCircuitPower(roundId: string, circuitPower: string) {
  if (!records[roundId]) {
    records[roundId] = {
      id: roundId,
      circuitPower: circuitPower,
      operations: {}
    };
  } else if (!records[roundId].circuitPower) {
    records[roundId].circuitPower = circuitPower;
    // 保存更新后的记录
    saveRecords();
  }
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
  
  // 根据 circuitPower 确定子文件夹
  let subDir = 'unknown_power';
  
  if (round.circuitPower) {
    subDir = `power_${round.circuitPower}`;
  }
  
  // 创建子文件夹（如果不存在）
  const powerDirPath = path.join(MARKDOWN_DIR_PATH, subDir);
  if (!fs.existsSync(powerDirPath)) {
    try {
      fs.mkdirSync(powerDirPath, { recursive: true });
      log(`[MONITOR] Created circuit power directory at ${powerDirPath}`);
    } catch (dirError: any) {
      log(`[MONITOR] Error creating circuit power directory: ${dirError.message}`);
      // 如果子文件夹创建失败，继续使用主目录
    }
  }
  
  // 使用子文件夹路径
  const markdownPath = path.join(powerDirPath, `round_${roundId}.md`);
  console.log(`[DEBUG] Will write Markdown to: ${markdownPath}`);
  
  let content = `# Round ${roundId} Operations Statistics\n\n`;
  content += `*Last updated: ${new Date().toISOString()}*\n\n`;
  
  // 添加 circuit power 信息（如果有）
  if (round.circuitPower) {
    content += `*Circuit Power: ${round.circuitPower}*\n\n`;
  }
  
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
  
  // 按 circuit power 分组
  const powerGroups: Record<string, string[]> = {};
  
  for (const roundId of roundIds) {
    const power = records[roundId].circuitPower || 'unknown';
    if (!powerGroups[power]) {
      powerGroups[power] = [];
    }
    powerGroups[power].push(roundId);
    
    // 导出单个 round 文件
    exportRoundToMarkdown(roundId);
  }
  
  // 为每个 circuit power 创建摘要文件
  for (const power in powerGroups) {
    const powerRoundIds = powerGroups[power];
    
    // 确定子文件夹
    const subDir = power === 'unknown' ? 'unknown_power' : `power_${power}`;
    const powerDirPath = path.join(MARKDOWN_DIR_PATH, subDir);
    if (!fs.existsSync(powerDirPath)) {
      try {
        fs.mkdirSync(powerDirPath, { recursive: true });
      } catch (error) {
        continue; // 如果创建失败，跳过这个 power 的摘要文件
      }
    }
    
    // 创建该 power 的摘要文件
    const powerSummaryPath = path.join(powerDirPath, 'summary.md');
    let powerContent = `# Circuit Power ${power} - Operations Summary\n\n`;
    powerContent += `*Generated: ${new Date().toISOString()}*\n\n`;
    powerContent += `## Rounds Summary (${powerRoundIds.length} rounds)\n\n`;
    powerContent += `| Round ID | Tally Count | Tally Success | Tally Avg (ms) | Deactivate Count | Deactivate Success | Deactivate Avg (ms) |\n`;
    powerContent += `|----------|-------------|--------------|----------------|------------------|-------------------|--------------------|\n`;
    
    for (const roundId of powerRoundIds) {
      const round = records[roundId];
      
      // 计算统计信息（与原代码相同）
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
      
      powerContent += `| ${roundId} | ${tallyCount} | ${tallySuccessCount} | ${tallyAvgDuration} | ${deactivateCount} | ${deactivateSuccessCount} | ${deactivateAvgDuration} |\n`;
    }
    
    try {
      fs.writeFileSync(powerSummaryPath, powerContent);
      log(`[MONITOR] Exported summary for circuit power ${power} to ${powerSummaryPath}`);
    } catch (error: any) {
      log(`[MONITOR] Error exporting circuit power summary: ${error.message}`);
    }
  }
  
  // 生成总体汇总 Markdown（与原代码基本相同）
  const summaryPath = path.join(MARKDOWN_DIR_PATH, 'all_rounds_summary.md');
  console.log(`[DEBUG] Will write summary Markdown to: ${summaryPath}`);
  let content = `# All Rounds Operations Summary\n\n`;
  content += `*Generated: ${new Date().toISOString()}*\n\n`;
  
  content += `## Circuit Power Distribution\n\n`;
  content += `| Circuit Power | Round Count |\n`;
  content += `|---------------|------------|\n`;
  
  for (const power in powerGroups) {
    content += `| ${power} | ${powerGroups[power].length} |\n`;
  }
  
  content += `\n## Rounds Summary\n\n`;
  content += `| Round ID | Circuit Power | Tally Count | Tally Success | Tally Avg (ms) | Deactivate Count | Deactivate Success | Deactivate Avg (ms) |\n`;
  content += `|----------|--------------|-------------|--------------|----------------|------------------|-------------------|--------------------|\n`;
  
  for (const roundId of roundIds) {
    const round = records[roundId];
    const power = round.circuitPower || 'unknown';
    
    // 计算统计信息（与原代码相同）
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
    
    content += `| ${roundId} | ${power} | ${tallyCount} | ${tallySuccessCount} | ${tallyAvgDuration} | ${deactivateCount} | ${deactivateSuccessCount} | ${deactivateAvgDuration} |\n`;
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
  // 按 circuit power 分组
  function groupRoundsByPower(): Record<string, string[]> {
    const powerGroups: Record<string, string[]> = {};
    
    for (const roundId in records) {
      const power = records[roundId].circuitPower || 'unknown';
      if (!powerGroups[power]) {
        powerGroups[power] = [];
      }
      powerGroups[power].push(roundId);
    }
    
    return powerGroups;
  }

  // 如果没有参数，则导出所有 rounds
  if (args.length === 0) {
    console.log('Exporting statistics for all rounds...');
    exportAllRoundsToMarkdown();
    console.log(`Done! Files exported to ${MARKDOWN_DIR_PATH}`);
    return;
  }
  
  // 如果第一个参数是 --list-powers，列出所有可用的 circuit powers
  if (args[0] === '--list-powers') {
    const powerGroups = groupRoundsByPower();
    console.log('Available circuit powers:');
    
    for (const power in powerGroups) {
      console.log(` - power_${power}: ${powerGroups[power].length} rounds`);
    }
    return;
  }
  
  // 如果第一个参数是 --power，导出特定 circuit power 的所有 rounds
  if (args[0] === '--power' && args.length > 1) {
    const requestedPower = args[1];
    const powerGroups = groupRoundsByPower();
    
    if (powerGroups[requestedPower]) {
      console.log(`Exporting statistics for all rounds with circuit power ${requestedPower}...`);
      
      // 导出该 power 的所有 round
      for (const roundId of powerGroups[requestedPower]) {
        exportRoundToMarkdown(roundId);
      }
      
      // 确定子文件夹
      const subDir = requestedPower === 'unknown' ? 'unknown_power' : `power_${requestedPower}`;
      console.log(`Done! Files exported to ${path.join(MARKDOWN_DIR_PATH, subDir)}`);
    } else {
      console.log(`No rounds found with circuit power ${requestedPower}`);
      console.log('Available circuit powers:');
      
      for (const power in powerGroups) {
        console.log(` - power_${power}: ${powerGroups[power].length} rounds`);
      }
    }
    return;
  }
  
  // 单个 round ID 导出
  const roundId = args[0];
  if (records[roundId]) {
    console.log(`Exporting statistics for round ${roundId}...`);
    exportRoundToMarkdown(roundId);
    
    // 确定该 round 的文件路径
    const power = records[roundId].circuitPower || 'unknown';
    const subDir = power === 'unknown' ? 'unknown_power' : `power_${power}`;
    const filePath = path.join(MARKDOWN_DIR_PATH, subDir, `round_${roundId}.md`);
    
    console.log(`Done! File exported to ${filePath}`);
  } else {
    console.log(`Round ${roundId} not found in records.`);
    console.log('Available rounds:');
    const roundIds = Object.keys(records);
    if (roundIds.length === 0) {
      console.log('No rounds recorded yet.');
    } else {
      // 按 circuit power 分组并显示
      const powerGroups = groupRoundsByPower();
      
      for (const power in powerGroups) {
        console.log(`Circuit power ${power} (${powerGroups[power].length} rounds):`);
        powerGroups[power].forEach(id => console.log(`  - ${id}`));
      }
    }
  }
} 