import mongoose from 'mongoose';
import crypto from 'node:crypto';
import config, { validateEnv } from '../config/env.js';
import logger from '../config/logger.js';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { User, Team } from '../models/User.js';
import { Lead } from '../models/Lead.js';
import { Customer } from '../models/Customer.js';
import { Deal } from '../models/Deal.js';
import { Activity } from '../models/Activity.js';
import { Timeline } from '../models/Timeline.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { LEAD_SOURCES, LEAD_STATUSES, LEAD_PRIORITIES } from '../constants/lead.js';
import { CUSTOMER_STATUSES, CUSTOMER_ORIGINS } from '../constants/customer.js';
import { DEAL_STAGES } from '../constants/deal.js';
import { ACTIVITY_TYPES } from '../constants/activity.js';
import { ROLES } from '../constants/roles.js';
import { calculateExpectedRevenue, roundMoney } from '../utils/money.js';
import { convertLead } from '../services/conversion.service.js';
import { bootstrapAdmin } from './bootstrapAdmin.js';

/**
 * Demo user credentials.
 *
 * IMPORTANT: these are development-only demo accounts. Their passwords are
 * generated at seed time and printed to the console - nothing is hardcoded in
 * this file - and the whole seed script refuses to run when NODE_ENV=production
 * unless SEED_FORCE is explicitly set.
 */
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD || null;

const DEMO_USERS = [
  { key: 'admin', name: 'Ada Admin', email: 'admin@demo.crm', role: ROLES.ADMIN },
  { key: 'manager', name: 'Miles Manager', email: 'manager@demo.crm', role: ROLES.SALES_MANAGER },
  { key: 'execA', name: 'Eve Executive', email: 'eve@demo.crm', role: ROLES.SALES_EXECUTIVE },
  { key: 'execB', name: 'Eli Executive', email: 'eli@demo.crm', role: ROLES.SALES_EXECUTIVE },
];

const LEAD_SEEDS = [
  { name: 'Acme Corporation', email: 'buyer@acme.test', company: 'Acme Corporation', source: LEAD_SOURCES.WEBSITE, status: LEAD_STATUSES.QUALIFIED, priority: LEAD_PRIORITIES.HIGH, exec: 'execA' },
  { name: 'Globex Ltd', email: 'procurement@globex.test', company: 'Globex Ltd', source: LEAD_SOURCES.REFERRAL, status: LEAD_STATUSES.QUALIFIED, priority: LEAD_PRIORITIES.HIGH, exec: 'execA' },
  { name: 'Initech', email: 'ops@initech.test', company: 'Initech', source: LEAD_SOURCES.SOCIAL_MEDIA, status: LEAD_STATUSES.CONTACTED, priority: LEAD_PRIORITIES.MEDIUM, exec: 'execB' },
  { name: 'Umbrella Health', email: 'hello@umbrella.test', company: 'Umbrella Health', source: LEAD_SOURCES.EMAIL, status: LEAD_STATUSES.NEW, priority: LEAD_PRIORITIES.LOW, exec: 'execB' },
  { name: 'Soylent Foods', email: 'sales@soylent.test', company: 'Soylent Foods', source: LEAD_SOURCES.PHONE, status: LEAD_STATUSES.LOST, priority: LEAD_PRIORITIES.MEDIUM, exec: 'execA' },
  { name: 'Hooli', email: 'it@hooli.test', company: 'Hooli', source: LEAD_SOURCES.OTHER, status: LEAD_STATUSES.UNQUALIFIED, priority: LEAD_PRIORITIES.LOW, exec: 'execB' },
];

const CUSTOMER_SEEDS = [
  { name: 'Won Incorporated', email: 'won@won.test', company: 'Won Incorporated', exec: 'execA', address: '1 Market St, San Francisco' },
  { name: 'Stark Industries', email: 'buy@stark.test', company: 'Stark Industries', exec: 'execB', address: '200 Park Ave, New York' },
];

const DEAL_SEEDS = [
  { customer: 'Won Incorporated', name: 'Won - Platform Licence', value: 45000, probability: 100, stage: DEAL_STAGES.WON, closingInDays: -20, exec: 'execA' },
  { customer: 'Won Incorporated', name: 'Won - Support Retainer', value: 12000, probability: 60, stage: DEAL_STAGES.NEGOTIATION, closingInDays: 45, exec: 'execA' },
  { customer: 'Stark Industries', name: 'Stark - Enterprise Rollout', value: 180000, probability: 80, stage: DEAL_STAGES.PROPOSAL, closingInDays: 60, exec: 'execB' },
  { customer: 'Stark Industries', name: 'Stark - Pilot', value: 25000, probability: 0, stage: DEAL_STAGES.LOST, closingInDays: -10, exec: 'execB', lostReason: 'Chose a competitor' },
];

const ACTIVITY_SEEDS = [
  { type: ACTIVITY_TYPES.CALL, title: 'Discovery call with Acme', exec: 'execA', related: 'Acme Corporation', dueInDays: 3 },
  { type: ACTIVITY_TYPES.FOLLOW_UP, title: 'Send proposal to Globex', exec: 'execA', related: 'Globex Ltd', dueInDays: 1 },
  { type: ACTIVITY_TYPES.MEETING, title: 'Overdue review with Initech', exec: 'execB', related: 'Initech', dueInDays: -7 },
  { type: ACTIVITY_TYPES.NOTE, title: 'Logged campaign feedback', exec: 'execB', related: 'Umbrella Health', dueInDays: null },
  { type: ACTIVITY_TYPES.EMAIL, title: 'Completed renewal email', exec: 'execA', related: 'Won Incorporated', dueInDays: -2, completed: true },
];

const daysFromNow = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

/**
 * Ensure a user exists, returning the document. Idempotent.
 */
async function upsertUser({ name, email, role }, password) {
  const existing = await User.findOne({ email });
  if (existing) return existing;
  const passwordHash = await User.hashPassword(password);
  return User.create({ name, email, phone: '', passwordHash, role, isActive: true });
}

/**
 * Wipe every CRM collection. Only ever called against a development database.
 */
async function clearDemoData() {
  await Promise.all([
    Timeline.deleteMany({}),
    Activity.deleteMany({}),
    Deal.deleteMany({}),
    Customer.deleteMany({}),
    Lead.deleteMany({}),
    RefreshToken.deleteMany({}),
    Team.deleteMany({}),
  ]);
}

export async function seed({ log = logger } = {}) {
  if (config.isProduction && !config.seed.force) {
    throw new Error(
      'Refusing to seed demo data with NODE_ENV=production. Set SEED_FORCE=true only if you really know what you are doing.'
    );
  }

  const adminResult = await bootstrapAdmin({ logger: log });
  const admin = adminResult.user;

  if (config.seed.force) {
    await clearDemoData();
    log.warn('SEED_FORCE=true - all CRM collections were cleared');
  }

  // --- Teams ---------------------------------------------------------------
  let salesTeam = await Team.findOne({ name: 'Demo Sales Team' });
  if (!salesTeam) {
    salesTeam = await Team.create({ name: 'Demo Sales Team', members: [] });
  }

  // --- Users ---------------------------------------------------------------
  const password = DEMO_PASSWORD || crypto.randomBytes(12).toString('base64url');
  const isGenerated = !DEMO_PASSWORD;
  const users = {};

  for (const seedUser of DEMO_USERS) {
    // The demo admin is the bootstrapped administrator; the others are sample users.
    if (seedUser.role === ROLES.ADMIN && admin) {
      users[seedUser.key] = admin;
      continue;
    }
    users[seedUser.key] = await upsertUser(seedUser, password);
  }

  users.manager.team = salesTeam._id;
  await users.manager.save();
  await salesTeam.updateOne({ $set: { members: [users.execA._id, users.execB._id] } });

  // --- Leads ---------------------------------------------------------------
  const leadsByKey = {};
  for (const leadSeed of LEAD_SEEDS) {
    const existing = await Lead.findOne({ email: leadSeed.email });
    if (existing) {
      leadsByKey[leadSeed.company] = existing;
      continue;
    }
    const lead = await Lead.create({
      name: leadSeed.name,
      email: leadSeed.email,
      phone: '+1 555 0100',
      company: leadSeed.company,
      source: leadSeed.source,
      status: leadSeed.status,
      priority: leadSeed.priority,
      description: 'Demo lead generated by `npm run seed`.',
      assignedTo: users[leadSeed.exec]._id,
      createdBy: admin._id,
    });
    leadsByKey[leadSeed.company] = lead;
  }

  // --- Convert one qualified lead so the demo data contains a real
  //     lead -> customer -> deal chain produced by the transactional flow. -----
  const acmeLead = leadsByKey['Acme Corporation'];
  if (acmeLead && acmeLead.status === LEAD_STATUSES.QUALIFIED && !acmeLead.convertedCustomer) {
    await convertLead(
      acmeLead._id,
      {
        dealName: 'Acme - Initial Platform Deal',
        dealValue: 75000,
        probability: 70,
        expectedClosingDate: daysFromNow(30),
        stage: DEAL_STAGES.PROPOSAL,
        description: 'Initial deal created by lead conversion during seeding.',
        assignedTo: users.execA._id,
      },
      admin,
      { ip: 'seed' }
    );
    log.info('Demo lead "Acme Corporation" converted into a customer + deal');
  }

  // --- Customers -----------------------------------------------------------
  const customersByName = {};
  for (const customerSeed of CUSTOMER_SEEDS) {
    const existing = await Customer.findOne({ email: customerSeed.email });
    if (existing) {
      customersByName[customerSeed.name] = existing;
      continue;
    }
    const customer = await Customer.create({
      name: customerSeed.name,
      email: customerSeed.email,
      phone: '+1 555 0199',
      company: customerSeed.company,
      address: customerSeed.address,
      assignedTo: users[customerSeed.exec]._id,
      status: CUSTOMER_STATUSES.ACTIVE,
      origin: CUSTOMER_ORIGINS.MANUAL,
      notes: 'Demo customer generated by `npm run seed`.',
    });
    customersByName[customerSeed.name] = customer;
  }

  // --- Deals ---------------------------------------------------------------
  for (const dealSeed of DEAL_SEEDS) {
    const customer = customersByName[dealSeed.customer];
    const exists = await Deal.exists({ name: dealSeed.name });
    if (exists) continue;
    const value = roundMoney(dealSeed.value);
    await Deal.create({
      name: dealSeed.name,
      customer: customer._id,
      lead: null,
      assignedTo: users[dealSeed.exec]._id,
      dealValue: value,
      probability: dealSeed.probability,
      expectedRevenue: calculateExpectedRevenue(value, dealSeed.probability),
      expectedClosingDate: daysFromNow(dealSeed.closingInDays),
      stage: dealSeed.stage,
      description: 'Demo deal generated by `npm run seed`.',
      lostReason: dealSeed.lostReason || '',
      createdBy: admin._id,
      closedAt: [DEAL_STAGES.WON, DEAL_STAGES.LOST].includes(dealSeed.stage) ? daysFromNow(dealSeed.closingInDays) : null,
    });
  }

  // --- Activities ----------------------------------------------------------
  for (const activitySeed of ACTIVITY_SEEDS) {
    const exists = await Activity.exists({ title: activitySeed.title });
    if (exists) continue;
    const lead = leadsByKey[activitySeed.related];
    const customer = customersByName[activitySeed.related];
    const relatedEntityType = customer ? 'CUSTOMER' : 'LEAD';
    const relatedEntityId = customer ? customer._id : lead?._id;
    await Activity.create({
      type: activitySeed.type,
      title: activitySeed.title,
      description: 'Demo activity generated by `npm run seed`.',
      assignedTo: users[activitySeed.exec]._id,
      dueDate: activitySeed.dueInDays === null ? null : daysFromNow(activitySeed.dueInDays),
      status: activitySeed.completed ? 'COMPLETED' : 'PENDING',
      completedAt: activitySeed.completed ? daysFromNow(-1) : null,
      relatedEntityType,
      relatedEntityId,
      createdBy: admin._id,
    });
  }

  return { users, salesTeam, password, isGenerated };
}

async function main() {
  validateEnv();
  await connectDatabase();
  try {
    const { users, password, isGenerated } = await seed();

    const lines = [
      '',
      '------------------------------------------------------------------',
      ' Demo data seeded.',
      '------------------------------------------------------------------',
      ` Administrator : ${users.admin.email}`,
      ` Manager      : ${users.manager.email}`,
      ` Executive A  : ${users.execA.email}`,
      ` Executive B  : ${users.execB.email}`,
      '',
      ` Shared demo password${isGenerated ? ' (generated for this run)' : ' (from SEED_DEMO_PASSWORD)'}: ${password}`,
      '',
      ' Sign in with  POST /api/v1/auth/login  using any of the emails above.',
      ' The administrator password is the INITIAL_ADMIN_PASSWORD you configured',
      ' in .env (it is never printed by this script).',
      '------------------------------------------------------------------',
      '',
    ];
    process.stdout.write(`${lines.join('\n')}\n`);
  } finally {
    await disconnectDatabase();
    await mongoose.connection.close().catch(() => {});
  }
}

const invokedDirectly = process.argv[1] && process.argv[1].includes('seed');
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`\nSeeding failed: ${error.message}\n\n`);
    process.exit(1);
  });
}