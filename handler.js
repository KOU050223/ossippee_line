import serverless from 'serverless-http'
import app from './src/index.js'  // default export で Express app を返すようにしてください

export const handler = serverless(app)
