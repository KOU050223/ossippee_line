import 'dotenv/config';
import express from 'express';
import { middleware as lineMiddleware, Client } from '@line/bot-sdk';
import path from 'path';
import { fileURLToPath } from 'url';

// firebase 

import admin from "firebase-admin";

// 環境変数からサービスアカウントキーを取得
const serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);

// Firebase Admin SDKを初期化
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const docRef = db.collection('users').doc('alovelace');

await docRef.set({
  first: 'Ada',
  last: 'Lovelace',
  born: 1815
});

// ES Module で __dirname を使うための定義
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 環境変数の読み込み
const {
  LINE_CHANNEL_SECRET,
  LINE_CHANNEL_ACCESS_TOKEN,
  PORT = 3000,
} = process.env;

// 必須設定のチェック
if (!LINE_CHANNEL_SECRET || !LINE_CHANNEL_ACCESS_TOKEN) {
  console.error('ERROR: LINE_CHANNEL_SECRET および LINE_CHANNEL_ACCESS_TOKEN が必要です。');
  process.exit(1);
}

// LINE SDK のクライアント初期化
const lineConfig = {
  channelSecret: LINE_CHANNEL_SECRET,
  channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
};
const lineClient = new Client(lineConfig);

// Express アプリケーション初期化
const app = express();
app.use('/stylesheets', express.static(path.join(process.cwd(), 'stylesheets')));
app.use('/audio', express.static(path.join(__dirname, 'public', 'audio')));

// ルートエンドポイント
app.get('/', (req, res) => res.send('Hello, World!'));

// Webhook エンドポイント (署名検証のため、JSON パーサーではなく raw パーサーを使用)
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  lineMiddleware(lineConfig),
  async (req, res, next) => {
    try {
      const events = req.body.events || [];
      await Promise.all(events.map(handleEvent));
      res.sendStatus(200);
    } catch (err) {
      next(err);
    }
  }
);

// グローバルエラーハンドラー
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Internal Server Error');
});

// サーバ起動
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

// イベント処理
async function handleEvent(event) {
  if (event.type !== 'message') return;

  const { replyToken, message } = event;
  try {
    switch (message.type) {
      case 'text':
        await handleText(replyToken, message.text);
        break;
      case 'sticker':
        await lineClient.replyMessage(replyToken, {
          type: 'sticker',
          packageId: message.packageId,
          stickerId: message.stickerId,
        });
        break;
      case 'image':
        // 画像は受け取り確認のみ
        await lineClient.replyMessage(replyToken, {
          type: 'text',
          text: '画像を受け取りました。',
        });
        break;
      default:
        break;
    }
  } catch (err) {
    console.error('handleEvent Error:', err);
    await lineClient.replyMessage(replyToken, {
      type: 'text',
      text: '処理中にエラーが発生しました。',
    });
  }
}

// テキストメッセージ処理
async function handleText(replyToken, text) {
  switch (text) {
    case 'コマンド':
      return lineClient.replyMessage(replyToken, {
        type: 'text',
        text: ['コマンド一覧:', '・コマンド', '・あそびかた'].join('\n'),
      });
    case 'あそびかた':
      return lineClient.replyMessage(replyToken, {
        type: 'text',
        text: '遊び方はこちら: https://liff.line.me/2006601390-9yZjDbWP',
      });
    default:
      return lineClient.replyMessage(replyToken, {
        type: 'text',
        text,
      });
  }
}
