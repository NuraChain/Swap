// The storage the server suite runs against: a real PostgreSQL, compiled to WASM
// and running in this process (PGlite) - the same SQL production sends, with no
// server, socket or file to set up. Booting one costs ~2s, so each test file
// shares a single instance and every freshDb() starts it empty.

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll } from 'vitest';

import { IndexerDb } from '../src/indexer/db.ts';

let shared: PGlite | undefined;

/** An empty database. Only one is live at a time per file: the next call wipes it. */
export async function freshDb(): Promise<IndexerDb>
{
    shared ??= new PGlite();
    const db = await IndexerDb.open(shared);
    await db.wipe();
    return db;
}

// The boot runs here, under a hook budget wide enough for it, instead of inside
// whichever test happens to call freshDb() first and blowing its 5s timeout.
beforeAll(async () =>
{
    shared ??= new PGlite();
    await shared.waitReady;
}, 30_000);

afterAll(async () =>
{
    await shared?.close();
    shared = undefined;
});
