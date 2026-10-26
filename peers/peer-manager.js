import { ProfileManager } from "../profile/profile-manager.js";
import { RTCManager } from "../network/rtc-manager.js";
import { ContactManager } from "../contacts/contact-manager.js";

export const PeerManager = {
    peers: [],
    nextOperationId: 0,
    // Control records only. RTCPeerConnection objects remain in RTCManager.
    connections: new Map(),
    retryTimers: new Map(),
    signalingClient: null,
    signalingSocket: null,
    signalingReady: false,
    presenceFresh: false,

    now() { return performance.now(); },

    init() {
        // Assignment is idempotent; RTCManager never schedules its own retries.
        RTCManager.onPeerEvent = event => this.handleRTCEvent(event);
        console.log("[PeerManager] init");
    },

    setSignalingState(client, ready) {
        if (window.wsClient !== client) return;
        const changed = this.signalingClient !== client ||
            this.signalingSocket !== client.socket;
        this.signalingClient = client;
        this.signalingSocket = client.socket;
        this.signalingReady = ready;
        if (changed || !ready) this.presenceFresh = false;
        for (const record of this.connections.values()) this.reconcile(record);
    },

    updatePeers(peers, client = window.wsClient) {
        if (client !== this.signalingClient || !this.signalingReady ||
            !client?.connected || client.socket !== this.signalingSocket) return;
        const id = ProfileManager.getProfile()?.id;
        this.peers = peers.filter(peerId => typeof peerId === "string" && peerId !== id);
        this.presenceFresh = true;
        console.log("[PeerManager] peers updated", this.peers);
        for (const peerId of this.peers) {
            if (ContactManager.getContacts().some(contact => contact.id === peerId)) {
                this.connect(peerId);
            }
        }
        for (const record of this.connections.values()) this.reconcile(record);
    },

    getRecord(peerId) {
        const localId = ProfileManager.getProfile()?.id;
        if (typeof peerId !== "string" || !peerId || !localId || peerId === localId) return null;
        let record = this.connections.get(peerId);
        if (record && record.localId !== localId) {
            this.stop(record, "profile-changed", false);
            this.connections.delete(peerId);
            record = null;
        }
        if (!record) {
            record = {
                peerId, localId, initiator: localId.localeCompare(peerId) < 0,
                operation: null, incoming: null, pendingOffer: null,
                repair: null, everOpen: false, failures: 0, retryAt: 0,
                timerAt: null, remoteSession: null, lastOfferKey: null,
                retiredSessions: []
            };
            this.connections.set(peerId, record);
        }
        return record;
    },

    canStart(record) {
        return ProfileManager.getProfile()?.id === record.localId &&
            ContactManager.getContacts().some(contact => contact.id === record.peerId) &&
            this.signalingReady && this.presenceFresh &&
            this.signalingClient === window.wsClient &&
            this.signalingClient?.connected &&
            this.signalingSocket === this.signalingClient.socket &&
            this.signalingSocket?.readyState === 1 && this.peers.includes(record.peerId);
    },

    connect(peerId) {
        const record = this.getRecord(peerId);
        if (!record) return Promise.resolve(null);
        this.reconcile(record);
        return Promise.resolve(RTCManager.getConnection(peerId) || null);
    },

    deadline(record) {
        const op = record.operation;
        const limits = [];
        if (op?.establishing) {
            limits.push(op.startedAt + 60000);
            if (record.initiator && !op.leftNew) limits.push(op.startedAt + 25000);
            if (op.connectedAt !== null) limits.push(op.connectedAt + 15000);
        }
        if (record.repair) limits.push(record.repair.startedAt + 15000);
        if (record.incoming) limits.push(record.incoming.deadline);
        return limits.length ? Math.min(...limits) : Infinity;
    },

    isCurrent(record, op) {
        return op.active && this.connections.get(record.peerId) === record &&
            record.operation === op && ProfileManager.getProfile()?.id === record.localId &&
            RTCManager.getConnection(record.peerId) === op.pc && this.now() < this.deadline(record);
    },

    arm(record) {
        let due = this.deadline(record);
        if (!record.operation && record.initiator && this.canStart(record) && record.retryAt > this.now()) {
            due = Math.min(due, record.retryAt);
        }
        const previous = this.retryTimers.get(record.peerId);
        if (previous !== undefined && record.timerAt === due) return;
        if (previous !== undefined) clearTimeout(previous);
        this.retryTimers.delete(record.peerId);
        record.timerAt = null;
        if (!Number.isFinite(due)) return;
        const handle = setTimeout(() => {
            // Check ownership BEFORE deleting: a queued old callback must not remove a new timer.
            if (this.connections.get(record.peerId) !== record ||
                this.retryTimers.get(record.peerId) !== handle) return;
            this.retryTimers.delete(record.peerId);
            record.timerAt = null;
            this.reconcile(record);
        }, Math.max(0, due - this.now()));
        this.retryTimers.set(record.peerId, handle);
        record.timerAt = due;
    },

    begin(record, existing = null) {
        if (record.operation) record.operation.active = false;
        const op = {
            token: Symbol("local-rtc-operation"), label: ++this.nextOperationId, active: true, pc: existing,
            startedAt: this.now(), connectedAt: null, leftNew: false, establishing: true,
            signalingClient: window.wsClient, signalingSocket: window.wsClient?.socket,
            remoteSdp: null, valid: null
        };
        op.valid = () => this.isCurrent(record, op);
        record.operation = op;
        record.repair = null;
        record.everOpen = false;
        this.arm(record); // Reserved and armed before createPeerConnection or any await.
        try {
            if (existing) RTCManager.bindOperation(existing, op);
            else op.pc = RTCManager.createPeerConnection(record.peerId, op);
            if (!op.pc) throw new Error("RTCPeerConnection was not created");
            return op;
        } catch (error) {
            console.warn("[PeerManager] create failed", record.peerId, error);
            this.stop(record, "create-failed");
            return null;
        }
    },

    reconcile(record) {
        if (this.connections.get(record.peerId) !== record) return;
        if (record.operation && this.now() >= this.deadline(record)) {
            this.stop(record, "deadline");
            return;
        }
        const pc = RTCManager.getConnection(record.peerId);
        const op = record.operation;
        if (pc && op?.pc === pc) {
            if (pc.connectionState === "failed" || pc.connectionState === "closed" ||
                pc.iceConnectionState === "failed" || pc.signalingState === "closed") {
                this.stop(record, "rtc-failed");
                return;
            }
            const channel = RTCManager.getChannel(record.peerId, pc);
            if (pc.connectionState !== "new") op.leftNew = true;
            if (pc.connectionState === "connected" && channel?.readyState === "open") {
                record.everOpen = true;
                record.repair = null;
                record.failures = 0;
                record.retryAt = 0;
                op.establishing = false;
                this.arm(record);
                return;
            }
            if (op.establishing) {
                if (pc.connectionState === "connected" && op.connectedAt === null) {
                    op.connectedAt = this.now();
                }
                if (this.signalingReady && this.presenceFresh &&
                    op.signalingSocket !== this.signalingSocket) {
                    this.stop(record, "signaling-session-changed");
                    return;
                }
                this.arm(record);
                return;
            }
            // A transient disconnected with an open DC retains the existing policy.
            if (channel?.readyState === "open") { this.arm(record); return; }
            if (!record.repair) {
                record.repair = { startedAt: this.now(), attempted: false };
                console.log("[PeerManager] channel repair", record.peerId);
                this.arm(record);
            }
            if (!RTCManager.canRepairChannel(pc)) {
                this.stop(record, "sctp-not-repairable");
                return;
            }
            const repair = record.repair;
            if (channel?.readyState === "connecting" || channel?.readyState === "closing") return;
            if (!record.initiator) return; // Receiver never competes to create chat.
            if (repair.attempted) { this.stop(record, "repair-channel-closed"); return; }
            repair.attempted = true;
            try {
                RTCManager.createChatChannel(record.peerId, pc);
            } catch (error) {
                console.warn("[PeerManager] channel repair failed", record.peerId, error);
                this.stop(record, "repair-create-failed");
            }
            return;
        }
        if (pc) return; // No ownership of an externally supplied live PC: never silently reset it.
        if (!record.initiator || !this.canStart(record)) { this.arm(record); return; }
        if (record.retryAt > this.now()) { this.arm(record); return; }
        const attempt = this.begin(record);
        if (!attempt) return;
        console.log("[PeerManager] creating offer", record.peerId);
        RTCManager.createOffer(record.peerId, attempt.pc, attempt).then(result => {
            if (record.operation !== attempt || !attempt.active) return;
            if (!result) this.stop(record, "offer-failed");
            else this.reconcile(record);
        }, error => {
            if (record.operation === attempt && attempt.active) {
                console.warn("[PeerManager] offer error", record.peerId, error);
                this.stop(record, "offer-error");
            }
        });
    },

    handleRTCEvent({ peerId, connection, type }) {
        const record = this.connections.get(peerId);
        if (!record || record.operation?.pc !== connection ||
            RTCManager.getConnection(peerId) !== connection || !record.operation.active) return;
        if (type === "sdp-error" || (type === "negotiationneeded" && record.repair)) {
            this.stop(record, type === "sdp-error" ? "remote-sdp-failed" : "repair-needs-sdp");
            return;
        }
        this.reconcile(record);
    },

    retire(record) {
        const session = record.remoteSession;
        if (session?.key && !record.retiredSessions.includes(session.key)) {
            record.retiredSessions.push(session.key);
            if (record.retiredSessions.length > 16) record.retiredSessions.shift();
        }
        record.remoteSession = null;
        record.lastOfferKey = null;
    },

    stop(record, reason, retry = true) {
        const op = record.operation;
        if (!op) return;
        console.log("[PeerManager] reset", record.peerId, "pc-op", op.label, reason);
        op.active = false;
        record.operation = null;
        record.repair = null;
        record.everOpen = false;
        const slot = record.incoming;
        record.incoming = null;
        const timer = this.retryTimers.get(record.peerId);
        if (timer !== undefined) clearTimeout(timer);
        this.retryTimers.delete(record.peerId);
        record.timerAt = null;
        this.retire(record);
        RTCManager.resetPeerConnection(record.peerId, op.pc, reason);
        if (slot) slot.resolve(false); // Release controller; the native Promise may stay pending forever.
        if (retry && record.initiator) {
            const delay = Math.min(3000 * 2 ** Math.min(record.failures, 4), 30000);
            record.failures += 1;
            record.retryAt = this.now() + delay * (1 + Math.random() * 0.2);
            console.log("[PeerManager] retry scheduled", record.peerId, reason, record.retryAt - this.now());
        }
        this.arm(record);
        this.drainOffer(record);
    },

    handleOffer(peerId, offer) {
        const record = this.getRecord(peerId);
        if (!record || record.initiator || offer?.type !== "offer" || typeof offer.sdp !== "string") {
            return Promise.resolve(false);
        }
        // Expire synchronously too: a throttled timer must not keep the slot busy.
        if (record.operation && this.now() >= this.deadline(record)) this.stop(record, "incoming-deadline");
        const key = offer.sdp;
        const session = RTCManager.describeRemote(offer);
        if (record.retiredSessions.includes(session.key)) return Promise.resolve(false);
        if (record.incoming) {
            if (record.incoming.key === key) return record.incoming.promise;
            if (record.pendingOffer?.key === key) return record.pendingOffer.promise;
            // One waiting distinct Offer; do not grow an unbounded queue on input.
            if (record.pendingOffer) return Promise.resolve(false);
            let resolve;
            const promise = new Promise(done => { resolve = done; });
            record.pendingOffer = { key, offer, promise, resolve };
            return promise;
        }
        if (record.lastOfferKey === key) return Promise.resolve(true);
        let pc = RTCManager.getConnection(peerId);
        const previous = record.remoteSession || (pc?.remoteDescription && RTCManager.describeRemote(pc.remoteDescription));
        if (pc && previous?.sessionId && session.sessionId &&
            previous.sessionId !== session.sessionId && previous.iceKey !== session.iceKey) {
            // Native SDP fields distinguish this declared session, but do NOT prove packet freshness (G).
            this.stop(record, "incoming-different-session", false);
            pc = RTCManager.getConnection(peerId);
        }
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        const slot = { key, promise, resolve, deadline: this.now() + 60000 };
        record.incoming = slot;
        const op = this.begin(record, pc || null);
        if (!op) { if (record.incoming === slot) { record.incoming = null; resolve(false); } return promise; }
        op.remoteSdp = offer;
        record.remoteSession = session;
        this.arm(record);
        RTCManager.handleOffer(peerId, offer, op.pc, op).then(result => {
            if (record.incoming !== slot || record.operation !== op || !op.active) return;
            if (!result || this.now() >= slot.deadline) { this.stop(record, "incoming-offer-failed"); return; }
            record.lastOfferKey = key;
            record.incoming = null;
            slot.resolve(true);
            this.reconcile(record);
            this.drainOffer(record);
        }, error => {
            if (record.incoming === slot && record.operation === op && op.active) {
                console.warn("[PeerManager] incoming offer error", peerId, error);
                this.stop(record, "incoming-offer-error");
            }
        });
        return promise;
    },

    drainOffer(record) {
        if (record.incoming || !record.pendingOffer) return;
        const pending = record.pendingOffer;
        record.pendingOffer = null;
        this.handleOffer(record.peerId, pending.offer).then(pending.resolve, () => pending.resolve(false));
    },

    getPeers() { return this.peers; }
};

window.PeerManager = PeerManager;
