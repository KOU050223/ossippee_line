# おっしっぴーのLineAPI用のリポジトリ

```bash
npm run start
or
npm run dev
```
↓
```bash
ngrok http 3000
```


# functionのチェック方法
```
npm run build
firebase emulators:start --only functions
```

別ターミナルで
```
ngrok http 5001
```

以下を開いてその下を設定する
https://developers.line.biz/console/channel/2007430916/messaging-api

```
https:ngrok-free.app>/ossippee-50d9a/asia-northeast1/lineBot/webhook
```

# デプロイ

```
cd functions
npm run deploy
```

初回
```
gcloud services enable secretmanager.googleapis.com
firebase functions:secrets:set LINE_CHANNEL_SECRET
firebase functions:secrets:set LINE_CHANNEL_ACCESS_TOKEN
```