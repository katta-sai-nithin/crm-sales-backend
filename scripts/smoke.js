/**
 * End-to-end smoke script against a running server (development only).
 *
 * Usage:
 *   node scripts/smoke.js http://localhost:5000 <email> <password>
 */
const [, , baseUrl = 'http://localhost:5000', email, password] = process.argv;

if (!email || !password) {
  console.error('Usage: node scripts/smoke.js <baseUrl> <email> <password>');
  process.exit(1);
}

let accessToken;

async function call(method, path, body) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, body: json };
}

const checks = [];
const check = (name, condition, extra = '') => {
  checks.push({ name, ok: Boolean(condition), extra });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${extra ? ` -> ${extra}` : ''}`);
};

(async () => {
  const health = await call('GET', '/health');
  check('health', health.status === 200 && health.body.data.database.connected, `db=${health.body?.data?.database?.connected}`);

  const login = await call('POST', '/auth/login', { email, password });
  check('login', login.status === 200, login.body?.message);
  accessToken = login.body?.data?.accessToken;

  const me = await call('GET', '/auth/me');
  check('me', me.status === 200 && !('passwordHash' in me.body.data));

  const refresh = await call('POST', '/auth/refresh', { refreshToken: login.body.data.refreshToken });
  check('refresh rotation', refresh.status === 200 && refresh.body.data.refreshToken !== login.body.data.refreshToken);
  accessToken = refresh.body?.data?.accessToken;

  const leads = await call('GET', '/leads?limit=5');
  check('leads list', leads.status === 200 && Array.isArray(leads.body.data), `${leads.body?.pagination?.totalRecords} records`);

  const customers = await call('GET', '/customers?limit=5');
  check('customers list', customers.status === 200, `${customers.body?.pagination?.totalRecords} records`);

  const deals = await call('GET', '/deals?limit=5');
  check('deals list', deals.status === 200, `${deals.body?.pagination?.totalRecords} records`);

  const activities = await call('GET', '/activities?limit=5');
  check('activities list', activities.status === 200, `${activities.body?.pagination?.totalRecords} records`);

  const dashboard = await call('GET', '/analytics/dashboard');
  check('dashboard', dashboard.status === 200 && typeof dashboard.body.data.leads.total === 'number', `leads=${dashboard.body?.data?.leads?.total}`);

  const pipeline = await call('GET', '/analytics/pipeline');
  check('pipeline', pipeline.status === 200 && pipeline.body.data.stages.length === 6);

  const team = await call('GET', '/analytics/team-performance');
  check('team performance', team.status === 200 || team.status === 403, `status=${team.status}`);

  const badFilter = await call('GET', '/leads?sortBy=passwordHash');
  check('rejects non allow-listed sort field', badFilter.status === 400);

  const notFound = await call('GET', '/leads/000000000000000000000000');
  check('unknown lead -> 404', notFound.status === 404);

  const unauthorized = await fetch(`${baseUrl}/api/v1/leads`).then((r) => r.status);
  check('unauthenticated -> 401', unauthorized === 401);

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((error) => {
  console.error('Smoke run failed:', error.message);
  process.exit(1);
});