/**
 * NutriTrack – Web Push Dispatcher Endpoint
 * Endpoint: POST /api/push-send
 * 
 * Sends standard W3C Web Push notifications directly to Apple APNs (iOS)
 * and Google FCM (Android) to display on the phone's Lock Screen even when
 * the browser/app is completely closed or swiped away.
 */
import webpush from 'web-push';

// VAPID Keys for NutriTrack
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BGFr_JXbzCgEXF6dkdwVRFy4XPvlU5RZ32ClDWWcnz1wfAwMgGLwuBQn5NvPAtG20SFRRP3kmo4IjGqbAiw4VzM';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'vPz2YCINuuXl_WGlGM8bIHUjuxXUSjtUdN_9GOASDMo';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support@nutritrack.app';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const { subscription, title, body, url, tag, delayMs } = req.body || {};

    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Missing push subscription object with endpoint.' });
    }

    const payload = JSON.stringify({
      title: title || 'NutriTrack 🥗',
      body: body || 'Pengingat nutrisi dan hidrasi harian untukmu.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      url: url || '/',
      tag: tag || ('nt_push_' + Date.now())
    });

    // Optional delay to give the user time to lock their phone screen
    if (delayMs && Number.isFinite(delayMs) && delayMs > 0) {
      const waitTime = Math.min(delayMs, 10000); // capped at 10 seconds for serverless timeout safety
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    const result = await webpush.sendNotification(subscription, payload, {
      TTL: 86400, // Time-to-live: 24 hours
      urgency: 'high'
    });

    return res.status(200).json({
      success: true,
      statusCode: result.statusCode,
      message: 'Push notification successfully dispatched to phone lock screen!'
    });
  } catch (error) {
    console.error('[WebPush Error]:', error);

    // If subscription has expired or unsubscribed
    if (error.statusCode === 404 || error.statusCode === 410) {
      return res.status(error.statusCode).json({
        error: 'Subscription expired or unsubscribed by device.',
        expired: true
      });
    }

    return res.status(500).json({
      error: 'Failed to dispatch push notification: ' + (error.message || String(error))
    });
  }
}
