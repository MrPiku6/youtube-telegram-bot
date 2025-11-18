const TelegramBot = require('node-telegram-bot-api');
const ytdl = require('ytdl-core');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const ffmpeg = require('ffmpeg-static');

// ============================================
// CONFIGURATION - INSERT YOUR BOT TOKEN HERE
// ============================================
const BOT_TOKEN = 'YOUR_TELEGRAM_BOT_TOKEN_HERE';

// Optional: Download limits for free users (set to 0 for unlimited)
const FREE_DAILY_LIMIT = 5;

// Optional: Your referral/affiliate links for monetization
const REFERRAL_LINK = 'https://your-affiliate-link.com';
const DONATE_LINK = 'https://your-donation-link.com';

// ============================================
// INITIALIZE BOT
// ============================================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// In-memory storage for user download counts (resets on bot restart)
// For persistent storage, use a database like SQLite or MongoDB
const userDownloads = {};

// ============================================
// HELPER FUNCTIONS
// ============================================

// Reset daily download counts at midnight
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
    resetDailyLimits(); // Schedule next reset
  }, msToMidnight);
}

// Initialize daily reset
resetDailyLimits();

// Check if user has reached download limit
function checkDownloadLimit(userId) {
  if (FREE_DAILY_LIMIT === 0) return true; // Unlimited
  
  if (!userDownloads[userId]) {
    userDownloads[userId] = { count: 0, premium: false };
  }
  
  if (userDownloads[userId].premium) return true; // Premium users unlimited
  
  return userDownloads[userId].count < FREE_DAILY_LIMIT;
}

// Increment download count
function incrementDownload(userId) {
  if (!userDownloads[userId]) {
    userDownloads[userId] = { count: 0, premium: false };
  }
  userDownloads[userId].count++;
}

// Get remaining downloads
function getRemainingDownloads(userId) {
  if (FREE_DAILY_LIMIT === 0) return 'Unlimited';
  if (!userDownloads[userId]) return FREE_DAILY_LIMIT;
  if (userDownloads[userId].premium) return 'Unlimited (Premium)';
  return FREE_DAILY_LIMIT - userDownloads[userId].count;
}

// Sanitize filename
function sanitizeFilename(filename) {
  return filename.replace(/[^a-zA-Z0-9_\-]/gi, '_').substring(0, 100);
}

// Format file size
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Delete file safely
function deleteFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Deleted: ${filePath}`);
    }
  } catch (error) {
    console.error(`Error deleting file: ${error.message}`);
  }
}

// ============================================
// DOWNLOAD FUNCTIONS
// ============================================

async function downloadVideo(url, quality = 'highest') {
  try {
    const info = await ytdl.getInfo(url);
    const title = sanitizeFilename(info.videoDetails.title);
    
    // Paths for temporary files
    const audioPath = path.join(__dirname, `${title}_audio.mp4`);
    const videoPath = path.join(__dirname, `${title}_video.mp4`);
    const outputPath = path.join(__dirname, `${title}.mp4`);

    // Download audio and video streams separately
    const audioStream = ytdl(url, { quality: 'highestaudio' });
    const videoStream = ytdl(url, { quality: quality === 'highest' ? 'highestvideo' : 'lowestvideo' });

    const downloadAudio = new Promise((resolve, reject) => {
      audioStream.pipe(fs.createWriteStream(audioPath))
        .on('finish', resolve)
        .on('error', reject);
    });

    const downloadVideo = new Promise((resolve, reject) => {
      videoStream.pipe(fs.createWriteStream(videoPath))
        .on('finish', resolve)
        .on('error', reject);
    });

    await Promise.all([downloadAudio, downloadVideo]);

    // Combine audio and video with ffmpeg
    const ffmpegCommand = `${ffmpeg} -i "${videoPath}" -i "${audioPath}" -c:v copy -c:a aac "${outputPath}"`;
    await execPromise(ffmpegCommand);

    // Clean up temporary files
    deleteFile(audioPath);
    deleteFile(videoPath);
    
    return { filePath: outputPath, title: info.videoDetails.title, info };

  } catch (error) {
    console.error(error); // Log the full error
    throw new Error('Could not process video. It might be private or region-locked.');
  }
}


async function downloadAudio(url) {
  try {
    const info = await ytdl.getInfo(url);
    const title = sanitizeFilename(info.videoDetails.title);
    const filename = `${title}_${Date.now()}.mp3`;
    const filePath = path.join(__dirname, filename);
    
    return new Promise((resolve, reject) => {
      const audioStream = ytdl(url, {
        quality: 'highestaudio',
        filter: 'audioonly'
      });
      
      const writeStream = fs.createWriteStream(filePath);
      
      audioStream.pipe(writeStream);
      
      audioStream.on('error', (error) => {
        deleteFile(filePath);
        reject(error);
      });
      
      writeStream.on('finish', () => {
        resolve({ filePath, title: info.videoDetails.title, info });
      });
      
      writeStream.on('error', (error) => {
        deleteFile(filePath);
        reject(error);
      });
    });
  } catch (error) {
    throw error;
  }
}

// ============================================
// BOT COMMANDS (Your existing code is fine)
// ============================================

// /start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeMessage = `
🎬 *Welcome to YouTube Downloader Bot!*

Send me any YouTube link and I'll download it for you!

*Available Commands:*
/video - Download video
/audio - Download audio only
/quality - Choose video quality
/stats - Check your download stats
/help - Show help message
/premium - Upgrade to premium (unlimited downloads)

*How to use:*
1️⃣ Send me a YouTube link
2️⃣ Choose video or audio
3️⃣ Wait for download
4️⃣ Enjoy your content!

*Free users:* ${FREE_DAILY_LIMIT === 0 ? 'Unlimited' : FREE_DAILY_LIMIT} downloads per day
*Premium users:* Unlimited downloads + High quality

💡 Support us: ${DONATE_LINK}
  `;
  
  bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

// /help command
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const helpMessage = `
📖 *How to Use This Bot*

*Quick Download:*
Just send any YouTube link and follow the buttons!

*Commands:*
/video [link] - Download video
/audio [link] - Download audio only
/quality - Set preferred quality
/stats - Your download statistics
/premium - Upgrade to premium

*Examples:*
\`/video https://youtube.com/watch?v=xxxxx\`
\`/audio https://youtu.be/xxxxx\`

*Tips:*
• Shorter videos download faster
• Audio files are smaller than videos
• Premium users get priority processing

Need help? Contact: @YourSupportUsername
  `;
  
  bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

// /stats command
bot.onText(/\/stats/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const remaining = getRemainingDownloads(userId);
  
  const statsMessage = `
📊 *Your Download Statistics*

👤 User ID: \`${userId}\`
📥 Remaining downloads today: *${remaining}*
${userDownloads[userId]?.premium ? '⭐ Premium Status: Active' : '🆓 Free User'}

Want unlimited downloads? Use /premium
  `;
  
  bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
});

// /premium command (monetization)
bot.onText(/\/premium/, (msg) => {
  const chatId = msg.chat.id;
  const premiumMessage = `
⭐ *Upgrade to Premium*

*Premium Benefits:*
✅ Unlimited downloads
✅ Highest quality videos
✅ Priority processing
✅ No ads
✅ Faster downloads

*Pricing:*
💵 $4.99/month or $39.99/year

Support our development: ${DONATE_LINK}

After payment, send receipt to: @YourSupportUsername
  `;
  
  bot.sendMessage(chatId, premiumMessage, { parse_mode: 'Markdown' });
});

// ============================================
// MAIN MESSAGE HANDLER
// ============================================

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  
  // Ignore commands and non-text messages
  if (!text || text.startsWith('/')) return;
  
  // Check if message contains YouTube link
  const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?([a-zA-Z0-9_-]{11})/;
  const match = text.match(youtubeRegex);
  
  if (!match) {
    bot.sendMessage(chatId, '❌ Please send a valid YouTube link.\n\nExample: https://youtube.com/watch?v=xxxxx');
    return;
  }
  
  const videoUrl = text.trim();
  
  // Validate YouTube URL with a try-catch block for more robustness
  try {
    if (!ytdl.validateURL(videoUrl)) {
      bot.sendMessage(chatId, '❌ Invalid YouTube URL. Please send a valid link.');
      return;
    }
  } catch (e) {
      bot.sendMessage(chatId, '❌ Could not validate the YouTube URL.');
      return;
  }
  
  
  // Check download limit
  if (!checkDownloadLimit(userId)) {
    const limitMessage = `
⚠️ *Daily Download Limit Reached*

You've reached your daily limit of ${FREE_DAILY_LIMIT} downloads.

*Options:*
1️⃣ Wait until tomorrow for free downloads
2️⃣ Upgrade to Premium for unlimited downloads (/premium)

💡 Share with friends: ${REFERRAL_LINK}
    `;
    bot.sendMessage(chatId, limitMessage, { parse_mode: 'Markdown' });
    return;
  }
  
  // Show download options
  const options = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🎥 Video (High)', callback_data: `video_highest_${videoUrl}` },
          { text: '🎥 Video (Low)', callback_data: `video_lowest_${videoUrl}` }
        ],
        [
          { text: '🎵 Audio (MP3)', callback_data: `audio_na_${videoUrl}` }
        ],
        [
          { text: '📊 Video Info', callback_data: `info_na_${videoUrl}` }
        ]
      ]
    }
  };
  
  bot.sendMessage(chatId, '🎬 Choose download option:', options);
});

// ============================================
// CALLBACK QUERY HANDLER
// ============================================

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;
  const messageId = query.message.message_id;
  
  // Parse callback data: action_quality_url
  const [action, quality, ...urlParts] = data.split('_');
  const videoUrl = urlParts.join('_');
  
  // Answer callback query to remove loading state
  bot.answerCallbackQuery(query.id);
  
  // Edit the message to show the user what's happening
  bot.editMessageText('Please wait...', { chat_id: chatId, message_id: messageId });

  
  // Handle info request
  if (action === 'info') {
    try {
      const infoMsg = await bot.sendMessage(chatId, '⏳ Fetching video information...');
      const info = await ytdl.getInfo(videoUrl);
      
      const infoMessage = `
📹 *Video Information*

*Title:* ${info.videoDetails.title}
*Channel:* ${info.videoDetails.author.name}
*Duration:* ${new Date(info.videoDetails.lengthSeconds * 1000).toISOString().substr(11, 8)}
*Views:* ${parseInt(info.videoDetails.viewCount).toLocaleString()}
*Upload Date:* ${info.videoDetails.uploadDate}
      `;
      
      bot.deleteMessage(chatId, infoMsg.message_id);
      bot.sendMessage(chatId, infoMessage, { parse_mode: 'Markdown' });
    } catch (error) {
      bot.sendMessage(chatId, '❌ Error fetching video info: ' + error.message);
    }
    return;
  }
  
  // Check download limit again
  if (!checkDownloadLimit(userId)) {
    bot.sendMessage(chatId, '⚠️ Daily download limit reached. Try again tomorrow or upgrade to premium! (/premium)');
    return;
  }
  
  let processingMsg;
  let filePath;
  
  try {
    // Send processing message
    processingMsg = await bot.sendMessage(chatId, '⏳ Processing your request... This may take a moment.');
    
    let result;
    
    if (action === 'video') {
      await bot.editMessageText('📥 Downloading video... Please be patient.', {
        chat_id: chatId,
        message_id: processingMsg.message_id
      });
      
      result = await downloadVideo(videoUrl, quality);
      filePath = result.filePath;
      
      const fileSize = fs.statSync(filePath).size;
      
      // Telegram has 50MB limit for bots
      if (fileSize > 50 * 1024 * 1024) {
        deleteFile(filePath);
        await bot.editMessageText('❌ File is too large! Telegram limits bot uploads to 50MB.\n\nTry:\n• The audio-only option\n• A lower quality video', {
          chat_id: chatId,
          message_id: processingMsg.message_id
        });
        return;
      }
      
      await bot.editMessageText('📤 Uploading video...', {
        chat_id: chatId,
        message_id: processingMsg.message_id
      });
      
      await bot.sendVideo(chatId, filePath, {
        caption: `🎬 *${result.title}*\n\n📦 Size: ${formatBytes(fileSize)}\n\n💡 Like this bot? ${REFERRAL_LINK}`,
        parse_mode: 'Markdown'
      });
      
    } else if (action === 'audio') {
      await bot.editMessageText('🎵 Downloading audio... Please wait.', {
        chat_id: chatId,
        message_id: processingMsg.message_id
      });
      
      result = await downloadAudio(videoUrl);
      filePath = result.filePath;
      
      const fileSize = fs.statSync(filePath).size;
      
      if (fileSize > 50 * 1024 * 1024) {
        deleteFile(filePath);
        await bot.editMessageText('❌ Audio file is too large (>50MB). Try a shorter video.', {
          chat_id: chatId,
          message_id: processingMsg.message_id
        });
        return;
      }
      
      await bot.editMessageText('📤 Uploading audio...', {
        chat_id: chatId,
        message_id: processingMsg.message_id
      });
      
      await bot.sendAudio(chatId, filePath, {
        caption: `🎵 *${result.title}*\n\n📦 Size: ${formatBytes(fileSize)}\n\n💡 Support us: ${DONATE_LINK}`,
        parse_mode: 'Markdown'
      });
    }
    
    // Delete processing message
    await bot.deleteMessage(chatId, processingMsg.message_id);
    
    // Increment download count
    incrementDownload(userId);
    
    // Show remaining downloads
    const remaining = getRemainingDownloads(userId);
    await bot.sendMessage(chatId, `✅ Download complete!\n📊 Remaining downloads today: *${remaining}*`, { parse_mode: 'Markdown' });
    
  } catch (error) {
    console.error('Download error:', error);
    
    if (processingMsg) {
      await bot.editMessageText(`❌ Download failed: ${error.message}\n\nPlease try a different video or contact support.`, {
        chat_id: chatId,
        message_id: processingMsg.message_id
      });
    } else {
      bot.sendMessage(chatId, `❌ An unexpected error occurred: ${error.message}`);
    }
    
  } finally {
      // Clean up file if it exists
      if (filePath) {
        deleteFile(filePath);
      }
  }
});

// ============================================
// ERROR HANDLING
// ============================================

bot.on('polling_error', (error) => {
  console.error(`Polling error: ${error.code} - ${error.message}`);
});

process.on('unhandledRejection', (error, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', error);
});


// ============================================
// START BOT
// ============================================

console.log('🤖 YouTube Downloader Bot is running...');
console.log('📱 Waiting for messages...');
