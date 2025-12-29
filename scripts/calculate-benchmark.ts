#!/usr/bin/env node

import * as fs from 'fs'
import * as path from 'path'

// Types
interface CostConfig {
  machineTypes: {
    [machineType: string]: {
      currentTallyCostUsd: {
        [scale: string]: number
      }
      idleSharingMultiplier: number
    }
  }
}

interface ScaleCost {
  baseUsd: number
  finalUsd: number
  doraAmount: number
  multiplier: number
}

interface MachineTypeCosts {
  costs: {
    [scale: string]: ScaleCost
  }
}

interface Report {
  timestamp: string
  doraPrice: number
  dora24hrChange?: number
  machineTypes: {
    [machineType: string]: MachineTypeCosts
  }
  previousReport?: {
    timestamp: string
    doraPrice: number
    machineTypes?: {
      [machineType: string]: MachineTypeCosts
    }
  }
}

interface DoraPrice {
  'dora-factory-2': {
    usd: number
    usd_24h_change?: number
  }
}

// Constants
const PROJECT_ROOT = path.join(__dirname, '..')
const COST_CONFIG_PATH = path.join(PROJECT_ROOT, 'benchmark/cost.json')
const REPORT_JSON_PATH = path.join(PROJECT_ROOT, 'benchmark/report.json')
const REPORT_MD_PATH = path.join(PROJECT_ROOT, 'benchmark/report.md')
const COINGECKO_API =
  'https://api.coingecko.com/api/v3/simple/price?ids=dora-factory-2&vs_currencies=usd&include_24hr_change=true'

// Fetch DORA price from CoinGecko
async function fetchDoraPrice(
  retries = 3,
): Promise<{ price: number; change24h?: number }> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(COINGECKO_API)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      const data = (await response.json()) as DoraPrice
      const price = data['dora-factory-2']?.usd
      const change24h = data['dora-factory-2']?.usd_24h_change

      if (!price || price <= 0) {
        throw new Error('Invalid price data received')
      }

      console.log(`✓ DORA price fetched: $${price.toFixed(4)}`)
      if (change24h !== undefined) {
        console.log(
          `  24h change: ${change24h > 0 ? '+' : ''}${change24h.toFixed(2)}%`,
        )
      }

      return { price, change24h }
    } catch (error) {
      console.error(`Attempt ${i + 1}/${retries} failed:`, error)
      if (i === retries - 1) {
        // Last attempt failed, try to use cached price
        return loadCachedPrice()
      }
      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)))
    }
  }
  throw new Error('Failed to fetch DORA price after all retries')
}

// Load cached price from previous report
function loadCachedPrice(): { price: number; change24h?: number } {
  try {
    if (fs.existsSync(REPORT_JSON_PATH)) {
      const previousReport = JSON.parse(
        fs.readFileSync(REPORT_JSON_PATH, 'utf-8'),
      ) as Report
      if (previousReport.doraPrice && previousReport.doraPrice > 0) {
        console.log(
          `⚠ Using cached DORA price: $${previousReport.doraPrice.toFixed(4)}`,
        )
        return {
          price: previousReport.doraPrice,
          change24h: previousReport.dora24hrChange,
        }
      }
    }
  } catch (error) {
    console.error('Failed to load cached price:', error)
  }
  throw new Error('No cached price available')
}

// Load cost configuration
function loadCostConfig(): CostConfig {
  try {
    const content = fs.readFileSync(COST_CONFIG_PATH, 'utf-8')
    return JSON.parse(content) as CostConfig
  } catch (error) {
    console.error('Failed to load cost config:', error)
    throw error
  }
}

// Calculate costs
function calculateCosts(
  config: CostConfig,
  doraPrice: number,
): Report['machineTypes'] {
  const result: Report['machineTypes'] = {}

  for (const [machineType, machineConfig] of Object.entries(
    config.machineTypes,
  )) {
    const costs: { [scale: string]: ScaleCost } = {}

    for (const [scale, baseUsd] of Object.entries(
      machineConfig.currentTallyCostUsd,
    )) {
      const finalUsd = baseUsd * machineConfig.idleSharingMultiplier
      const doraAmount = finalUsd / doraPrice

      costs[scale] = {
        baseUsd,
        finalUsd,
        doraAmount: parseFloat(doraAmount.toFixed(2)),
        multiplier: machineConfig.idleSharingMultiplier,
      }
    }

    result[machineType] = { costs }
  }

  return result
}

// Load previous report for comparison
function loadPreviousReport(): Report | null {
  try {
    if (fs.existsSync(REPORT_JSON_PATH)) {
      const content = fs.readFileSync(REPORT_JSON_PATH, 'utf-8')
      return JSON.parse(content) as Report
    }
  } catch (error) {
    console.error('Failed to load previous report:', error)
  }
  return null
}

// Generate JSON report
function generateJsonReport(
  doraPrice: number,
  dora24hrChange: number | undefined,
  machineTypes: Report['machineTypes'],
  previousReport: Report | null,
): Report {
  const report: Report = {
    timestamp: new Date().toISOString(),
    doraPrice: parseFloat(doraPrice.toFixed(4)),
    machineTypes,
  }

  if (dora24hrChange !== undefined) {
    report.dora24hrChange = parseFloat(dora24hrChange.toFixed(2))
  }

  if (previousReport) {
    report.previousReport = {
      timestamp: previousReport.timestamp,
      doraPrice: previousReport.doraPrice,
    }
  }

  return report
}

// Format change indicator
function formatChange(current: number, previous: number | undefined): string {
  if (previous === undefined) return ''
  const change = ((current - previous) / previous) * 100
  if (Math.abs(change) < 0.01) return ' ⚪'
  if (change > 0) return ` 🔴 (+${change.toFixed(2)}%)`
  return ` 🟢 (${change.toFixed(2)}%)`
}

// Generate Markdown report
function generateMarkdownReport(report: Report): string {
  const lines: string[] = []

  lines.push('# Benchmark Cost Report')
  lines.push('')
  lines.push(
    `**Generated:** ${new Date(report.timestamp).toLocaleString('en-US', { timeZone: 'Asia/Shanghai', hour12: false })} (Beijing Time)`,
  )
  lines.push('')

  // DORA Price section
  lines.push('## DORA Price')
  lines.push('')
  lines.push(`**Current Price:** $${report.doraPrice.toFixed(4)}`)

  if (report.dora24hrChange !== undefined) {
    const changeStr =
      report.dora24hrChange > 0
        ? `+${report.dora24hrChange.toFixed(2)}%`
        : `${report.dora24hrChange.toFixed(2)}%`
    const emoji =
      report.dora24hrChange > 0 ? '📈' : report.dora24hrChange < 0 ? '📉' : '➡️'
    lines.push(`**24h Change:** ${changeStr} ${emoji}`)
  }

  if (report.previousReport) {
    const priceChange =
      ((report.doraPrice - report.previousReport.doraPrice) /
        report.previousReport.doraPrice) *
      100
    lines.push('')
    lines.push('**Comparison with Previous Report:**')
    lines.push(
      `- Previous Price: $${report.previousReport.doraPrice.toFixed(4)}`,
    )
    lines.push(
      `- Previous Time: ${new Date(report.previousReport.timestamp).toLocaleString('en-US', { timeZone: 'Asia/Shanghai', hour12: false })}`,
    )
    lines.push(
      `- Price Change: ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(2)}%`,
    )
  }

  lines.push('')

  // Cost tables for each machine type
  for (const [machineType, machineData] of Object.entries(
    report.machineTypes,
  )) {
    lines.push(`## ${machineType}`)
    lines.push('')
    lines.push(
      '| Scale | Base Cost (USD) | Multiplier | Final Cost (USD) | DORA Amount | Change |',
    )
    lines.push(
      '|-------|----------------|------------|------------------|-------------|--------|',
    )

    for (const [scale, cost] of Object.entries(machineData.costs)) {
      let changeIndicator = ''

      // Compare with previous report if available
      if (report.previousReport) {
        const prevMachine = report.previousReport.machineTypes?.[machineType]
        const prevCost = prevMachine?.costs?.[scale]
        if (prevCost) {
          changeIndicator = formatChange(cost.doraAmount, prevCost.doraAmount)
        }
      }

      lines.push(
        `| ${scale} | $${cost.baseUsd.toFixed(2)} | ${cost.multiplier}x | $${cost.finalUsd.toFixed(2)} | ${cost.doraAmount.toFixed(2)} DORA |${changeIndicator} |`,
      )
    }

    lines.push('')
  }

  // Calculation formula
  lines.push('## Calculation Formula')
  lines.push('')
  lines.push('```')
  lines.push('Final USD Cost = Base Cost × Idle Sharing Multiplier')
  lines.push('DORA Amount = Final USD Cost ÷ DORA Price')
  lines.push('```')
  lines.push('')

  // Notes
  lines.push('---')
  lines.push('')
  lines.push('*This report is automatically generated by CI/CD pipeline.*')
  lines.push('')
  lines.push('*Change indicators:*')
  lines.push('- 🔴 Cost increased')
  lines.push('- 🟢 Cost decreased')
  lines.push('- ⚪ No significant change')

  return lines.join('\n')
}

// Main function
async function main() {
  try {
    console.log('🚀 Starting benchmark cost calculation...\n')

    // Load configuration
    console.log('📁 Loading cost configuration...')
    const config = loadCostConfig()
    console.log(`✓ Configuration loaded\n`)

    // Fetch DORA price
    console.log('💰 Fetching DORA price...')
    const { price: doraPrice, change24h } = await fetchDoraPrice()
    console.log('')

    // Calculate costs
    console.log('🔢 Calculating costs...')
    const machineTypes = calculateCosts(config, doraPrice)
    console.log('✓ Costs calculated\n')

    // Load previous report
    console.log('📊 Loading previous report...')
    const previousReport = loadPreviousReport()
    if (previousReport) {
      console.log(
        `✓ Previous report loaded (from ${previousReport.timestamp})\n`,
      )
    } else {
      console.log('ℹ No previous report found\n')
    }

    // Generate reports
    console.log('📝 Generating reports...')
    const jsonReport = generateJsonReport(
      doraPrice,
      change24h,
      machineTypes,
      previousReport,
    )
    const markdownReport = generateMarkdownReport(jsonReport)

    // Write reports
    fs.writeFileSync(REPORT_JSON_PATH, JSON.stringify(jsonReport, null, 2))
    console.log(`✓ JSON report saved: ${REPORT_JSON_PATH}`)

    fs.writeFileSync(REPORT_MD_PATH, markdownReport)
    console.log(`✓ Markdown report saved: ${REPORT_MD_PATH}`)

    console.log('\n✅ Benchmark cost calculation completed successfully!')

    // Print summary
    console.log('\n📋 Summary:')
    console.log(`   DORA Price: $${doraPrice.toFixed(4)}`)
    if (change24h !== undefined) {
      console.log(
        `   24h Change: ${change24h > 0 ? '+' : ''}${change24h.toFixed(2)}%`,
      )
    }
    console.log(`   Machine Types: ${Object.keys(machineTypes).length}`)
    console.log(
      `   Total Scales: ${Object.values(machineTypes).reduce((sum, m) => sum + Object.keys(m.costs).length, 0)}`,
    )
  } catch (error) {
    console.error('\n❌ Error:', error)
    process.exit(1)
  }
}

// Run
main()
