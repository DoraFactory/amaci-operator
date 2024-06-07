import express from 'express'
import { MongoStorage } from './storage/MongoStorage'

const app = express()
const storage = new MongoStorage()

app.use(express.json())

app.get('/', (_, res) => {
  res.send('Hello World')
})

app.post('/maci', async (req, res) => {
  const body = req.body

  const payload: Parameters<typeof storage.createMacidata>[0] = {
    chainId: 1,
    contractAddr: body.contractAddr,
    type: '2-1-1-5',
    coordinatorPrivateKey: process.env.COORDINATOR_PRI_KEY || '',
    eoaPrivateKey: undefined,
    startAt: body.startAt,
    endAt: body.endAt,
    maxVoteOptions: 5,
    deactivateInterval: 60000,
    latestdeactivateAt: 0,
    isStopVoting: false,
    deactivateProofsCount: 0,
    submitedDeactivateProofsCount: 0,
    hasProofs: false,
    msgProofsCount: 0,
    tallyProofsCount: 0,
    submitedProofsCount: 0,
    ifFinished: false,
  }

  const ok = await storage.createMacidata(payload)

  res.send(ok)
})

app.listen(3000)
