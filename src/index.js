require('dotenv').config();
const app = require('./app');
const { restoreSessions } = require('./services/whatsappService');

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Panju Intext API listening on http://localhost:${PORT}`);
  // Re-attach WhatsApp sessions that were logged in before this (re)start —
  // without this, every restart silently kills "Connected" sessions.
  try {
    restoreSessions();
  } catch (err) {
    console.error('WhatsApp session restore failed:', err.message);
  }
});
