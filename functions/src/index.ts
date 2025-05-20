import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import express from "express";
import { middleware as lineMiddleware, Client } from "@line/bot-sdk";
import { WebhookEvent, MessageEvent, FollowEvent, TextEventMessage } from "@line/bot-sdk";

// Admin SDK 初期化
admin.initializeApp();
const db = admin.firestore();

// Secret Manager に登録済みの名前と合わせる
const LINE_CHANNEL_SECRET = defineSecret("LINE_CHANNEL_SECRET");
const LINE_CHANNEL_ACCESS_TOKEN = defineSecret("LINE_CHANNEL_ACCESS_TOKEN");

export const lineBot = onRequest(
  {
    region: "asia-northeast1",
    secrets: [LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN],
  },
  async (req, res) => {
    // シークレット取得
    if (process.env.FUNCTIONS_EMULATOR) {
      require('dotenv').config();  // Emulators 起動時だけ .env を読む
    }
    const channelSecret = process.env.LINE_CHANNEL_SECRET;
    const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    console.log("channelSecret", channelSecret);
    console.log("channelAccessToken", channelAccessToken);

    // LINE SDK Client を生成
    const lineClient = new Client({ channelSecret, channelAccessToken: channelAccessToken ?? "" });

    // Express アプリを都度組み立て
    const app = express();

    // ルート
    app.get("/", (_req, res) => {
      res.send("Hello, World!");
    });

    // Firestore 更新エンドポイント
    app.post(
      "/changeState",
      express.raw({ type: "application/json" }),
      async (req, res) => {
        const { userId, gameState, talkState } = req.body;
        if (!userId || !gameState || !talkState) {
          res.status(400).send("Bad Request");
          return;
        }
        try {
          await db
            .collection("users")
            .doc(userId)
            .set({ gameState, talkState }, { merge: true });
          res.status(200).send("OK");
        } catch (err) {
          logger.error("Firestore 更新エラー:", err);
          res.status(500).send("Internal Server Error");
        }
      }
    );

    // Webhook（署名検証ミドルウェア付き）
    app.post(
      "/webhook",
      express.raw({ type: "application/json" }),
      (req, res, next) => {
        logger.info("▶ /webhook hit");
        logger.info("   X-Line-Signature:", req.header("X-Line-Signature"));
        logger.info("   Content-Length:", req.get("content-length"));
        next();
      },
      lineMiddleware({ channelSecret: channelSecret ?? "" }),
      async (req, res) => {
        try {
          const events = (req.body as any).events || [];
          await Promise.all(
            events.map((event: any) => handleEvent(event, lineClient))
          );
          res.status(200).send("OK");
        } catch (err) {
          logger.error("Webhook 処理中にエラー:", err);
          res.status(500).send("Internal Server Error");
        }
      }
    );

    // Express 実行
    app(req, res);
  }
);

// PHASES
const PHASES = [
  "phase1",    // 乾杯直後
  "phase2-1",  // 雑談①
  "phase2-2",  // 雑談②
  "phase2-3",  // 雑談③
  "phase3",    // 二次会誘い
  "phase4",    // ラストオーダー直前
];

type PhaseType = typeof PHASES[number] | "end";

interface ScenarioPhase {
  msg: string;
  choices: { text: string; point: number; react: string; }[];
  next: PhaseType;
}

type ScenarioType = {
  [key in PhaseType]?: ScenarioPhase;
};

const SCENARIO: ScenarioType = {
  "phase1": {
    msg: "店長:「みなさん、乾杯！」\nあなた：（飲みすぎて少し落ち着かない…）\n選択肢:\n1. すみません、少し席を外す必要がありまして…\n2. 乾杯ー！（笑顔で軽くグラスだけ掲げる）\n3. あと一杯だけ…おかわりお願いします",
    choices: [
      { text: "1", point: 3, react: "同僚A:「あれ？大丈夫？」と心配そうに小声で聞き返す。" },
      { text: "2", point: 1, react: "同僚B:「お、元気だね！」と照れ笑いしつつ拍手。" },
      { text: "3", point: 2, react: "店員:「かしこまりました」と手早くジョッキを用意しに行く。" },
    ],
    next: "phase2-1"
  },
  "phase2-1": {
    msg: "同僚C:「この週末、何か予定ある？」\nあなた：（そろそろ切り上げたい…）\n選択肢:\n1. 実はちょっと急ぎの用事を片付けたくて…そろそろ失礼してもいいですか？\n2. まだ未定だけど…みんなは？\n3. 週末は家でゆっくりしようかな…",
    choices: [
      { text: "1", point: 3, react: "同僚C:「あ、そうなんだ。じゃあ今日はここまでで！」と快く了承。" },
      { text: "2", point: 1, react: "同僚D:「そうなんだ！続きは週末に話そう！」と楽しげに話題継続。" },
      { text: "3", point: 2, react: "同僚E:「それもいいね」と軽く同意。" },
    ],
    next: "phase2-2"
  },
  "phase2-2": {
    msg: "同僚F:「最近、休日は何してるの？」\nあなた：（早くお暇を…）\n選択肢:\n1. 趣味を楽しむ時間が取れなくて…今日はこれで失礼します\n2. 新しいゲームを始めてみたよ！\n3. 家で家族と過ごす予定だから…ラストオーダーで締めない？",
    choices: [
      { text: "1", point: 3, react: "同僚F:「あら、そうなの？じゃあまた今度ね」と気遣いの言葉。" },
      { text: "2", point: 1, react: "同僚G:「へえ、面白そう！」と話を広げようとする。" },
      { text: "3", point: 2, react: "店長:「いい提案だね」と盛り上げる。" },
    ],
    next: "phase2-3"
  },
  "phase2-3": {
    msg: "同僚H:「あの案件、もうすぐ終わりそう？」\nあなた：（これ以上は耐えられない…）\n選択肢:\n1. 実は昨日徹夜で対応してて…今日は失礼します\n2. はい、もう少しで…詳細はまた後日！\n3. まだ山場だけど、どうにかなるよ！",
    choices: [
      { text: "1", point: 3, react: "同僚H:「マジか！お疲れさま…また報告聞かせて」と同情。" },
      { text: "2", point: 2, react: "同僚I:「了解！」と簡潔に切り上げムード。" },
      { text: "3", point: 1, react: "同僚J:「頼もしいね！」と笑顔で話継続。" },
    ],
    next: "phase3"
  },
  "phase3": {
    msg: "ホスト:「二次会、どこか行く人～？」\nあなた：（これ以上は控えたい…）\n選択肢:\n1. ごめんなさい、今日はちょっと控えます…お先に失礼します\n2. ちょっと予定を確認してから決めてもいいですか？\n3. ぜひ参加したいです！",
    choices: [
      { text: "1", point: 3, react: "ホスト:「あ、そうか…また今度ね」と少し残念そうに手を振る。" },
      { text: "2", point: 2, react: "同僚K:「うん、急いでないから」と配慮してくれる。" },
      { text: "3", point: 1, react: "ホスト:「おお、心強い！」と二次会の店探しに意欲を見せる。" },
    ],
    next: "phase4"
  },
  "phase4": {
    msg: "店員:「ラストオーダーです」\nあなた：（ここで最後の一手を…）\n選択肢:\n1. お会計をお願いします！\n2. 最後にもう一杯だけ…\n3. そろそろ失礼しますね…",
    choices: [
      { text: "1", point: 3, react: "店員:「かしこまりました」とレジへ案内してくれる。" },
      { text: "2", point: 1, react: "同僚L:「お、もう一杯？」と期待の視線。" },
      { text: "3", point: 2, react: "店長:「おっと、そうか。じゃあ今日はここまでだね」と時計を見る。" },
    ],
    next: "end"
  }
};

interface UserData {
  userId: string;
  gameState: string; // 全体状態
  talkState: PhaseType;    // シナリオ進行
  totalPoints: number;
  history: HistoryItem[];
}

interface HistoryItem {
  phase: PhaseType;
  choice: string;
  point: number;
}

async function handleEvent(event: WebhookEvent, lineClient: Client): Promise<any> {
  const userId = event.source.userId;
  if (!userId) return;

  // 新規フォロー時
  if (event.type === "follow") {
    const followEvent = event as FollowEvent;
    await db.collection("users").doc(userId).set({
      userId,
      gameState: "entry",
      talkState: "phase1",
      totalPoints: 0,
      history: []
    }, { merge: true });
    const nextScenario = "phase1";
    const nextScenarioPhase = SCENARIO[nextScenario];
    if (!nextScenarioPhase) {
      return lineClient.replyMessage(followEvent.replyToken, {
        type: "text",
        text: "シナリオが見つかりません。"
      });
    }
    return lineClient.replyMessage(followEvent.replyToken, [
      {
        type: "text",
        text: "酒飲み部のグループに参加ありがとう！\n\n"
      },
      makeButtonsTemplate(nextScenarioPhase)
    ]);
  }
  if (event.type !== "message" || event.message.type !== "text") return;
  const messageEvent = event as MessageEvent;
  const doc = await db.collection("users").doc(userId).get();
  if (!doc.exists) {
    return lineClient.replyMessage(messageEvent.replyToken, { type: "text", text: "まずは友だち追加してください！" });
  }
  const userData = doc.data() as UserData;
  if (userData.gameState === "flutter" || userData.talkState === "end") {
    return lineClient.replyMessage(messageEvent.replyToken, {
      type: "text",
      text: "もうゲームは終了しています！\nもう一度遊びたい場合は「リセット」と送ってください。"
    });
  }
  const phase = userData.talkState || "phase1";
  const scenario = SCENARIO[phase];
  if (!scenario) return lineClient.replyMessage(messageEvent.replyToken, { type: "text", text: "ゲームは終了しました。" });
  const textMessage = messageEvent.message as TextEventMessage;
  const choiceIndex = ["1", "2", "3"].indexOf(textMessage.text.trim());
  if (choiceIndex === -1) {
    // // 選択肢以外 → QuickReply付き再表示
    // return lineClient.replyMessage(messageEvent.replyToken, {
    //   type: "text",
    //   text: "数字で選択してください！\n" + scenario.msg,
    //   quickReply: makeQuickReply(scenario.choices)
    // });
    // ボタンテンプレートで再表示
    return lineClient.replyMessage(messageEvent.replyToken, makeButtonsTemplate(scenario));
  }
  const choice = scenario.choices[choiceIndex];
  const newTotal = (userData.totalPoints || 0) + choice.point;
  const newHistory: HistoryItem[] = [
    ...(userData.history || []),
    { phase, choice: choice.text, point: choice.point }
  ];
  if (newTotal >= 8) {
    await db.collection("users").doc(userId).set({
      talkState: "end",
      gameState: "flutter",
      totalPoints: newTotal,
      history: newHistory
    }, { merge: true });
    return lineClient.replyMessage(messageEvent.replyToken, {
      type: "text",
      text: `${choice.react}\n獲得: ${choice.point}ポイント（累計: ${newTotal}ポイント）\n\n店長:「では今日はこの辺でお開きにしましょう！」`
    });
  }
  const nextPhase = scenario.next;
  await db.collection("users").doc(userId).set({
    talkState: nextPhase,
    gameState: "line",
    totalPoints: newTotal,
    history: newHistory
  }, { merge: true });
  // const nextMsg = SCENARIO[nextPhase]?.msg || "次のフェーズに進みます";
  // return lineClient.replyMessage(messageEvent.replyToken, {
  //   type: "text",
  //   text: `${choice.react}\n獲得: ${choice.point}ポイント（累計: ${newTotal}ポイント）\n\n${nextMsg}`,
  //   quickReply: makeQuickReply(SCENARIO[nextPhase]?.choices || [])
  // });
    const nextScenario = SCENARIO[nextPhase];
    if (!nextScenario) {
      return lineClient.replyMessage(messageEvent.replyToken, {
        type: "text",
        text: `${choice.react}\n獲得: ${choice.point}ポイント（累計: ${newTotal}ポイント）\n\n次のフェーズが見つかりません。`
      });
    }
    
    return lineClient.replyMessage(messageEvent.replyToken, [
    {
      type: "text",
      text: `${choice.react}\n獲得: ${choice.point}ポイント（累計: ${newTotal}ポイント）`
    },
    makeButtonsTemplate(nextScenario)
    ]);
}

// QuickReply生成
// function makeQuickReply(choices: { text: string }[]) {
//   return {
//     items: choices.map((choice, idx) => ({
//       type: "action" as const,
//       action: {
//         type: "message" as const,
//         label: `${idx + 1}`,
//         text: `${idx + 1}`
//       }
//     }))
//   };
// }

// ボタンテンプレート生成
function makeButtonsTemplate(scenario: ScenarioPhase) {
  return {
    type: "template" as const,
    altText: "選択肢を選んでください",
    template: {
      type: "buttons" as const,
      text: scenario.msg,
      actions: scenario.choices.map((choice, idx) => ({
        type: "message" as const,
        label: scenario.choices.length === 2 ? ["はい","いいえ"][idx] : `${idx+1}: ${choice.text}`,
        text: `${idx+1}`
      }))
    }
  }
}
