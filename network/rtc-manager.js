console.log("[RTC] NEW VERSION LOADED");

import { UI } from "../ui/ui.js";
import { ProfileManager } from "../profile/profile-manager.js";

export const RTCManager = {

    peers: new Map(),

    connections: new Map(),

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

    createPeerConnection(peerId) {

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

                console.log(
                    "[RTC] signalingState",
                    peerId,
                    connection.signalingState
                );
            };

        connection.onicegatheringstatechange =
            () => {

                console.log(
                    "[RTC] iceGatheringState",
                    peerId,
                    connection.iceGatheringState
                );
            };

        connection.oniceconnectionstatechange =
            () => {

                console.log(
                    "[RTC] iceConnectionState",
                    peerId,
                    connection.iceConnectionState
                );
            };

        connection.onconnectionstatechange =
            () => {

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

        connection.ondatachannel =
            (event) => {

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
                    false
                );
            };

        /*
         * =====================================================
         * INITIATOR DATA CHANNEL
         * =====================================================
         *
         * Only initiator creates "chat".
         */

        if (isInitiator) {

            console.log(
                "[RTC] creating DataChannel as initiator",
                peerId
            );

            const channel =
                connection.createDataChannel(
                    "chat"
                );

            this.setupDataChannel(
                peerId,
                channel,
                true
            );

        } else {

            console.log(
                "[RTC] waiting for incoming DataChannel",
                peerId
            );
        }

        /*
         * =====================================================
         * RESTORE EARLY ICE
         * =====================================================
         *
         * Candidate could have arrived before the connection
         * existed.
         */

        const earlyCandidates =
            this.pendingCandidates.get(
                peerId
            );

        if (
            earlyCandidates &&
            earlyCandidates.length > 0
        ) {

            console.log(
                "[RTC] restoring early ICE candidates",
                peerId,
                earlyCandidates.length
            );

            const queue =
                this.candidateQueues.get(
                    peerId
                );

            queue.push(
                ...earlyCandidates
            );

            this.pendingCandidates.delete(
                peerId
            );
        }

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
        local
    ) {

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

        channel.onclose =
            () => {

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
            };

        /*
         * =====================================================
         * CHANNEL ERROR
         * =====================================================
         */

        channel.onerror =
            (error) => {

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
     * CREATE OFFER
     * =========================================================
     */

    async createOffer(peerId) {

        try {

            const connection =
                this.getConnection(
                    peerId
                );

            if (!connection) {

                console.error(
                    "[RTC] createOffer: no connection",
                    peerId
                );

                return null;
            }

            /*
             * Не создаём новый offer,
             * если signaling state уже не stable.
             */

            if (
                connection.signalingState !==
                "stable"
            ) {

                console.warn(
                    "[RTC] cannot create offer in state",
                    peerId,
                    connection.signalingState
                );

                return null;
            }

            console.log(
                "[RTC] creating offer",
                peerId
            );

            const offer =
                await connection.createOffer();

            console.log(
                "[RTC] offer created",
                peerId
            );

            await connection.setLocalDescription(
                offer
            );

            console.log(
                "[RTC] local description set",
                peerId
            );

            const sent =
                window.wsClient.send({

                    type:
                        "offer",

                    target:
                        peerId,

                    from:
                        ProfileManager
                            .getProfile()
                            .id,

                    offer:
                        connection.localDescription
                });

            if (!sent) {

                console.error(
                    "[RTC] offer could not be sent",
                    peerId
                );

                return null;
            }

            console.log(
                "[RTC] offer sent",
                peerId
            );

            return offer;

        } catch (error) {

            console.error(
                "[RTC] createOffer failed",
                peerId,
                error
            );

            return null;
        }
    },

    /*
     * =========================================================
     * SET REMOTE DESCRIPTION
     * =========================================================
     */

    async setRemoteDescription(
        peerId,
        sdp
    ) {

        const connection =
            this.getConnection(
                peerId
            );

        if (!connection) {

            console.error(
                "[RTC] setRemoteDescription: no connection",
                peerId
            );

            return false;
        }

        try {

            await connection.setRemoteDescription(
                new RTCSessionDescription(
                    sdp
                )
            );

            console.log(
                "[RTC] remote description set",
                peerId
            );

            /*
             * Теперь можно применить ICE candidates,
             * которые ждали remoteDescription.
             */

            await this.flushCandidateQueue(
                peerId
            );

            return true;

        } catch (error) {

            console.error(
                "[RTC] setRemoteDescription failed",
                peerId,
                error
            );

            return false;
        }
    },

    /*
     * =========================================================
     * CREATE ANSWER
     * =========================================================
     */

    async createAnswer(peerId) {

        const connection =
            this.getConnection(
                peerId
            );

        if (!connection) {

            console.error(
                "[RTC] createAnswer: no connection",
                peerId
            );

            return null;
        }

        try {

            console.log(
                "[RTC] creating answer",
                peerId
            );

            const answer =
                await connection.createAnswer();

            await connection.setLocalDescription(
                answer
            );

            console.log(
                "[RTC] answer local description set",
                peerId
            );

            const sent =
                window.wsClient.send({

                    type:
                        "answer",

                    target:
                        peerId,

                    from:
                        ProfileManager
                            .getProfile()
                            .id,

                    answer:
                        connection.localDescription
                });

            if (!sent) {

                console.error(
                    "[RTC] answer could not be sent",
                    peerId
                );

                return null;
            }

            console.log(
                "[RTC] answer sent",
                peerId
            );

            return answer;

        } catch (error) {

            console.error(
                "[RTC] createAnswer failed",
                peerId,
                error
            );

            return null;
        }
    },

    /*
     * =========================================================
     * HANDLE OFFER
     * =========================================================
     */

    async handleOffer(
        peerId,
        offer
    ) {

        console.log(
            "[RTC] handling offer",
            peerId
        );

        try {

            let connection =
                this.getConnection(
                    peerId
                );

            if (!connection) {

                console.log(
                    "[RTC] creating receiver connection",
                    peerId
                );

                connection =
                    this.createPeerConnection(
                        peerId
                    );
            }

            const success =
                await this.setRemoteDescription(
                    peerId,
                    offer
                );

            if (!success) {

                console.error(
                    "[RTC] failed to set remote offer",
                    peerId
                );

                return;
            }

            console.log(
                "[RTC] remote offer set",
                peerId
            );

            await this.createAnswer(
                peerId
            );

        } catch (error) {

            console.error(
                "[RTC] handleOffer failed",
                peerId,
                error
            );
        }
    },

    /*
     * =========================================================
     * HANDLE ANSWER
     * =========================================================
     */

    async handleAnswer(
        peerId,
        answer
    ) {

        console.log(
            "[RTC] handling answer",
            peerId
        );

        await this.setRemoteDescription(
            peerId,
            answer
        );
    },

    /*
     * =========================================================
     * ADD ICE CANDIDATE
     * =========================================================
     */

    async addIceCandidate(
        peerId,
        candidate
    ) {

        /*
         * Если connection ещё не существует,
         * сохраняем candidate.
         */

        const connection =
            this.getConnection(
                peerId
            );

        if (!connection) {

            console.log(
                "[RTC] queueing ICE: no connection yet",
                peerId
            );

            if (
                !this.pendingCandidates.has(
                    peerId
                )
            ) {

                this.pendingCandidates.set(
                    peerId,
                    []
                );
            }

            this.pendingCandidates
                .get(peerId)
                .push(candidate);

            return;
        }

        /*
         * Если remoteDescription ещё не установлен,
         * откладываем candidate.
         */

        if (
            !connection.remoteDescription
        ) {

            console.log(
                "[RTC] queueing ICE: remote description not set",
                peerId
            );

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

            this.candidateQueues
                .get(peerId)
                .push(candidate);

            return;
        }

        try {

            await connection.addIceCandidate(
                new RTCIceCandidate(
                    candidate
                )
            );

            console.log(
                "[RTC] ICE candidate added",
                peerId
            );

        } catch (error) {

            console.error(
                "[RTC] addIceCandidate failed",
                peerId,
                error
            );
        }
    },

    /*
     * =========================================================
     * FLUSH ICE QUEUE
     * =========================================================
     */

    async flushCandidateQueue(
        peerId
    ) {

        const connection =
            this.getConnection(
                peerId
            );

        if (!connection) {
            return;
        }

        if (
            !connection.remoteDescription
        ) {
            return;
        }

        const queue =
            this.candidateQueues.get(
                peerId
            );

        if (
            !queue ||
            queue.length === 0
        ) {

            return;
        }

        console.log(
            "[RTC] flushing ICE queue",
            peerId,
            queue.length
        );

        this.candidateQueues.delete(
            peerId
        );

        for (
            const candidate
            of queue
        ) {

            try {

                await connection.addIceCandidate(
                    new RTCIceCandidate(
                        candidate
                    )
                );

                console.log(
                    "[RTC] queued ICE candidate added",
                    peerId
                );

            } catch (error) {

                console.error(
                    "[RTC] queued ICE candidate failed",
                    peerId,
                    error
                );
            }
        }
    },

    /*
     * =========================================================
     * HANDLE CANDIDATE
     * =========================================================
     */

    async handleCandidate(
        peerId,
        candidate
    ) {

        console.log(
            "[RTC] handling candidate",
            peerId
        );

        await this.addIceCandidate(
            peerId,
            candidate
        );
    },

    /*
     * =========================================================
     * SEND MESSAGE
     * =========================================================
     */

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
