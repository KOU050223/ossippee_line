import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import express from 'express';
import { middleware as lineMiddleware, Client } from '@line/bot-sdk';

// Admin SDK 初期化
admin.initializeApp();
const db = admin.firestore();

// Secret Manager から参照するキー名（CLI で登録済みの名前と合わせる）
const LINE_CHANNEL_SECRET    = defineSecret('LINE_CHANNEL_SECRET');
const LINE_CHANNEL_TOKEN     = defineSecret('LINE_CHANNEL_ACCESS_TOKEN');

export const lineBot = onRequest(
  {
    region: 'asia-northeast1',
    secrets: [LINE_CHANNEL_SECRET, LINE_CHANNEL_TOKEN],
  },
  async (req, res) => {
    // --- シークレットを取得 ---
    const channelSecret     = await LINE_CHANNEL_SECRET.value();
    const channelAccessToken = await LINE_CHANNEL_TOKEN.value();

    // LINE SDK Client を生成
    const lineConfig = { channelSecret, channelAccessToken };
    const lineClient = new Client(lineConfig);

    // Express アプリを都度組み立て
    const app = express();

    // ルート
    app.get('/', (_req, res) => {
      res.send('Hello, World!');
    });

    // Firestore 更新エンドポイント
    app.post(
      '/changeState',
      express.raw({ type: 'application/json' }),
      async (req, res) => {
        const { userId, gameState } = req.body;
        if (!userId || !gameState) {
          res.status(400).send('Bad Request');
          return;
        }
        try {
          await db.collection('users').doc(userId)
            .set({ gameState }, { merge: true });
          res.status(200).send('OK');
        } catch (err) {
          logger.error('Firestore 更新エラー:', err);
          res.status(500).send('Internal Server Error');
        }
      }
    );

    // Webhook（署名検証ミドルウェア付き）
    app.post(
      '/webhook',
      express.raw({ type: 'application/json' }),
      lineMiddleware(lineConfig),
      async (req, res) => {
        try {
          const events = (req.body as any).events || [];
            await Promise.all(events.map((event: any) => handleEvent(event, lineClient)));
          res.status(200).send('OK');
        } catch (err) {
          logger.error('Webhook 処理中にエラー:', err);
          res.status(500).send('Internal Server Error');
        }
      }
    );

    // 最後に Express に流し込む
    app(req, res);
  }
);

// イベント処理
async function handleEvent(event: any, lineClient: Client) {
  if (event.type === 'follow') {
    const userId = event.source.userId;
    const profile = await lineClient.getProfile(userId);
    // Firestore に登録
    await db.collection('users').doc(profile.userId).set({
      userId: profile.userId,
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl,
      gameState: 'entry',
      nomiPoint: 0,
    }, { merge: true });
    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: `${profile.displayName} さん、参加ありがとう！\nあなたのIDは ${profile.userId} です。`,
    });
  }
  if (event.type !== 'message') return null;

  const { replyToken, message } = event;
  switch (message.type) {
    case 'text':
      return handleText(replyToken, message.text, lineClient);
    case 'sticker':
      return lineClient.replyMessage(replyToken, {
        type: 'sticker',
        packageId: message.packageId,
        stickerId: message.stickerId,
      });
    case 'image':
      return lineClient.replyMessage(replyToken, {
        type: 'text',
        text: '画像を受け取りました。',
      });
    default:
      return null;
  }
}

// テキスト応答
async function handleText(
  replyToken: string,
  text: string,
  lineClient: Client
) {
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
