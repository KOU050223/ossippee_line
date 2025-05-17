import express from 'express'
import { middleware, messagingApi } from '@line/bot-sdk'
const { MessagingApiClient } = messagingApi

const router = express.Router()
const client = new MessagingApiClient({
  channelAccessToken: process.env.LINE_ACCESS_TOKEN
})

// POST にだけミドルウェアをかける
router.post(
  '/', 
  middleware({ channelSecret: process.env.LINE_CHANNEL_SECRET }),
  async (req, res) => {
    console.log('lineRouterきたー')
    const events = req.body.events || []
    await Promise.all(events.map(ev => {
      if (ev.type === 'message' && ev.message.type === 'text') {
        return client.replyMessage(ev.replyToken, {
          type: 'text',
          text: `「${ev.message.text}」を受け取りました！`
        })
      }
      return Promise.resolve()
    }))
    // たとえエラーが起きても 200 を返すように catch しても OK
    res.sendStatus(200)
  }
)

export default router
