import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { initDatabase } from './db';
import { authRouter } from './routes/auth';
import { publicRouter } from './routes/public';
import { adminProvidersRouter } from './routes/adminProviders';
import { adminPlansRouter } from './routes/adminPlans';
import { adminOffersRouter } from './routes/adminOffers';
import { adminSubmissionsRouter } from './routes/adminSubmissions';
import { adminStatsRouter } from './routes/adminStats';
import { adminSettingsRouter } from './routes/adminSettings';
import { adminAuditRouter } from './routes/adminAudit';
import { adminUsersRouter } from './routes/adminUsers';
import { ordersRouter } from './routes/orders';
import { adminOrdersRouter } from './routes/adminOrders';
import { paymentClicksRouter } from './routes/paymentClicks';

// Initialize Database & Tables
initDatabase();

const app = express();
const PORT = process.env.PORT || 5001;

// Middlewares
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json());

// Public customer routes
app.use('/api', publicRouter);
app.use('/api', ordersRouter);
app.use('/api', paymentClicksRouter);

// Admin Auth routes
app.use('/api/admin', authRouter);
app.use('/api/auth', authRouter);

// Protected Admin routes
app.use('/api/admin/providers', adminProvidersRouter);
app.use('/api/admin/plans', adminPlansRouter);
app.use('/api/admin/offers', adminOffersRouter);
app.use('/api/admin/submissions', adminSubmissionsRouter);
app.use('/api/admin/stats', adminStatsRouter);
app.use('/api/admin/settings', adminSettingsRouter);
app.use('/api/admin/audit-logs', adminAuditRouter);
app.use('/api/admin/users', adminUsersRouter);
app.use('/api/admin/orders', adminOrdersRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler for unmatched API routes
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  res.status(404).send('Not Found');
});

// Central error handler (avoid leaking stack traces)
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[UNHANDLED_ERROR]', err);
  res.status(500).json({ error: 'Internal server error occurred.' });
});

app.listen(PORT, () => {
  console.log(`🚀 [PhonePe-Recharge Backend] Running on http://localhost:${PORT}`);
});
