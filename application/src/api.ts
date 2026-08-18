// The one file that crosses into the server half - and it crosses with TYPES only. The value
// import below is client-safe schemas; `typeof api` is erased at build, so no handler, store,
// or server dependency can reach the browser bundle. The client's runtime half is the manifest:
// method + path per route, projected from the SAME declaration the server registered. A
// server-rendered page carries it embedded (readManifest - synchronous, no round trip); a
// plain vite dev page falls back to one fetch. '/api' matches the dev proxy and the
// production mount.
import { createClient, readManifest, type Manifest } from '@azerothjs/http/api/shared';
import type { Api } from '../../server/src/app.ts';

export type { Candle, DeploymentInfo, Pool, PoolDetail, Stats, TokenRef, TokenWithPrice, TxItem } from '../../server/src/schemas.ts';

// During SSR the module loads with an empty manifest: pages fetch data in `mount { }`, which
// runs only in the browser, so no call ever happens server-side. An UNREACHABLE manifest
// (component tests, the api half down in dev) degrades to {} instead of taking the whole
// module graph down - each call then fails at its own site with an error naming the cause.
const manifest: Manifest = typeof document === 'undefined'
    ? {}
    : readManifest() ?? await fetch('/api/_manifest')
        .then((response) => response.json() as Promise<Manifest>)
        .catch(() => ({}));

// A group missing from that degraded manifest fails at its own call site by
// design - but it fails SYNCHRONOUSLY. Every caller here is a
// `void client.market.x().catch(...)` inside `mount { }`, and a synchronous
// throw sails straight past that .catch(): the landing page died with an
// uncaught error the moment the api half was down, instead of just showing no
// numbers. Rejecting delivers the same failure where the pages already handle it.
function rejectOnHole<T extends object>(target: T): T
{
    const wrapGroup = (group: object): object => new Proxy(group, {
        get: (methods, name, receiver) =>
        {
            const method: unknown = Reflect.get(methods, name, receiver);
            if (typeof method !== 'function')
            {
                return method;
            }
            return (...args: unknown[]): unknown =>
            {
                try
                {
                    return (method as (...call: unknown[]) => unknown)(...args);
                }
                catch (error)
                {
                    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
                }
            };
        }
    });

    return new Proxy(target, {
        get: (groups, name, receiver) =>
        {
            const group: unknown = Reflect.get(groups, name, receiver);
            return typeof group === 'object' && group !== null ? wrapGroup(group) : group;
        }
    });
}

export const client = rejectOnHole(createClient<Api>(manifest, { baseUrl: '/api' }));
