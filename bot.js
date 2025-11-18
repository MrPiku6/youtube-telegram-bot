const TelegramBot = require('node-telegram-bot-api');
const ytdl = require('ytdl-core');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// ============================================
// CONFIGURATION - INSERT YOUR BOT TOKEN HERE
// ============================================
const BOT_TOKEN = '8570541890:AAGW_lfhDy0oOqXfD88iJIneEceduGu4rlg';

// Download limits
const FREE_DAILY_LIMIT = 5;

// Monetization links
const REFERRAL_LINK = 'https://your-affiliate-link.com';
const DONATE_LINK = 'https://your-donation-link.com';

// ============================================
// INITIALIZE BOT
// ============================================
const bot = new TelegramBot(BOT_TOKEN, { 
  polling: { 
    interval: 300,
    autoStart: true,
    params: {
      timeout: 10
    }
  }
});

// User download tracking
const userDownloads = {};

// ============================================
// IMPROVED HELPER FUNCTIONS
// ============================================

function resetDailyLimits() {
  const now = new Date();
  const night = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0, 0, 0
  );
  const msToMidnight = night.getTime() - now.getTime();
  
  setTimeout(() => {
    Object.keys(userDownloads).forEach(userId => {
      userDownloads[userId].count = 0;
    });
    console.log('📊 Daily limits reset');
    resetDailyLimits();
  }, msToMidnight);
}

resetDailyLimits();

function checkDownloadLimit(userId) {
  if (FREE_DAILY_LIMIT === 0) return true;
  
  if (!userDownloads[userId]) {
    userDownloads[userId] = { count: 0, premium: false };
  }
  
  if (userDownloads[userId].premium) return true;
  
  return userDownloads[userId].count < FREE_DAILY_LIMIT;
}

function incrementDownload(userId) {
  if (!userDownloads[userId]) {
    userDownloads[userId] = { count: 0, premium: false };
  }
  userDownloads[userId].count++;
}

function getRemainingDownloads(userId) {
  if (FREE_DAILY_LIMIT === 0) return 'Unlimited';
  if (!userDownloads[userId]) return FREE_DAILY_LIMIT;
  if (userDownloads[userId].premium) return 'Unlimited (Premium)';
  return FREE_DAILY_LIMIT - userDownloads[userId].count;
}

function sanitizeFilename(filename) {
  return filename.replace(/[^a-z0-9_\-]/gi, '_').substring(0, 100);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function deleteFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`🗑️ Deleted: ${filePath}`);
    }
  } catch (error) {
    console.error(`❌ Error deleting file: ${error.message}`);
  }
}

// ============================================
// IMPROVED DOWNLOAD FUNCTIONS
// ============================================

const YTDL_OPTIONS = {
  quality: 'highest',
  filter: 'audioandvideo',
  requestOptions: {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    }
  }
};

async function downloadVideo(url, quality = 'highest') {
  return new Promise(async (resolve, reject) => {
    try {
      console.log(`📥 Starting video download: ${url}`);
      
      const info = await ytdl.getInfo(url);
      const title = sanitizeFilename(info.videoDetails.title);
      const filename = `${title}_${Date.now()}.mp4`;
      const filePath = path.join(__dirname, 'downloads', filename);

      // Ensure downloads directory exists
      if (!fs.existsSync(path.join(__dirname, 'downloads'))) {
        fs.mkdirSync(path.join(__dirname, 'downloads'));
      }

      const videoFormat = ytdl.chooseFormat(info.formats, {
        quality: quality === 'highest' ? 'highest' : 'lowest',
        filter: 'audioandvideo'
      });

      if (!videoFormat) {
        reject(new Error('No suitable video format found'));
        return;
      }

      console.log(`🎬 Selected format: ${videoFormat.qualityLabel}`);

      const videoStream = ytdl.downloadFromInfo(info, { format: videoFormat });
      const writeStream = fs.createWriteStream(filePath);

      let downloadedBytes = 0;
      let totalBytes = videoFormat.contentLength || 0;

      videoStream.on('data', (chunk) => {
        downloadedBytes += chunk.length;
      });

      videoStream.pipe(writeStream);

      writeStream.on('finish', () => {
        console.log(`✅ Download completed: ${filePath}`);
        resolve({ 
          filePath, 
          title: info.videoDetails.title,
          duration: info.videoDetails.lengthSeconds,
          quality: videoFormat.qualityLabel
        });
      });

      writeStream.on('error', (error) => {
        console.error('❌ Write stream error:', error);
        deleteFile(filePath);
        reject(error);
      });

      videoStream.on('error', (error) => {
        console.error('❌ Video stream error:', error);
        deleteFile(filePath);
        reject(error);
      });

      // Timeout after 10 minutes
      setTimeout(() => {
        if (!writeStream.closed) {
          reject(new Error('Download timeout'));
          videoStream.destroy();
          writeStream.destroy();
          deleteFile(filePath);
        }
      }, 10 * 60 * 1000);

    } catch (error) {
      console.error('❌ Download video error:', error);
      reject(error);
    }
  });
}

async function downloadAudio(url) {
  return new Promise(async (resolve, reject) => {
    try {
      console.log(`🎵 Starting audio download: ${url}`);
      
      const info = await ytdl.getInfo(url);
      const title = sanitizeFilename(info.videoDetails.title);
      const filename = `${title}_${Date.now()}.mp3`;
      const filePath = path.join(__dirname, 'downloads', filename);

      // Ensure downloads directory exists
      if (!fs.existsSync(path.join(__dirname, 'downloads'))) {
        fs.mkdirSync(path.join(__dirname, 'downloads'));
      }

      const audioFormat = ytdl.chooseFormat(info.formats, {
        quality: 'highestaudio',
        filter: 'audioonly'
      });

      if (!audioFormat) {
        reject(new Error('No suitable audio format found'));
        return;
      }

      console.log(`🎶 Selected audio format: ${audioFormat.audioBitrate}kbps`);

      const audioStream = ytdl.downloadFromInfo(info, { format: audioFormat });
      const writeStream = fs.createWriteStream(filePath);

      audioStream.pipe(writeStream);

      writeStream.on('finish', () => {
        console.log(`✅ Audio download completed: ${filePath}`);
        resolve({ 
          filePath, 
          title: info.videoDetails.title,
          duration: info.videoDetails.lengthSeconds
        });
      });

      writeStream.on('error', (error) => {
        console.error('❌ Audio write error:', error);
        deleteFile(filePath);
        reject(error);
      });

      audioStream.on('error', (error) => {
        console.error('❌ Audio stream error:', error);
        deleteFile(filePath);
        reject(error);
      });

      // Timeout after 10 minutes
      setTimeout(() => {
        if (!writeStream.closed) {
          reject(new Error('Audio download timeout'));
          audioStream.destroy();
          writeStream.destroy();
          deleteFile(filePath);
        }
      }, 10 * 60 * 1000);

    } catch (error) {
      console.error('❌ Download audio error:', error);
      reject(error);
    }
  });
}

// ============================================
// BOT COMMANDS - IMPROVED
// ============================================

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeMessage = `
🎬 *YouTube Downloader Bot Started!*

*Commands:*
📥 Send any YouTube link to download
/video - Download as video
/audio - Download as MP3
/stats - Your download stats
/help - Help guide

*Limits:* ${FREE_DAILY_LIMIT} downloads/day (free)
*Premium:* Unlimited downloads

*Quick Start:*
1. Send YouTube link
2. Choose format
3. Download your file!

🔗 ${REFERRAL_LINK}
  `;
  
  bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const helpMessage = `
📖 *Bot Help Guide*

*How to Download:*
1. Copy YouTube video URL
2. Send it to this bot
3. Choose video or audio
4. Wait for download

*Supported Links:*
• https://youtube.com/watch?v=...
• https://youtu.be/...
• YouTube shorts
• YouTube music

*File Limits:*
• Max 50MB per file (Telegram limit)
• Shorter videos work better

Need help? Contact support.
  `;
  
  bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/stats/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const remaining = getRemainingDownloads(userId);
  
  const statsMessage = `
📊 *Your Stats*

🆔 User: \`${userId}\`
📥 Remaining: *${remaining}*
${userDownloads[userId]?.premium ? '⭐ Premium: Active' : '💎 Premium: Inactive'}

Upgrade: /premium
  `;
  
  bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/video(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const url = match[1];

  if (!url) {
    bot.sendMessage(chatId, '❌ Please provide a YouTube URL:\n`/video https://youtube.com/watch?v=...`', { parse_mode: 'Markdown' });
    return;
  }

  if (!ytdl.validateURL(url)) {
    bot.sendMessage(chatId, '❌ Invalid YouTube URL');
    return;
  }

  if (!checkDownloadLimit(userId)) {
    bot.sendMessage(chatId, `⚠️ Daily limit reached (${FREE_DAILY_LIMIT}/day). Try tomorrow or /premium`);
    return;
  }

  // Show quality options
  const options = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🎥 High Quality', callback_data: `video_high_${Buffer.from(url).toString('base64')}` },
          { text: '🎥 Low Quality', callback_data: `video_low_${Buffer.from(url).toString('base64')}` }
        ]
      ]
    }
  };

  bot.sendMessage(chatId, '🎬 Choose video quality:', options);
});

bot.onText(/\/audio(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const url = match[1];

  if (!url) {
    bot.sendMessage(chatId, '❌ Please provide a YouTube URL:\n`/audio https://youtube.com/watch?v=...`', { parse_mode: 'Markdown' });
    return;
  }

  if (!ytdl.validateURL(url)) {
    bot.sendMessage(chatId, '❌ Invalid YouTube URL');
    return;
  }

  if (!checkDownloadLimit(userId)) {
    bot.sendMessage(chatId, `⚠️ Daily limit reached (${FREE_DAILY_LIMIT}/day). Try tomorrow or /premium`);
    return;
  }

  const options = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🎵 Download MP3', callback_data: `audio_${Buffer.from(url).toString('base64')}` }
        ]
      ]
    }
  };

  bot.sendMessage(chatId, '🎵 Download as MP3?', options);
});

// ============================================
// IMPROVED MESSAGE HANDLER
// ============================================

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  // Ignore commands and non-text messages
  if (!text || text.startsWith('/')) return;

  // Check for YouTube URL
  const youtubeRegex = /(https?:\/\/)?(www\.)?(youtube|youtu)\.(com|be)\/(watch\?v=|embed\/|v\/|shorts\/)?([a-zA-Z0-9_-]{11})/;
  const match = text.match(youtubeRegex);

  if (!match) {
    bot.sendMessage(chatId, '❌ Please send a valid YouTube URL');
    return;
  }

  const videoUrl = text.trim();

  if (!ytdl.validateURL(videoUrl)) {
    bot.sendMessage(chatId, '❌ Invalid YouTube URL format');
    return;
  }

  if (!checkDownloadLimit(userId)) {
    bot.sendMessage(chatId, `⚠️ Daily limit reached (${FREE_DAILY_LIMIT}/day). Try tomorrow or /premium`);
    return;
  }

  // Show download options
  const options = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🎥 Video (High)', callback_data: `video_high_${Buffer.from(videoUrl).toString('base64')}` },
          { text: '🎥 Video (Low)', callback_data: `video_low_${Buffer.from(videoUrl).toString('base64')}` }
        ],
        [
          { text: '🎵 Audio (MP3)', callback_data: `audio_${Buffer.from(videoUrl).toString('base64')}` }
        ],
        [
          { text: '📊 Video Info', callback_data: `info_${Buffer.from(videoUrl).toString('base64')}` }
        ]
      ]
    }
  };

  bot.sendMessage(chatId, '🎬 Choose download option:', options);
});

// ============================================
// IMPROVED CALLBACK HANDLER
// ============================================

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;

  try {
    await bot.answerCallbackQuery(query.id);

    // Parse callback data
    const parts = data.split('_');
    const action = parts[0];
    const quality = parts[1];
    const encodedUrl = parts.slice(2).join('_');
    
    const videoUrl = Buffer.from(encodedUrl, 'base64').toString();

    console.log(`🔄 Processing: ${action} ${quality} for ${videoUrl}`);

    // Handle info request
    if (action === 'info') {
      const infoMsg = await bot.sendMessage(chatId, '📊 Fetching video info...');
      
      try {
        const info = await ytdl.getInfo(videoUrl);
        const duration = Math.floor(info.videoDetails.lengthSeconds / 60) + ':' + 
                        (info.videoDetails.lengthSeconds % 60).toString().padStart(2, '0');
        
        const infoMessage = `
📹 *Video Info*

*Title:* ${info.videoDetails.title}
*Channel:* ${info.videoDetails.author.name}
*Duration:* ${duration}
*Views:* ${parseInt(info.videoDetails.viewCount).toLocaleString()}
        `;
        
        await bot.editMessageText(infoMessage, {
          chat_id: chatId,
          message_id: infoMsg.message_id,
          parse_mode: 'Markdown'
        });
      } catch (error) {
        await bot.editMessageText('❌ Error fetching video info', {
          chat_id: chatId,
          message_id: infoMsg.message_id
        });
      }
      return;
    }

    // Check download limit
    if (!checkDownloadLimit(userId)) {
      await bot.sendMessage(chatId, '⚠️ Daily download limit reached');
      return;
    }

    let processingMsg;
    let filePath;

    try {
      processingMsg = await bot.sendMessage(chatId, '⏳ Starting download...');

      if (action === 'video') {
        await bot.editMessageText('📥 Downloading video... (This may take a while)', {
          chat_id: chatId,
          message_id: processingMsg.message_id
        });

        const result = await downloadVideo(videoUrl, quality);
        filePath = result.filePath;

        const stats = fs.statSync(filePath);
        const fileSize = stats.size;

        // Check file size limit
        if (fileSize > 45 * 1024 * 1024) {
          deleteFile(filePath);
          await bot.editMessageText('❌ File too large (>45MB). Try audio or lower quality.', {
            chat_id: chatId,
            message_id: processingMsg.message_id
          });
          return;
        }

        await bot.editMessageText('📤 Uploading to Telegram...', {
          chat_id: chatId,
          message_id: processingMsg.message_id
        });

        // Send video
        await bot.sendVideo(chatId, filePath, {
          caption: `🎬 ${result.title}\n📦 ${formatBytes(fileSize)} | ${result.quality}`,
          parse_mode: 'Markdown'
        });

      } else if (action === 'audio') {
        await bot.editMessageText('🎵 Downloading audio...', {
          chat_id: chatId,
          message_id: processingMsg.message_id
        });

        const result = await downloadAudio(videoUrl);
        filePath = result.filePath;

        const stats = fs.statSync(filePath);
        const fileSize = stats.size;

        if (fileSize > 45 * 1024 * 1024) {
          deleteFile(filePath);
          await bot.editMessageText('❌ Audio file too large (>45MB)', {
            chat_id: chatId,
            message_id: processingMsg.message_id
          });
          return;
        }

        await bot.editMessageText('📤 Uploading audio...', {
          chat_id: chatId,
          message_id: processingMsg.message_id
        });

        // Send audio
        await bot.sendAudio(chatId, filePath, {
          caption: `🎵 ${result.title}\n📦 ${formatBytes(fileSize)}`,
          title: result.title,
          parse_mode: 'Markdown'
        });
      }

      // Clean up
      await bot.deleteMessage(chatId, processingMsg.message_id);
      incrementDownload(userId);

      const remaining = getRemainingDownloads(userId);
      await bot.sendMessage(chatId, `✅ Download complete!\n📊 Remaining: *${remaining}*`, { 
        parse_mode: 'Markdown' 
      });

      deleteFile(filePath);

    } catch (error) {
      console.error('❌ Download processing error:', error);
      
      if (processingMsg) {
        await bot.editMessageText(`❌ Download failed: ${error.message}`, {
          chat_id: chatId,
          message_id: processingMsg.message_id
        });
      }
      
      if (filePath) {
        deleteFile(filePath);
      }
    }

  } catch (error) {
    console.error('❌ Callback error:', error);
    await bot.sendMessage(chatId, '❌ Processing error occurred');
  }
});

// ============================================
// ERROR HANDLING
// ============================================

bot.on('polling_error', (error) => {
  console.error('🔴 Polling error:', error.message);
});

bot.on('webhook_error', (error) => {
  console.error('🔴 Webhook error:', error.message);
});

process.on('unhandledRejection', (error) => {
  console.error('🔴 Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('🔴 Uncaught exception:', error);
});

// ============================================
// START BOT
// ============================================

console.log('🤖 YouTube Downloader Bot Starting...');
console.log('📱 Bot is ready and waiting for messages...');
console.log('💡 Make sure you have stable internet connection');
