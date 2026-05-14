import { PeerManager } from '../peers/peer-manager.js';
import { ProfileManager } from '../profile/profile-manager.js';
import { RTCManager } from './rtc-manager.js';

const SIGNAL_SERVER =
    "wss://whisper-signaling.onrender.com";

export class WSClient {

    constructor() {

        this.url = null;

        this.socket = null;

        this.connected = false;

        this.peerId =
            crypto.randomUUID();

        this.peers = [];

        this.reconnectDelay = 3000;
    }

    connect() {

        console.log("[WS] connecting...");

        this.socket =
            new WebSocket(SIGNAL_SERVER);

        this.socket.addEventListener(
            "open",
            () => {

                this.connected = true;

                console.log("[WS] connected");

                console.log(
                    "[WS] state",
                    this.socket.readyState
                );

                this.send({
                    type: "join",
                    peerId: this.peerId
                });
            }
        );

        this.socket.addEventListener(
            "message",
            (event) => {

                console.log(
                    "[RAW MESSAGE]",
                    event.data
                );

                try {

                    const data =
                        JSON.parse(event.data);

                    console.log(
                        "[WS] message",
                        data
                    );

                    this.handleMessage(data);

                } catch (err) {

                    console.error(
                        "[WS] invalid message",
                        err
                    );
                }
            }
        );

        this.socket.addEventListener(
            "close",
            () => {

                this.connected = false;

                console.warn(
                    "[WS] disconnected"
                );

                setTimeout(() => {

                    this.connect();

                }, this.reconnectDelay);
            }
        );

        this.socket.addEventListener(
            "error",
            (err) => {

                console.error(
                    "[WS] error",
                    err
                );
            }
        );
    }

    send(data) {

        if (!this.connected) {
            return;
        }

        this.socket.send(
            JSON.stringify(data)
        );
    }

    handleMessage(data) {

        switch (data.type) {

            case "welcome":

                console.log(
                    "[WS] server welcome"
                );

                break;

            case "peers":

                PeerManager.updatePeers(
                    data.peers
                );

                this.peers = data.peers;

                for (
                    const peerId
                    of data.peers
                ) {

                    const myId =
                        ProfileManager
                            .getProfile()
                            .id;

                    if (peerId === myId) {
                        continue;
                    }

                    const existingConnection =
                        RTCManager.getConnection(
                            peerId
                        );

                    if (existingConnection) {
                        continue;
                    }

                    RTCManager
                        .createPeerConnection(
                            peerId
                        );
                }

                console.log(
                    "[WS] peers",
                    PeerManager.getPeers()
                );

                break;

            case "message":

                console.log(
                    "[MESSAGE]",
                    data.from,
                    ":",
                    data.text
                );

                window.dispatchEvent(
                    new CustomEvent(
                        "ws-message",
                        {
                            detail: data
                        }
                    )
                );

                break;

            case "offer":

                console.log(
                    "[WS] OFFER received"
                );
                
                RTCManager.handleOffer(
                    data.from,
                    data.offer
                );

                break;

            case "answer":

                console.log(
                    "[WS] ANSWER received"
                );

            

                RTCManager.handleAnswer(
                    data.from,
                    data.answer
                );

                break;

            case "ice-candidate":

                console.log(
                    "[WS] ICE candidate received"
                );

                RTCManager.handleCandidate(
                    data.from,
                    data.candidate
                );

                break;

            default:

                console.log(
                    "[WS] unknown message",
                    data
                );
            }
    }

    send(data) {

    if (
        !this.socket ||
        this.socket.readyState !== WebSocket.OPEN
    ) {

        console.error(
            "[WS] socket not connected"
        );

        return;
    }

    console.log(
        "[WS] sending",
        data
    );

    this.socket.send(
        JSON.stringify(data)
    );
},

    sendMessage(text) {

        if (
            !this.peers ||
            this.peers.length === 0
        ) {

            console.log(
                "[WS] no peers"
            );

            return;
        }

        const targetPeer =
            this.peers[0];

        this.send({
            type: "message",
            to: targetPeer,
            from: this.peerId,
            text
        });

        console.log(
            "[WS] sent message:",
            text
        );
    }
};

window.WSClient = WSClient;
