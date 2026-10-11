/**
 * Verifies that every operation documents the error statuses the API can return.
 * Usage: node scripts/responseAudit.js [baseUrl]
 */
const baseUrl = process.argv[2] || 'http://localhost:5000';
const spec = await (await fetch(`${baseUrl}/api-docs.json`)).json();

const HTTP_METHODS = new Set(['get', 'put', 'post', 'patch', 'delete']);
let operations = 0;
let publicOperations = 0;
let with400 = 0;
let with401 = 0;
const problems = [];

for (const [path, item] of Object.entries(spec.paths || {})) {
  for (const [method, op] of Object.entries(item)) {
    if (!HTTP_METHODS.has(method.toLowerCase())) continue;
    operations += 1;
    const label = `${method.toUpperCase()} ${path}`;
    const isPublic = Array.isArray(op.security) && op.security.length === 0;
    if (isPublic) publicOperations += 1;

    if (op.responses?.['400']) with400 += 1;
    else problems.push(`${label} missing 400`);

    if (!isPublic) {
      if (op.responses?.['401']) with401 += 1;
      else problems.push(`${label} missing 401`);
    }
  }
}

console.log(`operations                  : ${operations}`);
console.log(`public (security: [])       : ${publicOperations}`);
console.log(`protected operations        : ${operations - publicOperations}`);
console.log(`documenting 400             : ${with400}/${operations}`);
console.log(`protected documenting 401   : ${with401}/${operations - publicOperations}`);
console.log(`login responses             : ${Object.keys(spec.paths['/auth/login'].post.responses).join(', ')}`);
console.log(`createLead responses        : ${Object.keys(spec.paths['/leads'].post.responses).join(', ')}`);

if (problems.length) {
  console.log('\nproblems:');
  problems.forEach((problem) => console.log(`  ${problem}`));
  process.exit(1);
}
console.log('\nall operations document their universal error responses');