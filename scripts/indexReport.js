/**
 * Prints the indexes of every collection (development / verification helper).
 * Usage: node scripts/indexReport.js
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import '../src/models/index.js';

const listCollections = await connectDatabase();
const collections = await listCollections.db.collections();

for (const collection of collections) {
  const indexes = await collection.indexes();
  console.log(`\n${collection.collectionName}`);
  for (const index of indexes) {
    const columns = Object.entries(index.key).map(([field, dir]) => `${field}:${dir}`).join(', ');
    const flags = [
      index.unique ? 'UNIQUE' : null,
      index.sparse ? 'SPARSE' : null,
      index.partialFilterExpression ? 'PARTIAL' : null,
      index.expireAfterSeconds !== undefined ? `TTL(${index.expireAfterSeconds})` : null,
      index.textIndexVersion ? 'TEXT' : null,
    ].filter(Boolean);
    console.log(`  ${columns}${flags.length ? `  [${flags.join(' ')}]` : ''}`);
  }
}

await disconnectDatabase();
await mongoose.connection.close().catch(() => {});