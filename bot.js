const TelegramBot = require('node-telegram-bot-api');
const ytdl = require('ytdl-core');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const ffmpeg = require('ffmpeg-static');

// ============================================
// CONFIGURATION - BOT TOKEN FROM ENVIRONMENT
// ============================================
const BOT_TOKEN = process.env.BOT_TOKEN;

// Optional: Download limits for free users (set to 0 for unlimited)
const FREE_DAILY_LIMIT = 5;

// Optional: Your referral/affiliate links for monetization
const REFERRAL_LINK = 'https://your-affiliate-link.com';
const DONATE_LINK = 'https://your-donation-link.com';

// ============================================
// INITIALIZE BOT
// ============================================
if (!BOT_TOKEN) {
  console.error('FATAL ERROR: BOT_TOKEN is not defined. Please set it in your environment variables.');
  process.exit(1);
}
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// In-memory storage for user download counts
const userDownloads = {};

// ============================================
// HELPER FUNCTIONS
// ============================================

// Reset daily download counts at midnight
function resetDailyLimits() {
  const now = new Date();
  const night = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
  const msToMidnight = night.getTime() - now.getTime();
  setTimeout(() => {
    Object.keys(userDownloads).forEach(userId => {
      userDownloads[userId].count = 0;
    });
    resetDailyLimits();
  }, msToMidnight);
}
resetDailyLimits();

function checkDownloadLimit(userId) {
  if (FREE_DAILY_LIMIT === 0) return true;
  if (!userDownloads[userId]) userDownloads[userId] = { count: 0, premium: false };
  if (userDownloads[userId].premium) return true;
  return userDownloads[userId].count < FREE_DAILY_LIMIT;
}

function incrementDownload(userId) {
  if (!userDownloads[userId]) userDownloads[userId] = { count: 0, premium: false };
  userDownloads[userId].count++;
}

function getRemainingDownloads(userId) {
  if (FREE_DAILY_LIMIT === 0) return 'Unlimited';
  if (!userDownloads[userId]) return FREE_DAILY_LIMIT;
  if (userDownloads[userId].premium) return 'Unlimited (Premium)';
  return FREE_DAILY_LIMIT - userDownloads[userId].count;
}

function sanitizeFilename(filename) {
  return filename.replace(/[^a-zA-Z0-9_\-.]/gi, '_').substring(0, 100);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function deleteFile(filePath) {
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      console.log(`Deleted temporary file: ${filePath}`);
    } catch (error) {
      console.error(`Error deleting file ${filePath}:`, error);
    }
  }
}

// ============================================
// DOWNLOAD FUNCTIONS (UPDATED & ROBUST)
// ============================================

async function downloadVideo(url, quality = 'highest') {
  const info = await ytdl.getInfo(url);
  const title = sanitizeFilename(info.videoDetails.title);
  
  const audioPath = path.join(__dirname, `${title}_audio.mp4`);
  const videoPath = path.join(__dirname, `${title}_video.mp4`);
  const outputPath = path.join(__dirname, `${title}_output.mp4`);

  try {
    const audioStream = ytdl(url, { quality: 'highestaudio' });
    const videoStream = ytdl(url, { quality: quality === 'highest' ? 'highestvideo' : 'lowestvideo' });

    const downloadAudio = new Promise((resolve, reject) => audioStream.pipe(fs.createWriteStream(audioPath)).on('finish', resolve).on('error', reject));
    const downloadVideo = new Promise((resolve, reject) => videoStream.pipe(fs.createWriteStream(videoPath)).on('finish', resolve).on('error', reject));
    
    await Promise.all([downloadAudio, downloadVideo]);

    const ffmpegCommand = `"${ffmpeg}" -i "${videoPath}" -i "${audioPath}" -c:v copy -c:a aac "${outputPath}"`;
    console.log(`Running ffmpeg command for ${title}`);
    await execPromise(ffmpegCommand);
    
    return { filePath: outputPath, title: info.videoDetails.title, info };
  } catch (error) {
    console.error(`Error processing video "${title}":`, error);
    throw new Error('Could not process video. It might be private, region-locked, or a livestream.');
  } finally {
    deleteFile(audioPath);
    deleteFile(videoPath);
  }
}

async function downloadAudio(url) {
  const info = await ytdl.getInfo(url);
  const title = sanitizeFilename(info.videoDetails.title);
  const outputPath = path.join(__dirname, `${title}.mp3`);

  try {
    const audioStream = ytdl(url, { quality: 'highestaudio', filter: 'audioonly' });
    return new Promise((resolve, reject) => {
      audioStream.pipe(fs.createWriteStream(outputPath))
        .on('finish', () => resolve({ filePath: outputPath, title: info.videoDetails.title, info }))
        .on('error', reject);
    });
  } catch (error) {
    console.error(`Error downloading audio for "${title}":`, error);
    throw new Error('Could not process audio.');
  }
}

// ============================================
// BOT COMMANDS (No changes needed)
// ============================================
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `
🎬 *Welcome to YouTube Downloader Bot!*

Send me any YouTube link and I'll download it for you!

*How to use:*
1️⃣ Send me a YouTube link
2️⃣ Choose video or audio
3️⃣ Wait for the download

*Free users:* ${FREE_DAILY_LIMIT === 0 ? 'Unlimited' : `${FREE_DAILY_LIMIT} downloads per day`}
/stats - Check your remaining downloads.
  `, { parse_mode: 'Markdown' });
});

bot.onText(/\/stats/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const remaining = getRemainingDownloads(userId);
  bot.sendMessage(chatId, `
📊 *Your Download Statistics*
📥 Remaining downloads today: *${remaining}*
${userDownloads[userId]?.premium ? '⭐ Premium Status: Active' : ''}
  `, { parse_mode: 'Markdown' });
});

// ============================================
// MAIN MESSAGE HANDLER
// ============================================

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;

  const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/([a-zA-Z0-9_-]{11})/;
  if (!text.match(youtubeRegex)) {
    return bot.sendMessage(chatId, '❌ Please send a valid YouTube link.');
  }
  
  const videoUrl = text.trim();
  if (!ytdl.validateURL(videoUrl)) {
    return bot.sendMessage(chatId, '❌ Invalid YouTube URL format.');
  }

  if (!checkDownloadLimit(userId)) {
    return bot.sendMessage(chatId, `⚠️ *Daily Download Limit Reached*.\n\nYou can download more tomorrow.`, { parse_mode: 'Markdown' });
  }

  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎥 Video (High)', callback_data: `video_highest_${videoUrl}` }, { text: '🎥 Video (Low)', callback_data: `video_lowest_${videoUrl}` }],
        [{ text: '🎵 Audio (MP3)', callback_data: `audio_na_${videoUrl}` }],
        [{ text: '📊 Video Info', callback_data: `info_na_${videoUrl}` }]
      ]
    }
  };
  bot.sendMessage(chatId, '🎬 Choose a download option:', options);
});

// ============================================
// CALLBACK QUERY HANDLER
// ============================================

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;
  const [action, quality, ...urlParts] = data.split('_');
  const videoUrl = urlParts.join('_');
  
  bot.answerCallbackQuery(query.id);
  const processingMsg = await bot.editMessageText('⏳ Processing your request...', { chat_id: chatId, message_id: query.message.message_id, reply_markup: null });

  if (action === 'info') {
    try {
      const info = await ytdl.getInfo(videoUrl);
      const infoMessage = `*Title:* ${info.videoDetails.title}\n*Channel:* ${info.videoDetails.author.name}\n*Duration:* ${new Date(info.videoDetails.lengthSeconds * 1000).toISOString().slice(11, 19)}`;
      await bot.editMessageText(infoMessage, { chat_id: chatId, message_id: processingMsg.message_id, parse_mode: 'Markdown' });
    } catch (error) {
      await bot.editMessageText(`❌ Error fetching info: ${error.message}`, { chat_id: chatId, message_id: processingMsg.message_id });
    }
    return;
  }
  
  if (!checkDownloadLimit(userId)) {
    return bot.editMessageText('⚠️ Daily download limit reached.', { chat_id: chatId, message_id: processingMsg.message_id });
  }

  let filePath;
  try {
    let result;
    if (action === 'video') {
      await bot.editMessageText('📥 Downloading video... (This can take a while)', { chat_id: chatId, message_id: processingMsg.message_id });
      result = await downloadVideo(videoUrl, quality);
    } else if (action === 'audio') {
      await bot.editMessageText('🎵 Downloading audio...', { chat_id: chatId, message_id: processingMsg.message_id });
      result = await downloadAudio(videoUrl);
    }
    
    filePath = result.filePath;
    const fileSize = fs.statSync(filePath).size;

    if (fileSize > 50 * 1024 * 1024) {
      throw new Error('File is too large for Telegram (limit is 50MB). Please try a shorter video or lower quality.');
    }
    
    await bot.editMessageText('📤 Uploading to Telegram...', { chat_id: chatId, message_id: processingMsg.message_id });

    if (action === 'video') {
      await bot.sendVideo(chatId, filePath, { caption: `🎬 *${result.title}*`, parse_mode: 'Markdown' });
    } else if (action === 'audio') {
      await bot.sendAudio(chatId, filePath, { caption: `🎵 *${result.title}*`, parse_mode: 'Markdown' });
    }
    
    await bot.deleteMessage(chatId, processingMsg.message_id);
    incrementDownload(userId);
    const remaining = getRemainingDownloads(userId);
    await bot.sendMessage(chatId, `✅ Download complete!\n*Remaining downloads today:* ${remaining}`, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Callback handler error:', error);
    await bot.editMessageText(`❌ Download failed: ${error.message}`, { chat_id: chatId, message_id: processingMsg.message_id });
  } finally {
    if (filePath) deleteFile(filePath);
  }
});

// ============================================
// ERROR HANDLING
// ============================================
bot.on('polling_error', (error) => console.error('Polling error:', error.message));
process.on('unhandledRejection', (error) => console.error('Unhandled Rejection:', error));

// ============================================
// START BOT
// ============================================
console.log('🤖 YouTube Downloader Bot is running...');
console.log('📱 Waiting for messages...');
