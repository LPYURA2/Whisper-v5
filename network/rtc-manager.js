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
