const express = require('express');
const { Client } = require('@line/bot-sdk');
const OpenAI = require('openai');

const app = express();

// ==============================
// 設定（ここを変更するだけでキャラ変更可能）
// ==============================
const CHARACTER_PERSONALITY = `
あなたは優しく共感的なカウンセラーです。
以下の特徴を持って応答してください：

・相手の気持ちに寄り添い、否定せずに聞く
・優しく温かく励ましの言葉をかけ、安心できるようにする
・求められない限り具体的で実用的なアドバイスはしない
・求められた場合、具体的で実用的なアドバイスをする
・200文字以内で親しみやすい口調で話す
・絵文字は1メッセージに2つほど使い親近感を演出する
・相手の名前は聞かず、自然な会話を心がける

例：「そんな気持ちになるのは自然なことです。 一人で抱え込まず、少しずつでも大丈夫です✨」
`;

// ==============================
// 環境変数（Renderで設定）
// ==============================
const config = {
  line: {
    channelSecret: process.env.LINE_CHANNEL_SECRET,
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
  },
  port: process.env.PORT || 3000,
};

// ==============================
// API初期化
// ==============================
const lineClient = new Client(config.line);
const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

// ==============================
// 会話履歴管理（メモリ内）
// ==============================
const conversationHistory = new Map();

// 履歴を取得（存在しなければ新規作成）
function getHistory(userId) {
  if (!conversationHistory.has(userId)) {
    conversationHistory.set(userId, [
      {
        role: 'system',
        content: CHARACTER_PERSONALITY
      }
    ]);
  }
  return conversationHistory.get(userId);
}

// 履歴に追加（上限管理付き）
function addToHistory(userId, role, content) {
  const history = getHistory(userId);
  history.push({ role, content });
  
  // システムメッセージ + 直近20回の会話のみ保持
  if (history.length > 21) {
    const systemMessage = history[0]; // システムメッセージは保持
    const recentMessages = history.slice(-20); // 直近20回
    conversationHistory.set(userId, [systemMessage, ...recentMessages]);
  }
}

// 【将来の機能】履歴削除（TTL実装時に使用）
function clearOldHistory() {
  // TODO: 将来的に一定時間経過した履歴を削除
  // 現在は手動実装が必要な場合のみ使用
  console.log('履歴削除機能は未実装');
}

// ==============================
// OpenAI API呼び出し
// ==============================
async function getAIResponse(userId, userMessage) {
  try {
    // ユーザーメッセージを履歴に追加
    addToHistory(userId, 'user', userMessage);
    
    // OpenAI APIに送信
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // コスト効率重視
      messages: getHistory(userId),
      max_tokens: 300,
      temperature: 0.7,
    });

    const aiResponse = completion.choices[0].message.content;
    
    // AI応答を履歴に追加
    addToHistory(userId, 'assistant', aiResponse);
    
    return aiResponse;
  } catch (error) {
    console.error('OpenAI API Error:', error);
    return 'すみません、少し調子が悪いみたいです😅 もう一度話しかけてくださいね！';
  }
}

// ==============================
// LINE Webhook処理
// ==============================
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const events = JSON.parse(req.body.toString()).events;
    
    await Promise.all(events.map(async (event) => {
      // テキストメッセージのみ処理
      if (event.type !== 'message' || event.message.type !== 'text') {
        return;
      }

      const userId = event.source.userId;
      const userMessage = event.message.text;
      
      console.log(`User ${userId}: ${userMessage}`);

      // AI応答を取得
      const aiResponse = await getAIResponse(userId, userMessage);
      
      console.log(`AI: ${aiResponse}`);

      // LINE経由で返信
      await lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: aiResponse,
      });
    }));

    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook Error:', error);
    res.status(500).send('Error');
  }
});

// ==============================
// ヘルスチェック用エンドポイント
// ==============================
app.get('/', (req, res) => {
  res.send('AI相談bot is running! 🤖✨');
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    activeUsers: conversationHistory.size,
  });
});

// ==============================
// サーバー起動
// ==============================
app.listen(config.port, () => {
  console.log(`🤖 AI相談bot started on port ${config.port}`);
  console.log(`📱 Webhook URL: https://your-app.onrender.com/webhook`);
});

// ==============================
// エラーハンドリング
// ==============================
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
