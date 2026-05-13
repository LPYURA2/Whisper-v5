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
    }

};

window.RTCManager = RTCManager;
