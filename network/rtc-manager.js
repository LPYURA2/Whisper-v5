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

    await connection.setLocalDescription(
        offer
    );

    console.log(
        "[RTC] local description set"
    );

    console.log(
        "[RTC] OFFER SDP",
        JSON.stringify(
            connection.localDescription
        )
    );

    return offer;
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
        new RTCSessionDescription(sdp)
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

    console.log(
        "[RTC] ANSWER SDP",
        JSON.stringify(
            connection.localDescription
        )
    );

    return answer;
}

};

window.RTCManager = RTCManager;
