import { WSClient } from "./ws-client.js";

export const RTCManager = {

    peers: new Map(),

    init() {

        console.log("[RTCManager] init");
    },

    createPeerConnection(peerId) {

    console.log(
        "[RTCManager] creating connection",
        peerId
    );

    const connection =
        new RTCPeerConnection({

            iceServers: [
                {
                    urls:
                    "stun:stun.l.google.com:19302"
                }
            ]
        });

    connection.onicecandidate =
    (event) => {

        if (event.candidate) {

            console.log(
                "[RTC] ICE candidate",
                JSON.stringify(
                    event.candidate)
            );

            WSClient.send( {
                type: "ice-candidate",
                target: peerId,
                candidate: event.candidate
            });

        } else {

            console.log(
                "[RTC] ICE gathering complete"
            );
        }
    };

    const channel =
        connection.createDataChannel(
            "chat"
        );

    channel.onopen = () => {

        console.log(
            "[RTC] data channel open",
            peerId
        );
    };

    channel.onmessage = (event) => {

        console.log(
            "[RTC] message",
            peerId,
            event.data
        );
    };

    connection.ondatachannel =
        (event) => {

            const incomingChannel =
                event.channel;

            incomingChannel.onopen =
                () => {

                    console.log(
                        "[RTC] incoming channel open",
                        peerId
                    );
                };

            incomingChannel.onmessage =
                (msgEvent) => {

                    console.log(
                        "[RTC] incoming message",
                        peerId,
                        msgEvent.data
                    );
                };
        };

    this.peers.set(
        peerId,
        connection
    );

    console.log(
        "[RTCManager] connection created",
        peerId
    );

    return connection;
},

    getConnection(peerId) {

        return this.peers.get(peerId);
    },

 async createOffer(peerId) {

    try {

        const connection =
            this.getConnection(peerId);

        if (!connection) {

            console.error(
                "[RTC] no connection",
                peerId
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
            "[RTC] offer created"
        );

        await connection.setLocalDescription(
            offer
        );

        console.log(
            "[RTC] local description set"
        );

        WSClient.send({
            type: "offer",
            target: peerId,
            offer:
                connection.localDescription
        });

        console.log(
            "[RTC] offer sent"
        );

        return offer;

    } catch (error) {

        console.error(
            "[RTC] createOffer failed",
            error
        );

        return null;
    }
},
    async setRemoteDescription(
        peerId,
        sdp
    ) {

        const connection =
            this.getConnection(peerId);

        if (!connection) {

            console.error(
                "[RTC] no connection",
                peerId
            );

            return;
        }

        await connection.setRemoteDescription(
            new RTCSessionDescription(
                sdp
            )
        );

        console.log(
            "[RTC] remote description set"
        );
    },

    async createAnswer(peerId) {

        const connection =
            this.getConnection(peerId);

        if (!connection) {

            console.error(
                "[RTC] no connection",
                peerId
            );

            return null;
        }

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
            "[RTC] answer local description set"
        );

        WSClient.send({
            type: "answer",
            target: peerId,
            answer:
                connection.localDescription
        });

        console.log(
            "[RTC] answer sent"
        );

        return answer;
    },

    async handleOffer(
        peerId,
        offer
    ) {

        console.log(
            "[RTC] handling offer",
            peerId
        );

        let connection =
            this.getConnection(peerId);

        if (!connection) {

            connection =
                this.createPeerConnection(
                    peerId
                );
        }

        await connection.setRemoteDescription(
            new RTCSessionDescription(
                offer
            )
        );

        console.log(
            "[RTC] remote offer set"
        );

        await this.createAnswer(
            peerId
        );
    },

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

    async addIceCandidate(
        peerId,
        candidate
    ) {

        const connection =
            this.getConnection(peerId);

        if (!connection) {

            console.error(
                "[RTC] no connection",
                peerId
            );

            return;
        }

        await connection.addIceCandidate(
            new RTCIceCandidate(
                candidate
            )
        );

        console.log(
            "[RTC] ICE candidate added"
        );
    },

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

};

window.RTCManager = RTCManager;
