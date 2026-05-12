export const RTCManager = {

    peers: new Map(),

    init() {

        console.log("[RTC] init");
    },

    createPeerConnection(peerId) {

        console.log(
            "[RTC] creating connection",
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

        connection.onconnectionstatechange =
            () => {

                console.log(
                    "[RTC] state",
                    peerId,
                    connection.connectionState
                );
            };

        connection.onicecandidate =
            (event) => {

                if (!event.candidate) {
                    return;
                }

                console.log(
                    "[RTC] ice candidate",
                    peerId,
                    event.candidate
                );
            };

        this.peers.set(
            peerId,
            connection
        );

        return connection;
    },

    getConnection(peerId) {

        return this.peers.get(peerId);
    },

    hasConnection(peerId) {

        return this.peers.has(peerId);
    },

    removeConnection(peerId) {

        const connection =
            this.peers.get(peerId);

        if (connection) {

            connection.close();

            this.peers.delete(peerId);

            console.log(
                "[RTC] removed",
                peerId
            );
        }
    }
};

window.RTCManager = RTCManager;
