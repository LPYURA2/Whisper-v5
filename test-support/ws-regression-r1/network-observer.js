/* Diagnostic-only asset. Loaded before the unchanged Whisper runtime.
 * Observes browser events and allowlisted application markers; never drives
 * connection/retry/recovery, stores payloads, or reads application storage.
 */
(function () {
    'use strict';
    if (window.WhisperNetDiagnostics) return;
    const startedAt = performance.now();
    const build = window.WHISPER_TEST_BUILD || {};
    const MAX_EVENTS = 160;
    const MAX_SOCKETS = 16;
    const MAX_PCS = 16;
    const events = [];
    const sockets = [];
    const pcs = [];
    const socketRecords = new WeakMap();
    const pcRecords = new WeakMap();
    const channelRecords = new WeakMap();
    const capabilities = { webSocketObserver: false, peerConnectionObserver: false };
    const markers = { connecting: 0, openHandlerMarkers: 0, readyHandlerMarkers: 0,
        bootstrapFatal: 0, globalErrors: 0, promiseErrors: 0 };
    let nativeOpenContext = null;
    let nativeMessageContext = null;
    let socketSerial = 0;
    let pcSerial = 0;
    let channelSerial = 0;
    let panel = null;
    let output = null;
    let statusLine = null;
    let exportArea = null;
    const readyStates = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
    const messageTypes = new Set(['join', 'welcome', 'peers', 'signaling-ready',
        'signaling-error', 'offer', 'answer', 'ice-candidate', 'message']);
    const candidateTypes = new Set(['host', 'srflx', 'prflx', 'relay']);
    const errorNames = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError',
        'SyntaxError', 'SecurityError', 'InvalidStateError', 'NotSupportedError',
        'NetworkError', 'AbortError', 'OperationError']);

    function safe(fn) { try { return fn(); } catch (_) { return undefined; } }
    function elapsed() { return Math.round((performance.now() - startedAt) * 10) / 10; }
    function utc() { return new Date().toISOString(); }
    function errorName(error) { return errorNames.has(error && error.name) ? error.name : 'UnknownError'; }
    function state(value, allowed) { return allowed.includes(value) ? value : 'unknown'; }
    function record(kind, fields) {
        // fields are constructed inside this file only; no event/data/Error objects.
        events.push(Object.assign({ atMs: elapsed(), utc: utc(), kind: kind }, fields || {}));
        if (events.length > MAX_EVENTS) events.shift();
    }
    function typeOfPacket(value) {
        if (typeof value !== 'string' || value.length > 1048576) return 'unknown';
        try {
            const parsed = JSON.parse(value);
            return parsed && messageTypes.has(parsed.type) ? parsed.type : 'unknown';
        } catch (_) { return 'invalid-json-or-nontext'; }
    }
    function ownership(socket) {
        const client = window.wsClient;
        const pm = window.PeerManager;
        return {
            clientExists: !!client,
            clientSocketMatches: !!client && client.socket === socket,
            clientIsSignalingClient: !!client && window.Signaling && window.Signaling.wsClient === client || false,
            clientProtocolReady: !!client && client.socket === socket && client.connected === true,
            peerManagerExists: !!pm,
            setSignalingStateAvailable: !!pm && typeof pm.setSignalingState === 'function',
            peerManagerReady: !!pm && pm.signalingReady === true,
            peerManagerClientMatches: !!pm && !!client && pm.signalingClient === client,
            peerManagerSocketMatches: !!pm && pm.signalingSocket === socket,
            presenceFresh: !!pm && pm.presenceFresh === true
        };
    }
    function socketSnapshot(item) {
        return {
            socket: item.id,
            state: readyStates[item.socket.readyState] || 'unknown',
            createdAtMs: item.createdAtMs,
            ageMs: Math.round(elapsed() - item.createdAtMs),
            nativeOpen: item.nativeOpen,
            nativeErrors: item.nativeErrors,
            nativeClose: item.nativeClose,
            closeCode: item.closeCode,
            closeWasClean: item.closeWasClean,
            joinSent: item.joinSent,
            receivedReady: item.receivedReady,
            receivedTypes: Object.assign({}, item.receivedTypes),
            sentTypes: Object.assign({}, item.sentTypes),
            openHandlerMarker: item.openHandlerMarker,
            readyHandlerMarker: item.readyHandlerMarker,
            owner: ownership(item.socket)
        };
    }
    function stage(item) {
        if (!item) return markers.connecting ? 'connect-marker-without-socket' : 'not-started';
        const current = socketSnapshot(item);
        if (current.state === 'CONNECTING') return 'native-CONNECTING';
        if (current.state === 'CLOSING' || current.state === 'CLOSED') return 'native-' + current.state;
        if (current.state !== 'OPEN') return 'unknown';
        if (!current.owner.clientSocketMatches) return 'OPEN-not-current-owner';
        if (!current.openHandlerMarker && !current.joinSent) return 'OPEN-no-handler-marker-no-join';
        if (!current.joinSent) return 'OPEN-join-not-sent';
        if (!current.receivedReady) return 'join-sent-awaiting-signaling-ready';
        if (!current.owner.clientProtocolReady) return 'ready-received-client-not-ready';
        if (current.owner.setSignalingStateAvailable && !current.owner.peerManagerReady) return 'client-ready-peer-manager-not-ready';
        const livePCs = pcs.filter(function (p) { return p.pc.connectionState !== 'closed'; });
        return livePCs.length ? 'signaling-ready-WebRTC-started' : 'signaling-ready-no-PC';
    }
    function currentSocketRecord() {
        const socket = window.wsClient && window.wsClient.socket;
        return socket && socketRecords.get(socket) || sockets[sockets.length - 1] || null;
    }
    function afterHandlers(item, eventKind) {
        // Native listener is installed before application listeners. A diagnostic
        // next-task sample observes state after event dispatch. Microtasks alone
        // are insufficient: browser callback cleanup may run them between native
        // event listeners. This timer never changes any connection or deadline.
        setTimeout(function () {
            safe(function () {
                record('ws-after-' + eventKind, Object.assign({ socket: item.id, phase: 'next-task-sample' }, ownership(item.socket)));
                if (eventKind === 'open' && nativeOpenContext === item) nativeOpenContext = null;
                if (eventKind === 'message' && nativeMessageContext === item) nativeMessageContext = null;
            });
        }, 0);
    }
    function observeSocket(socket) {
        const item = { id: 'ws' + (++socketSerial), socket: socket, createdAtMs: elapsed(),
            nativeOpen: 0, nativeErrors: 0, nativeClose: 0, closeCode: null,
            closeWasClean: null, joinSent: 0, receivedReady: 0, receivedTypes: {},
            sentTypes: {}, openHandlerMarker: 0, readyHandlerMarker: 0 };
        socketRecords.set(socket, item);
        sockets.push(item);
        if (sockets.length > MAX_SOCKETS) sockets.shift();
        record('ws-created', { socket: item.id });
        socket.addEventListener('open', function () {
            safe(function () {
                item.nativeOpen++;
                nativeOpenContext = item;
                record('ws-native-open', Object.assign({ socket: item.id }, ownership(socket)));
                afterHandlers(item, 'open');
            });
        });
        socket.addEventListener('message', function (event) {
            safe(function () {
                const type = typeOfPacket(event.data);
                nativeMessageContext = item;
                item.receivedTypes[type] = (item.receivedTypes[type] || 0) + 1;
                if (type === 'signaling-ready') item.receivedReady++;
                record('ws-native-message-type', { socket: item.id, type: type });
                afterHandlers(item, 'message');
            });
        });
        socket.addEventListener('error', function () {
            safe(function () {
                item.nativeErrors++;
                record('ws-native-error', { socket: item.id, state: readyStates[socket.readyState] || 'unknown' });
            });
        });
        socket.addEventListener('close', function (event) {
            safe(function () {
                item.nativeClose++;
                item.closeCode = Number.isInteger(event.code) ? event.code : null;
                item.closeWasClean = event.wasClean === true;
                record('ws-native-close', { socket: item.id, code: item.closeCode, wasClean: item.closeWasClean });
                afterHandlers(item, 'close');
            });
        });
    }
    safe(function () {
        const NativeWebSocket = window.WebSocket;
        if (typeof NativeWebSocket !== 'function') return;
        class ObservedWebSocket extends NativeWebSocket {
            constructor(...args) {
                super(...args);
                safe(() => observeSocket(this));
            }
            send(...args) {
                const result = super.send(...args);
                safe(() => {
                    const item = socketRecords.get(this);
                    if (!item) return;
                    const type = typeOfPacket(args[0]);
                    item.sentTypes[type] = (item.sentTypes[type] || 0) + 1;
                    if (type === 'join') item.joinSent++;
                    record('ws-native-send-accepted', { socket: item.id, type: type });
                });
                return result;
            }
        }
        window.WebSocket = ObservedWebSocket;
        capabilities.webSocketObserver = window.WebSocket === ObservedWebSocket;
    });

    safe(function () {
        const original = console.log.bind(console);
        console.log = function (...args) {
            const result = original(...args);
            safe(function () {
                const marker = args[0];
                if (marker === '[WS] connecting...') {
                    markers.connecting++;
                    record('application-ws-connecting-marker');
                } else if (marker === '[WS] WebSocket open; waiting for signaling-ready') {
                    markers.openHandlerMarkers++;
                    const item = nativeOpenContext;
                    if (item) item.openHandlerMarker++;
                    record('application-open-handler-marker', { socket: item ? item.id : null });
                } else if (marker === '[WS] signaling ready') {
                    markers.readyHandlerMarkers++;
                    const item = nativeMessageContext;
                    if (item) item.readyHandlerMarker++;
                    record('application-ready-handler-marker', { socket: item ? item.id : null });
                }
            });
            return result;
        };
        const originalError = console.error.bind(console);
        console.error = function (...args) {
            const result = originalError(...args);
            safe(function () {
                if (args[0] === '[Bootstrap] Fatal Error') {
                    markers.bootstrapFatal++;
                    record('bootstrap-fatal-marker', { errorName: errorName(args[1]) });
                }
            });
            return result;
        };
    });

    function channelSnapshot(item) {
        return { channel: item.id, state: state(item.channel.readyState, ['connecting', 'open', 'closing', 'closed']) };
    }
    function observeChannel(pcItem, channel) {
        if (!channel || channelRecords.has(channel)) return;
        const item = { id: 'dc' + (++channelSerial), channel: channel };
        channelRecords.set(channel, item);
        pcItem.channels.push(item);
        if (pcItem.channels.length > 8) pcItem.channels.shift();
        record('dc-observed', { pc: pcItem.id, channel: item.id });
        ['open', 'closing', 'close', 'error'].forEach(function (kind) {
            channel.addEventListener(kind, function () {
                safe(function () { record('dc-' + kind, Object.assign({ pc: pcItem.id }, channelSnapshot(item))); });
            });
        });
    }
    function pcOwned(pc) {
        const manager = window.RTCManager;
        if (!manager || !(manager.connections instanceof Map)) return null;
        return Array.from(manager.connections.values()).includes(pc);
    }
    function pcSnapshot(item) {
        const pc = item.pc;
        const connectionState = state(pc.connectionState, ['new', 'connecting', 'connected', 'disconnected', 'failed', 'closed']);
        const iceState = state(pc.iceConnectionState, ['new', 'checking', 'connected', 'completed', 'disconnected', 'failed', 'closed']);
        const active = connectionState === 'connected' && ['connected', 'completed'].includes(iceState) && pcOwned(pc) !== false;
        return { pc: item.id, owned: pcOwned(pc), connectionState: connectionState,
            iceState: iceState, signalingState: state(pc.signalingState, ['stable', 'have-local-offer',
                'have-remote-offer', 'have-local-pranswer', 'have-remote-pranswer', 'closed']),
            gatheringState: state(pc.iceGatheringState, ['new', 'gathering', 'complete']),
            channels: item.channels.map(channelSnapshot), candidateTypes: Object.assign({}, item.candidateTypes),
            selectedPair: active ? item.pair : null,
            route: active && item.pair ? item.pair.route : 'unknown' };
    }
    function observePC(pc) {
        const item = { id: 'pc' + (++pcSerial), pc: pc, channels: [], candidateTypes: {}, pair: null, statsPending: false, generation: 0 };
        pcRecords.set(pc, item);
        pcs.push(item);
        if (pcs.length > MAX_PCS) pcs.shift();
        record('pc-created', { pc: item.id });
        ['connectionstatechange', 'iceconnectionstatechange', 'signalingstatechange', 'icegatheringstatechange'].forEach(function (kind) {
            pc.addEventListener(kind, function () {
                safe(function () {
                    item.generation++;
                    if (pc.connectionState !== 'connected' || !['connected', 'completed'].includes(pc.iceConnectionState)) item.pair = null;
                    const view = pcSnapshot(item);
                    record('pc-' + kind, { pc: item.id, connectionState: view.connectionState,
                        iceState: view.iceState, signalingState: view.signalingState, owned: view.owned });
                });
            });
        });
        pc.addEventListener('icecandidate', function (event) {
            safe(function () {
                if (!event.candidate) return;
                const rawType = event.candidate.type;
                const type = candidateTypes.has(rawType) ? rawType : 'unknown';
                item.candidateTypes[type] = (item.candidateTypes[type] || 0) + 1;
                record('local-candidate-type', { pc: item.id, candidateType: type });
            });
        });
        pc.addEventListener('datachannel', function (event) { safe(function () { observeChannel(item, event.channel); }); });
    }
    safe(function () {
        const NativePC = window.RTCPeerConnection;
        if (typeof NativePC !== 'function') return;
        class ObservedPeerConnection extends NativePC {
            constructor(...args) {
                super(...args);
                safe(() => observePC(this));
            }
            createDataChannel(...args) {
                const channel = super.createDataChannel(...args);
                safe(() => {
                    const item = pcRecords.get(this);
                    if (item) observeChannel(item, channel);
                });
                return channel;
            }
        }
        window.RTCPeerConnection = ObservedPeerConnection;
        capabilities.peerConnectionObserver = window.RTCPeerConnection === ObservedPeerConnection;
    });
    async function sampleStats(item) {
        const pc = item.pc;
        if (item.statsPending || pc.connectionState !== 'connected' || pcOwned(pc) === false) return;
        item.statsPending = true;
        const generation = item.generation;
        try {
            const reports = await pc.getStats();
            if (item.generation !== generation || pc.connectionState !== 'connected' || !['connected', 'completed'].includes(pc.iceConnectionState) || pcOwned(pc) === false) {
                item.pair = null;
                return;
            }
            let selected = null;
            reports.forEach(function (r) {
                if (r.type === 'transport' && r.selectedCandidatePairId) selected = reports.get(r.selectedCandidatePairId) || selected;
            });
            if (!selected || selected.type !== 'candidate-pair' || selected.state !== 'succeeded') {
                item.pair = null;
                return;
            }
            const local = reports.get(selected.localCandidateId);
            const remote = reports.get(selected.remoteCandidateId);
            const localType = local && candidateTypes.has(local.candidateType) ? local.candidateType : 'unknown';
            const remoteType = remote && candidateTypes.has(remote.candidateType) ? remote.candidateType : 'unknown';
            const known = localType !== 'unknown' && remoteType !== 'unknown';
            item.pair = { selectedBy: 'transport.selectedCandidatePairId', state: 'succeeded',
                localType: localType, remoteType: remoteType,
                route: localType === 'relay' || remoteType === 'relay' ? 'relay' : known ? 'direct' : 'unknown',
                protocol: local && ['udp', 'tcp'].includes(local.protocol) ? local.protocol : 'unknown',
                relayProtocol: local && ['udp', 'tcp', 'tls'].includes(local.relayProtocol) ? local.relayProtocol : 'unknown',
                sampledAtMs: elapsed() };
        } catch (_) {
            item.pair = null;
        } finally {
            item.statsPending = false;
        }
    }

    function buildInfo() {
        const commit = function (value) { return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value) ? value : 'unknown'; };
        return { title: typeof build.title === 'string' ? build.title.slice(0, 96) : 'Whisper network comparison',
            id: typeof build.id === 'string' && /^[a-zA-Z0-9._-]{1,100}$/.test(build.id) ? build.id : 'unknown',
            sourceCommit: commit(build.sourceCommit), runtimeCommit: commit(build.runtimeCommit) };
    }
    function snapshot() {
        const current = currentSocketRecord();
        return { schema: 'whisper-network-diagnostics-v1', build: buildInfo(),
            generatedAt: utc(), elapsedMs: elapsed(), online: navigator.onLine === true,
            visibility: state(document.visibilityState, ['visible', 'hidden', 'prerender']),
            capabilities: Object.assign({}, capabilities), stage: stage(current),
            markers: Object.assign({}, markers), signaling: current ? socketSnapshot(current) : null,
            sockets: sockets.map(socketSnapshot), peerConnections: pcs.map(pcSnapshot),
            events: events.map(function (e) { return Object.assign({}, e); }),
            note: 'Native events and application readiness are separate. CONNECTING log alone does not prove absence of native open. No raw payloads, IDs, IPs, SDP, credentials, profile keys or message contents exported. Browser online is not proof of server reachability.' };
    }
    function exportJSON() { return JSON.stringify(snapshot(), null, 2); }
    safe(function () {
        Object.defineProperty(window, 'WhisperNetDiagnostics', { value: Object.freeze({ snapshot: snapshot, exportJSON: exportJSON }), configurable: false });
    });
    safe(function () {
        window.addEventListener('error', function (event) {
            safe(function () {
                markers.globalErrors++;
                record('global-error', { category: event.error ? 'javascript' : 'resource-or-event', errorName: errorName(event.error) });
            });
        });
        window.addEventListener('unhandledrejection', function (event) {
            safe(function () { markers.promiseErrors++; record('unhandled-promise', { errorName: errorName(event.reason) }); });
        });
        ['online', 'offline'].forEach(function (kind) {
            window.addEventListener(kind, function () { safe(function () { record('browser-' + kind); }); });
        });
        document.addEventListener('visibilitychange', function () { safe(function () { record('visibility', { state: state(document.visibilityState, ['visible', 'hidden', 'prerender']) }); }); });
    });
    function render() {
        if (!panel) return;
        const view = snapshot();
        const active = view.signaling;
        const ready = active && active.owner.clientProtocolReady;
        statusLine.textContent = 'WS: ' + (active ? active.state : 'нет socket') + ' · signaling: ' + (ready ? 'ready' : 'не готов') + ' · ' + view.stage;
        output.textContent = 'Native open: ' + (active ? active.nativeOpen : 0) + ' · обработчик open: ' + (active ? active.openHandlerMarker : 0) +
            ' · join отправлен: ' + (active ? active.joinSent : 0) + ' · ready получен: ' + (active ? active.receivedReady : 0) +
            '\nsetSignalingState: ' + (active ? String(active.owner.setSignalingStateAvailable) : 'нет клиента') +
            ' · fatal: ' + view.markers.bootstrapFatal + ' · online: ' + String(view.online) + '\n' +
            (view.peerConnections.length ? view.peerConnections.map(function (p) {
                return p.pc + ': PC ' + p.connectionState + ' / ICE ' + p.iceState + ' / DC ' +
                    (p.channels.map(function (d) { return d.state; }).join(', ') || 'нет') + ' / ' + p.route +
                    (p.selectedPair ? ' (' + p.selectedPair.localType + ' ↔ ' + p.selectedPair.remoteType + ')' : '');
            }).join('\n') : 'PC ещё не создан');
    }
    function mount() {
        if (!document.body || panel) return;
        panel = document.createElement('details');
        panel.id = 'whisper-network-diagnostics';
        panel.open = true;
        panel.style.cssText = 'position:relative;z-index:99999;padding:10px 12px;background:#172554;color:#f8fafc;border-bottom:2px solid #60a5fa;font:13px/1.45 system-ui,sans-serif;overflow-wrap:anywhere';
        const info = buildInfo();
        const summary = document.createElement('summary');
        summary.textContent = info.title + ' · ' + info.id;
        summary.style.cssText = 'font-weight:700;cursor:pointer';
        panel.appendChild(summary);
        const commit = document.createElement('div');
        commit.textContent = 'Source: ' + info.sourceCommit;
        panel.appendChild(commit);
        statusLine = document.createElement('div');
        panel.appendChild(statusLine);
        output = document.createElement('pre');
        output.style.cssText = 'white-space:pre-wrap;margin:6px 0;font:12px/1.4 ui-monospace,monospace';
        panel.appendChild(output);
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.textContent = 'Копировать безопасную диагностику';
        copy.style.cssText = 'padding:8px 10px;border:1px solid #93c5fd;border-radius:5px;background:#eff6ff;color:#172554;cursor:pointer';
        copy.addEventListener('click', async function () {
            const json = exportJSON();
            try {
                if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error();
                await navigator.clipboard.writeText(json);
                copy.textContent = 'Диагностика скопирована';
            } catch (_) {
                if (!exportArea) {
                    exportArea = document.createElement('textarea');
                    exportArea.readOnly = true;
                    exportArea.setAttribute('aria-label', 'Безопасный диагностический JSON для копирования');
                    exportArea.style.cssText = 'display:block;width:100%;height:180px;margin-top:8px;color:#111827;background:white';
                    panel.appendChild(exportArea);
                }
                exportArea.value = json;
                exportArea.focus();
                exportArea.select();
                copy.textContent = 'Скопируйте выделенный JSON';
            }
        });
        panel.appendChild(copy);
        const notice = document.createElement('div');
        notice.textContent = 'Сравнение без TURN. Используйте разные тестовые профили. Экспорт этой панели безопасный; обычные подробные логи приложения могут содержать чувствительные SDP/профиль.';
        notice.style.cssText = 'font-size:11px;margin-top:6px;color:#bfdbfe';
        panel.appendChild(notice);
        document.body.insertBefore(panel, document.body.firstChild);
        render();
    }
    safe(function () {
        record('observer-started');
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { safe(mount); }, { once: true });
        else mount();
        setInterval(function () {
            safe(render);
            pcs.forEach(function (item) { safe(function () { sampleStats(item); }); });
        }, 2000);
    });
})();
