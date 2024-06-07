import { MongoClient, ServerApiVersion } from 'mongodb'
const uri = process.env.MONGODB_URI || ''

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})

async function run() {
  try {
    const database = client.db('sample_mflix')

    const movies = database.collection('movies')
    // Query for a movie that has the title 'Back to the Future'
    const query = { title: 'Back to the Future' }

    const movie = await movies.findOne(query)

    console.log(movie)
  } finally {
    // Ensures that the client will close when you finish/error
    await client.close()
  }
}
run().catch(console.dir)
