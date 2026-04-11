import fs from 'node:fs/promises'
import path from 'node:path'

type Phase = 'MSG' | 'TALLY' | 'DEACTIVATE'

type FileMeta = {
  fileName: string
  roundId: string
  circuitPower: string
  concurrency: number
}

type Sample = FileMeta & {
  phase: Phase
  batchStart: number
  batchEnd: number
  batchSize: number
  durationMs: number
}

type SubmittedBatch = FileMeta & {
  phase: 'MSG' | 'TALLY'
  count: number
  txHash: string
}

type Stats = {
  count: number
  avgMs: number
  minMs: number
  maxMs: number
  p50Ms: number
  p90Ms: number
}

type BucketSummary = {
  circuitPower: string
  phase: Phase
  concurrency: number
  batchSize: number
  count: number
  avgMs: number
  minMs: number
  maxMs: number
  p50Ms: number
  p90Ms: number
  sourceFiles: string[]
}

type PhaseSummary = {
  circuitPower: string
  phase: Phase
  totalCount: number
  batchSizes: number[]
  dominantBucket: BucketSummary | null
  buckets: BucketSummary[]
}

type FormulaSummary = {
  circuitPower: string
  stateDepth: number
  intStateDepth: number
  voteOptionDepth: number
  maxUsers: number
  msgPerProof: number
  msgProofsPerGenerationBatch: number
  tallyBatchUserCapacity: number
  tallyBatchCountAll: number
  tallyProofsPerGenerationBatch: number
  msgSamples: number
  tallySamples: number
  tMsgP50Ms: number
  tMsgP90Ms: number
  tTallyP50Ms: number
  tTallyP90Ms: number
  tallyAllTimeP50Ms: number
  tallyAllTimeP90Ms: number
  msgProofCountFormula: string
  msgGenerationRoundsFormula: string
  totalFormulaP50: string
  totalFormulaP90: string
}

type ActualEstimateSummary = {
  circuitPower: string
  maxUsers: number
  scenarioMessages: number
  msgRounds: number
  tallyRounds: number
  msgStageUnitP50Ms: number
  msgStageUnitP90Ms: number
  tallyStageUnitP50Ms: number
  tallyStageUnitP90Ms: number
  gateTimeMs: number
  finalizeTimeMs: number
  actualTotalP50Ms: number
  actualTotalP90Ms: number
  actualFormulaP50: string
  actualFormulaP90: string
}

type SubmittedBatchSummary = {
  fileName: string
  roundId: string
  circuitPower: string
  concurrency: number
  msgBatchTxCount: number
  tallyBatchTxCount: number
  msgBatchItemTotal: number
  tallyBatchItemTotal: number
}

type RuntimeTimingSummary = {
  fileName: string
  roundId: string
  circuitPower: string
  concurrency: number
  msgSubmitTxCount: number
  tallySubmitTxCount: number
  msgSubmitIntervalStats: Stats | null
  tallySubmitIntervalStats: Stats | null
  msgStageWallMs: number | null
  tallyStageWallMs: number | null
  gateTimeMs: number | null
  finalizeTimeMs: number | null
}

const BENCHMARK_DIR = path.resolve(process.cwd(), 'benchmark')
const JSON_REPORT = path.join(BENCHMARK_DIR, 'proof-batch-report.json')
const MD_REPORT = path.join(BENCHMARK_DIR, 'proof-batch-report.md')

const FILE_RE =
  /^(?<roundId>[^-]+)-(?<circuitPower>\d+-\d+-\d+-\d+)-cur+rency-(?<concurrency>\d+)\.log$/i
const LINE_RE =
  /Generated (?<phase>MSG|TALLY|DEACTIVATE) proof batch \[(?<start>\d+)\.\.(?<end>\d+)\] in (?<duration>\d+)ms/g
const SUBMITTED_BATCH_RE =
  /Processed (?<phase>MSG|TALLY) batch \(count=(?<count>\d+)\) .*?tx=(?<txHash>[A-F0-9]+)/g
const TIMESTAMP_RE = /^\[(?<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\]/

function parseLogTimestamp(line: string): number | null {
  const match = line.match(TIMESTAMP_RE)
  const raw = match?.groups?.ts
  if (!raw) return null
  const parsed = new Date(raw.replace(' ', 'T')).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function round2(value: number) {
  return Math.round(value * 100) / 100
}

function msToMinutes(valueMs: number) {
  return round2(valueMs / 1000 / 60)
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const index = (sorted.length - 1) * p
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]
  const weight = index - lower
  return sorted[lower] * (1 - weight) + sorted[upper] * weight
}

function computeStats(durations: number[]): Stats {
  const sorted = [...durations].sort((a, b) => a - b)
  const sum = sorted.reduce((acc, cur) => acc + cur, 0)
  return {
    count: sorted.length,
    avgMs: round2(sum / sorted.length),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    p50Ms: round2(percentile(sorted, 0.5)),
    p90Ms: round2(percentile(sorted, 0.9)),
  }
}

function parseFileName(fileName: string): FileMeta | null {
  const match = fileName.match(FILE_RE)
  if (!match?.groups) return null
  return {
    fileName,
    roundId: match.groups.roundId,
    circuitPower: match.groups.circuitPower,
    concurrency: Number(match.groups.concurrency),
  }
}

async function parseSamples(fileName: string): Promise<Sample[]> {
  const meta = parseFileName(fileName)
  if (!meta) return []
  const filePath = path.join(BENCHMARK_DIR, fileName)
  const content = await fs.readFile(filePath, 'utf8')
  const matches = content.matchAll(LINE_RE)
  const samples: Sample[] = []
  for (const match of matches) {
    if (!match.groups) continue
    const phase = match.groups.phase as Phase
    const batchStart = Number(match.groups.start)
    const batchEnd = Number(match.groups.end)
    const durationMs = Number(match.groups.duration)
    samples.push({
      ...meta,
      phase,
      batchStart,
      batchEnd,
      batchSize: batchEnd - batchStart + 1,
      durationMs,
    })
  }
  return samples
}

async function parseSubmittedBatches(fileName: string): Promise<SubmittedBatch[]> {
  const meta = parseFileName(fileName)
  if (!meta) return []
  const filePath = path.join(BENCHMARK_DIR, fileName)
  const content = await fs.readFile(filePath, 'utf8')
  const matches = content.matchAll(SUBMITTED_BATCH_RE)
  const rows: SubmittedBatch[] = []
  for (const match of matches) {
    if (!match.groups) continue
    rows.push({
      ...meta,
      phase: match.groups.phase as 'MSG' | 'TALLY',
      count: Number(match.groups.count),
      txHash: match.groups.txHash,
    })
  }
  return rows
}

async function parseRuntimeTimingSummary(
  fileName: string,
): Promise<RuntimeTimingSummary | null> {
  const meta = parseFileName(fileName)
  if (!meta) return null
  const filePath = path.join(BENCHMARK_DIR, fileName)
  const content = await fs.readFile(filePath, 'utf8')
  const lines = content.split('\n')

  const msgSubmitTimes: number[] = []
  const tallySubmitTimes: number[] = []
  let startProofMsgsAt: number | null = null
  let startProofTallyAt: number | null = null
  let completedRoundTallyAt: number | null = null

  for (const line of lines) {
    const ts = parseLogTimestamp(line)
    if (ts == null) continue
    if (line.includes('Start to generate proof for msgs')) startProofMsgsAt = ts
    if (line.includes('Start to generate proof for tally')) startProofTallyAt = ts
    if (line.includes('Completed round Tally')) completedRoundTallyAt = ts
    if (line.includes('Processed MSG batch')) msgSubmitTimes.push(ts)
    if (line.includes('Processed TALLY batch')) tallySubmitTimes.push(ts)
  }

  const diffStats = (times: number[]) => {
    if (times.length < 2) return null
    const intervals: number[] = []
    for (let i = 1; i < times.length; i++) intervals.push(times[i] - times[i - 1])
    return computeStats(intervals)
  }

  const lastMsgSubmitAt = msgSubmitTimes.length > 0 ? msgSubmitTimes[msgSubmitTimes.length - 1] : null
  const lastTallySubmitAt =
    tallySubmitTimes.length > 0 ? tallySubmitTimes[tallySubmitTimes.length - 1] : null

  return {
    fileName,
    roundId: meta.roundId,
    circuitPower: meta.circuitPower,
    concurrency: meta.concurrency,
    msgSubmitTxCount: msgSubmitTimes.length,
    tallySubmitTxCount: tallySubmitTimes.length,
    msgSubmitIntervalStats: diffStats(msgSubmitTimes),
    tallySubmitIntervalStats: diffStats(tallySubmitTimes),
    msgStageWallMs:
      startProofMsgsAt != null && lastMsgSubmitAt != null
        ? lastMsgSubmitAt - startProofMsgsAt
        : null,
    tallyStageWallMs:
      startProofTallyAt != null && lastTallySubmitAt != null
        ? lastTallySubmitAt - startProofTallyAt
        : null,
    gateTimeMs:
      lastMsgSubmitAt != null && startProofTallyAt != null
        ? startProofTallyAt - lastMsgSubmitAt
        : null,
    finalizeTimeMs:
      lastTallySubmitAt != null && completedRoundTallyAt != null
        ? completedRoundTallyAt - lastTallySubmitAt
        : null,
  }
}

function summarizeBuckets(samples: Sample[]): BucketSummary[] {
  const grouped = new Map<string, Sample[]>()
  for (const sample of samples) {
    const key = [
      sample.circuitPower,
      sample.phase,
      sample.concurrency,
      sample.batchSize,
    ].join('|')
    const arr = grouped.get(key)
    if (arr) arr.push(sample)
    else grouped.set(key, [sample])
  }

  const buckets: BucketSummary[] = []
  for (const [key, bucketSamples] of grouped) {
    const [circuitPower, phase, concurrencyStr, batchSizeStr] = key.split('|')
    const stats = computeStats(bucketSamples.map((item) => item.durationMs))
    const sourceFiles = [...new Set(bucketSamples.map((item) => item.fileName))].sort()
    buckets.push({
      circuitPower,
      phase: phase as Phase,
      concurrency: Number(concurrencyStr),
      batchSize: Number(batchSizeStr),
      ...stats,
      sourceFiles,
    })
  }

  return buckets.sort((a, b) => {
    if (a.circuitPower !== b.circuitPower) return a.circuitPower.localeCompare(b.circuitPower)
    if (a.phase !== b.phase) return a.phase.localeCompare(b.phase)
    if (a.concurrency !== b.concurrency) return a.concurrency - b.concurrency
    return a.batchSize - b.batchSize
  })
}

function summarizePhases(buckets: BucketSummary[]): PhaseSummary[] {
  const grouped = new Map<string, BucketSummary[]>()
  for (const bucket of buckets) {
    const key = [bucket.circuitPower, bucket.phase].join('|')
    const arr = grouped.get(key)
    if (arr) arr.push(bucket)
    else grouped.set(key, [bucket])
  }

  const phaseSummaries: PhaseSummary[] = []
  for (const [key, phaseBuckets] of grouped) {
    const [circuitPower, phase] = key.split('|')
    const sortedBuckets = [...phaseBuckets].sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      if (b.batchSize !== a.batchSize) return b.batchSize - a.batchSize
      return a.concurrency - b.concurrency
    })
    phaseSummaries.push({
      circuitPower,
      phase: phase as Phase,
      totalCount: phaseBuckets.reduce((acc, cur) => acc + cur.count, 0),
      batchSizes: [...new Set(phaseBuckets.map((item) => item.batchSize))].sort((a, b) => a - b),
      dominantBucket: sortedBuckets[0] ?? null,
      buckets: [...phaseBuckets].sort((a, b) => {
        if (a.concurrency !== b.concurrency) return a.concurrency - b.concurrency
        return a.batchSize - b.batchSize
      }),
    })
  }

  return phaseSummaries.sort((a, b) => {
    if (a.circuitPower !== b.circuitPower) return a.circuitPower.localeCompare(b.circuitPower)
    return a.phase.localeCompare(b.phase)
  })
}

function parseCircuitPower(circuitPower: string) {
  const [stateDepthStr, intStateDepthStr, voteOptionDepthStr, msgPerProofStr] =
    circuitPower.split('-')
  const stateDepth = Number(stateDepthStr)
  const intStateDepth = Number(intStateDepthStr)
  const voteOptionDepth = Number(voteOptionDepthStr)
  const msgPerProof = Number(msgPerProofStr)
  return {
    stateDepth,
    intStateDepth,
    voteOptionDepth,
    msgPerProof,
    maxUsers: 5 ** stateDepth,
    tallyBatchUserCapacity: 5 ** intStateDepth,
    tallyBatchCountAll: 5 ** (stateDepth - intStateDepth),
  }
}

function buildFormulaSummaries(phaseSummaries: PhaseSummary[]): FormulaSummary[] {
  const grouped = new Map<string, { msg?: PhaseSummary; tally?: PhaseSummary }>()
  for (const summary of phaseSummaries) {
    const entry = grouped.get(summary.circuitPower) || {}
    if (summary.phase === 'MSG') entry.msg = summary
    if (summary.phase === 'TALLY') entry.tally = summary
    grouped.set(summary.circuitPower, entry)
  }

  const formulas: FormulaSummary[] = []
  for (const [circuitPower, entry] of grouped) {
    if (!entry.msg?.dominantBucket || !entry.tally?.dominantBucket) continue
    const meta = parseCircuitPower(circuitPower)
    const msg = entry.msg.dominantBucket
    const tally = entry.tally.dominantBucket
    const tallyAllTimeP50Ms = round2(
      Math.ceil(meta.tallyBatchCountAll / tally.batchSize) * tally.p50Ms,
    )
    const tallyAllTimeP90Ms = round2(
      Math.ceil(meta.tallyBatchCountAll / tally.batchSize) * tally.p90Ms,
    )
    formulas.push({
      circuitPower,
      stateDepth: meta.stateDepth,
      intStateDepth: meta.intStateDepth,
      voteOptionDepth: meta.voteOptionDepth,
      maxUsers: meta.maxUsers,
      msgPerProof: meta.msgPerProof,
      msgProofsPerGenerationBatch: msg.batchSize,
      tallyBatchUserCapacity: meta.tallyBatchUserCapacity,
      tallyBatchCountAll: meta.tallyBatchCountAll,
      tallyProofsPerGenerationBatch: tally.batchSize,
      msgSamples: msg.count,
      tallySamples: tally.count,
      tMsgP50Ms: msg.p50Ms,
      tMsgP90Ms: msg.p90Ms,
      tTallyP50Ms: tally.p50Ms,
      tTallyP90Ms: tally.p90Ms,
      tallyAllTimeP50Ms,
      tallyAllTimeP90Ms,
      msgProofCountFormula: `ceil(m / ${meta.msgPerProof})`,
      msgGenerationRoundsFormula: `ceil(ceil(m / ${meta.msgPerProof}) / ${msg.batchSize})`,
      totalFormulaP50: `ceil(ceil(m / ${meta.msgPerProof}) / ${msg.batchSize}) * ${msg.p50Ms} + ceil(${meta.tallyBatchCountAll} / ${tally.batchSize}) * ${tally.p50Ms}`,
      totalFormulaP90: `ceil(ceil(m / ${meta.msgPerProof}) / ${msg.batchSize}) * ${msg.p90Ms} + ceil(${meta.tallyBatchCountAll} / ${tally.batchSize}) * ${tally.p90Ms}`,
    })
  }

  return formulas.sort((a, b) => a.circuitPower.localeCompare(b.circuitPower))
}

function buildActualEstimateSummaries(
  formulaSummaries: FormulaSummary[],
  runtimeTimingSummaries: RuntimeTimingSummary[],
): ActualEstimateSummary[] {
  const runtimeByCircuit = new Map(
    runtimeTimingSummaries.map((item) => [item.circuitPower, item] as const),
  )
  const rows: ActualEstimateSummary[] = []
  for (const formula of formulaSummaries) {
    const runtime = runtimeByCircuit.get(formula.circuitPower)
    if (!runtime) continue
    const scenarioMessages = formula.maxUsers * 5
    const msgProofCount = Math.ceil(scenarioMessages / formula.msgPerProof)
    const msgRounds = Math.ceil(msgProofCount / formula.msgProofsPerGenerationBatch)
    const tallyRounds = Math.ceil(
      formula.tallyBatchCountAll / formula.tallyProofsPerGenerationBatch,
    )
    const msgStageUnitP50Ms = Math.max(
      formula.tMsgP50Ms,
      runtime.msgSubmitIntervalStats?.p50Ms ?? 0,
    )
    const msgStageUnitP90Ms = Math.max(
      formula.tMsgP90Ms,
      runtime.msgSubmitIntervalStats?.p90Ms ?? 0,
    )
    const tallyStageUnitP50Ms = Math.max(
      formula.tTallyP50Ms,
      runtime.tallySubmitIntervalStats?.p50Ms ?? 0,
    )
    const tallyStageUnitP90Ms = Math.max(
      formula.tTallyP90Ms,
      runtime.tallySubmitIntervalStats?.p90Ms ?? 0,
    )
    const gateTimeMs = runtime.gateTimeMs ?? 0
    const finalizeTimeMs = runtime.finalizeTimeMs ?? 0
    rows.push({
      circuitPower: formula.circuitPower,
      maxUsers: formula.maxUsers,
      scenarioMessages,
      msgRounds,
      tallyRounds,
      msgStageUnitP50Ms,
      msgStageUnitP90Ms,
      tallyStageUnitP50Ms,
      tallyStageUnitP90Ms,
      gateTimeMs,
      finalizeTimeMs,
      actualTotalP50Ms: round2(
        msgRounds * msgStageUnitP50Ms +
          tallyRounds * tallyStageUnitP50Ms +
          gateTimeMs +
          finalizeTimeMs,
      ),
      actualTotalP90Ms: round2(
        msgRounds * msgStageUnitP90Ms +
          tallyRounds * tallyStageUnitP90Ms +
          gateTimeMs +
          finalizeTimeMs,
      ),
      actualFormulaP50: `${msgRounds} * max(${formula.tMsgP50Ms}, ${round2(
        runtime.msgSubmitIntervalStats?.p50Ms ?? 0,
      )}) + ${tallyRounds} * max(${formula.tTallyP50Ms}, ${round2(
        runtime.tallySubmitIntervalStats?.p50Ms ?? 0,
      )}) + ${gateTimeMs} + ${finalizeTimeMs}`,
      actualFormulaP90: `${msgRounds} * max(${formula.tMsgP90Ms}, ${round2(
        runtime.msgSubmitIntervalStats?.p90Ms ?? 0,
      )}) + ${tallyRounds} * max(${formula.tTallyP90Ms}, ${round2(
        runtime.tallySubmitIntervalStats?.p90Ms ?? 0,
      )}) + ${gateTimeMs} + ${finalizeTimeMs}`,
    })
  }
  return rows.sort((a, b) => a.circuitPower.localeCompare(b.circuitPower))
}

function summarizeSubmittedBatches(rows: SubmittedBatch[]): SubmittedBatchSummary[] {
  const grouped = new Map<string, SubmittedBatch[]>()
  for (const row of rows) {
    const arr = grouped.get(row.fileName)
    if (arr) arr.push(row)
    else grouped.set(row.fileName, [row])
  }

  const summaries: SubmittedBatchSummary[] = []
  for (const [fileName, items] of grouped) {
    const meta = items[0]
    const msgRows = items.filter((item) => item.phase === 'MSG')
    const tallyRows = items.filter((item) => item.phase === 'TALLY')
    summaries.push({
      fileName,
      roundId: meta.roundId,
      circuitPower: meta.circuitPower,
      concurrency: meta.concurrency,
      msgBatchTxCount: msgRows.length,
      tallyBatchTxCount: tallyRows.length,
      msgBatchItemTotal: msgRows.reduce((acc, cur) => acc + cur.count, 0),
      tallyBatchItemTotal: tallyRows.reduce((acc, cur) => acc + cur.count, 0),
    })
  }

  return summaries.sort((a, b) => a.fileName.localeCompare(b.fileName))
}

function formatDuration(ms: number | null) {
  if (ms == null) return '-'
  if (ms >= 60_000) return `${round2(ms / 60_000)}min`
  return `${round2(ms / 1000)}s`
}

function renderMarkdown(
  files: string[],
  samples: Sample[],
  phaseSummaries: PhaseSummary[],
  submittedBatchSummaries: SubmittedBatchSummary[],
  formulaSummaries: FormulaSummary[],
  runtimeTimingSummaries: RuntimeTimingSummary[],
  actualEstimateSummaries: ActualEstimateSummary[],
) {
  const lines: string[] = []
  lines.push('# Proof Batch Benchmark Report')
  lines.push('')
  lines.push(`Generated at: ${new Date().toISOString()}`)
  lines.push(`Files analyzed: ${files.length}`)
  lines.push(`Batch samples analyzed: ${samples.length}`)
  lines.push(
    `Submitted batch tx samples analyzed: ${submittedBatchSummaries.reduce((acc, cur) => acc + cur.msgBatchTxCount + cur.tallyBatchTxCount, 0)}`,
  )
  lines.push('')
  lines.push('## Method')
  lines.push('')
  lines.push('- Source logs: `benchmark/*.log`')
  lines.push('- Parsed lines: `Generated MSG/TALLY/DEACTIVATE proof batch [a..b] in Xms`')
  lines.push('- Parsed submit lines: `Processed MSG/TALLY batch (count=N) ✅ tx=...`')
  lines.push('- Grouping keys: `circuitPower + phase + batchSize + concurrency`')
  lines.push('- Main stats: `count`, `avg`, `p50`, `p90`, `min`, `max`')
  lines.push('')
  lines.push('## Submitted Batch Transactions')
  lines.push('')
  lines.push('| Circuit | Concurrency | File | MSG Batch Txs | MSG Items Total | TALLY Batch Txs | TALLY Items Total |')
  lines.push('| --- | ---: | --- | ---: | ---: | ---: | ---: |')
  for (const summary of submittedBatchSummaries) {
    lines.push(
      `| ${summary.circuitPower} | ${summary.concurrency} | ${summary.fileName} | ${summary.msgBatchTxCount} | ${summary.msgBatchItemTotal} | ${summary.tallyBatchTxCount} | ${summary.tallyBatchItemTotal} |`,
    )
  }
  lines.push('')
  lines.push('## Runtime Timing Reference')
  lines.push('')
  lines.push('| Circuit | Concurrency | File | MSG Submit P50 | MSG Submit P90 | TALLY Submit P50 | TALLY Submit P90 | Gate Time | Finalize Time | MSG Stage Wall | TALLY Stage Wall |')
  lines.push('| --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const summary of runtimeTimingSummaries) {
    lines.push(
      `| ${summary.circuitPower} | ${summary.concurrency} | ${summary.fileName} | ${formatDuration(summary.msgSubmitIntervalStats?.p50Ms ?? null)} | ${formatDuration(summary.msgSubmitIntervalStats?.p90Ms ?? null)} | ${formatDuration(summary.tallySubmitIntervalStats?.p50Ms ?? null)} | ${formatDuration(summary.tallySubmitIntervalStats?.p90Ms ?? null)} | ${formatDuration(summary.gateTimeMs)} | ${formatDuration(summary.finalizeTimeMs)} | ${formatDuration(summary.msgStageWallMs)} | ${formatDuration(summary.tallyStageWallMs)} |`,
    )
  }
  lines.push('')
  lines.push('## ETA Quick Reference')
  lines.push('')
  lines.push('| Circuit | Phase | Typical Batch Size | Concurrency | Samples | P50 Batch Time (min) | P90 Batch Time (min) | Suggested Normal ETA / batch | Suggested Conservative ETA / batch |')
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |')
  for (const summary of phaseSummaries) {
    const dominant = summary.dominantBucket
    if (!dominant) continue
    lines.push(
      `| ${summary.circuitPower} | ${summary.phase} | ${dominant.batchSize} | ${dominant.concurrency} | ${dominant.count} | ${msToMinutes(dominant.p50Ms)} | ${msToMinutes(dominant.p90Ms)} | ${msToMinutes(dominant.p50Ms)}min x remaining batches | ${msToMinutes(dominant.p90Ms)}min x remaining batches |`,
    )
  }
  lines.push('')
  lines.push('## Formula Reference')
  lines.push('')
  lines.push('- `m`: message count variable')
  lines.push('- `MSG_PROOF_COUNT(m) = ceil(m / msgPerProof)`')
  lines.push('- `MSG_TIME(m) = ceil(MSG_PROOF_COUNT(m) / msgProofsPerGenerationBatch) * T_msg`')
  lines.push('- `TALLY_PROOF_COUNT_ALL = 5^(stateDepth - intStateDepth)`')
  lines.push('- `TALLY_ALL_TIME = ceil(TALLY_PROOF_COUNT_ALL / tallyProofsPerGenerationBatch) * T_tally`')
  lines.push('- `TOTAL_TIME(m) = MSG_TIME(m) + TALLY_ALL_TIME`')
  lines.push('')
  lines.push('| Circuit | stateDepth | intStateDepth | Max Users | msgPerProof | msgProofsPerGenerationBatch | tallyProofCountAll | tallyProofsPerGenerationBatch | T_msg P50 (min) | T_msg P90 (min) | T_tally P50 (min) | T_tally P90 (min) | TALLY_ALL_TIME P50 (min) | TALLY_ALL_TIME P90 (min) | TOTAL_TIME_P50(m) | TOTAL_TIME_P90(m) |')
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |')
  for (const item of formulaSummaries) {
    lines.push(
      `| ${item.circuitPower} | ${item.stateDepth} | ${item.intStateDepth} | ${item.maxUsers} | ${item.msgPerProof} | ${item.msgProofsPerGenerationBatch} | ${item.tallyBatchCountAll} | ${item.tallyProofsPerGenerationBatch} | ${msToMinutes(item.tMsgP50Ms)} | ${msToMinutes(item.tMsgP90Ms)} | ${msToMinutes(item.tTallyP50Ms)} | ${msToMinutes(item.tTallyP90Ms)} | ${msToMinutes(item.tallyAllTimeP50Ms)} | ${msToMinutes(item.tallyAllTimeP90Ms)} | ${item.totalFormulaP50} | ${item.totalFormulaP90} |`,
    )
  }
  lines.push('')
  lines.push('## Actual Total Time Estimate')
  lines.push('')
  lines.push('- Scenario: `maxUsers` participants, each participant casts `5` votes')
  lines.push('- Model: `Actual ≈ MSG rounds * max(MSG proof chunk, MSG submit interval) + gate + TALLY rounds * max(TALLY proof chunk, TALLY submit interval) + finalize`')
  lines.push('')
  lines.push('| Circuit | Max Users | Scenario Messages | MSG Rounds | TALLY Rounds | Gate Time | Finalize Time | Actual Total P50 | Actual Total P90 |')
  lines.push('| --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |')
  for (const item of actualEstimateSummaries) {
    lines.push(
      `| ${item.circuitPower} | ${item.maxUsers} | ${item.scenarioMessages} | ${item.msgRounds} | ${item.tallyRounds} | ${formatDuration(item.gateTimeMs)} | ${formatDuration(item.finalizeTimeMs)} | ${formatDuration(item.actualTotalP50Ms)} | ${formatDuration(item.actualTotalP90Ms)} |`,
    )
  }
  lines.push('')
  lines.push('## Dominant Buckets')
  lines.push('')
  lines.push('| Circuit | Phase | Dominant Batch Size | Concurrency | Samples | Avg (ms) | P50 (ms) | P90 (ms) | Min (ms) | Max (ms) |')
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
  for (const summary of phaseSummaries) {
    const dominant = summary.dominantBucket
    if (!dominant) continue
    lines.push(
      `| ${summary.circuitPower} | ${summary.phase} | ${dominant.batchSize} | ${dominant.concurrency} | ${dominant.count} | ${dominant.avgMs} | ${dominant.p50Ms} | ${dominant.p90Ms} | ${dominant.minMs} | ${dominant.maxMs} |`,
    )
  }
  lines.push('')

  for (const summary of phaseSummaries) {
    lines.push(`## ${summary.circuitPower} / ${summary.phase}`)
    lines.push('')
    lines.push(`- Total samples: ${summary.totalCount}`)
    lines.push(`- Batch sizes seen: ${summary.batchSizes.join(', ')}`)
    if (summary.dominantBucket) {
      lines.push(
        `- Dominant bucket: batchSize=${summary.dominantBucket.batchSize}, concurrency=${summary.dominantBucket.concurrency}, samples=${summary.dominantBucket.count}`,
      )
    }
    lines.push('')
    lines.push('| Batch Size | Concurrency | Samples | Avg (ms) | P50 (ms) | P90 (ms) | Min (ms) | Max (ms) | Source Files |')
    lines.push('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |')
    for (const bucket of summary.buckets) {
      lines.push(
        `| ${bucket.batchSize} | ${bucket.concurrency} | ${bucket.count} | ${bucket.avgMs} | ${bucket.p50Ms} | ${bucket.p90Ms} | ${bucket.minMs} | ${bucket.maxMs} | ${bucket.sourceFiles.join(', ')} |`,
      )
    }
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

async function main() {
  const fileNames = (await fs.readdir(BENCHMARK_DIR))
    .filter((name) => name.endsWith('.log'))
    .sort()

  const samples = (await Promise.all(fileNames.map((fileName) => parseSamples(fileName)))).flat()
  const submittedBatches = (
    await Promise.all(fileNames.map((fileName) => parseSubmittedBatches(fileName)))
  ).flat()
  const runtimeTimingSummaries = (
    await Promise.all(fileNames.map((fileName) => parseRuntimeTimingSummary(fileName)))
  ).filter((item): item is RuntimeTimingSummary => item !== null)
  const buckets = summarizeBuckets(samples)
  const phaseSummaries = summarizePhases(buckets)
  const submittedBatchSummaries = summarizeSubmittedBatches(submittedBatches)
  const formulaSummaries = buildFormulaSummaries(phaseSummaries)
  const actualEstimateSummaries = buildActualEstimateSummaries(
    formulaSummaries,
    runtimeTimingSummaries,
  )

  const jsonReport = {
    generatedAt: new Date().toISOString(),
    sourceDir: BENCHMARK_DIR,
    filesAnalyzed: fileNames,
    batchSamplesAnalyzed: samples.length,
    submittedBatchSamplesAnalyzed: submittedBatches.length,
    grouping: ['circuitPower', 'phase', 'batchSize', 'concurrency'],
    submittedBatchSummaries,
    runtimeTimingSummaries,
    formulaSummaries,
    actualEstimateSummaries,
    phaseSummaries,
    buckets,
  }

  const markdown = renderMarkdown(
    fileNames,
    samples,
    phaseSummaries,
    submittedBatchSummaries,
    formulaSummaries,
    runtimeTimingSummaries,
    actualEstimateSummaries,
  )

  await fs.writeFile(JSON_REPORT, `${JSON.stringify(jsonReport, null, 2)}\n`)
  await fs.writeFile(MD_REPORT, markdown)

  console.log(`Wrote ${JSON_REPORT}`)
  console.log(`Wrote ${MD_REPORT}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
