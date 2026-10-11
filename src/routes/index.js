import { Router } from 'express';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import leadRoutes from './lead.routes.js';
import customerRoutes from './customer.routes.js';
import dealRoutes from './deal.routes.js';
import activityRoutes, { timelineRouter } from './activity.routes.js';
import analyticsRoutes from './analytics.routes.js';
import healthRoutes from './health.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/leads', leadRoutes);
router.use('/customers', customerRoutes);
router.use('/deals', dealRoutes);
router.use('/activities', activityRoutes);
router.use('/timeline', timelineRouter);
router.use('/analytics', analyticsRoutes);

export default router;