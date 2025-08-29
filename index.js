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
・温かく励ましの言葉をかける
・具体的で実用的なアドバイスを提供する
・200文字以内で親しみやすい口調で話す
・絵文字を適度に使って親近感を演出する
・相手の名前は聞かず、自然な会話を心がける

例：「そんな気持ちになるのは自然なことですよ😊 一人で抱え込まず、少しずつでも大丈夫です✨」
`;

// ==============================
// システム制限設定
// ==============================
const LIMITS = {
  MAX_USERS: 100,                    // 最大ユーザー数
  DAILY_TURN_LIMIT: 10,              // 1日の会話ターン制限
  SESSION_TIMEOUT: 30 * 60 * 1000,   // セッション有効期限（30分）
  CLEANUP_INTERVAL: 5 * 60 * 1000,   // クリーンアップ間隔（5分）
  HEAVY_KEYWORDS: ['死にたい', '辛すぎる', '助けて', '深刻', '重要', '本当に困って', '限界', 'もうだめ'],
};

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
// データ管理（メモリ内）
// ==============================
const conversationHistory = new Map();        // userId -> 会話履歴配列
const registeredUsers = new Set();           // 登録済みユーザーID
const dailyUsageCounter = new Map();         // userId -> {date: string, count: number}
const sessionData = new Map();               // userId -> {lastActivity: timestamp}

// ==============================
// ユーザー管理機能
// ==============================
function isUserRegistered(userId) {
  return registeredUsers.has(userId);
}

function canRegisterNewUser() {
  return registeredUsers.size < LIMITS.MAX_USERS;
}

function registerUser(userId) {
  if (canRegisterNewUser() || isUserRegistered(userId)) {
    registeredUsers.add(userId);
    updateSessionActivity(userId);
    return true;
  }
  return false;
}

// ==============================
// セッション管理（セキュリティ対応）
// ==============================
function updateSessionActivity(userId) {
  sessionData.set(userId, {
    lastActivity: Date.now()
  });
}

function isSessionActive(userId) {
  const session = sessionData.get(userId);
  if (!session) return false;
  
  const now = Date.now();
  return (now - session.lastActivity) < LIMITS.SESSION_TIMEOUT;
}

// 期限切れセッション削除（セキュリティ機能）
function cleanupExpiredSessions() {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (const [userId, session] of sessionData.entries()) {
    if ((now - session.lastActivity) > LIMITS.SESSION_TIMEOUT) {
      // 会話履歴を完全削除
      conversationHistory.delete(userId);
      sessionData.delete(userId);
      cleanedCount++;
      console.log(`🔒 Session expired and data cleaned for user: ${userId.slice(0, 8)}***`);
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`🧹 Cleaned ${cleanedCount} expired sessions for security`);
  }
}

// 定期的なセキュリティクリーンアップ
setInterval(cleanupExpiredSessions, LIMITS.CLEANUP_INTERVAL);

// ==============================
// 日次利用制限機能
// ==============================
function getTodayString() {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

function getDailyUsage(userId) {
  const today = getTodayString();
  const userUsage = dailyUsageCounter.get(userId);
  
  if (!userUsage || userUsage.date !== today) {
    const newUsage = { date: today, count: 0 };
    dailyUsageCounter.set(userId, newUsage);
    return newUsage;
  }
  
  return userUsage;
}

function canUseTodayMore(userId) {
  const usage = getDailyUsage(userId);
  return usage.count < LIMITS.DAILY_TURN_LIMIT;
}

function incrementDailyUsage(userId) {
  const usage = getDailyUsage(userId);
  usage.count += 1;
}

function getRemainingTurns(userId) {
  const usage = getDailyUsage(userId);
  return Math.max(0, LIMITS.DAILY_TURN_LIMIT - usage.count);
}

// ==============================
// GPTモデル選択（コスト最適化）
// ==============================
function selectGPTModel(userMessage) {
  const messageText = userMessage.toLowerCase();
  const isHeavyConsultation = LIMITS.HEAVY_KEYWORDS.some(keyword => 
    messageText.includes(keyword)
  );
  
  return isHeavyConsultation ? 'gpt-4o' : 'gpt-4o-mini';
}

// ==============================
// 会話履歴管理
// ==============================
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

function addToHistory(userId, role, content) {
  const history = getHistory(userId);
  history.push({ role, content });
  
  // システムメッセージ + 直近20回の会話のみ保持
  if (history.length > 21) {
    const systemMessage = history[0];
    const recentMessages = history.slice(-20);
    conversationHistory.set(userId, [systemMessage, ...recentMessages]);
  }
}

// ==============================
// OpenAI API呼び出し
// ==============================
async function getAIResponse(userId, userMessage) {
  try {
    // ユーザーメッセージを履歴に追加
    addToHistory(userId, 'user', userMessage);
    
    // GPTモデル選択
    const selectedModel = selectGPTModel(userMessage);
    
    console.log(`🤖 Using ${selectedModel} for user ${userId.slice(0, 8)}***`);
    
    // OpenAI APIに送信
    const completion = await openai.chat.completions.create({
      model: selectedModel,
      messages: getHistory(userId),
      max_tokens: selectedModel === 'gpt-4o' ? 400 : 300,
      temperature: 0.7,
    });

    const aiResponse = completion.choices[0].message.content;
    
    // AI応答を履歴に追加
    addToHistory(userId, 'assistant', aiResponse);
    
    return {
      response: aiResponse,
      model: selectedModel
    };
  } catch (error) {
    console.error('OpenAI API Error:', error);
    return {
      response: 'すみません、少し調子が悪いみたいです😅 もう一度話しかけてくださいね！',
      model: 'error'
    };
  }
}

// ==============================
// システムメッセージ生成
// ==============================
function getNewUserRejectionMessage() {
  return `
ありがとうございます！😊

現在多くの方にご利用いただいており、
新規の受付を一時停止させていただいています🙇‍♀️

サービス拡張の準備が整い次第、
改めてご案内いたします✨

しばらくお待ちください！
`;
}

function getDailyLimitMessage(remainingTurns) {
  if (remainingTurns <= 0) {
    return `
今日のお話はここまでです😊

たくさんお話しできて嬉しかったです✨
また明日、ゆっくりお話ししましょう🌸

おつかれさまでした！
`;
  } else {
    return `今日はあと${remainingTurns}回お話しできます😊`;
  }
}

function getSessionExpiredMessage() {
  return `
お疲れ様です😊

セキュリティの観点から、しばらく時間が空いた
会話内容は自動的に削除されました🔒

また新しい気持ちでお話ししましょう✨
何でもお聞かせくださいね！
`;
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
      const userMessage = event.message.text.trim();
      
      console.log(`📱 User ${userId.slice(0, 8)}***: ${userMessage}`);

      // ユーザー登録チェック
      if (!registerUser(userId)) {
        const rejectionMessage = getNewUserRejectionMessage();
        await lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: rejectionMessage,
        });
        console.log(`❌ User registration rejected: ${userId.slice(0, 8)}***`);
        return;
      }

      // セッション確認（セキュリティチェック）
      if (!isSessionActive(userId) && conversationHistory.has(userId)) {
        // セッション期限切れの場合、履歴削除して通知
        conversationHistory.delete(userId);
        await lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: getSessionExpiredMessage(),
        });
        console.log(`🔒 Session expired message sent to: ${userId.slice(0, 8)}***`);
        return;
      }

      // セッション活動更新
      updateSessionActivity(userId);

      // 日次利用制限チェック
      if (!canUseTodayMore(userId)) {
        const limitMessage = getDailyLimitMessage(0);
        await lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: limitMessage,
        });
        console.log(`⏰ Daily limit reached for user: ${userId.slice(0, 8)}***`);
        return;
      }

      // 利用回数をカウント
      incrementDailyUsage(userId);
      const remainingTurns = getRemainingTurns(userId);

      // AI応答を取得
      const { response: aiResponse, model } = await getAIResponse(userId, userMessage);
      
      console.log(`🤖 AI (${model}): ${aiResponse.slice(0, 50)}...`);

      // 制限情報を追加（残り少ない場合のみ）
      let responseText = aiResponse;
      if (remainingTurns <= 3 && remainingTurns > 0) {
        responseText += `\n\n💫 ${getDailyLimitMessage(remainingTurns)}`;
      }

      // LINE経由で返信
      await lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: responseText,
      });

      console.log(`✅ Response sent. Remaining turns: ${remainingTurns}`);
    }));

    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook Error:', error);
    res.status(500).send('Error');
  }
});

// ==============================
// ヘルスチェック・管理用エンドポイント
// ==============================
app.get('/', (req, res) => {
  res.send('AI相談bot (Phase 1) is running! 🤖✨');
});

app.get('/health', (req, res) => {
  const today = getTodayString();
  const todayActiveUsers = Array.from(dailyUsageCounter.entries())
    .filter(([_, usage]) => usage.date === today).length;
  
  const activeSessions = sessionData.size;

  res.json({
    status: 'ok',
    version: 'Phase 1 - Foundation',
    timestamp: new Date().toISOString(),
    stats: {
      totalRegisteredUsers: registeredUsers.size,
      maxUsers: LIMITS.MAX_USERS,
      todayActiveUsers: todayActiveUsers,
      activeSessions: activeSessions,
      dailyTurnLimit: LIMITS.DAILY_TURN_LIMIT,
      activeConversations: conversationHistory.size,
      sessionTimeout: `${LIMITS.SESSION_TIMEOUT / 60000} minutes`,
    },
  });
});

// 管理者用統計エンドポイント
app.get('/admin/stats', (req, res) => {
  const today = getTodayString();
  const usageStats = Array.from(dailyUsageCounter.entries())
    .filter(([_, usage]) => usage.date === today)
    .map(([userId, usage]) => ({
      userId: userId.slice(0, 8) + '***', // プライバシー保護
      count: usage.count,
      remaining: LIMITS.DAILY_TURN_LIMIT - usage.count
    }));

  res.json({
    date: today,
    systemLimits: LIMITS,
    stats: {
      totalUsers: registeredUsers.size,
      todayActiveUsers: usageStats.length,
      activeSessions: sessionData.size,
      activeConversations: conversationHistory.size,
    },
    usageBreakdown: usageStats.sort((a, b) => b.count - a.count), // 使用量順
  });
});

// セキュリティ手動クリーンアップ（管理者用）
app.post('/admin/cleanup', express.json(), (req, res) => {
  const beforeCount = conversationHistory.size;
  cleanupExpiredSessions();
  const afterCount = conversationHistory.size;
  
  res.json({
    message: 'Cleanup completed',
    cleaned: beforeCount - afterCount,
    remaining: afterCount
  });
});

// ==============================
// サーバー起動
// ==============================
app.listen(config.port, () => {
  console.log(`🚀 AI相談bot (Phase 1) started on port ${config.port}`);
  console.log(`📱 Webhook URL: https://your-app.onrender.com/webhook`);
  console.log(`👥 Max users: ${LIMITS.MAX_USERS}, Daily limit: ${LIMITS.DAILY_TURN_LIMIT} turns/user`);
  console.log(`🔒 Session timeout: ${LIMITS.SESSION_TIMEOUT / 60000} minutes`);
  console.log(`🧹 Cleanup interval: ${LIMITS.CLEANUP_INTERVAL / 60000} minutes`);
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
