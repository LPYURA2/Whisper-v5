// Isolated static ExpressTURN test. Credentials are supplied only by the private
// URL fragment, removed synchronously before application startup, and kept in RAM.
import { BUILD_INFO, STUN_URI, TURN_CANDIDATES } from "./turn-poc-build.js";

let runtime = null;
let mode = "all";
let selectedCandidate = null;
let captureError = null;
let preparation = null;
let attempted = false;
let prepared = false;
let secretVariants = [];
const listeners = new Set();

class ConfigError extends Error {
    constructor(code) { super(code); this.code = code; }
}

function captureFragment() {
    if (typeof window === "undefined") { captureError = "config-missing"; return; }
    try {
        const address = new URL(window.location.href);
        const rawFragment = address.hash.slice(1);
        const query = address.searchParams;
        const fragment = new URLSearchParams(rawFragment);
        const usernames = fragment.getAll("turn-user");
        const passwords = fragment.getAll("turn-pass");
        // Remember every supplied variant before validation or any startup log.
        rememberSecrets([...usernames, ...passwords, rawFragment]);
        // Even malformed or unknown fragments are removed; failure is fail-closed.
        if (address.hash) window.history.replaceState(null, "", address.pathname + address.search);
        const requestedMode = query.has("ice") ? query.get("ice") : "all";
        if (query.getAll("ice").length > 1 || !["all", "relay"].includes(requestedMode) ||
            query.has("turn-user") || query.has("turn-pass")) throw new ConfigError("config-invalid");
        mode = requestedMode;
        const requestedCandidate = query.get("turn");
        if (query.getAll("turn").length > 1 ||
            (requestedCandidate !== null && !Object.prototype.hasOwnProperty.call(TURN_CANDIDATES, requestedCandidate))) {
            throw new ConfigError("config-invalid");
        }
        selectedCandidate = requestedCandidate;
        if (rawFragment.length > 32768 || /%(?![A-Fa-f0-9]{2})/.test(rawFragment)) throw new ConfigError("config-invalid");
        // URLSearchParams is deliberately forgiving; reject malformed UTF-8 escapes
        // instead of silently changing a credential to replacement characters.
        try { decodeURIComponent(rawFragment.replace(/\+/g, " ")); }
        catch { throw new ConfigError("config-invalid"); }
        if ([...fragment.keys()].some(key => !["turn-user", "turn-pass"].includes(key)) ||
            usernames.length > 1 || passwords.length > 1) throw new ConfigError("config-invalid");
        if (selectedCandidate === null) {
            // Normal mode starts with the current STUN only until a TURN candidate
            // has a separate physical PASS. A URL fragment never activates TURN.
            if (rawFragment || mode === "relay") throw new ConfigError("candidate-required");
            return;
        }
        if (usernames.length !== 1 || passwords.length !== 1 || usernames[0] === "" || passwords[0] === "") {
            throw new ConfigError("config-missing");
        }
        if (usernames[0].length > 8192 || passwords[0].length > 8192) throw new ConfigError("config-invalid");
        // No Number(), trim(), HMAC or invented expiry: retain exact strings.
        runtime = Object.freeze({ username: usernames[0], credential: passwords[0] });
    } catch (error) {
        runtime = null;
        captureError = error instanceof ConfigError ? error.code : "config-invalid";
    }
}

// Imported by core/app.js before bootstrap, profile storage, logging, signaling
// and PeerConnection creation. There is no backend request or refresh timer.
captureFragment();


// Opening the same private link in an already loaded tab changes only its hash.
// A failed/missing initial setup needs one fresh document so module capture runs
// again. A configured tab only scrubs the incoming hash: its PC/config stay intact.
let recoveryReloadRequested = false;
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("hashchange", () => {
        try {
            const address = new URL(window.location.href);
            if (!address.hash) return;
            const rawFragment = address.hash.slice(1);
            const fragment = new URLSearchParams(rawFragment);
            const usernames = fragment.getAll("turn-user");
            const passwords = fragment.getAll("turn-pass");
            rememberSecrets([...usernames, ...passwords, rawFragment]);
            let validPair = rawFragment.length <= 32768 && !/%(?![A-Fa-f0-9]{2})/.test(rawFragment) &&
                [...fragment.keys()].every(key => ["turn-user", "turn-pass"].includes(key)) &&
                usernames.length === 1 && passwords.length === 1 &&
                usernames[0] !== "" && passwords[0] !== "" &&
                usernames[0].length <= 8192 && passwords[0].length <= 8192;
            try { decodeURIComponent(rawFragment.replace(/\+/g, " ")); }
            catch { validPair = false; }
            if (selectedCandidate && !prepared && !runtime && captureError && validPair && !recoveryReloadRequested) {
                recoveryReloadRequested = true;
                // Keep the new fragment only for this explicit full reload;
                // the next document synchronously removes it before startup.
                // Initial capture errors never trigger reload by themselves.
                try { window.location.reload(); return; } catch { /* Scrub below if navigation is unavailable. */ }
            }
            try { window.history.replaceState(null, "", address.pathname + address.search); }
            catch { /* No config update, recovery or repeated reload on History API failure. */ }
        } catch { /* Never log private incoming URL or native error details. */ }
    });
}

function publish(stage, code = null) {
    const state = Object.freeze({ stage, code, ...TurnPocConfig.getPublicConfig() });
    for (const listener of listeners) {
        try { listener(state); } catch { /* A passive observer cannot change startup. */ }
    }
}

function rememberSecrets(values) {
    const variants = new Set();
    for (const value of values) {
        variants.add(value);
        variants.add(JSON.stringify(value).slice(1, -1));
        try {
            const encoded = encodeURIComponent(value);
            variants.add(encoded);
            variants.add(encoded.replace(/%[0-9A-F]{2}/g, token => token.toLowerCase()));
            const uriEncoded = encodeURI(value);
            variants.add(uriEncoded);
            variants.add(uriEncoded.replace(/%[0-9A-F]{2}/g, token => token.toLowerCase()));
        } catch { /* Invalid Unicode must never cause logging of raw input. */ }
        variants.add(value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"));
        if (typeof btoa === "function" && typeof TextEncoder === "function") {
            try {
                const bytes = new TextEncoder().encode(value);
                variants.add(btoa(String.fromCharCode(...bytes)));
            } catch { /* No fallback that could expose the original value. */ }
        }
    }
    secretVariants = [...new Set([...secretVariants, ...variants])].filter(Boolean).sort((a, b) => b.length - a.length);
}

function redactText(value) {
    let result = String(value);
    for (const secret of secretVariants) result = result.split(secret).join("[REDACTED]");
    try {
        const packet = JSON.parse(result);
        if (packet && typeof packet === "object") return "[Packet omitted from diagnostic log]";
    } catch { /* Ordinary log labels are kept, not parsed or evaluated. */ }
    return result
        .replace(/v1\.[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.[AB]\.\d{10,12}\.[a-f0-9]{32}\.[a-f0-9]{64}/g, '[REDACTED-INVITATION]')
        .replace(/(a=ice-pwd:)[^\r\n]*/gi, '$1[REDACTED]')
        .replace(/("(?:privateKey|password|credential|secretKey|apiKey|authorization|sdp|text|message|content|body|payload|data)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[REDACTED]"');
}

function sanitize(value, seen, depth = 0) {
    if (typeof value === "string") return redactText(value);
    if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "bigint" || typeof value === "symbol") return redactText(String(value));
    if (typeof value === "function") return "[Function]";
    if (depth > 8) return "[Truncated]";
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (Array.isArray(value)) return value.map(item => sanitize(item, seen, depth + 1));
    if (value instanceof Map) return [...value].map(([key, item]) => [sanitize(key, seen, depth + 1), sanitize(item, seen, depth + 1)]);
    if (value instanceof Set) return [...value].map(item => sanitize(item, seen, depth + 1));
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return "[Binary data omitted]";
    const output = {};
    // Explicit Error fields prevent native console inspection from exposing them.
    if (value instanceof Error || Object.prototype.toString.call(value) === "[object DOMException]") {
        output.name = ["Error", "TypeError", "SyntaxError", "InvalidStateError", "OperationError", "NotAllowedError", "AbortError", "NotSupportedError"]
            .includes(value.name) ? value.name : "Error";
        output.message = "[Error details omitted from diagnostic log]";
    }
    try {
        const descriptors = Object.getOwnPropertyDescriptors(value);
        for (const [key, descriptor] of Object.entries(descriptors)) {
            if (!descriptor.enumerable) continue;
            const safeKey = redactText(key);
            if (/^(?:username|credential|password|privatekey|secretkey|apikey|authorization|iceservers|sdp|secret|cookie|set-cookie|invitation|token|text|message|content|body|payload|data|messages)$/i.test(key)) {
                output[safeKey] = "[REDACTED]";
            } else {
                output[safeKey] = "value" in descriptor ? sanitize(descriptor.value, seen, depth + 1) : "[Accessor omitted]";
            }
        }
    } catch { return "[Uninspectable object]"; }
    return output;
}

export const TurnPocConfig = Object.freeze({
    prepare() {
        if (preparation) return preparation;
        preparation = Promise.resolve().then(() => {
            attempted = true;
            if (captureError || (selectedCandidate !== null && !runtime) || (mode === "relay" && selectedCandidate === null)) {
                const code = captureError || "config-missing";
                publish("error", code);
                throw new ConfigError(code);
            }
            prepared = true;
            publish("ready");
            return TurnPocConfig.getPublicConfig();
        });
        return preparation;
    },

    subscribe(listener) {
        if (typeof listener !== "function") return () => {};
        listeners.add(listener);
        return () => listeners.delete(listener);
    },

    getRTCConfiguration() {
        if (!prepared || (selectedCandidate !== null && !runtime)) throw new ConfigError(captureError || "config-unavailable");
        const turn = selectedCandidate === null ? [] : [{
            urls: TURN_CANDIDATES[selectedCandidate].uri, username: runtime.username, credential: runtime.credential
        }];
        return {
            iceServers: mode === "all" ? [{ urls: STUN_URI }, ...turn] : turn,
            iceTransportPolicy: mode
        };
    },

    getPublicConfig() {
        const ready = prepared;
        const turnAvailable = ready && selectedCandidate !== null && runtime !== null;
        const candidate = selectedCandidate === null ? null : TURN_CANDIDATES[selectedCandidate];
        return Object.freeze({
            buildName: BUILD_INFO.name, buildId: BUILD_INFO.id, base: BUILD_INFO.base,
            provider: candidate ? "expressturn" : "none", mode, requestedPolicy: mode,
            candidate: selectedCandidate, transport: candidate ? candidate.transport : "none",
            prepared: ready, turnAvailable,
            configuration: ready ? (turnAvailable ? (mode === "all" ? "stun+turn" : "turn-only") : "stun-only") : attempted ? "unavailable" : "not-prepared",
            fallbackReason: selectedCandidate === null && mode === "all" ? "no-verified-turn" : null,
            providerCandidateStatus: candidate ? "runtime-not-verified" : "no-verified-turn",
            turnUris: candidate ? [candidate.uri] : [], expiresAtMs: null
        });
    },

    sanitizeLogArgs(args) {
        try {
            const values = Array.from(args);
            const label = typeof values[0] === "string" ? values[0] : "";
            if (/\[(?:RAW MESSAGE|APP MESSAGE|Chats)\]/i.test(label) ||
                /\[(?:RTC|WS|UI|Chat(?:Manager)?)\].*(?:packet received|message sent|sendMessage|addMessage|invalid packet|invalid message|message received|sending message)/i.test(label)) {
                return [redactText(label), "[Packet omitted from diagnostic log]"];
            }
            const seen = new WeakSet();
            return values.map(value => sanitize(value, seen));
        } catch { return ["[Log omitted: redaction unavailable]"]; }
    }
});
