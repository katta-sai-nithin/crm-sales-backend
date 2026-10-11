import logger from '../config/logger.js';
import { activityService } from '../services/activity.service.js';
import config from '../config/env.js';

/**
 * Scheduled maintenance job.
 *
 * Important: overdue activity *reporting* is computed in the query layer
 * (`buildStatusFilter`), so the dashboard and list endpoints are always correct
 * even if this job never runs. The job only persists the derived OVERDUE flag so
 * that ad-hoc queries and BI tools that read `activities.status` directly stay
 * accurate.
 */
export function startOverdueActivityJob() {
  const run = async () => {
    try {
      const updated = await activityService.markOverdueActivities();
      if (updated > 0) logger.info({ updated }, 'Marked pending activities as overdue');
    } catch (error) {
      logger.error({ err: error }, 'Overdue activity job failed');
    }
  };

  const timer = setInterval(run, config.jobs.overdueIntervalMs);
  timer.unref();
  logger.info(
    { intervalMs: config.jobs.overdueIntervalMs },
    'Overdue activity job scheduled'
  );

  return () => clearInterval(timer);
}

/**
 * Run every registered job once, then schedule the recurring ones.
 */
export function startJobs() {
  const stoppers = [startOverdueActivityJob()];
  return () => stoppers.forEach((stop) => stop());
}

export function stopJobs() {
  logger.info('Background jobs stopped');
}