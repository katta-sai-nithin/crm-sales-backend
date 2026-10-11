import mongoose from 'mongoose';
import config, { validateEnv } from '../config/env.js';
import logger from '../config/logger.js';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { User } from '../models/User.js';
import { AuthService } from '../services/auth.service.js';
import { ApiError } from '../utils/ApiError.js';
import { normalizeEmail } from '../utils/sanitize.js';

/**
 * Passwords that must never be accepted for a real administrator account.
 */
const BANNED_PASSWORDS = new Set([
  'password',
  'password123',
  'admin',
  'admin123',
  'administrator',
  'changeme',
  'letmein',
  '12345678',
  '123456789',
  'qwerty123',
  'crmadmin',
  'crmadmin123',
]);

/**
 * Create the very first ADMIN account.
 *
 * Credentials come exclusively from the INITIAL_ADMIN_* environment variables -
 * nothing is hardcoded. The password must satisfy a strict policy and must not be
 * one of the well known defaults. Re-running the script is safe: an existing
 * admin with the same email is reported and skipped.
 */
export async function bootstrapAdmin({ logger: log = logger } = {}) {
  const { adminName, adminEmail, adminPassword } = config.bootstrap;

  const missing = [];
  if (!adminName) missing.push('INITIAL_ADMIN_NAME');
  if (!adminEmail) missing.push('INITIAL_ADMIN_EMAIL');
  if (!adminPassword) missing.push('INITIAL_ADMIN_PASSWORD');

  if (missing.length) {
    throw new Error(
      `Cannot bootstrap the administrator: ${missing.join(', ')} ${
        missing.length === 1 ? 'is' : 'are'
      } not set. Add them to your .env file and run the command again.`
    );
  }

  const email = normalizeEmail(adminEmail);

  if (BANNED_PASSWORDS.has(adminPassword.toLowerCase())) {
    throw new Error(
      'Refusing to bootstrap with a well known / default password. Generate a strong unique password, ' +
        'for example: node -e "console.log(require(\'crypto\').randomBytes(18).toString(\'base64url\'))"'
    );
  }

  if (adminPassword.length < 12) {
    throw new Error('Refusing to bootstrap: INITIAL_ADMIN_PASSWORD must be at least 12 characters long');
  }

  try {
    AuthService.validatePasswordPolicy(adminPassword);
  } catch (error) {
    if (error instanceof ApiError) {
      throw new Error(`Refusing to bootstrap with a weak password. ${error.message}`);
    }
    throw error;
  }

  const existingAdmin = await User.findOne({ email });
  if (existingAdmin) {
    if (existingAdmin.role !== 'ADMIN') {
      throw new Error(
        `A non-admin account already uses ${email}. Choose a different INITIAL_ADMIN_EMAIL.`
      );
    }
    log.info(`Administrator ${email} already exists - nothing to do.`);
    return { created: false, user: existingAdmin };
  }

  const passwordHash = await User.hashPassword(adminPassword);
  const admin = await User.create({
    name: adminName,
    email,
    phone: '',
    passwordHash,
    role: 'ADMIN',
    isActive: true,
  });

  log.info(`Administrator created: ${admin.email}`);
  return { created: true, user: admin };
}

/**
 * CLI entry point.
 */
async function main() {
  validateEnv();
  await connectDatabase();
  try {
    const { created, user } = await bootstrapAdmin();
    process.stdout.write(
      `${created ? 'Administrator created' : 'Administrator already present'}: ${user.email} (id=${user._id})\n`
    );
  } finally {
    await disconnectDatabase();
    await mongoose.connection.close().catch(() => {});
  }
}

const invokedDirectly = process.argv[1] && process.argv[1].includes('bootstrapAdmin');
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`\nBootstrap failed: ${error.message}\n\n`);
    process.exit(1);
  });
}