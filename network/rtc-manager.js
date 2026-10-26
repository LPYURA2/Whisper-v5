
console.log("[RTC] NEW VERSION LOADED");

import { UI } from "../ui/ui.js";
import { ProfileManager } from "../profile/profile-manager.js";

export const RTCManager = {

    peers: new Map(),

    connections: new Map(),

    connectionCreatedAt: new Map(),

    channels: new Map(),

    /*
     * ICE candidates, которые пришли до того,
     * как появился RTCPeerConnection.
     */
    pendingCandidates: new Map(),

    /*
     * ICE candidates, которые пришли после создания
     * connection, но до setRemoteDescription().
     */
    candidateQueues: new Map(),

    // Internal ownership only; no operation tokens are put on the wire.
    onPeerEvent: null,
    operationOwners: new WeakMap(),
    channelOwners: new WeakMap(),
    channelLabels: new WeakMap(),
    nextChannelId: 0,
    answerJobs: new WeakMap(),

    bindOperation(connection, operation) {
        operation.pc = connection;
        this.operationOwners.set(connection, operation);
    },

    isCurrent(peerId, connection, operation = this.operationOwners.get(connection)) {
        return !!connection && this.connections.get(peerId) === connection &&
            connection.signalingState !== "closed" &&
            (!operation || (operation.active && operation.pc === connection && operation.valid()));
    },

    notifyPeer(peerId, connection, type, channel = null) {
        const operation = this.operationOwners.get(connection);
        if (this.connections.get(peerId) !== connection || (operation && !operation.active)) return;
        console.log("[RTC] lifecycle", peerId, "pc-op", operation?.label, "dc", this.channelLabels.get(channel), type);
        this.onPeerEvent?.({ peerId, connection, channel, type });
    },

    getChannel(peerId, connection = this.getConnection(peerId)) {
        const channel = this.channels.get(peerId);
        return channel && this.channelOwners.get(channel) === connection ? channel : null;
    },

    canRepairChannel(connection) {
        const local = connection.currentLocalDescription || connection.localDescription;
        const remote = connection.currentRemoteDescription || connection.remoteDescription;
        const data = description => /^m=application\s+(?!0(?:\s|$))\d+\s/m.test(description?.sdp || "");
        return connection.connectionState === "connected" && connection.signalingState === "stable" &&
            connection.sctp?.state === "connected" && data(local) && data(remote);
    },

    createChatChannel(peerId, connection) {
        if (!this.isCurrent(peerId, connection) ||
            ProfileManager.getProfile().id.localeCompare(peerId) >= 0) return null;
        const existing = this.getChannel(peerId, connection);
        if (existing && existing.readyState !== "closed") return existing;
        console.log("[RTC] creating DataChannel as initiator", peerId);
        const channel = connection.createDataChannel("chat");
        this.setupDataChannel(peerId, channel, true, connection);
        return channel;
    },

    describeRemote(description) {
        const sdp = description?.sdp || "";
        const origin = /^o=\S+\s+(\S+)/m.exec(sdp);
        const sections = sdp.split(/(?=^m=)/m);
        const sessionValue = name => new RegExp("^a=" + name + ":([^\\r\\n]+)", "m").exec(sections[0])?.[1];
        const ice = [];
        let index = 0;
        for (const section of sections) {
            if (!section.startsWith("m=")) continue;
            const value = name => new RegExp("^a=" + name + ":([^\\r\\n]+)", "m").exec(section)?.[1];
            if (/^m=application\s+(?!0(?:\s|$))\d+\s/.test(section)) {
                ice.push({ index, mid: value("mid"), ufrag: value("ice-ufrag") || sessionValue("ice-ufrag"),
                    pwd: value("ice-pwd") || sessionValue("ice-pwd") });
            }
            index += 1;
        }
        const sessionId = origin?.[1] || null;
        const iceKey = JSON.stringify(ice);
        return { sessionId, ice, iceKey, key: sessionId ? sessionId + ":" + iceKey : null };
    },

    candidateUfrag(candidate) {
        return candidate?.usernameFragment || /(?:^|\s)ufrag\s+(\S+)/.exec(candidate?.candidate || "")?.[1] || null;
    },

    candidateMatches(connection, candidate) {
        const ufrag = this.candidateUfrag(candidate);
        if (!ufrag) return true; // Unknown ownership stays subject to the browser and limitation G.
        const ice = this.describeRemote(connection.remoteDescription).ice;
        const section = ice.find(item => candidate.sdpMid != null ? item.mid === candidate.sdpMid :
            candidate.sdpMLineIndex != null ? item.index === candidate.sdpMLineIndex : true);
        if (section?.ufrag) return section.ufrag === ufrag;
        const known = ice.map(item => item.ufrag).filter(Boolean);
        return !known.length || known.includes(ufrag);
    },

    pruneCandidates(peerId) {
        const now = performance.now();
        const entries = [...(this.pendingCandidates.get(peerId) || []), ...(this.candidateQueues.get(peerId) || [])];
        const keep = new Set(entries.filter(entry => now - entry.at < 60000)
            .sort((a, b) => a.at - b.at).slice(-256));
        for (const map of [this.pendingCandidates, this.candidateQueues]) {
            const retained = (map.get(peerId) || []).filter(entry => keep.has(entry));
            if (retained.length) map.set(peerId, retained);
            else map.delete(peerId);
        }
    },

    queueCandidate(peerId, candidate, connection, pending = false) {
        const map = pending ? this.pendingCandidates : this.candidateQueues;
        const entries = map.get(peerId) || [];
        entries.push({ candidate, ufrag: this.candidateUfrag(candidate), at: performance.now(), owner: connection });
        map.set(peerId, entries);
        this.pruneCandidates(peerId);
    },

    preserveFutureCandidates(peerId, connection) {
        this.pruneCandidates(peerId);
        const description = connection.remoteDescription || this.operationOwners.get(connection)?.remoteSdp;
        const oldUfrags = new Set(this.describeRemote(description).ice.map(item => item.ufrag).filter(Boolean));
        const retained = [...(this.pendingCandidates.get(peerId) || []), ...(this.candidateQueues.get(peerId) || [])]
            .filter(entry => entry.ufrag && !oldUfrags.has(entry.ufrag));
        this.candidateQueues.delete(peerId);
        if (retained.length) this.pendingCandidates.set(peerId, retained);
        else this.pendingCandidates.delete(peerId);
    },

    canSignal(operation) {
        const client = window.wsClient;
        return !!client?.connected && (!operation ||
            (operation.signalingClient === client && operation.signalingSocket === client.socket));
    },

    init() {

        console.log(
            "[RTCManager] init"
        );
    },

    /*
     * =========================================================
     * CREATE PEER CONNECTION
     * =========================================================
     */

    createPeerConnection(peerId, operation = null) {

        console.log(
            "[RTCManager] createPeerConnection",
            peerId
        );

        /*
         * Не создаём второй RTCPeerConnection
         * для одного PeerID.
         */

        const existingConnection =
            this.connections.get(peerId);

        if (existingConnection) {

            console.log(
                "[RTCManager] connection already exists",
                peerId
            );

            return existingConnection;
        }

        /*
         * =====================================================
         * DETERMINE INITIATOR
         * =====================================================
         *
         * Правило остаётся тем же:
         *
         * localId < remoteId
         *        ↓
         *     initiator
         *
         * Initiator создаёт DataChannel.
         * Receiver только принимает его.
         */

        const localId =
            ProfileManager
                .getProfile()
                .id;

        const isInitiator =
            localId.localeCompare(peerId) < 0;

        console.log(
            "[RTC] role",
            peerId,
            isInitiator
                ? "INITIATOR"
                : "RECEIVER"
        );

        /*
         * =====================================================
         * CREATE RTCPeerConnection
         * =====================================================
         */

        const connection =
            new RTCPeerConnection({

                iceServers: [

                    {
                        urls:
                            "stun:stun.l.google.com:19302"
                    }

                ]
            });

        this.connections.set(
            peerId,
            connection
        );

        if (operation) this.bindOperation(connection, operation);

        this.connectionCreatedAt.set(
            peerId,
            Date.now()
        );

        /*
         * Создаём очередь ICE для этого connection.
         */

        if (
            !this.candidateQueues.has(
                peerId
            )
        ) {

            this.candidateQueues.set(
                peerId,
                []
            );
        }

        console.log(
            "[RTC] connection created",
            peerId
        );

        /*
         * =====================================================
         * WEBRTC STATE LOGGING
         * =====================================================
         */

        connection.onsignalingstatechange =
            () => {
                if (!this.isCurrent(peerId, connection)) return;
                this.notifyPeer(peerId, connection, "signaling");
                console.log(
                    "[RTC] signalingState",
                    peerId,
                    connection.signalingState
                );
            };

        connection.onicegatheringstatechange =
            () => {
                if (!this.isCurrent(peerId, connection)) return;
                console.log(
                    "[RTC] iceGatheringState",
                    peerId,
                    connection.iceGatheringState
                );
            };

        connection.oniceconnectionstatechange =
            () => {
                if (this.connections.get(peerId) !== connection) return;
                this.notifyPeer(peerId, connection, "ice");
                console.log(
                    "[RTC] iceConnectionState",
                    peerId,
                    connection.iceConnectionState
                );
            };

        connection.onconnectionstatechange =
            () => {
                if (this.connections.get(peerId) !== connection) return;
                this.notifyPeer(peerId, connection, "connection");
                console.log(
                    "[RTC] connectionState",
                    peerId,
                    connection.connectionState
                );

                if (
                    connection.connectionState ===
                    "connected"
                ) {

                    console.log(
                        "[RTC] CONNECTED",
                        peerId
                    );
                }

                if (
                    connection.connectionState ===
                    "failed"
                ) {

                    console.warn(
                        "[RTC] CONNECTION FAILED",
                        peerId
                    );
                }

                if (
                    connection.connectionState ===
                    "disconnected"
                ) {

                    console.warn(
                        "[RTC] CONNECTION DISCONNECTED",
                        peerId
                    );
                }

                if (
                    connection.connectionState ===
                    "closed"
                ) {

                    console.warn(
                        "[RTC] CONNECTION CLOSED",
                        peerId
                    );
                }
            };

        /*
         * =====================================================
         * ICE CANDIDATE
         * =====================================================
         */

        connection.onicecandidate =
            (event) => {
                const owner = this.operationOwners.get(connection);
                if (!this.isCurrent(peerId, connection, owner)) return;
                // A live PC may emit fresh ICE after WS reconnect; only unfinished SDP is socket-bound.
                if (owner?.establishing ? !this.canSignal(owner) : !window.wsClient?.connected) return;
                if (event.candidate) {

                    console.log(
                        "[RTC] ICE candidate generated",
                        peerId
                    );

                    const sent =
                        window.wsClient.send({

                            type:
                                "ice-candidate",

                            target:
                                peerId,

                            from:
                                localId,

                            candidate:
                                event.candidate
                        });

                    if (!sent) {

                        console.warn(
                            "[RTC] ICE candidate could not be sent",
                            peerId
                        );
                    }

                } else {

                    console.log(
                        "[RTC] ICE gathering complete",
                        peerId
                    );
                }
            };

        /*
         * =====================================================
         * INCOMING DATA CHANNEL
         * =====================================================
         *
         * Receiver enters here.
         *
         * Initiator does NOT use this to create another channel.
         */

        connection.onnegotiationneeded = () => {
            if (this.isCurrent(peerId, connection)) this.notifyPeer(peerId, connection, "negotiationneeded");
        };

        connection.ondatachannel =
            (event) => {
                if (!this.isCurrent(peerId, connection)) { event.channel.close(); return; }
                console.log(
                    "[RTC] incoming DataChannel",
                    peerId,
                    event.channel.label
                );

                const incomingChannel =
                    event.channel;

                this.setupDataChannel(
                    peerId,
                    incomingChannel,
                    false,
                    connection
                );
            };

        /*
         * =====================================================
         * INITIATOR DATA CHANNEL
         * =====================================================
         *
         * Only initiator creates "chat".
         */

        if (isInitiator) this.createChatChannel(peerId, connection);
        else console.log("[RTC] waiting for incoming DataChannel", peerId);
        this.pruneCandidates(peerId);

        console.log(
            "[RTCManager] connection ready",
            peerId
        );

        return connection;
    },

    /*
     * =========================================================
     * DATA CHANNEL SETUP
     * =========================================================
     */

    setupDataChannel(
        peerId,
        channel,
        local,
        connection = this.getConnection(peerId)
    ) {
        if (!this.isCurrent(peerId, connection)) { channel.close(); return; }
        this.channelOwners.set(channel, connection);
        this.channelLabels.set(channel, ++this.nextChannelId);
        const current = () => this.isCurrent(peerId, connection) && this.channels.get(peerId) === channel;


        /*
         * Если у нас уже есть открытый/открывающийся канал,
         * не заменяем его случайным вторым каналом.
         */

        const existingChannel =
            this.channels.get(
                peerId
            );

        if (
            existingChannel &&
            existingChannel !== channel &&
            (
                existingChannel.readyState === "open" ||
                existingChannel.readyState === "connecting"
            )
        ) {

            console.warn(
                "[RTC] duplicate DataChannel ignored",
                peerId,
                channel.label
            );

            try {
                channel.close();
            } catch (err) {
                console.warn(
                    "[RTC] failed to close duplicate channel",
                    err
                );
            }

            return;
        }

        this.channels.set(
            peerId,
            channel
        );

        console.log(
            "[RTC] DataChannel registered",
            peerId,
            local
                ? "local"
                : "incoming"
        );

        /*
         * =====================================================
         * CHANNEL OPEN
         * =====================================================
         */

        channel.onopen =
            () => {
                if (!current()) return;
                this.notifyPeer(peerId, connection, "channel-open", channel);
                console.log(
                    "[RTC] DATA CHANNEL OPEN",
                    peerId
                );

                console.log(
                    "[RTC] channel state",
                    peerId,
                    channel.readyState
                );
            };

        /*
         * =====================================================
         * CHANNEL CLOSE
         * =====================================================
         */

        if ("onclosing" in channel) channel.onclosing = () => {
            if (current()) this.notifyPeer(peerId, connection, "channel-closing", channel);
        };

        channel.onclose =
            () => {
                if (!current()) return;
                console.warn(
                    "[RTC] DataChannel CLOSED",
                    peerId
                );

                /*
                 * Удаляем только этот канал.
                 * Если уже появился другой — его не трогаем.
                 */

                if (
                    this.channels.get(
                        peerId
                    ) === channel
                ) {

                    this.channels.delete(
                        peerId
                    );
                }
                this.notifyPeer(peerId, connection, "channel-close", channel);
            };

        /*
         * =====================================================
         * CHANNEL ERROR
         * =====================================================
         */

        channel.onerror =
            (error) => {
                if (!current()) return;
                this.notifyPeer(peerId, connection, "channel-error", channel);
                console.error(
                    "[RTC] DataChannel ERROR",
                    peerId,
                    error
                );
            };

        /*
         * =====================================================
         * CHANNEL MESSAGE
         * =====================================================
         */

        channel.onmessage =
            (event) => {
                if (!current()) return;
                try {

                    const packet =
                        JSON.parse(
                            event.data
                        );

                    console.log(
                        "[RTC] packet received",
                        peerId,
                        packet
                    );

                    if (
                        packet.type ===
                        "chat"
                    ) {

                        UI.addMessage(
                            packet.text,
                            false
                        );

                        return;
                    }

                    console.warn(
                        "[RTC] unknown packet",
                        packet
                    );

                } catch (err) {

                    console.error(
                        "[RTC] invalid packet",
                        peerId,
                        err
                    );
                }
            };
    },

    /*
     * =========================================================
     * GET CONNECTION
     * =========================================================
     */

    getConnection(peerId) {

        return this.connections.get(
            peerId
        );
    },

    /*
     * =========================================================
     * CONNECTION AGE
     * =========================================================
     */

    getConnectionAge(peerId) {

        const connection =
            this.connections.get(peerId);

        const createdAt =
            this.connectionCreatedAt.get(peerId);

        if (
            !connection ||
            createdAt === undefined
        ) {
            return 0;
        }

        return Math.max(
            0,
            Date.now() - createdAt
        );
    },

    /*
     * =========================================================
     * RESET PEER CONNECTION
     * =========================================================
     */

    resetPeerConnection(
        peerId,
        expectedConnection,
        reason = "manual-reset"
    ) {

        const connection =
            this.connections.get(peerId);

        if (!connection) {
            return false;
        }

        /*
         * Не позволяем старому таймеру закрыть новое соединение.
         */

        if (
            expectedConnection &&
            connection !== expectedConnection
        ) {

            console.warn(
                "[RTC] reset skipped: connection instance changed",
                peerId,
                reason
            );

            return false;
        }

        console.warn(
            "[RTC] resetting peer connection",
            peerId,
            reason
        );

        const operation = this.operationOwners.get(connection);
        if (operation) operation.active = false;
        this.preserveFutureCandidates(peerId, connection);
        const channel = this.getChannel(peerId, connection);

        if (channel) {

            this.channels.delete(peerId);

            channel.onopen = null;
            channel.onclose = null;
            channel.onclosing = null;
            channel.onerror = null;
            channel.onmessage = null;

            try {

                if (channel.readyState !== "closed") {
                    channel.close();
                }

            } catch (error) {

                console.warn(
                    "[RTC] failed to close old DataChannel",
                    peerId,
                    error
                );
            }
        }

        if (
            this.connections.get(peerId) !== connection
        ) {
            return false;
        }

        this.connections.delete(peerId);
        this.connectionCreatedAt.delete(peerId);

        /*
         * Не переносим ICE-кандидаты старого соединения
         * в новое соединение.
         */

        // Distinguishable early ICE for a different SDP was retained above.

        connection.onnegotiationneeded = null;
        connection.onicecandidate = null;
        connection.ondatachannel = null;
        connection.onconnectionstatechange = null;
        connection.oniceconnectionstatechange = null;
        connection.onsignalingstatechange = null;
        connection.onicegatheringstatechange = null;

        try {

            if (connection.signalingState !== "closed") {
                connection.close();
            }

        } catch (error) {

            console.warn(
                "[RTC] failed to close old RTCPeerConnection",
                peerId,
                error
            );
        }

        return true;
    },

    /*
     * =========================================================
     * CREATE OFFER
     * =========================================================
     */

    async createOffer(peerId, connection = this.getConnection(peerId), operation = this.operationOwners.get(connection)) {
        try {
            if (!this.isCurrent(peerId, connection, operation) || connection.signalingState !== "stable") return null;
            const offer = await connection.createOffer();
            if (!this.isCurrent(peerId, connection, operation)) return null;
            await connection.setLocalDescription(offer);
            if (!this.isCurrent(peerId, connection, operation) || !this.canSignal(operation)) return null;
            const sent = window.wsClient.send({
                type: "offer", target: peerId, from: ProfileManager.getProfile().id,
                offer: connection.localDescription
            });
            if (!sent) return null;
            console.log("[RTC] offer sent", peerId);
            return offer;
        } catch (error) {
            console.warn("[RTC] createOffer failed", peerId, error);
            return null;
        }
    },

    async setRemoteDescription(peerId, sdp, connection = this.getConnection(peerId), operation = this.operationOwners.get(connection)) {
        try {
            if (!this.isCurrent(peerId, connection, operation)) return false;
            await connection.setRemoteDescription(new RTCSessionDescription(sdp));
            if (!this.isCurrent(peerId, connection, operation)) return false;
            console.log("[RTC] remote description set", peerId);
            await this.flushCandidateQueue(peerId, connection, operation);
            return this.isCurrent(peerId, connection, operation);
        } catch (error) {
            console.warn("[RTC] setRemoteDescription failed", peerId, error);
            return false;
        }
    },

    async createAnswer(peerId, connection = this.getConnection(peerId), operation = this.operationOwners.get(connection)) {
        try {
            if (!this.isCurrent(peerId, connection, operation) || connection.signalingState !== "have-remote-offer") return null;
            const answer = await connection.createAnswer();
            if (!this.isCurrent(peerId, connection, operation)) return null;
            await connection.setLocalDescription(answer);
            if (!this.isCurrent(peerId, connection, operation) || !this.canSignal(operation)) return null;
            const sent = window.wsClient.send({
                type: "answer", target: peerId, from: ProfileManager.getProfile().id,
                answer: connection.localDescription
            });
            if (!sent) return null;
            console.log("[RTC] answer sent", peerId);
            return answer;
        } catch (error) {
            console.warn("[RTC] createAnswer failed", peerId, error);
            return null;
        }
    },

    async handleOffer(peerId, offer, connection = this.getConnection(peerId), operation = this.operationOwners.get(connection)) {
        if (!await this.setRemoteDescription(peerId, offer, connection, operation)) return false;
        if (!this.isCurrent(peerId, connection, operation)) return false;
        return !!await this.createAnswer(peerId, connection, operation);
    },

    handleAnswer(peerId, answer) {
        const connection = this.getConnection(peerId);
        const operation = this.operationOwners.get(connection);
        if (!this.isCurrent(peerId, connection, operation) || connection.signalingState !== "have-local-offer") {
            return Promise.resolve(false);
        }
        const existing = this.answerJobs.get(connection);
        if (existing) return existing.promise;
        const job = {};
        this.answerJobs.set(connection, job);
        job.promise = this.setRemoteDescription(peerId, answer, connection, operation).then(result => {
            if (this.isCurrent(peerId, connection, operation)) this.notifyPeer(peerId, connection, result ? "answer" : "sdp-error");
            return result;
        }).finally(() => {
            if (this.answerJobs.get(connection) === job) this.answerJobs.delete(connection);
        });
        return job.promise;
    },

    async addIceCandidate(peerId, candidate) {
        if (typeof peerId !== "string" || !peerId || !candidate) return;
        this.pruneCandidates(peerId);
        const connection = this.getConnection(peerId);
        const operation = this.operationOwners.get(connection);
        if (!this.isCurrent(peerId, connection, operation)) {
            this.queueCandidate(peerId, candidate, null, true);
            return;
        }
        if (!connection.remoteDescription) {
            this.queueCandidate(peerId, candidate, connection);
            return;
        }
        if (!this.candidateMatches(connection, candidate)) {
            this.queueCandidate(peerId, candidate, null, true);
            return;
        }
        try {
            if (!this.isCurrent(peerId, connection, operation)) return;
            await connection.addIceCandidate(new RTCIceCandidate(candidate));
            if (this.isCurrent(peerId, connection, operation)) console.log("[RTC] ICE candidate added", peerId);
        } catch (error) {
            console.warn("[RTC] addIceCandidate failed", peerId, error);
        }
    },

    async flushCandidateQueue(peerId, connection = this.getConnection(peerId), operation = this.operationOwners.get(connection)) {
        if (!this.isCurrent(peerId, connection, operation) || !connection.remoteDescription) return;
        this.pruneCandidates(peerId);
        const ready = [];
        for (const map of [this.candidateQueues, this.pendingCandidates]) {
            const waiting = [];
            for (const entry of map.get(peerId) || []) {
                if (this.candidateMatches(connection, entry.candidate)) ready.push(entry);
                else waiting.push(entry);
            }
            if (waiting.length) map.set(peerId, waiting);
            else map.delete(peerId);
        }
        for (const entry of ready) {
            if (!this.isCurrent(peerId, connection, operation)) return;
            try {
                await connection.addIceCandidate(new RTCIceCandidate(entry.candidate));
                if (!this.isCurrent(peerId, connection, operation)) return;
            } catch (error) {
                console.warn("[RTC] queued ICE candidate failed", peerId, error);
            }
        }
    },

    async handleCandidate(peerId, candidate) {
        await this.addIceCandidate(peerId, candidate);
    },

    sendMessage(
        peerId,
        text
    ) {

        const channel =
            this.channels.get(
                peerId
            );

        if (!channel) {

            console.error(
                "[RTC] no DataChannel",
                peerId
            );

            return false;
        }

        console.log(
            "[RTC] sendMessage channel state",
            peerId,
            channel.readyState
        );

        if (
            channel.readyState !==
            "open"
        ) {

            console.warn(
                "[RTC] DataChannel not open yet",
                peerId,
                channel.readyState
            );

            return false;
        }

        const packet = {

            type:
                "chat",

            id:
                crypto.randomUUID(),

            timestamp:
                Date.now(),

            from:
                ProfileManager
                    .getProfile()
                    .id,

            text
        };

        try {

            channel.send(
                JSON.stringify(
                    packet
                )
            );

            UI.addMessage(
                text,
                true
            );

            console.log(
                "[RTC] message sent",
                peerId,
                packet
            );

            return true;

        } catch (error) {

            console.error(
                "[RTC] message send failed",
                peerId,
                error
            );

            return false;
        }
    }
};

window.RTCManager =
    RTCManager;
