import { ProfileManager } from "../profile/profile-manager.js";
import { RTCManager } from "../network/rtc-manager.js";
import { ContactManager } from "../contacts/contact-manager.js";

export const PeerManager = {

    peers: [],

    connections: new Map(),

    retryTimers: new Map(),

    recoveryTimers: new Map(),

    init() {
        console.log("[PeerManager] init");
    },

    updatePeers(peers) {
        const profile = ProfileManager.getProfile();

        if (!profile) {
            console.error("[PeerManager] profile not found");
            return;
        }

        const myId = profile.id;

        this.peers = peers.filter(
            peerId => peerId !== myId
        );

        console.log("[PeerManager] peers updated", this.peers);

        const contacts = ContactManager.getContacts();

        for (const peerId of this.peers) {
            const isContact = contacts.some(
                contact => contact.id === peerId
            );

            if (!isContact) {
                console.log(
                    "[PeerManager] peer is online but not a contact",
                    peerId
                );
                continue;
            }

            console.log(
                "[PeerManager] auto-connect contact",
                peerId
            );

            this.connect(peerId);
        }
    },

    async connect(peerId) {
        if (!peerId) {
            console.error("[PeerManager] invalid peerId");
            return;
        }

        const profile = ProfileManager.getProfile();

        if (!profile) {
            console.error("[PeerManager] profile not found");
            return;
        }

        const myId = profile.id;

        if (peerId === myId) {
            console.log("[PeerManager] cannot connect to self");
            return;
        }

        const existing = RTCManager.getConnection(peerId);

        if (existing) {
            const state = existing.connectionState;

            console.log(
                "[PeerManager] existing connection",
                peerId,
                state
            );

            if (state === "connected" || state === "connecting") {
                console.log(
                    "[PeerManager] connection already active",
                    peerId,
                    state
                );
                return existing;
            }

            const age = RTCManager.getConnectionAge(peerId);

            const staleNew =
                state === "new" && age > 20000;

            if (state === "new" && !staleNew) {
                console.log(
                    "[PeerManager] negotiation still starting",
                    peerId,
                    "ageMs:",
                    age
                );
                return existing;
            }

            if (state === "disconnected") {
                console.warn(
                    "[PeerManager] connection temporarily disconnected; keeping it",
                    peerId
                );
                return existing;
            }

            if (
                state === "failed" ||
                state === "closed" ||
                staleNew
            ) {
                RTCManager.resetPeerConnection(
                    peerId,
                    existing,
                    staleNew
                        ? "stale-new-timeout"
                        : `state-${state}`
                );
            }
        }

        const shouldInitiate =
            myId.localeCompare(peerId) < 0;

        console.log("[PeerManager] connect", peerId);
        console.log("[PeerManager] localId", myId);
        console.log("[PeerManager] peerId", peerId);
        console.log("[PeerManager] initiator", shouldInitiate);

        const connection =
            RTCManager.createPeerConnection(peerId);

        if (!connection) {
            console.error(
                "[PeerManager] failed to create connection",
                peerId
            );
            return;
        }

        if (shouldInitiate) {
            console.log("[PeerManager] creating offer", peerId);

            await RTCManager.createOffer(peerId);

            const oldTimer = this.retryTimers.get(peerId);

            if (oldTimer) {
                clearTimeout(oldTimer);
            }

            const timer = setTimeout(() => {
                this.retryTimers.delete(peerId);

                const current = RTCManager.getConnection(peerId);

                if (
                    !current ||
                    current !== connection ||
                    current.connectionState !== "new"
                ) {
                    return;
                }

                if (RTCManager.getConnectionAge(peerId) < 25000) {
                    return;
                }

                console.warn(
                    "[PeerManager] offer attempt timed out; retrying",
                    peerId
                );

                RTCManager.resetPeerConnection(
                    peerId,
                    connection,
                    "offer-timeout"
                );

                if (this.peers.includes(peerId)) {
                    this.connect(peerId);
                }
            }, 25000);

            this.retryTimers.set(peerId, timer);
        }

        return connection;
    },

    handleConnectionState(peerId, connection, state) {
        const current = RTCManager.getConnection(peerId);

        if (current !== connection) {
            console.log(
                "[PeerManager] ignoring state from stale connection",
                peerId,
                state
            );
            return;
        }

        if (state === "connected") {
            const recoveryTimer = this.recoveryTimers.get(peerId);

            if (recoveryTimer) {
                clearTimeout(recoveryTimer);
            }

            this.recoveryTimers.delete(peerId);

            const retryTimer = this.retryTimers.get(peerId);

            if (retryTimer) {
                clearTimeout(retryTimer);
            }

            this.retryTimers.delete(peerId);
            return;
        }

        if (state === "disconnected") {
            if (this.recoveryTimers.has(peerId)) {
                return;
            }

            console.warn(
                "[PeerManager] temporary disconnect; waiting before reset",
                peerId
            );

            const timer = setTimeout(() => {
                this.recoveryTimers.delete(peerId);

                if (RTCManager.getConnection(peerId) !== connection) {
                    return;
                }

                if (connection.connectionState !== "disconnected") {
                    return;
                }

                console.warn(
                    "[PeerManager] disconnect grace period expired",
                    peerId
                );

                this.recover(
                    peerId,
                    connection,
                    "disconnected-timeout"
                );
            }, 12000);

            this.recoveryTimers.set(peerId, timer);
            return;
        }

        if (state === "failed" || state === "closed") {
            const recoveryTimer = this.recoveryTimers.get(peerId);

            if (recoveryTimer) {
                clearTimeout(recoveryTimer);
            }

            this.recoveryTimers.delete(peerId);

            this.recover(
                peerId,
                connection,
                `state-${state}`
            );
        }
    },

    recover(peerId, connection, reason) {
        if (RTCManager.getConnection(peerId) !== connection) {
            console.log(
                "[PeerManager] recovery skipped; connection changed",
                peerId,
                reason
            );
            return;
        }

        const oldRetryTimer = this.retryTimers.get(peerId);

        if (oldRetryTimer) {
            clearTimeout(oldRetryTimer);
        }

        this.retryTimers.delete(peerId);

        const reset = RTCManager.resetPeerConnection(
            peerId,
            connection,
            reason
        );

        if (!reset) {
            return;
        }

        if (!this.peers.includes(peerId)) {
            console.log(
                "[PeerManager] peer is not currently online; waiting for peers update",
                peerId
            );
            return;
        }

        if (!window.wsClient || !window.wsClient.connected) {
            console.log(
                "[PeerManager] signaling not ready; waiting for peers update",
                peerId
            );
            return;
        }

        const oldTimer = this.recoveryTimers.get(peerId);

        if (oldTimer) {
            clearTimeout(oldTimer);
        }

        const timer = setTimeout(() => {
            this.recoveryTimers.delete(peerId);

            if (RTCManager.getConnection(peerId)) {
                return;
            }

            console.log(
                "[PeerManager] starting recovery attempt",
                peerId,
                reason
            );

            this.connect(peerId);
        }, 1000);

        this.recoveryTimers.set(peerId, timer);
    },

    getPeers() {
        return this.peers;
    }
};

window.PeerManager = PeerManager;
