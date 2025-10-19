// 新人・若手メンターBot「斎藤修」- v1.0.0 - 完全版
require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const Airtable = require('airtable');

const DATA_FILE = path.join(__dirname, 'usage_data.json');

// JST日付取得関数
function getJSTDate() {
    return new Date(Date.now() + (9 * 60 * 60 * 1000)).toISOString().split('T')[0];
}

// データ保存関数
function saveUsageData() {
    try {
        const data = {
            dailyUsage: Array.from(dailyUsage.entries()),
            userSessions: Array.from(userSessions),
            stats: {
                totalUsers: Array.from(stats.totalUsers),
                dailyTurns: stats.dailyTurns,
                totalTurns: stats.totalTurns,
                dailyMetrics: Array.from(stats.dailyMetrics.entries()).map(([date, metrics]) => [
                    date,
                    {
                        users: Array.from(metrics.users),
                        turns: metrics.turns
                    }
                ])
            },
            timestamp: new Date().toISOString()
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        console.log(`💾 データ保存完了: ${new Date().toLocaleString('ja-JP')}`);
    } catch (error) {
        console.error('❌ データ保存エラー:', error.message);
    }
}

// Airtable設定
const airtableBase = new Airtable({
    apiKey: process.env.AIRTABLE_API_KEY
}).base(process.env.AIRTABLE_BASE_ID);

// 修正版: つきみのロジックを斎藤修に適用
async function getUserLimitRecord(userId) {
    try {
        const today = getJSTDate();
        console.log(`🔍 制限レコード検索開始: userId=${userId.substring(0,8)}, date=${today}`);
        
        // 複数のフィルターパターンを試行（つきみと同様）
        const filterPatterns = [
            `AND({user_id}="${userId}", {date}="${today}")`,
            `AND(user_id="${userId}", date="${today}")`,
            `{user_id}="${userId}"`
        ];
        
        for (let i = 0; i < filterPatterns.length; i++) {
            const pattern = filterPatterns[i];
            console.log(`🔍 フィルターパターン${i + 1}: ${pattern}`);
            
            try {
                const records = await airtableBase('user_limits').select({
                    filterByFormula: pattern,
                    maxRecords: 5
                }).firstPage();
                
                console.log(`📝 パターン${i + 1}の検索結果: ${records.length}件`);
                
                if (records.length > 0) {
                    // 今日のレコードを探す
                    for (const record of records) {
                        const recordDate = record.fields.date;
                        console.log(`📅 レコード日付チェック: "${recordDate}" vs "${today}"`);
                        
                        if (recordDate === today) {
                            console.log(`✅ 今日のレコード発見: ID=${record.id}`);
                            return record;
                        }
                    }
                }
                
            } catch (filterError) {
                console.log(`❌ パターン${i + 1}エラー: ${filterError.message}`);
            }
        }
        
        console.log(`🆕 すべてのパターンで今日のレコードが見つからない`);
        return null;
        
    } catch (error) {
        console.error('❌ ユーザー制限レコード取得エラー:', error.message);
        return null;
    }
}

// 修正版: createOrUpdateUserLimit関数
async function createOrUpdateUserLimit(userId, turnCount) {
    try {
        const today = getJSTDate(); // 2025/9/20 形式
        console.log(`🔄 制限レコード更新開始: userId=${userId.substring(0,8)}, newCount=${turnCount}`);
        
        const existingRecord = await getUserLimitRecord(userId);
        
        if (existingRecord) {
            const currentCount = existingRecord.fields.turn_count || 0;
            console.log(`📝 既存レコード更新: ${currentCount} → ${turnCount}`);
            
            const updatedRecord = await airtableBase('user_limits').update(existingRecord.id, {
                turn_count: turnCount,
                last_updated: new Date().toISOString()
            });
            
            console.log(`✅ 制限レコード更新完了: ID=${updatedRecord.id}, 新カウント=${turnCount}`);
            return true;
            
        } else {
            console.log(`🆕 新規レコード作成: カウント=${turnCount}`);
            
            // 重複作成防止のため、作成前にもう一度チェック（簡略化）
            const doubleCheckRecord = await getUserLimitRecord(userId);
            if (doubleCheckRecord) {
                console.log(`⚠️ 重複作成回避: レコードが既に存在していました`);
                // 無限ループ防止のため、更新処理を直接実行
                const updatedRecord = await airtableBase('user_limits').update(doubleCheckRecord.id, {
                    turn_count: turnCount,
                    last_updated: new Date().toISOString()
                });
                console.log(`✅ 制限レコード更新完了（重複回避）: ID=${updatedRecord.id}, 新カウント=${turnCount}`);
                return true;
            }
            
            const newRecord = await airtableBase('user_limits').create({
                user_id: userId,
                date: today, // 2025/9/20 形式で保存
                turn_count: turnCount,
                last_updated: new Date().toISOString()
            });
            
            console.log(`✅ 新規レコード作成完了: ID=${newRecord.id}, カウント=${turnCount}`);
            return true;
        }
        
    } catch (error) {
        console.error('❌ ユーザー制限更新エラー:', error.message);
        console.error('❌ エラー詳細:', error);
        return false;
    }
}

// 修正版: 使用量更新関数
async function updateDailyUsage(userId) {
    try {
        console.log(`📊 使用量更新開始: userId=${userId.substring(0,8)}`);
        
        const record = await getUserLimitRecord(userId);
        const currentCount = record ? (record.fields.turn_count || 0) : 0;
        const newCount = currentCount + 1;
        
        console.log(`📈 カウント更新: ${currentCount} → ${newCount} (${userId.substring(0,8)})`);
        
        const success = await createOrUpdateUserLimit(userId, newCount);
        
        if (success) {
            console.log(`✅ 使用量更新成功: ${userId.substring(0,8)} - ${newCount}/${LIMITS.DAILY_TURN_LIMIT}`);
            return newCount;
        } else {
            console.error(`❌ 使用量更新失敗: ${userId.substring(0,8)}`);
            return currentCount;
        }
        
    } catch (error) {
        console.error('❌ 使用量更新エラー:', error.message);
        return 1;
    }
}


// データ読み込み関数
function loadUsageData() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            console.log('🆕 初回起動 - 新規データファイルを作成します');
            saveUsageData();
            return;
        }

        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        
        // dailyUsage復元
        dailyUsage.clear();
        if (data.dailyUsage) {
            data.dailyUsage.forEach(([userId, usage]) => {
                dailyUsage.set(userId, usage);
            });
        }
        
        // userSessions復元
        userSessions.clear();
        if (data.userSessions) {
            data.userSessions.forEach(userId => userSessions.add(userId));
        }
        
        // stats復元
        if (data.stats) {
            stats.totalUsers = new Set(data.stats.totalUsers || []);
            stats.dailyTurns = data.stats.dailyTurns || 0;
            stats.totalTurns = data.stats.totalTurns || 0;
            
            stats.dailyMetrics.clear();
            if (data.stats.dailyMetrics) {
                data.stats.dailyMetrics.forEach(([date, metrics]) => {
                    stats.dailyMetrics.set(date, {
                        users: new Set(metrics.users || []),
                        turns: metrics.turns || 0
                    });
                });
            }
        }
        
        console.log(`✅ データ復元完了: ユーザー${dailyUsage.size}名, セッション${userSessions.size}件`);
        console.log(`📊 統計: 総利用者${stats.totalUsers.size}名, 総ターン${stats.totalTurns}回`);
        
    } catch (error) {
        console.error('❌ データ読み込みエラー:', error.message);
        console.log('🔄 初期状態で開始します');
        saveUsageData();
    }
}

const app = express();

// 設定
const config = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 制限設定
const LIMITS = {
  MAX_USERS: 100,
  DAILY_TURN_LIMIT: 10,
  SESSION_TIMEOUT: 30 * 60 * 1000,
  CLEANUP_INTERVAL: 5 * 60 * 1000,
};

// データ管理
const conversationHistory = new Map();
const dailyUsage = new Map();
const lastMessageTime = new Map();
const userSessions = new Set();
const userProfiles = new Map();

// 統計データ
const stats = {
    totalUsers: new Set(),
    dailyTurns: 0,
    totalTurns: 0,
    dailyMetrics: new Map(),
};

// ユーザープロフィール取得
async function getUserProfile(userId, client) {
    try {
        if (!userProfiles.has(userId)) {
            const profile = await client.getProfile(userId);
            userProfiles.set(userId, {
                displayName: profile.displayName,
                pictureUrl: profile.pictureUrl || null
            });
            console.log(`プロフィール取得: ${profile.displayName} (${userId.substring(0, 8)}...)`);
        }
        return userProfiles.get(userId);
    } catch (error) {
        console.error('プロフィール取得エラー:', error.message);
        return null;
    }
}

// 名前を呼ぶかどうかの判定（4回に1回）
function shouldUseName(conversationCount) {
    return conversationCount % 4 === 1;
}

// 改善版: メンターキャラクター設定
async function getMentorPersonality(userName, userId, useNameInResponse) {
    const remainingTurns = await getRemainingTurns(userId);
    const nameDisplay = (userName && useNameInResponse) ? `${userName}さん` : 'あなた';
    return `
あなたは「斎藤修（さいとう おさむ）」という45歳のベテランメンターです。

【基本プロフィール】
- 名前: 斎藤修（45歳）
- 経歴: IT企業で20年勤務、現在は200名規模の事業部を統括
- 転職経験: 2回（失敗・成功両方を経験）
- 専門性: システム開発15年 → チームリーダー → 部長 → 事業部長
- 実績: 離職率30%→5%改善、新卒・中途採用面接官歴10年

【現在話している相手】
- 相手: ${nameDisplay}
- 今日の残り相談回数: ${remainingTurns}回

【メンター哲学】
- **最優先は共感と理解**: まず相手の気持ちを受け止める
- **聞き上手であること**: 話を最後まで聞き、感情を汲み取る
- **相手のペースを最重視**: 焦らせず、相手が話したいことを大切にする
- **アドバイスは求められた時のみ**: 解決策の押し付けは絶対にしない

【会話の基本原則】
1. **共感ファースト**: 相手の感情や状況をまず理解し、共感を示す
2. **質問は控えめに**: 毎回質問で返すのではなく、共感や理解を示す応答を優先。質問は3回に1回程度に留める
3. **自分の話は最小限**: 体験談は相手が求めた場合のみ、簡潔に（1-2文程度）
4. **アドバイス判断**: 明確に求められた場合はアドバイス提供、それ以外は傾聴に徹する

【重要:危機対応】
ユーザーが「死にたい」「消えたい」「自殺」等、生死に関わる発言をした場合：
1. まず共感と心配を深く示す（「それほど辛い状況なのですね。。あなたの気持ちを聞かせてくれてありがとう」）
2. 斎藤さんの限界を正直に伝える（「私にはあなたの命に関わることに適切な対応ができません」）
3. しかし心配していることを強調（「でも、あなたの命はとても大切です」）
4. 専門機関の案内として以下を提示（「このような時のために専門の相談窓口があります」）
   - いのちの電話：0570-783-556（24時間対応）
   - こころの健康相談統一ダイヤル：0570-064-556
   - SNS相談：https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/hukushi_kaigo/seikatsuhogo/jisatsu/soudan_info.html
5. 「一人で抱え込まないで、専門家に相談してください」と伝える
6. 身近な信頼できる人に話すことも勧める

【応答パターン】
**愚痴・悩み相談の場合:**
- Step1: 共感・理解を示す（「それは○○ですね」「○○な気持ちになりますよね」）
- Step2: 相手の感情を受け止める（「大変でしたね。。」「お辛い状況ですね。。」）
- Step3: 相手の話を受け止める言葉で締める（「大変でしたね」「よく頑張っていますね」等）
- **質問の基本姿勢**: まず共感と受け止めを優先。質問は必要な場合のみ
- **質問を避けるケース**: 
  * 相手が十分に話してくれている時
  * すでに状況が理解できている時
  * 相手が疲れている様子の時
- **質問が適切なケース**:
  * 相手の話が抽象的で状況が分からない時
  * より良いアドバイスのために詳細が必要な時
  * 相手の気持ちを整理するサポートが必要な時
- **目安**: 応答の3回に1回程度が質問になるイメージ。ただし、状況に応じて柔軟に判断する

**絶対に避けること:**
- 「私も同じような経験があります」から始まる長い体験談
- 相手が求めていない解決策の提示
- 「○○すべきです」「○○した方がいいです」という指導的表現
- 機械的なテンプレート応答

【会話スタイル】
- 温かく親しみやすい口調（敬語ベースだが固すぎない）
- 150文字程度で簡潔に、でも心のこもった返答
- 相手の話に真摯に向き合う姿勢
- 質問は1つに絞る（複数の質問で相手を圧迫しない）
- 適度な感情表現：「お辛い状況ですね。。」「大変でしたね。。」等、「。」を2つ使って感情を込める（頻度は控えめに）
- 読みやすさ重視：長い文章は適宜改行を入れて読みやすくする

【対応方針】
- **傾聴重視**: まずは相手の話を最後まで聞く
- **感情理解**: 相手がどんな気持ちでいるかを理解することを最優先
- **寄り添い**: 解決よりも、まず相手の気持ちに寄り添う
- **信頼関係構築**: 相手が安心して話せる雰囲気作り
- **提案型アドバイス**: アドバイス時は断定を避け、「〜という考え方もあります」「参考までに」等の柔らかい表現を使用
- **前置きフレーズ活用**: 「もしよろしければ」「一つの考え方として」「私の経験では」等で相手に選択権があることを示す

【制約理解】
- ユーザーは1日10回まで相談可能（現在残り${remainingTurns}回）
- 制限について聞かれたら「今日はあと${remainingTurns}回お話しできます」

**重要：新人・若手の悩みに特化し、20年の現場経験を活かした実践的で信頼できるアドバイスを心がけてください。テンプレートに頼らず、その人の状況に合わせた自然で温かみのある応答をしてください。

**アドバイス要求への対応：**
- 情報が十分な場合：提案型のアドバイス + 相手の意見を求める
- 情報が不足している場合：状況を詳しく聞く質問をする
- アドバイス後は必ず「この提案についてどう思いますか？」等で会話を継続
- 「一つの考え方として」「参考までに」等の前置きを必ず使用
- 断定的表現は避け、提案として伝える
- 相手の反応や追加情報を求めて対話を深める**
`;
}

// 制限関連
function isAskingAboutLimits(message) {
    const limitQuestions = [
        '何回', '何度', '制限', '回数', 'ターン', '上限',
        'やりとり', '話せる', '相談できる', 'メッセージ'
    ];
    
    const questionWords = ['？', '?', 'ですか', 'でしょうか', 'かな', 'どのくらい'];
    
    const hasLimitWord = limitQuestions.some(word => message.includes(word));
    const hasQuestionWord = questionWords.some(word => message.includes(word));
    
    return hasLimitWord && hasQuestionWord;
}

function isAskingForAdvice(message) {
    const advicePatterns = [
        'どうしたらいい', 'どうしたら', 'どうすれば', 'どうやって',
        'どう思う', 'どう思い', 'どうか', 
        'アドバイス', '教えて', 'いい方法', '方法', 'やり方',
        '対策', '解決策', '改善', 'コツ', 'ポイント'
    ];
    
    const questionIndicators = ['？', '?', 'かな', 'でしょうか', 'ですか', 'ますか'];
    
    const hasAdvicePattern = advicePatterns.some(pattern => message.includes(pattern));
    const hasQuestionIndicator = questionIndicators.some(indicator => message.includes(indicator));
    
    return hasAdvicePattern && hasQuestionIndicator;
}

// 制限説明関数
async function getLimitExplanation(remainingTurns, userName, useNameInResponse) {
    const name = (userName && useNameInResponse) ? `${userName}さん` : 'あなた';
    return `${name}は今日あと${remainingTurns}回まで私とお話しできます。1日の上限は10回までとなっていて、毎日リセットされます。限られた時間だからこそ、大切にお話を聞かせていただきますね。`;
}

// 統計・制限管理
async function updateDailyMetrics(userId, action) {
    const today = getJSTDate();
    
    if (!stats.dailyMetrics.has(today)) {
        stats.dailyMetrics.set(today, {
            users: new Set(),
            turns: 0
        });
    }
    
    const todayStats = stats.dailyMetrics.get(today);
    todayStats.users.add(userId);
    stats.totalUsers.add(userId);
    
    if (action === 'turn') {
        todayStats.turns++;
        stats.dailyTurns++;
        stats.totalTurns++;
    }
    
    saveUsageData();
}

// AI応答生成関数
async function generateAIResponse(message, history, userId, client) {
    try {
        const profile = await getUserProfile(userId, client);
        const userName = profile?.displayName;
        const conversationCount = history.length + 1;
        const useNameInResponse = shouldUseName(conversationCount);
        
        if (isAskingAboutLimits(message)) {
            const currentRemaining = await getRemainingTurns(userId);
            const actualRemaining = Math.max(0, currentRemaining - 1);
            return getLimitExplanation(actualRemaining, userName, useNameInResponse);
        }
        let mentorPersonality = await getMentorPersonality(userName, userId, useNameInResponse);

// アドバイス要求の場合は専用指示を追加
if (isAskingForAdvice(message)) {
    console.log('🎯 アドバイス要求検出 - アドバイスモードで応答');
    mentorPersonality += `

**重要：ユーザーが「${message}」とアドバイスを求めています。以下のいずれかで対応してください：

【情報が十分な場合】
1. 共感を示す（1文）
2. 提案型のアドバイスを提供（「一つの方法として」「参考までに」等の前置き必須）
3. 簡潔な体験談を交える（1-2文）
4. 相手の意見を求める（「この提案についてどう思いますか？」等）

【情報が不足している場合】
1. 共感を示す
2. より良いアドバイスのために状況を詳しく聞く質問をする
3. 「具体的な状況を教えていただけると、より適切なアドバイスができます」

**絶対に言い切り型や押し付けがましい表現は避け、必ず対話を継続してください。**
`;
}
        
        const messages = [
            { role: 'system', content: mentorPersonality },
            ...history,
            { role: 'user', content: message }
        ];
        
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: messages,
            max_tokens: 250,
            temperature: 0.8,
        });
        
        let aiResponse = response.choices[0].message.content;
        
        if (aiResponse && !aiResponse.match(/[。！？]$/)) {
    const sentences = aiResponse.split(/[。！？]/);
    if (sentences.length > 1) {
        sentences.pop();
        aiResponse = sentences.join('。') + '。';
    }
}

// 読みやすさのための改行挿入
if (aiResponse.length > 100) {
    aiResponse = aiResponse.replace(/。\s*([^。]{50,})/g, '。\n\n$1');
}
        
        console.log(`AI応答生成完了: レスポンス長=${aiResponse.length}文字`);
        
        return aiResponse;
        
    } catch (error) {
        console.error('OpenAI API エラー:', error.message);
        const profile = await getUserProfile(userId, client);
        const userName = profile?.displayName;
        return `${userName ? userName + 'さん、' : ''}申し訳ございません。今少し考え事をしていて、うまくお答えできませんでした。もう一度お話しいただけますでしょうか。`;
    }
}

// システムメッセージ
const SYSTEM_MESSAGES = {
    welcome: (userName, useNameInResponse) => {
        const greetings = [
            `${userName ? userName + 'さん、' : ''}こんにちは。斎藤と申します。今日はどのようなことでお悩みでしょうか？`,
            `${userName ? userName + 'さん、' : ''}お疲れさまです。何かお困りのことがありましたら、お気軽にご相談ください。`,
            `${userName ? userName + 'さん、' : ''}今日はどのようなことでお話ししましょうか？どんな小さなことでも構いません。`
        ];
        return greetings[Math.floor(Math.random() * greetings.length)];
    },
    
    dailyLimitReached: (userName, useNameInResponse) => {
        const messages = [
            `${userName ? userName + 'さん、' : ''}今日の相談回数が上限に達しました。また明日お話しできるのを楽しみにしています。`,
            `${userName ? userName + 'さん、' : ''}今日はここまでになります。今日はゆっくり休んで、また明日お話ししましょう。`,
            `${userName ? userName + 'さん、' : ''}お疲れさまでした。心の整理には時間も大切ですから、また明日お待ちしています。`
        ];
        return messages[Math.floor(Math.random() * messages.length)];
    },
    
    remainingTurns: (remaining, userName, useNameInResponse) => {
        const messages = [
            `${userName ? userName + 'さん、' : ''}今日はあと${remaining}回お話しできます。`,
            `あと${remaining}回お話しできます。大切にお聞きしますね。`,
            `今日の残り回数は${remaining}回です。何でもお話しください。`
        ];
        return messages[Math.floor(Math.random() * messages.length)];
    },
    
    maxUsersReached: "申し訳ございません。現在多くの方がお話し中のため、少しお時間をおいてからお話しかけください。"
};

// クリーンアップ
function cleanupMemorySessions() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [userId, timestamp] of lastMessageTime) {
        if (now - timestamp > LIMITS.SESSION_TIMEOUT) {
            conversationHistory.delete(userId);
            lastMessageTime.delete(userId);
            userSessions.delete(userId);
            cleanedCount++;
            console.log(`セッション削除: ユーザー${userId.substring(0, 8)}... (30分非アクティブ)`);
        }
    }
    
    const today = new Date().toISOString().split('T')[0];
    for (const [userId, usage] of dailyUsage) {
        if (usage.date !== today) {
            dailyUsage.delete(userId);
        }
    }
    
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString().split('T')[0];
    
    for (const [date] of stats.dailyMetrics) {
        if (date < weekAgoStr) {
            stats.dailyMetrics.delete(date);
        }
    }
    
    if (cleanedCount > 0) {
        console.log(`🧹 メモリクリーンアップ実行: ${cleanedCount}セッション削除`);
    }
}

setInterval(cleanupMemorySessions, LIMITS.CLEANUP_INTERVAL);

// LINE クライアント設定
const client = new line.Client(config);

// Webhookエンドポイント
app.post('/webhook', line.middleware(config), async (req, res) => {
    try {
        console.log('📨 Webhook受信成功');
        res.status(200).end();
        
        const events = req.body.events;
        console.log(`📨 イベント数: ${events.length}`);
        
        events.forEach(event => {
            setImmediate(() => handleEvent(event));
        });
        
    } catch (error) {
        console.error('❌ Webhook処理エラー:', error.message);
        res.status(200).end();
    }
});

// 修正版: 制限チェック関数
async function checkDailyLimit(userId) {
    try {
        const record = await getUserLimitRecord(userId);
        const currentCount = record ? (record.fields.turn_count || 0) : 0;
        
        console.log(`🔍 制限チェック: userId=${userId.substring(0,8)}, count=${currentCount}/${LIMITS.DAILY_TURN_LIMIT}`);
        
        const withinLimit = currentCount < LIMITS.DAILY_TURN_LIMIT;
        console.log(`✅ 制限判定: ${currentCount}/${LIMITS.DAILY_TURN_LIMIT} = ${withinLimit ? '許可' : '拒否'}`);
        return withinLimit;
    } catch (error) {
        console.error('制限チェックエラー:', error.message);
        return true; // エラー時は制限を適用しない
    }
}

// 修正版: 残り回数取得関数
async function getRemainingTurns(userId) {
    try {
        console.log(`🔍 残り回数取得: userId=${userId.substring(0,8)}`);
        
        const record = await getUserLimitRecord(userId);
        const currentCount = record ? (record.fields.turn_count || 0) : 0;
        const remaining = Math.max(0, LIMITS.DAILY_TURN_LIMIT - currentCount);
        
        console.log(`📊 残り回数計算: ${currentCount}使用済み → 残り${remaining}回`);
        return remaining;
        
    } catch (error) {
        console.error('❌ 残り回数取得エラー:', error.message);
        return LIMITS.DAILY_TURN_LIMIT; // エラー時は全回数を返す
    }
}

// セッション管理
async function manageUserSession(userId) {
    try {
        userSessions.add(userId);
        lastMessageTime.set(userId, Date.now());
        return userSessions.size <= LIMITS.MAX_USERS;
    } catch (error) {
        console.error('セッション管理エラー:', error.message);
        userSessions.add(userId);
        lastMessageTime.set(userId, Date.now());
        return userSessions.size <= LIMITS.MAX_USERS;
    }
}

// メインイベント処理
async function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        console.log(`🔍 イベントスキップ: type=${event.type}, messageType=${event.message?.type}`);
        return;
    }
    
    const userId = event.source.userId;
    const userMessage = event.message.text;
    const replyToken = event.replyToken;
    
    try {
        console.log(`🔍 handleEvent処理開始: ${userId.substring(0, 8)} - "${userMessage}"`);
        
        // プロフィール取得
        const profile = await getUserProfile(userId, client);
        const userName = profile?.displayName;
        console.log(`✅ プロフィール取得完了: ${userName || 'Unknown'}`);
        
        // ユーザーセッション制限チェック
        if (!userSessions.has(userId) && userSessions.size >= LIMITS.MAX_USERS) {
            console.log(`❌ 最大ユーザー数制限に達したため拒否: ${userSessions.size}/${LIMITS.MAX_USERS}`);
            await client.replyMessage(replyToken, {
                type: 'text',
                text: SYSTEM_MESSAGES.maxUsersReached
            });
            return;
        }
        
        // セッション管理
        const sessionAllowed = await manageUserSession(userId);
        if (!sessionAllowed) {
            console.log(`❌ 最大ユーザー数制限に達したため拒否`);
            await client.replyMessage(replyToken, {
                type: 'text',
                text: SYSTEM_MESSAGES.maxUsersReached
            });
            return;
        }
        
        // 日次制限チェック
        if (!(await checkDailyLimit(userId))) {
            console.log(`❌ 日次制限に達したため拒否`);
            const conversationCount = conversationHistory.get(userId)?.length || 0;
            const useNameInResponse = shouldUseName(conversationCount);
            
            await client.replyMessage(replyToken, {
                type: 'text',
                text: SYSTEM_MESSAGES.dailyLimitReached(userName, useNameInResponse)
            });
            return;
        }
        
        // 会話履歴取得
        let history = conversationHistory.get(userId) || [];
        const conversationCount = history.length + 1;
        const useNameInResponse = shouldUseName(conversationCount);
        console.log(`🔍 会話履歴取得完了: ${history.length}件, 名前使用: ${useNameInResponse}`);
        
        // 初回ユーザー処理
        if (history.length === 0) {
            const welcomeMessage = SYSTEM_MESSAGES.welcome(userName, useNameInResponse);
            
            await client.replyMessage(replyToken, {
                type: 'text',
                text: welcomeMessage
            });
            
            history.push({ role: 'assistant', content: welcomeMessage });
            conversationHistory.set(userId, history);
            
            await updateDailyUsage(userId);
            updateDailyMetrics(userId, 'turn');
            return;
        }
        
        // AI応答生成
        const aiResponse = await generateAIResponse(userMessage, history, userId, client);
        let finalResponse = aiResponse;
        
        // 使用回数更新・残り回数表示
        const usageCount = await updateDailyUsage(userId);
        const remaining = Math.max(0, LIMITS.DAILY_TURN_LIMIT - usageCount);
        
        if (remaining <= 3 && remaining > 0) {
            finalResponse += "\n\n" + SYSTEM_MESSAGES.remainingTurns(remaining, userName, useNameInResponse);
        }        
        
        // 会話履歴更新
        history.push(
            { role: 'user', content: userMessage },
            { role: 'assistant', content: aiResponse }
        );
        
        if (history.length > 20) {
            history = history.slice(-20);
        }
        
        conversationHistory.set(userId, history);
        await updateDailyMetrics(userId, 'turn');
        
        // 応答送信
        await client.replyMessage(replyToken, {
            type: 'text',
            text: finalResponse
        });
        console.log(`✅ 応答送信完了: ${userName || 'Unknown'} (${userId.substring(0, 8)}...) - レスポンス長=${finalResponse.length}文字`);
        
    } catch (error) {
        console.error(`❌ handleEvent エラー詳細:`, {
            userId: userId.substring(0, 8),
            userName: await getUserProfile(userId, client).then(p => p?.displayName).catch(() => 'Unknown'),
            message: userMessage,
            replyToken: replyToken,
            errorMessage: error.message,
            timestamp: new Date().toISOString()
        });
        
        try {
            await client.replyMessage(replyToken, {
                type: 'text',
                text: "申し訳ございません。お話を聞く準備ができませんでした。少し時間をおいてからもう一度お話しかけください。"
            });
        } catch (replyError) {
            console.error('❌ エラー応答送信も失敗:', replyError.message);
        }
    }
}

// 管理機能エンドポイント
app.get('/', (req, res) => {
    res.send(`
        <html>
        <head>
            <title>新人・若手メンターBot - 斎藤修</title>
            <meta charset="UTF-8">
        </head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background: linear-gradient(135deg, #667eea, #764ba2);">
            <h1>👨‍💼⭐ 新人・若手メンターBot - 斎藤修 ⭐👨‍💼</h1>
            <p>20年の現場経験を持つベテランメンター「斎藤修」があなたのキャリアをサポートします</p>
            <p><strong>v1.0.0</strong> - サーバーは正常に稼働しています ✨</p>
            <div style="margin-top: 30px;">
                <a href="/health" style="background: #55a3ff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 0 10px;">ヘルスチェック</a>
                <a href="/admin" style="background: #667eea; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 0 10px;">管理画面</a>
            </div>
        </body>
        </html>
    `);
});

app.get('/health', (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const todayStats = stats.dailyMetrics.get(today) || { users: new Set(), turns: 0 };
    
    const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: '新人・若手メンターBot - 斎藤修',
        version: '1.0.0',
        uptime: Math.floor(process.uptime()),
        stats: {
            totalUsers: stats.totalUsers.size,
            todayUsers: todayStats.users.size,
            totalTurns: stats.totalTurns,
            todayTurns: todayStats.turns,
            activeSessions: userSessions.size,
            cachedProfiles: userProfiles.size
        },
        limits: {
            maxUsers: LIMITS.MAX_USERS,
            dailyTurnLimit: LIMITS.DAILY_TURN_LIMIT
        },
        mentor_info: {
            name: '斎藤修',
            experience: '20年',
            specialties: ['キャリア相談', '人間関係', '業務効率', 'スキル開発'],
            approach: '実践的で信頼できるアドバイス'
        },
        message: '斎藤修があなたのキャリアサポートで安定稼働中です ✨'
    };
    
    res.json(health);
});

app.get('/admin', (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const todayStats = stats.dailyMetrics.get(today) || { users: new Set(), turns: 0 };
    
    res.send(`
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body { 
                    font-family: 'Hiragino Sans', 'Yu Gothic', sans-serif; 
                    margin: 20px; 
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                }
                .container { 
                    max-width: 600px; 
                    margin: 0 auto; 
                    background: white; 
                    padding: 40px; 
                    border-radius: 20px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.2);
                }
                .header { text-align: center; margin-bottom: 40px; }
                .status {
                    background: #00b894;
                    color: white;
                    padding: 15px;
                    border-radius: 10px;
                    margin: 20px 0;
                    text-align: center;
                    font-weight: bold;
                }
                .mentor-info {
                    background: #74b9ff;
                    color: white;
                    padding: 20px;
                    border-radius: 10px;
                    margin: 20px 0;
                    text-align: left;
                }
                .menu-item {
                    display: block;
                    background: linear-gradient(45deg, #667eea, #764ba2);
                    color: white;
                    padding: 20px 30px;
                    margin: 20px 0;
                    text-decoration: none;
                    border-radius: 15px;
                    text-align: center;
                    font-size: 1.2em;
                    font-weight: bold;
                    transition: all 0.3s ease;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.1);
                }
                .menu-item:hover {
                    transform: translateY(-3px);
                    box-shadow: 0 8px 25px rgba(0,0,0,0.2);
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>👨‍💼 斎藤修 - メンター管理メニュー v1.0.0</h1>
                    <div class="status">
                        ✅ v1.0.0 新人・若手メンターBot稼働中！ | 相談者: ${stats.totalUsers.size}名 | 本日: ${todayStats.users.size}名 | 相談: ${stats.totalTurns}回
                    </div>
                </div>
                
                <div class="mentor-info">
                    <h3>✨ 斎藤修プロフィール</h3>
                    <ul style="margin: 10px 0;">
                        <li>✅ IT企業20年勤務、現事業部長（200名規模）</li>
                        <li>✅ 転職経験2回（失敗・成功両方を経験）</li>
                        <li>✅ 離職率30%→5%改善実績</li>
                        <li>✅ 新卒・中途採用面接官歴10年</li>
                    </ul>
                </div>
                
                <a href="/health" class="menu-item">
                    ❤️ ヘルスチェック
                </a>
                
                <a href="/admin/stats" class="menu-item">
                    📊 統計ダッシュボード
                </a>
                
                <a href="/test" class="menu-item">
                    🧪 システムテスト
                </a>
            </div>
        </body>
        </html>
    `);
});

app.get('/admin/stats', (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const todayStats = stats.dailyMetrics.get(today) || { users: new Set(), turns: 0 };
    
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const dayStats = stats.dailyMetrics.get(dateStr) || { users: new Set(), turns: 0 };
        
        last7Days.push({
            date: dateStr,
            users: dayStats.users.size,
            turns: dayStats.turns
        });
    }
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>斎藤修 - メンター統計情報 v1.0.0</title>
            <meta charset="UTF-8">
            <style>
                body { 
                    font-family: 'Hiragino Sans', 'Yu Gothic', sans-serif; 
                    margin: 20px; 
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                }
                .container { 
                    max-width: 1000px; 
                    margin: 0 auto; 
                    background: white; 
                    padding: 30px; 
                    border-radius: 15px;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.1);
                }
                .header {
                    text-align: center;
                    color: white;
                    margin-bottom: 40px;
                    background: linear-gradient(45deg, #667eea, #764ba2);
                    padding: 20px;
                    border-radius: 10px;
                }
                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 20px;
                    margin-bottom: 40px;
                }
                .stat-card {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    padding: 25px;
                    border-radius: 15px;
                    text-align: center;
                    color: white;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.1);
                    transition: transform 0.3s ease;
                }
                .stat-card:hover {
                    transform: translateY(-5px);
                }
                .stat-number {
                    font-size: 2.5em;
                    font-weight: bold;
                    margin-bottom: 10px;
                }
                .stat-label {
                    font-size: 1em;
                    opacity: 0.9;
                }
                .mentor-features {
                    background: #74b9ff;
                    color: white;
                    padding: 20px;
                    border-radius: 10px;
                    margin-bottom: 20px;
                }
                .daily-stats {
                    background: white;
                    border: 2px solid #667eea;
                    border-radius: 15px;
                    overflow: hidden;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.05);
                }
                .daily-stats h3 {
                    background: linear-gradient(45deg, #667eea, #764ba2);
                    color: white;
                    margin: 0;
                    padding: 20px;
                    text-align: center;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                }
                th, td {
                    padding: 15px;
                    text-align: center;
                    border-bottom: 1px solid #f1f2f6;
                }
                th {
                    background-color: #f8f9fa;
                    font-weight: bold;
                    color: #2d3436;
                }
                tr:hover {
                    background-color: #e6ecff;
                }
                .footer {
                    text-align: center; 
                    margin-top: 40px; 
                    color: #636e72;
                    background: #f1f2f6;
                    padding: 20px;
                    border-radius: 10px;
                }
                .back-button {
                    background: #667eea;
                    color: white;
                    padding: 10px 20px;
                    text-decoration: none;
                    border-radius: 5px;
                    margin-top: 20px;
                    display: inline-block;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>👨‍💼 斎藤修 - メンター統計情報 v1.0.0 👨‍💼</h1>
                    <p>最終更新: ${new Date().toLocaleString('ja-JP')}</p>
                </div>
                
                <div class="mentor-features">
                    <h3>✨ メンター斎藤修の特徴</h3>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 15px;">
                        <div>
                            <strong>経験・実績:</strong>
                            <ul style="margin: 5px 0; text-align: left;">
                                <li>✅ IT企業20年勤務経験</li>
                                <li>✅ 現事業部長（200名規模）</li>
                            </ul>
                        </div>
                        <div>
                            <strong>専門領域:</strong>
                            <ul style="margin: 5px 0; text-align: left;">
                                <li>✅ キャリア相談・人間関係</li>
                                <li>✅ 業務効率・スキル開発</li>
                            </ul>
                        </div>
                    </div>
                </div>
                
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-number">${stats.totalUsers.size}</div>
                        <div class="stat-label">👥 総相談者数</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${todayStats.users.size}</div>
                        <div class="stat-label">📅 本日の相談者</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${stats.totalTurns}</div>
                        <div class="stat-label">💬 総相談回数</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${todayStats.users.size > 0 ? (todayStats.turns / todayStats.users.size).toFixed(1) : 0}</div>
                        <div class="stat-label">📊 平均相談数/人</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${userProfiles.size}</div>
                        <div class="stat-label">👤 登録済みユーザー</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${userSessions.size}</div>
                        <div class="stat-label">🔄 アクティブセッション</div>
                    </div>
                </div>
                
                <div class="daily-stats">
                    <h3>📊 過去7日間の相談実績</h3>
                    <table>
                        <tr>
                            <th>📅 日付</th>
                            <th>👥 相談者数</th>
                            <th>💬 相談回数</th>
                            <th>📈 平均相談数</th>
                        </tr>
                        ${last7Days.map(day => `
                            <tr>
                                <td>${day.date}</td>
                                <td>${day.users}</td>
                                <td>${day.turns}</td>
                                <td>${day.users > 0 ? (day.turns / day.users).toFixed(1) : 0}</td>
                            </tr>
                        `).join('')}
                    </table>
                </div>
                
                <div class="footer">
                    <p>👨‍💼 斎藤修v1.0.0が新人・若手のキャリアサポートで安定稼働中です 👨‍💼</p>
                    <p style="font-size: 0.9em; margin-top: 15px;">
                        システム稼働時間: ${Math.floor(process.uptime() / 3600)}時間${Math.floor((process.uptime() % 3600) / 60)}分
                    </p>
                    <a href="/admin" class="back-button">管理メニューに戻る</a>
                </div>
            </div>
        </body>
        </html>
    `);
});

app.get('/test', (req, res) => {
    res.json({
        message: '斎藤修v1.0.0は新人・若手メンターとして安定稼働しています！',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        webhook_url: req.get('host') + '/webhook',
        environment_check: {
            line_secret: !!process.env.LINE_CHANNEL_SECRET,
            line_token: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
            openai_key: !!process.env.OPENAI_API_KEY,
            airtable_key: !!process.env.AIRTABLE_API_KEY,
            airtable_base: !!process.env.AIRTABLE_BASE_ID
        },
        mentor_profile: {
            name: '斎藤修',
            age: 45,
            experience: '20年',
            current_position: '事業部長（200名規模）',
            specialties: ['キャリア相談', '人間関係', '業務効率', 'スキル開発'],
            approach: '実践的で信頼できるアドバイス'
        }
    });
});

// サーバー開始
const PORT = process.env.PORT || 3000;
console.log('使用量データを読み込み中...');
loadUsageData();
app.listen(PORT, () => {
    console.log('👨‍💼⭐ 新人・若手メンターBot「斎藤修」v1.0.0が起動しました ⭐👨‍💼');
    console.log(`ポート: ${PORT}`);
    console.log(`環境: ${process.env.NODE_ENV || 'development'}`);
    console.log('');
    console.log('=== 🏢 システム情報 ===');
    console.log(`最大ユーザー数: ${LIMITS.MAX_USERS}名`);
    console.log(`1日の制限: ${LIMITS.DAILY_TURN_LIMIT}ターン`);
    console.log(`セッション時間: ${LIMITS.SESSION_TIMEOUT / 60000}分`);
    console.log(`クリーンアップ間隔: ${LIMITS.CLEANUP_INTERVAL / 60000}分`);
    console.log('');
    console.log('=== 👨‍💼 メンタープロフィール ===');
    console.log('• 名前: 斎藤修（45歳）');
    console.log('• 経歴: IT企業20年勤務、現事業部長');
    console.log('• 実績: 離職率30%→5%改善、面接官歴10年');
    console.log('• 専門: キャリア相談、人間関係、業務効率');
    console.log('• 方針: 実践的で信頼できるアドバイス');
    console.log('====================================');
    console.log('');
    console.log('=== 🎯 サービス目標 ===');
    console.log('• 新人・若手の悩み解決率向上');
    console.log('• 平均相談ターン数: 目標3-5ターン');
    console.log('• ユーザー継続率: 翌日再利用率測定');
    console.log('• メンター品質: 実践的で信頼できる応答');
    console.log('========================');
    console.log('');
    console.log('斎藤修が新人・若手の皆さんをお待ちしています... 👨‍💼');
    
    // 起動時の環境変数チェック
    const requiredEnvs = ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN', 'OPENAI_API_KEY'];
    const optionalEnvs = ['AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID'];
    const missingEnvs = requiredEnvs.filter(env => !process.env[env]);
    const missingOptionalEnvs = optionalEnvs.filter(env => !process.env[env]);
    
    if (missingEnvs.length > 0) {
        console.error('❌ 不足している必須環境変数:', missingEnvs.join(', '));
        console.error('Renderの環境変数設定を確認してください');
    } else {
        console.log('✅ 必須環境変数設定完了');
    }
    
    if (missingOptionalEnvs.length > 0) {
        console.log('⚠️ オプション環境変数未設定:', missingOptionalEnvs.join(', '));
        console.log('Airtable機能を使用する場合は設定してください');
    } else {
        console.log('✅ Airtable環境変数設定完了');
    }
    
    console.log('');
    console.log('🎉 斎藤修v1.0.0は新人・若手メンターとして準備完了しました！');
});
