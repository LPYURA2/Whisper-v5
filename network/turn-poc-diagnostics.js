// Isolated TURN PoC. This observer never controls a PC or its operation.
import { TurnPocConfig } from "./turn-poc-config.js";
import { BUILD_INFO, TURN_URIS } from "./turn-poc-build.js";

const BASE = BUILD_INFO.base;
const TYPES = new Set(["signaling", "ice", "connection", "gathering", "ice-error",
    "channel-open", "channel-close", "channel-error", "reset", "channel-closing",
    "negotiationneeded", "answer", "sdp-error", "ice-gathering", "ice-candidate"]);
const REASONS = new Set(["deadline", "rtc-failed", "signaling-session-changed", "sctp-not-repairable",
    "repair-channel-closed", "repair-create-failed", "remote-sdp-failed", "repair-needs-sdp",
    "offer-failed", "offer-error", "create-failed", "incoming-deadline", "incoming-different-session",
    "incoming-offer-failed", "incoming-offer-error", "profile-changed", "manual-reset"]);
const ENUMS = {
    pc: ["new", "connecting", "connected", "disconnected", "failed", "closed"],
    ice: ["new", "checking", "connected", "completed", "disconnected", "failed", "closed"],
    gathering: ["new", "gathering", "complete"],
    signaling: ["stable", "have-local-offer", "have-remote-offer", "have-local-pranswer", "have-remote-pranswer", "closed"],
    dtls: ["new", "connecting", "connected", "closed", "failed"],
    sctp: ["connecting", "connected", "closed"],
    dc: ["connecting", "open", "closing", "closed"],
    candidate: ["host", "srflx", "prflx", "relay"],
    protocol: ["udp", "tcp"],
    relayProtocol: ["udp", "tcp", "tls"],
    pair: ["frozen", "waiting", "in-progress", "failed", "succeeded"]
};

let rtc = null;
let config = { buildName: BUILD_INFO.name, buildId: BUILD_INFO.id, mode: "all", requestedPolicy: "all", requestedTransport: "none",
    configuration: "not-prepared", turnAvailable: false, fallbackReason: null,
    provider: "none", candidate: null, turnUris: [], providerCandidateStatus: "no-verified-turn" };
let events = [];
let peerSequence = 0;
let snapshotSequence = 0;
const peers = new Map();
const pairLabels = new WeakMap();
let panel = null;
let output = null;
let status = null;
let lastSnapshot = null;
let summary = null;
let badge = null;
let toggleButton = null;
let observedSignaling = null;
let observerTimer = null;
let activeReads = 0;
let bootstrapState = { stage: "preparing", code: null };
const bootstrapCodes = new Set(["config-unavailable", "config-invalid", "config-missing", "candidate-required", "no-verified-turn"]);
const configurations = new Set(["stun-only", "stun+turn", "turn-only", "unavailable", "not-prepared"]);
const observedSockets = new WeakSet();
const relayRecords = new WeakMap();
const relayHistory = [];

function value(kind, input) {
    return ENUMS[kind].includes(input) ? input : null;
}

function number(input) {
    return typeof input === "number" && Number.isFinite(input) && input >= 0 ? input : null;
}

function updateConfiguration(input) {
    if (["relay", "all"].includes(input.mode)) config.mode = input.mode;
    if (["all", "relay"].includes(input.requestedPolicy)) config.requestedPolicy = input.requestedPolicy;
    else config.requestedPolicy = config.mode === "relay" ? "relay" : "all";
    if (["udp", "tcp", "none"].includes(input.transport)) config.requestedTransport = input.transport;
    if (["expressturn", "none"].includes(input.provider)) config.provider = input.provider;
    if ([null, "express-udp", "express-tcp"].includes(input.candidate)) config.candidate = input.candidate;
    if (["runtime-not-verified", "no-verified-turn"].includes(input.providerCandidateStatus)) config.providerCandidateStatus = input.providerCandidateStatus;
    if (Array.isArray(input.turnUris)) config.turnUris = input.turnUris.filter(uri => TURN_URIS.includes(uri));
    if (configurations.has(input.configuration)) config.configuration = input.configuration;
    if (typeof input.turnAvailable === "boolean") config.turnAvailable = input.turnAvailable;
    if (Object.prototype.hasOwnProperty.call(input, "fallbackReason")) {
        config.fallbackReason = bootstrapCodes.has(input.fallbackReason) ? input.fallbackReason : null;
    }
    if (Object.prototype.hasOwnProperty.call(input, "expiresAtMs")) config.expiresAtMs = number(input.expiresAtMs);
}

function alias(peerId) {
    if (!peers.has(peerId)) peers.set(peerId, "peer-" + (++peerSequence));
    return peers.get(peerId);
}

function operationLabel(operation) {
    return Number.isSafeInteger(operation?.label) && operation.label >= 0 ? operation.label : null;
}

function state(connection, peerId, manager) {
    const channel = manager.getChannel?.(peerId, connection);
    return {
        pc: value("pc", connection.connectionState),
        ice: value("ice", connection.iceConnectionState),
        gathering: value("gathering", connection.iceGatheringState),
        signaling: value("signaling", connection.signalingState),
        dtls: value("dtls", connection.sctp?.transport?.state),
        sctp: value("sctp", connection.sctp?.state),
        dc: value("dc", channel?.readyState)
    };
}

function candidate(report, id) {
    const item = report.get(id);
    if (!item) return null;
    const address = typeof item.address === "string" ? item.address :
        typeof item.ip === "string" ? item.ip : "";
    const parts = address.split(".");
    const ipv4 = parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
    const ipv6 = address.includes(":") && /^[a-f0-9:.]+$/i.test(address);
    return {
        type: value("candidate", item.candidateType),
        family: ipv4 ? "IPv4" : ipv6 ? "IPv6" : address.endsWith(".local") ? "mDNS" : "unknown",
        protocol: value("protocol", item.protocol),
        relayProtocol: value("relayProtocol", item.relayProtocol)
    };
}

function route(local, remote) {
    if (!local?.type || !remote?.type) return "unknown";
    if (local?.type === "relay" || remote?.type === "relay") return "relay";
    const direct = item => ["host", "srflx", "prflx"].includes(item?.type);
    return direct(local) && direct(remote) ? "direct" : "unknown";
}

function signalingState() {
    const client = typeof window === "undefined" ? observedSignaling : window.wsClient || observedSignaling;
    const socket = client?.socket;
    const socketState = [0, 1, 2, 3].includes(socket?.readyState) ? socket.readyState : null;
    const ready = client?.connected === true && socketState === 1;
    const stage = ready ? "ready" : socketState === 0 ? "connecting" : socketState === 1 ? "waiting-ready" :
        socketState === 2 ? "closing" : socketState === 3 ? "closed" : client ? "unknown" : "not-started";
    return { ready, stage, socketState };
}

function latestError() {
    const event = [...events].reverse().find(item => item.event === "ice-error" || item.event === "sdp-error" ||
        item.event === "channel-error" || item.event.startsWith("reset:"));
    return event ? { event: event.event, errorCode: event.errorCode ?? null, peer: event.peer,
        operation: event.operation, monotonicMs: event.monotonicMs } : null;
}

function markRelay(connection, peerId, operation, source, count = null) {
    let record = relayRecords.get(connection);
    if (!record) {
        record = { peer: alias(peerId), operation: operationLabel(operation), relayCandidateObserved: true,
            candidateEventObservations: 0, statsLocalRelayCandidates: null };
        relayRecords.set(connection, record);
        relayHistory.push(record);
        if (relayHistory.length > 40) relayHistory.shift();
    }
    if (source === "event") record.candidateEventObservations += 1;
    if (source === "stats") record.statsLocalRelayCandidates = count;
    return record;
}

function liveResult() {
    return { base: BASE, ...config, bootstrap: { ...bootstrapState }, signaling: signalingState(),
        peers: [], relayHistory: relayHistory.map(item => ({ ...item })), lastError: latestError() };
}

function displaySummary(result) {
    if (badge) badge.textContent = `${BUILD_INFO.name} · ${BUILD_INFO.id} · ICE: ${config.mode}`;
    const signaling = result.signaling || signalingState();
    const activePeers = result.peers?.filter(peer => !peer.discarded) || [];
    const pc = activePeers[0];
    const boot = result.bootstrap || bootstrapState;
    const preparing = boot.stage === "preparing" ? "Подготовка ICE-конфигурации…" :
        boot.stage === "error" ? `Конфигурация не загружена: ${boot.code || "config-unavailable"}. Для TURN нужен явный тестовый кандидат и его приватная ссылка. Соединение не создаётся.` :
            config.turnAvailable ? "Диагностический кандидат ExpressTURN настроен; работа relay ещё не доказана" :
                "Обычный all: действующий STUN; отдельно подтверждённого TURN-кандидата пока нет";
    const available = `Конфигурация новых PC: ${config.configuration} · ${config.candidate || "без TURN"} · транспорт: ${config.requestedTransport}`;
    const connection = pc ? `ICE: ${pc.states?.ice || "unknown"} · PC: ${pc.states?.pc || "unknown"} · DC: ${pc.states?.dc || "unknown"}` :
        "ICE / PC / DC: ожидание контакта или новой попытки";
    const relaySeen = pc ? pc.relayCandidateObserved === true : false;
    const allocation = pc ? `Relay-кандидат текущей попытки: ${relaySeen ? "получен" : "пока не наблюдался"}` :
        result.relayHistory?.length ? "Relay-кандидаты наблюдались ранее; текущего PC нет" : "Relay-кандидаты пока не наблюдались";
    const routeText = pc?.route || "unknown";
    const observedTransport = pc?.observedTurnTransport || "unknown";
    const candidateType = item => ENUMS.candidate.includes(item?.type) ? item.type : "unknown";
    const selectedTypes = pc?.selectedPairs?.map(pair => `${candidateType(pair.local)} ↔ ${candidateType(pair.remote)}`).join("; ") || "unknown ↔ unknown";
    if (summary) summary.textContent = `${preparing}\n${available}\nSignaling: ${signaling.stage}\n${connection}\n${allocation}\nВыбранная пара: ${selectedTypes}\nМаршрут текущего PC: ${routeText}\nТранспорт до TURN по stats: ${observedTransport}`;
    if (toggleButton) toggleButton.textContent = boot.stage === "preparing" ? `${BUILD_INFO.name} · подготовка…` :
        boot.stage === "error" ? `${BUILD_INFO.name} · ошибка конфигурации · диагностика` :
            `${BUILD_INFO.name} · ${config.mode} · ${routeText} · DC: ${pc?.states?.dc || "—"}`;
}

function watchSignaling() {
    const client = typeof window === "undefined" ? observedSignaling : window.wsClient || observedSignaling;
    const socket = client?.socket;
    if (!socket || typeof socket.addEventListener !== "function" || observedSockets.has(socket)) return;
    observedSockets.add(socket);
    const notify = () => {
        if (client !== (typeof window === "undefined" ? observedSignaling : window.wsClient || observedSignaling) || client.socket !== socket) return;
        displaySummary(lastSnapshot ? { ...lastSnapshot, signaling: signalingState(), bootstrap: { ...bootstrapState } } : liveResult());
    };
    for (const event of ["open", "message", "close", "error"]) socket.addEventListener(event, notify);
}

async function observeTick() {
    if (typeof document === "undefined" || document.visibilityState === "hidden" || activeReads) return;
    watchSignaling();
    try { await TurnPocDiagnostics.snapshot(); } catch { /* Passive diagnostics must not control recovery. */ }
}

function startObserver() {
    if (observerTimer !== null || typeof document === "undefined" || typeof setInterval !== "function") return;
    // One global UI observer. It neither controls peers nor adds per-peer timers.
    observerTimer = setInterval(observeTick, 3000);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "hidden") void observeTick();
    });
}

function pairLabel(connection, id) {
    let labels = pairLabels.get(connection);
    if (!labels) { labels = new Map(); pairLabels.set(connection, labels); }
    if (!labels.has(id)) labels.set(id, "pair-" + (labels.size + 1));
    return labels.get(id);
}

function pairSummary(connection, item, report, selected) {
    const local = candidate(report, item.localCandidateId);
    const remote = candidate(report, item.remoteCandidateId);
    return {
        pair: pairLabel(connection, item.id), selected: selected.has(item.id),
        state: value("pair", item.state),
        nominated: typeof item.nominated === "boolean" ? item.nominated : null,
        route: route(local, remote), complete: !!local?.type && !!remote?.type,
        local, remote,
        requestsSent: number(item.requestsSent), responsesReceived: number(item.responsesReceived),
        requestsReceived: number(item.requestsReceived), responsesSent: number(item.responsesSent),
        bytesSent: number(item.bytesSent), bytesReceived: number(item.bytesReceived),
        currentRoundTripTimeSeconds: number(item.currentRoundTripTime)
    };
}

function errorName(error) {
    return ["InvalidStateError", "NotSupportedError", "OperationError", "NotAllowedError", "AbortError", "TypeError"]
        .includes(error?.name) ? error.name : "StatsError";
}

function noteType(input) {
    if (TYPES.has(input)) return input;
    if (typeof input === "string" && input.startsWith("reset:")) return REASONS.has(input.slice(6)) ? input : "reset";
    return "event";
}

function render(result) {
    if (output) output.textContent = JSON.stringify(result, null, 2);
    displaySummary(result);
    if (status) {
        const routes = result.peers?.filter(peer => !peer.discarded)
            .map(peer => peer.peer + ": " + (peer.route || "unknown") + " / " + (peer.states?.dc || "—"));
        const error = result.lastError;
        const failure = error ? ` Последнее событие: ${error.event}${error.errorCode === null ? "" : ` (${error.errorCode})`}. Это не установленная причина отказа.` : "";
        status.textContent = (routes?.length ? routes.join("; ") : "Текущего PeerConnection нет. События сохранены ниже.") + failure;
    }
}

function mount() {
    if (typeof document === "undefined" || !document.body || document.getElementById("turn-poc-diagnostics")) return;
    const style = document.createElement("style");
    style.textContent = `
        #turn-poc-diagnostics { position:fixed;right:8px;bottom:8px;z-index:2147483000;
            max-width:min(440px,calc(100vw - 16px));font:14px/1.4 system-ui,sans-serif;color:#f4f4f5; }
        #turn-poc-diagnostics button { font:inherit;min-height:42px;padding:8px 12px;border-radius:8px;
            border:1px solid #777;background:#1f2937;color:#fff;cursor:pointer; }
        #turn-poc-diagnostics section { padding:12px;background:#111827;border:1px solid #6b7280;
            border-radius:10px;max-height:65dvh;overflow:auto;box-shadow:0 3px 20px #0008; }
        #turn-poc-diagnostics h2 {font-size:17px;margin:0 0 8px;}
        #turn-poc-diagnostics p {margin:8px 0;}
        #turn-poc-diagnostics pre {white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;}
        #turn-poc-diagnostics .turn-poc-actions {display:flex;gap:6px;flex-wrap:wrap;}
        #turn-poc-diagnostics .turn-poc-summary {white-space:pre-line;font-size:13px;}
        #turn-poc-diagnostics .turn-poc-badge {font-weight:700;color:#9ee7f0;font-size:13px;}
        #turn-poc-diagnostics summary {cursor:pointer;padding:10px 0;}
    `;
    const dock = document.createElement("aside");
    dock.id = "turn-poc-diagnostics";
    const toggle = document.createElement("button");
    toggleButton = toggle;
    toggle.type = "button";
    toggle.textContent = `${BUILD_INFO.name} · диагностика`;
    toggle.setAttribute("aria-expanded", "false");
    panel = document.createElement("section");
    panel.hidden = true;
    panel.setAttribute("aria-label", "Безопасная диагностика TURN, сигналинг");
    const title = document.createElement("h2");
    title.textContent = `${BUILD_INFO.name} · ${BUILD_INFO.id}`;
    const description = document.createElement("p");
    description.textContent = "Обычный all использует прежний STUN без непроверенных TURN. Явный диагностический кандидат ExpressTURN UDP или TCP проверяется по одному за прогон. С ним all допускает direct и relay; relay запрещает direct. TURN PASS требует активной relay-пары, DC open и новых сообщений в обе стороны. Один relay-кандидат не доказывает передачу.";
    badge = document.createElement("p");
    badge.className = "turn-poc-badge";
    badge.id = "turn-poc-mode-badge";
    summary = document.createElement("p");
    summary.className = "turn-poc-summary";
    summary.id = "turn-poc-live-summary";
    summary.setAttribute("aria-live", "polite");
    status = document.createElement("p");
    status.setAttribute("aria-live", "polite");
    status.textContent = "Нажмите «Снимок getStats».";
    const actions = document.createElement("div");
    actions.className = "turn-poc-actions";
    const capture = document.createElement("button");
    capture.type = "button";
    capture.textContent = "Снимок getStats";
    capture.id = "turn-poc-snapshot";
    capture.addEventListener("click", async () => {
        capture.disabled = true;
        status.textContent = "Чтение статистики…";
        try { await TurnPocDiagnostics.snapshot(); }
        catch { status.textContent = "Снимок недоступен. Исходные данные не сохранены."; }
        finally { capture.disabled = false; }
    });
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Копировать снимок";
    copy.addEventListener("click", async () => {
        if (!lastSnapshot) { status.textContent = "Сначала получите снимок."; return; }
        try {
            await navigator.clipboard.writeText(JSON.stringify(lastSnapshot, null, 2));
            status.textContent = "Безопасный снимок скопирован.";
        } catch { status.textContent = "Копирование недоступно; выделите текст снимка или сделайте снимок экрана."; }
    });
    const restartNote = document.createElement("p");
    restartNote.id = "turn-poc-restart-note";
    restartNote.textContent = "Обычный STUN-only запускается по публичной ссылке. Для отдельного TURN-кандидата и после перезагрузки откройте его исходную приватную ссылку; credentials не сохраняются. Живой PC не перенастраивается.";
    output = document.createElement("pre");
    output.id = "turn-poc-safe-snapshot";
    output.setAttribute("tabindex", "0");
    actions.append(capture, copy);
    panel.append(title, description, summary, status, actions, restartNote, output);
    toggle.addEventListener("click", () => {
        panel.hidden = !panel.hidden;
        toggle.setAttribute("aria-expanded", String(!panel.hidden));
    });
    dock.append(toggle, badge, panel);
    document.head.append(style);
    document.body.append(dock);
}

export const TurnPocDiagnostics = {
    bootstrap(input = {}) {
        updateConfiguration(input);
        bootstrapState = {
            stage: ["selecting", "preparing", "ready", "error"].includes(input.stage) ? input.stage : "error",
            code: bootstrapCodes.has(input.code) ? input.code : input.stage === "error" ? "config-unavailable" : null
        };
        mount();
        startObserver();
        displaySummary(lastSnapshot ? { ...lastSnapshot, bootstrap: { ...bootstrapState } } : liveResult());
        if (bootstrapState.stage === "error" && panel) {
            panel.hidden = false;
            toggleButton?.setAttribute("aria-expanded", "true");
        }
    },

    observeSignaling(client) {
        observedSignaling = client || null;
        watchSignaling();
        displaySummary(lastSnapshot ? { ...lastSnapshot, signaling: signalingState() } : liveResult());
    },

    attach(manager, publicConfig = {}) {
        rtc = manager;
        config = {
            buildName: BUILD_INFO.name, buildId: BUILD_INFO.id,
            mode: ["relay", "all"].includes(publicConfig.mode) ? publicConfig.mode : "unknown",
            requestedTransport: ["udp", "tcp", "none"].includes(publicConfig.transport) ? publicConfig.transport : "unknown",
            requestedPolicy: publicConfig.mode === "relay" ? "relay" : "all",
            configuration: "not-prepared", turnAvailable: false, fallbackReason: null,
            provider: publicConfig.provider === "expressturn" ? "expressturn" : "none",
            candidate: null, turnUris: [],
            providerCandidateStatus: "no-verified-turn",
            expiresAtMs: number(publicConfig.expiresAtMs)
        };
        updateConfiguration(publicConfig);
        mount();
        startObserver();
        displaySummary(liveResult());
    },

    note(peerId, connection, type, detail = null) {
        try {
            if (!rtc || rtc.connections.get(peerId) !== connection) return;
            const operation = rtc.operationOwners.get(connection);
            const event = noteType(type);
            // stop() invalidates the operation before resetPeerConnection closes it.
            if (!operation || (!operation.active && event !== "reset" && !event.startsWith("reset:"))) return;
            const entry = {
                peer: alias(peerId), operation: operationLabel(operation), event,
                monotonicMs: number(performance.now()), states: state(connection, peerId, rtc)
            };
            if (event === "ice-error" && Number.isInteger(detail?.errorCode) && detail.errorCode >= 0 && detail.errorCode <= 9999) {
                entry.errorCode = detail.errorCode;
            }
            if (event === "ice-candidate" && ENUMS.candidate.includes(detail?.candidateType)) {
                entry.candidateType = detail.candidateType;
                if (detail.candidateType === "relay") markRelay(connection, peerId, operation, "event");
            }
            events.push(entry);
            if (events.length > 40) events.shift();
        } catch { /* An observer must not interrupt the existing controller. */ }
    },

    async snapshot() {
        activeReads += 1;
        try {
            // Read-only static configuration status; no refresh, expiry or PC changes.
            updateConfiguration(TurnPocConfig.getPublicConfig());
            const manager = rtc;
            const request = ++snapshotSequence;
            const result = {
                base: BASE, ...config, bootstrap: { ...bootstrapState }, signaling: signalingState(), capturedAt: new Date().toISOString(),
                peers: [], events: events.map(event => ({ ...event, states: { ...event.states } }))
            };
            let captures = [];
            if (manager) {
                // These references stay private; only aliases and sanitized values are exported.
                captures = [...manager.connections].map(([peerId, connection]) => ({
                    peerId, connection, operation: manager.operationOwners.get(connection)
                }));
                result.peers = await Promise.all(captures.map(async ({ peerId, connection, operation }) => {
                    const peer = alias(peerId);
                    const label = operationLabel(operation);
                    if (!operation?.active) return { peer, operation: label, discarded: "unowned-or-inactive-operation" };
                    let report;
                    try { report = await connection.getStats(); }
                    catch (error) {
                        if (rtc !== manager || manager.connections.get(peerId) !== connection ||
                            manager.operationOwners.get(connection) !== operation || !operation.active) {
                            return { peer, operation: label, discarded: "pc-or-operation-changed" };
                        }
                        return { peer, operation: label, states: state(connection, peerId, manager),
                            route: "unknown", routeStatus: "unknown", statsError: errorName(error) };
                    }
                    if (rtc !== manager || manager.connections.get(peerId) !== connection ||
                        manager.operationOwners.get(connection) !== operation || !operation.active) {
                        return { peer, operation: label, discarded: "pc-or-operation-changed" };
                    }
                    const items = [...report.values()];
                    const transports = items.filter(item => item.type === "transport");
                    const selectedIds = new Set(transports.map(item => item.selectedCandidatePairId)
                        .filter(id => typeof id === "string" && id));
                    const pairs = items.filter(item => item.type === "candidate-pair")
                        .map(item => pairSummary(connection, item, report, selectedIds));
                    const selectedPairs = [...selectedIds].map(id => pairs.find(item => item.pair === pairLabel(connection, id)) ||
                        { pair: pairLabel(connection, id), selected: true, unavailable: true, route: "unknown", complete: false });
                    const selectedRoute = selectedPairs.some(pair => pair.route === "relay") ? "relay" :
                        selectedPairs.length && selectedPairs.every(pair => pair.route === "direct" && pair.complete) ? "direct" : "unknown";
                    const states = state(connection, peerId, manager);
                    const active = states.pc === "connected" && ["connected", "completed"].includes(states.ice) &&
                        selectedPairs.length > 0 && selectedPairs.every(pair => pair.complete && pair.state === "succeeded");
                    // relayProtocol describes this client's connection to TURN.
                    // Neither candidate.protocol nor requested URI alone proves it.
                    const observedProtocols = [...new Set(selectedPairs.filter(pair => pair.local?.type === "relay")
                        .map(pair => pair.local.relayProtocol).filter(Boolean))];
                    const observedTurnTransport = active && selectedRoute === "relay" && observedProtocols.length === 1 ?
                        observedProtocols[0] : "unknown";
                    const localCandidates = items.filter(item => item.type === "local-candidate").map(item => candidate(report, item.id));
                    const localRelayCount = localCandidates.filter(item => item?.type === "relay").length;
                    return {
                        peer, operation: label, states,
                        route: active ? selectedRoute : "unknown",
                        observedTurnTransport,
                        routeStatus: active && selectedRoute !== "unknown" ? "active" : selectedIds.size && !active ? "inactive" : "unknown",
                        lastKnownRoute: !active && selectedIds.size ? selectedRoute : null,
                        relayCandidateObserved: localRelayCount > 0 || relayRecords.has(connection),
                        statsLocalRelayCandidates: localRelayCount,
                        selectedPairs, pairs,
                        reportedLocalCandidates: localCandidates,
                        reportedRemoteCandidates: items.filter(item => item.type === "remote-candidate")
                            .map(item => candidate(report, item.id)),
                        dataChannels: items.filter(item => item.type === "data-channel").map(item => ({
                            state: value("dc", item.state), messagesSent: number(item.messagesSent),
                            messagesReceived: number(item.messagesReceived), bytesSent: number(item.bytesSent),
                            bytesReceived: number(item.bytesReceived)
                        }))
                    };
                }));
                // Promise.all is another await boundary: a fast peer can be replaced
                // while another peer's getStats is still pending.
                for (let index = 0; index < captures.length; index += 1) {
                    const { peerId, connection, operation } = captures[index];
                    if (!result.peers[index].discarded && (rtc !== manager ||
                        manager.connections.get(peerId) !== connection ||
                        manager.operationOwners.get(connection) !== operation || !operation?.active)) {
                        result.peers[index] = {
                            peer: alias(peerId), operation: operationLabel(operation),
                            discarded: "pc-or-operation-changed"
                        };
                    }
                }
            }
            if (request !== snapshotSequence || manager !== rtc) {
                return { base: BASE, discarded: "snapshot-superseded", peers: [] };
            }
            // Commit report-derived history only after ownership and request checks.
            for (const [index, { peerId, connection, operation }] of captures.entries()) {
                const peerResult = result.peers[index];
                if (!peerResult.discarded && peerResult.statsLocalRelayCandidates > 0) {
                    markRelay(connection, peerId, operation, "stats", peerResult.statsLocalRelayCandidates);
                }
            }
            result.completedAt = new Date().toISOString();
            result.relayHistory = relayHistory.map(item => ({ ...item }));
            result.lastError = latestError();
            lastSnapshot = result;
            render(result);
            return result;
        } finally {
            activeReads -= 1;
        }
    }
};
