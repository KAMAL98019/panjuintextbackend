const fs = require('fs');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const prisma = require('../config/db');

// One WhatsApp Web session per purpose, each logged into its own phone number:
// 'CustomerDocs' sends quotations/bills to the owner (and sometimes the customer);
// 'Greetings' sends festival broadcasts. Connection handling ported from the battle-tested
// A2 Insurance service: transient-error suppression, categorized retries, auto-reconnect.
const clients = {};
const reconnectTimers = {};
const AUTH_DIR = path.join(process.cwd(), '.wwebjs_auth');
const PURPOSES = ['CustomerDocs', 'Greetings'];

// whatsapp-web.js on Windows regularly throws EBUSY (session file locks) and
// "Execution context was destroyed" (WhatsApp Web navigating internally) as unhandled
// rejections — without this they take the whole server down.
let rejectionHandlerInstalled = false;
function installRejectionHandler() {
  if (rejectionHandlerInstalled) return;
  rejectionHandlerInstalled = true;
  process.on('unhandledRejection', (reason) => {
    const msg = reason?.message ?? String(reason);
    if (
      msg.includes('EBUSY') ||
      msg.includes('resource busy or locked') ||
      msg.includes('Execution context was destroyed') ||
      msg.includes('Protocol error (Runtime') ||
      msg.includes('Target closed') ||
      msg.includes('Session closed')
    ) {
      console.warn(`WhatsApp transient error suppressed: ${msg.split('\n')[0]}`);
      return;
    }
    console.error('Unhandled rejection:', reason);
  });
}

async function persistStatus(purpose, data) {
  try {
    await prisma.whatsappSession.upsert({
      where: { purpose },
      create: { purpose, ...data },
      update: data,
    });
  } catch (err) {
    console.error(`WhatsApp status persist failed (${purpose}): ${err.message}`);
  }
}

function scheduleReconnect(purpose, delayMs) {
  if (reconnectTimers[purpose]) return; // already scheduled
  reconnectTimers[purpose] = setTimeout(async () => {
    reconnectTimers[purpose] = null;
    console.log(`WhatsApp ${purpose}: reconnecting...`);
    const old = clients[purpose];
    delete clients[purpose];
    if (old) await old.destroy().catch(() => {});
    ensureClient(purpose);
  }, delayMs);
}

function buildClient(purpose) {
  installRejectionHandler();

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: purpose, dataPath: AUTH_DIR }),
    puppeteer: {
      headless: true,
      ...(process.env.PUPPETEER_EXECUTABLE_PATH && { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ],
    },
  });
  client.__ready = false;
  client.__qrNotifyCount = 0;

  client.on('qr', async (qr) => {
    // WhatsApp regenerates the QR every ~30s until scanned; keep the latest one
    const qrDataUrl = await qrcode.toDataURL(qr, { width: 280, margin: 2 });
    client.__qrNotifyCount++;
    await persistStatus(purpose, { status: 'QrPending', qrDataUrl, connectedNumber: null });
  });

  client.on('authenticated', () => {
    console.log(`WhatsApp ${purpose}: authenticated — session saved, no QR needed next restart`);
  });

  client.on('ready', async () => {
    client.__ready = true;
    client.__qrNotifyCount = 0;
    const number = client.info?.wid?.user || null;
    console.log(`WhatsApp ${purpose}: ready ✓ (${number})`);
    await persistStatus(purpose, { status: 'Connected', qrDataUrl: null, connectedNumber: number });
  });

  client.on('auth_failure', async (msg) => {
    client.__ready = false;
    console.error(`WhatsApp ${purpose}: auth failure — ${msg}`);
    await persistStatus(purpose, { status: 'Disconnected', qrDataUrl: null, connectedNumber: null });
    scheduleReconnect(purpose, 10_000);
  });

  client.on('disconnected', async (reason) => {
    client.__ready = false;
    console.warn(`WhatsApp ${purpose}: disconnected (${reason}) — auto-reconnecting in 10s`);
    await persistStatus(purpose, { status: 'Disconnected', qrDataUrl: null, connectedNumber: null });
    scheduleReconnect(purpose, 10_000);
  });

  client.initialize().catch((err) => {
    if (client.__ready) return; // ready fired before the exception bubbled — we're good
    const msg = err?.message ?? String(err);
    if (msg.includes('EBUSY') || msg.includes('resource busy')) {
      console.warn(`WhatsApp ${purpose}: init blocked by file lock — retrying in 8s`);
      scheduleReconnect(purpose, 8_000);
    } else if (msg.includes('Execution context was destroyed') || msg.includes('Protocol error (Runtime')) {
      console.warn(`WhatsApp ${purpose}: page reloaded during startup (transient) — retrying in 6s`);
      scheduleReconnect(purpose, 6_000);
    } else if (msg.includes('Could not find Chrome') || msg.includes('Failed to launch') || msg.includes('Browser was not found')) {
      console.warn(`WhatsApp ${purpose}: disabled — Chrome not available on this machine`);
      persistStatus(purpose, { status: 'Disconnected', qrDataUrl: null, connectedNumber: null });
    } else {
      console.error(`WhatsApp ${purpose}: init error — ${msg}`);
      scheduleReconnect(purpose, 15_000);
    }
  });

  return client;
}

/** Starts (or returns the existing) session for a purpose. Idempotent — safe to call repeatedly. */
function ensureClient(purpose) {
  if (!clients[purpose]) clients[purpose] = buildClient(purpose);
  return clients[purpose];
}

/**
 * Re-starts sessions that were logged in before the server restarted — LocalAuth keeps the
 * login on disk, but the live connection only exists in memory.
 */
function restoreSessions() {
  PURPOSES.forEach((purpose) => {
    const sessionDir = path.join(AUTH_DIR, `session-${purpose}`);
    if (fs.existsSync(sessionDir)) ensureClient(purpose);
  });
}

/** Force a fresh QR: tear the session's browser down and start over. */
async function refreshQR(purpose) {
  const client = clients[purpose];
  delete clients[purpose];
  await persistStatus(purpose, { status: 'QrPending', qrDataUrl: null, connectedNumber: null });
  if (client) await client.destroy().catch(() => {});
  ensureClient(purpose);
}

async function getStatus(purpose) {
  const row = await prisma.whatsappSession.findUnique({ where: { purpose } });
  if (!row) return { purpose, status: 'Disconnected', qrDataUrl: null, connectedNumber: null };

  // Self-heal: DB says Connected/QrPending but no live client (e.g. after a restart) — restart it.
  if (row.status !== 'Disconnected' && !clients[purpose]) {
    ensureClient(purpose);
    return { ...row, status: 'Connecting', qrDataUrl: null };
  }
  // Live client exists but hasn't finished starting up yet
  if (row.status === 'Connected' && clients[purpose] && !clients[purpose].__ready) {
    return { ...row, status: 'Connecting' };
  }

  // Auto-refresh stale QR code if it hasn't updated in 45 seconds (WhatsApp QR expires every ~20-30s)
  if (row.status === 'QrPending' && row.qrDataUrl && Date.now() - new Date(row.updatedAt).getTime() > 45_000) {
    console.log(`WhatsApp ${purpose}: QR code stale (not updated for >45s). Triggering auto-refresh...`);
    refreshQR(purpose).catch((err) => console.error(`WhatsApp ${purpose} auto-refresh error:`, err));
    return { ...row, status: 'QrPending', qrDataUrl: null };
  }

  return row;
}

async function logout(purpose) {
  if (reconnectTimers[purpose]) {
    clearTimeout(reconnectTimers[purpose]);
    reconnectTimers[purpose] = null;
  }
  const client = clients[purpose];
  if (client) {
    try { await client.logout(); } catch { /* session may already be dead */ }
    try { await client.destroy(); } catch { /* ignore */ }
    delete clients[purpose];
  }
  await persistStatus(purpose, { status: 'Disconnected', qrDataUrl: null, connectedNumber: null });
}

function toChatId(mobile) {
  let digits = String(mobile).replace(/\D/g, '').replace(/^0+/, '');
  if (digits.length === 10) digits = `91${digits}`;
  return `${digits}@c.us`;
}

function requireReadyClient(purpose) {
  const client = clients[purpose];
  if (!client) {
    throw new Error(`WhatsApp "${purpose}" session is not connected — open the WhatsApp page and connect it first`);
  }
  if (!client.__ready) {
    throw new Error(`WhatsApp "${purpose}" session is still connecting — wait until it shows Connected, then retry`);
  }
  return client;
}

async function sendDocument(purpose, toNumber, buffer, filename, caption) {
  const client = requireReadyClient(purpose);
  const media = new MessageMedia('application/pdf', buffer.toString('base64'), filename);
  return client.sendMessage(toChatId(toNumber), media, { caption });
}

async function sendText(purpose, toNumber, text) {
  const client = requireReadyClient(purpose);
  return client.sendMessage(toChatId(toNumber), text);
}

let queueTimeout = null;

async function processQueue() {
  try {
    const nextItem = await prisma.whatsappQueueItem.findFirst({
      where: {
        status: 'Pending',
        scheduledAt: { lte: new Date() }
      },
      orderBy: { id: 'asc' }
    });

    if (nextItem) {
      await prisma.whatsappQueueItem.update({
        where: { id: nextItem.id },
        data: { status: 'Processing' }
      });

      console.log(`WhatsApp Queue: processing item ${nextItem.id} to ${nextItem.toNumber}...`);

      try {
        if (nextItem.message) {
          await sendText(nextItem.purpose, nextItem.toNumber, nextItem.message);
        } else if (nextItem.documentType) {
          let quotation = null;
          if (nextItem.quotationId) {
            const quotationRepository = require('../repositories/quotation.repository');
            quotation = await quotationRepository.findById(nextItem.quotationId);
          }
          const billController = require('../controllers/bill.controller');
          const { buffer, filename } = await billController.renderDocumentBuffer({
            documentType: nextItem.documentType,
            quotation,
            billId: nextItem.billId
          });
          const caption = `${nextItem.documentType} for Customer`;
          await sendDocument(nextItem.purpose, nextItem.toNumber, buffer, filename, caption);
        }

        await prisma.whatsappQueueItem.update({
          where: { id: nextItem.id },
          data: { status: 'Sent' }
        });

        const whatsappRepository = require('../repositories/whatsapp.repository');
        await whatsappRepository.logMessage({
          purpose: nextItem.purpose,
          quotationId: nextItem.quotationId,
          customerId: nextItem.customerId,
          toNumber: nextItem.toNumber,
          documentType: nextItem.documentType || null,
          status: 'Sent'
        });

        console.log(`WhatsApp Queue: item ${nextItem.id} sent successfully.`);
      } catch (err) {
        const attempts = nextItem.attempts + 1;
        const isFailed = attempts >= 3;
        const newStatus = isFailed ? 'Failed' : 'Pending';

        await prisma.whatsappQueueItem.update({
          where: { id: nextItem.id },
          data: {
            status: newStatus,
            attempts,
            error: err.message
          }
        });

        const whatsappRepository = require('../repositories/whatsapp.repository');
        await whatsappRepository.logMessage({
          purpose: nextItem.purpose,
          quotationId: nextItem.quotationId,
          customerId: nextItem.customerId,
          toNumber: nextItem.toNumber,
          documentType: nextItem.documentType || null,
          status: isFailed ? 'Failed' : 'Sent',
          error: err.message
        });

        console.error(`WhatsApp Queue: item ${nextItem.id} failed attempt ${attempts}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error('WhatsApp Queue processing error:', err);
  } finally {
    queueTimeout = setTimeout(processQueue, 2000);
  }
}

function startQueueWorker() {
  if (!queueTimeout) {
    console.log('WhatsApp Queue: starting background queue worker (2s interval)...');
    queueTimeout = setTimeout(processQueue, 2000);
  }
}

startQueueWorker();

module.exports = { ensureClient, restoreSessions, refreshQR, getStatus, logout, sendDocument, sendText, startQueueWorker };
