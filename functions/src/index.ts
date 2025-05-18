import {onRequest} from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as v1functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import express from 'express';
import { middleware as lineMiddleware, Client } from '@line/bot-sdk';

// Firebase Admin SDK 初期化
admin.initializeApp();
const db = admin.firestore();

// LINE チャンネル設定は Firebase Functions の config から取得します
// 実行前に以下コマンドで設定してください: 
// firebase functions:config:set line.channel_secret="YOUR_SECRET" line.channel_access_token="YOUR_TOKEN"
const lineConfig = {
  channelSecret: v1functions.config().line.channel_secret,
  channelAccessToken: v1functions.config().line.channel_access_token,
};
const lineClient = new Client(lineConfig);

// Express アプリ初期化
const app = express();

// ルートエンドポイント
app.get('/', (_req, res) => {
  res.send('Hello, World!');
});

// Webhook エンドポイント用に raw ボディをパース & 署名検証ミドルウェア適用
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  lineMiddleware(lineConfig),
  async (req, res) => {
    try {
      const events = (req.body as any).events || [];
      await Promise.all(events.map(handleEvent));
      res.status(200).send('OK');
    } catch (err) {
      logger.error('Webhook 処理中にエラー:', err);
      res.status(500).send('Internal Server Error');
    }
  }
);

// イベント処理関数
async function handleEvent(event: any) {
  if (event.type === 'follow') {
    const userId: string = event.source.userId;
    const profile = await lineClient.getProfile(userId);

    // Firestore にユーザー登録
    await registerUserToDatabase({
      userId: profile.userId,
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl,
      statusMessage: profile.statusMessage,
    });

    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: `${profile.displayName} さん、はじめまして！登録が完了しました😊`,
    });
  }

  if (event.type !== 'message') return null;

  const { replyToken, message } = event;
  switch (message.type) {
    case 'text':
      return handleText(replyToken, message.text);
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

// テキストメッセージ処理
async function handleText(replyToken: string, text: string) {
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

// Firestore にユーザー登録する関数
async function registerUserToDatabase(user: {
  userId: string;
  displayName: string;
  pictureUrl?: string;
  statusMessage?: string;
}) {
  logger.info('新規ユーザー登録:', user);
  const userRef = db.collection('users').doc(user.userId);
  await userRef.set(user, { merge: true });
}

// Firebase Functions (v2) としてエクスポート
export const lineBot = onRequest({ region: 'asia-northeast1' }, app);
