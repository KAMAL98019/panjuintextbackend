const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');

const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth.routes');
const customerRoutes = require('./routes/customer.routes');
const productRoutes = require('./routes/product.routes');
const quotationRoutes = require('./routes/quotation.routes');
const orderRoutes = require('./routes/order.routes');
const billRoutes = require('./routes/bill.routes');
const settingsRoutes = require('./routes/settings.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const notificationRoutes = require('./routes/notification.routes');
const whatsappRoutes = require('./routes/whatsapp.routes');
const searchRoutes = require('./routes/search.routes');

const app = express();

// Allow the configured client, local dev (including the CRA proxy, which rewrites Origin to the
// target http://localhost:5000/), and ngrok demo tunnels. Unknown origins are not errors — they
// simply get no CORS headers, so the browser blocks them without breaking the request pipeline.
const allowedOrigin = (origin, callback) => {
  const ok =
    !origin ||
    origin === (process.env.CLIENT_URL || 'http://localhost:3000') ||
    /^http:\/\/localhost:(3000|5000)\/?$/.test(origin) ||
    /^https:\/\/[a-z0-9-]+\.ngrok(-free)?\.app$/.test(origin);
  callback(null, ok);
};
app.use(cors({ origin: allowedOrigin }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/api/health', (req, res) => res.json({ success: true, message: 'Panju Intext API is running' }));

app.use('/api/auth', authRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/products', productRoutes);
app.use('/api/quotations', quotationRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/bills', billRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/search', searchRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
