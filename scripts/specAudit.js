/**
 * Audits the generated OpenAPI document.
 *
 * Reports operations without an `operationId` (Swagger UI then falls back to the
 * summary, which produces deep links containing escaped whitespace), plus a few
 * other spec-quality checks.
 *
 * Usage: node scripts/specAudit.js [baseUrl]
 */
const baseUrl = process.argv[2] || 'http://localhost:5000';
const spec = await (await fetch(`${baseUrl}/api-docs.json`)).json();

const HTTP_METHODS = new Set(['get', 'put', 'post', 'patch', 'delete', 'head', 'options']);

const operations = [];
for (const [path, item] of Object.entries(spec.paths || {})) {
  for (const [method, op] of Object.entries(item)) {
    // `parameters`, `summary`, `$ref` etc. are not operations.
    if (!HTTP_METHODS.has(method.toLowerCase())) continue;
    operations.push({ path, method, op });
  }
}

const missingOperationId = operations.filter(({ op }) => !op.operationId);
const missingSummary = operations.filter(({ op }) => !op.summary);
const missingResponses = operations.filter(({ op }) => !op.responses || Object.keys(op.responses).length === 0);
const duplicates = operations
  .map(({ op }) => op.operationId)
  .filter(Boolean)
  .filter((id, index, all) => all.indexOf(id) !== index);

console.log(`OpenAPI document: ${spec.info?.title} v${spec.info?.version}`);
console.log(`paths            : ${Object.keys(spec.paths || {}).length}`);
console.log(`operations       : ${operations.length}`);
console.log(`missing operationId : ${missingOperationId.length}`);
console.log(`missing summary      : ${missingSummary.length}`);
console.log(`missing responses    : ${missingResponses.length}`);
console.log(`duplicate operationIds: ${[...new Set(duplicates)].join(', ') || 'none'}`);
console.log(`security schemes     : ${Object.keys(spec.components?.securitySchemes || {}).join(', ') || 'none'}`);

if (missingOperationId.length) {
  console.log('\nOperations without an operationId (these make Swagger UI build deep links');
  console.log('from the summary, which contains spaces and triggers the deprecation warning):');
  for (const { path, method, op } of missingOperationId) {
    console.log(`  ${method.toUpperCase().padEnd(6)} ${path.padEnd(38)} summary="${op.summary || ''}"`);
  }
}

const withSpaces = operations.filter(({ op }) => op.operationId && /\s/.test(op.operationId));
console.log(`\noperationIds containing whitespace: ${withSpaces.length}`);

process.exit(missingOperationId.length || withSpaces.length || missingResponses.length ? 1 : 0);