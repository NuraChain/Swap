// A headless Chrome, driven over the DevTools protocol. ONE copy, because two
// scripts now need a browser to turn this repository's own data into a committed
// binary: build-whitepaper-pdf.mjs prints the ten PDFs, and build-og-image.mjs
// shoots the social card.
//
// The protocol rather than a command-line flag, because only the protocol takes
// a footer template and only the protocol can wait for `document.fonts.ready` -
// and a page screenshotted or printed before its fonts decode is a page in the
// fallback face.
//
// No puppeteer: the whole client is the forty lines below, and a browser this
// repository already requires a human to have is not worth a 300 MB download in
// every checkout.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The first Chrome or Edge on this platform's list, or $CHROME if it is set. */
export function findChrome()
{
    if (process.env.CHROME !== undefined && process.env.CHROME !== '')
    {
        return process.env.CHROME;
    }
    const programFiles = process.env.PROGRAMFILES ?? 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
    const candidates = process.platform === 'win32'
        ? [
            join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
            join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
            join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
        ]
        : process.platform === 'darwin'
            ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
            : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
    const found = candidates.find((candidate) => existsSync(candidate));
    if (found === undefined)
    {
        throw new Error('no Chrome or Edge found - set CHROME=/path/to/chrome');
    }
    return found;
}

/**
 * Opens `htmlPath` in a throwaway browser and hands `run(send, sessionId)` a
 * loaded page with its fonts decoded. `send(method, params, sessionId)` is the
 * raw DevTools call, so the caller chooses Page.printToPDF or
 * Page.captureScreenshot without this module knowing which.
 *
 * `viewport` sizes the page before it loads - a screenshot wants exact pixels,
 * a print does not care and passes nothing.
 *
 * The browser is always torn down, and a cleanup failure never masks the error
 * that brought us here.
 */
export async function withPage(chrome, htmlPath, run, { viewport = null } = {})
{
    const profile = mkdtempSync(join(tmpdir(), 'nuraswap-chrome-'));
    const child = spawn(chrome, [
        '--headless=new',
        '--disable-gpu',
        '--disable-extensions',
        '--hide-scrollbars',
        '--no-first-run',
        '--no-default-browser-check',
        // Both of these exist so the output is the SAME file on every machine
        // that reruns these scripts, because the output is committed. LCD text
        // lays red and cyan fringes along the stems for a subpixel geometry the
        // reader of a shared PNG does not have, and an untagged profile lets the
        // host display's colour space leak into the pixels.
        '--disable-lcd-text',
        '--force-color-profile=srgb',
        '--remote-debugging-port=0',
        `--user-data-dir=${ profile }`,
        'about:blank'
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    try
    {
        const wsUrl = await new Promise((resolve, reject) =>
        {
            let log = '';
            child.stderr.on('data', (chunk) =>
            {
                log += chunk;
                const match = log.match(/DevTools listening on (ws:\/\/\S+)/);
                if (match !== null)
                {
                    resolve(match[1]);
                }
            });
            child.on('exit', (code) => reject(new Error(`chrome exited with ${ code } before listening:\n${ log }`)));
            setTimeout(() => reject(new Error('chrome did not start within 30s')), 30_000).unref();
        });

        const ws = new WebSocket(wsUrl);
        await new Promise((resolve, reject) =>
        {
            ws.onopen = resolve;
            ws.onerror = () => reject(new Error(`could not connect to ${ wsUrl }`));
        });

        let nextId = 0;
        const pending = new Map();
        const events = [];
        ws.onmessage = (event) =>
        {
            const message = JSON.parse(String(event.data));
            if (message.id !== undefined)
            {
                const call = pending.get(message.id);
                pending.delete(message.id);
                if (message.error !== undefined)
                {
                    call.reject(new Error(`${ call.method }: ${ message.error.message }`));
                }
                else
                {
                    call.resolve(message.result);
                }
            }
            else
            {
                for (const listener of events)
                {
                    listener(message);
                }
            }
        };
        const send = (method, params = {}, sessionId = undefined) => new Promise((resolve, reject) =>
        {
            const id = ++nextId;
            pending.set(id, { method, resolve, reject });
            ws.send(JSON.stringify({ id, method, params, sessionId }));
        });

        const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        await send('Page.enable', {}, sessionId);

        if (viewport !== null)
        {
            // deviceScaleFactor 1: the card is authored at its true pixel size, so
            // a scale here would only resample it.
            await send('Emulation.setDeviceMetricsOverride', {
                width: viewport.width,
                height: viewport.height,
                deviceScaleFactor: 1,
                mobile: false
            }, sessionId);
        }

        const loaded = new Promise((resolve) => events.push((message) =>
        {
            if (message.method === 'Page.loadEventFired' && message.sessionId === sessionId)
            {
                resolve();
            }
        }));
        await send('Page.navigate', { url: pathToFileURL(htmlPath).href }, sessionId);
        await loaded;
        // Embedded fonts still decode asynchronously; render only once they have.
        await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true }, sessionId);

        const result = await run(send, sessionId);

        await send('Browser.close').catch(() => undefined);
        ws.close();
        return result;
    }
    finally
    {
        // Chrome holds the profile until it is gone; give it the moment it needs
        // before the directory is removed.
        const exited = new Promise((resolve) => child.once('exit', resolve));
        child.kill();
        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000).unref())]);
        try
        {
            rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
        }
        catch
        {
            // A stray temp profile is a nuisance, not a failure.
        }
    }
}
