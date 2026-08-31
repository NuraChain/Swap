/**
 * Nura Wallet connector for dApps.
 *
 * Announces a "Nura Wallet" provider through EIP-6963, so any connect modal built on
 * wagmi v2 / RainbowKit / AppKit lists the wallet automatically.
 *
 * Inside the wallet's own browser tab the injected provider already exists and this
 * file does nothing. In an external browser (Chrome, Safari, the Android browser) the
 * announced provider transports each request over a deep link:
 *
 *   nurawallet://dapp?request=<base64url({ id, method, params, callback })>
 *
 * The wallet answers by reopening the callback URL with
 * `#nura=<base64url({ id, result?, error? })>` appended. That lands in a fresh tab of
 * this site; the fragment is forwarded to the requesting tab over BroadcastChannel
 * with a localStorage fallback, and the fresh tab shows the page as normal.
 *
 * Usage:
 *   <script src="/nura-connector.js"></script>
 *   <script>NuraConnector.init({ chainId: 1020 });</script>
 */
(function () {
    'use strict';

    var CHANNEL = 'nura-wallet-connector';
    var STORE_PREFIX = 'nura-connector/';
    var TIMEOUT = 5 * 60 * 1000;

    var ICON =
        'data:image/svg+xml;base64,' +
        btoa(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
                '<rect width="32" height="32" rx="8" fill="#0B1220"/>' +
                '<circle cx="16" cy="16" r="9" fill="none" stroke="#38BDF8" stroke-width="2"/>' +
                '<circle cx="16" cy="16" r="3.5" fill="#2963EB"/>' +
                '</svg>'
        );

    var toBase64Url = function (value) {
        var bytes = new TextEncoder().encode(value);
        var raw = '';

        for (var i = 0; i < bytes.length; i += 1) {
            raw += String.fromCharCode(bytes[i]);
        }

        return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };

    var fromBase64Url = function (value) {
        var padded = value.replace(/-/g, '+').replace(/_/g, '/');

        return new TextDecoder().decode(
            Uint8Array.from(atob(padded), function (char) {
                return char.charCodeAt(0);
            })
        );
    };

    var newId = function () {
        return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    };

    var init = function (options) {
        options = options || {};

        // The wallet's own browser already injected a full provider; nothing to add.
        if (window.__nuraWallet !== undefined) {
            return;
        }

        var chainId = '0x' + (options.chainId || 1020).toString(16);
        var accounts = [];

        try {
            accounts = JSON.parse(localStorage.getItem(STORE_PREFIX + 'accounts') || '[]');
        } catch (ignored) {
            accounts = [];
        }

        var listeners = {};
        var pending = {};

        var emit = function (name, payload) {
            (listeners[name] || []).slice().forEach(function (handler) {
                try {
                    handler(payload);
                } catch (ignored) {}
            });
        };

        var settle = function (reply) {
            var entry = pending[reply.id];

            if (entry === undefined) {
                return;
            }

            delete pending[reply.id];
            clearTimeout(entry.timer);

            if (reply.error) {
                var error = new Error(reply.error.message || 'Request failed');
                error.code = reply.error.code || -32603;
                if (reply.error.data !== undefined) {
                    error.data = reply.error.data;
                }
                entry.reject(error);

                return;
            }

            if (entry.method === 'eth_requestAccounts' || entry.method === 'wallet_requestPermissions') {
                var granted = entry.method === 'eth_requestAccounts' ? reply.result : accounts;

                if (Array.isArray(granted) && granted.length > 0) {
                    accounts = granted;

                    try {
                        localStorage.setItem(STORE_PREFIX + 'accounts', JSON.stringify(accounts));
                    } catch (ignored) {}

                    emit('connect', { chainId: chainId });
                    emit('accountsChanged', accounts);
                }
            }

            entry.resolve(reply.result);
        };

        var channel = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL) : undefined;

        if (channel !== undefined) {
            channel.onmessage = function (event) {
                if (event.data && typeof event.data.id === 'string') {
                    settle(event.data);
                }
            };
        }

        window.addEventListener('storage', function (event) {
            if (event.key !== null && event.key.indexOf(STORE_PREFIX + 'reply/') === 0 && typeof event.newValue === 'string' && event.newValue.length > 0) {
                try {
                    settle(JSON.parse(event.newValue));
                } catch (ignored) {}
            }
        });

        // A returning callback tab: hand the reply to whoever is waiting, then tidy the URL.
        var match = /[#&]nura=([A-Za-z0-9_-]+)/.exec(window.location.hash);

        if (match !== null) {
            try {
                var reply = JSON.parse(fromBase64Url(match[1]));

                settle(reply);

                if (channel !== undefined) {
                    channel.postMessage(reply);
                }

                localStorage.setItem(STORE_PREFIX + 'reply/' + reply.id, JSON.stringify(reply));
                localStorage.removeItem(STORE_PREFIX + 'reply/' + reply.id);
            } catch (ignored) {}

            try {
                history.replaceState(null, '', window.location.pathname + window.location.search);
            } catch (ignored) {}
        }

        var roundtrip = function (method, params) {
            return new Promise(function (resolve, reject) {
                var id = newId();

                pending[id] = {
                    method: method,
                    resolve: resolve,
                    reject: reject,
                    timer: setTimeout(function () {
                        delete pending[id];

                        var error = new Error('Nura Wallet did not answer');
                        error.code = 4001;
                        reject(error);
                    }, TIMEOUT)
                };

                var payload = {
                    id: id,
                    method: method,
                    params: Array.isArray(params) ? params : [],
                    callback: window.location.origin + window.location.pathname
                };

                window.location.href = 'nurawallet://dapp?request=' + toBase64Url(JSON.stringify(payload));
            });
        };

        var provider = {
            isNuraWallet: true,

            request: function (args) {
                if (args === null || typeof args !== 'object' || typeof args.method !== 'string') {
                    return Promise.reject(new Error('Expected { method, params }'));
                }

                switch (args.method) {
                    case 'eth_chainId':
                        return Promise.resolve(chainId);

                    case 'net_version':
                        return Promise.resolve(String(parseInt(chainId, 16)));

                    case 'eth_accounts':
                        return Promise.resolve(accounts.slice());

                    default:
                        return roundtrip(args.method, args.params);
                }
            },

            on: function (name, handler) {
                (listeners[name] = listeners[name] || []).push(handler);

                return provider;
            },

            removeListener: function (name, handler) {
                listeners[name] = (listeners[name] || []).filter(function (held) {
                    return held !== handler;
                });

                return provider;
            }
        };

        var announce = function () {
            window.dispatchEvent(
                new CustomEvent('eip6963:announceProvider', {
                    detail: Object.freeze({
                        info: Object.freeze({
                            uuid: newId(),
                            name: 'Nura Wallet',
                            icon: options.icon || ICON,
                            rdns: 'net.nurachain.wallet'
                        }),
                        provider: provider
                    })
                })
            );
        };

        window.addEventListener('eip6963:requestProvider', announce);

        announce();
    };

    window.NuraConnector = { init: init };
})();
