import { env } from './env.js';
import { logger } from './logger.js';
export async function sendTelegramMessage(text) {
    const token = env.TELEGRAM_BOT_TOKEN;
    const chatId = env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
        logger.warn('Telegram not configured — skipping admin notification');
        return;
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    const json = await res.json();
    if (!json.ok) {
        logger.error('Telegram send failed', { description: json.description });
    }
    else {
        logger.info('Telegram admin notification sent');
    }
}
