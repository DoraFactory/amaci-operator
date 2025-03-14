import { fetchRounds } from '../vota/indexer'
import { Task, TaskAct } from '../types'
// import { Timer } from '../storage/timer'
import { genKeypair } from '../lib/keypair'
import { log } from '../log'
import { IKeypair } from '../types'  // Import IKeypair type

// Define RoundData type or import it if available
type RoundData = any; // Replace with proper type if available

// 在 inspect.ts 中缓存密钥对
let cachedCoordinator: IKeypair | null = null;
let cachedRounds: RoundData[] | null = null;
let lastFetchTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

export const inspect: TaskAct = async () => {
  const now = Date.now()
  const startTime = Date.now();
  const startMem = process.memoryUsage();
  console.log(`[INSPECT START] Time: ${new Date().toISOString()}, Memory: ${Math.round(startMem.heapUsed / 1024 / 1024)}MB`);
  
  
  // 使用缓存的密钥对
  if (!cachedCoordinator) {
    cachedCoordinator = genKeypair(BigInt(process.env.COORDINATOR_PRI_KEY));
  }
  const coordinator = cachedCoordinator;

  // 使用缓存
  let rounds;
  if (cachedRounds && (now - lastFetchTime < CACHE_TTL)) {
    rounds = cachedRounds;
    console.log('Using cached rounds data');
  } else {
    // 根据maci public key和code id来获取所有的rounds
    console.log(`[FETCH START] Time: ${new Date().toISOString()}`);
    rounds = await fetchRounds(coordinator.pubKey.map(String));
    cachedRounds = rounds;
    lastFetchTime = now;
    console.log('Fetched fresh rounds data');
  }
  
  console.log('===========')
  console.log(process.env.CODE_IDS)
  console.log(coordinator.pubKey.map(String))
  console.log(rounds)
  console.log('===========')
  const newTasks: Task[] = []

  let tasks = 0
  for (const maciRound of rounds) {

    // Tally
    if (
      ['Pending', 'Voting', 'Processing', 'Tallying'].includes(
        maciRound.period,
      ) &&
      now > Number(maciRound.votingEnd) / 1e6
    ) {
      tasks ++
      newTasks.push({ name: 'tally', params: { id: maciRound.id } })
    }
  }

  console.log(`[TASK inspect] find rounds count: ${tasks}/${rounds.length}`)
  log(`[TASK inspect] find rounds count: ${tasks}/${rounds.length}`)


  const endMem = process.memoryUsage();
  console.log(`[INSPECT END] Time: ${new Date().toISOString()}, Memory: ${Math.round(endMem.heapUsed / 1024 / 1024)}MB, Delta: ${Math.round((endMem.heapUsed - startMem.heapUsed) / 1024 / 1024)}MB, Duration: ${Date.now() - startTime}ms`);
  
  return { newTasks }
}
