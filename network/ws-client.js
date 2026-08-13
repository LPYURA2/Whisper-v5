import { PeerManager } from "../peers/peer-manager.js";
import { RTCManager } from "./rtc-manager.js";

const SIGNAL_SERVER =
    "wss://whisper-signaling.onrender.com";

export class WSClient {

    constructor() {

        this.socket = null;

        this.connected = false;

        this.peerId =
            window.ProfileManager.profile.id;

        this.peers = [];

        this.reconnectDelay = 3000;

        this.reconnectTimer = null;
    }

    connect() {

        // Не создаём второе WebSocket-соединение,
        // если текущее уже подключено или подключается.
        if (
            this.socket &&
            (
                this.socket.readyState === WebSocket.OPEN ||
                this.socket.readyState === WebSocket.CONNECTING
            )
        ) {

            console.log(
                "[WS] connection already exists"
            );

            return;
        }

        console.log(
            "[WS] connecting..."
        );

        const socket =
            new WebSocket(
                SIGNAL_SERVER
            );

        this.socket = socket;

        socket.addEventListener(
            "open",
            () => {

                // Игнорируем событие старого socket,
                // если уже создан новый.
                if (this.socket !== socket) {
                    return;
                }

                this.connected = true;

                console.log(
                    "[WS] connected"
                );

                console.log(
                    "[WS] state",
                    socket.readyState
                );

                this.send({
                    type: "join",
                    peerId: this.peerId
                });
            }
        );

        socket.addEventListener(
            "message",
            (event) => {

                console.log(
                    "[RAW MESSAGE]",
                    event.data
                );

                try {

                    const data =
                        JSON.parse(
                            event.data
                        );

                    console.log(
                        "[WS] message",
                        data
                    );

                    this.handleMessage(
                        data
                    );

                } catch (err) {

                    console.error(
                        "[WS] invalid message",
                        err
                    );
                }
            }
        );

        socket.addEventListener(
            "close",
            () => {

                // Старый socket не должен
                // ломать состояние нового.
                if (this.socket !== socket) {
                    return;
                }

                this.connected = false;

                console.warn(
                    "[WS] disconnected"
                );

                this.socket = null;

                this.scheduleReconnect();
            }
        );

        socket.addEventListener(
            "error",
            (err) => {

                console.error(
                    "[WS] error",
                    err
                );
            }
        );
    }

    scheduleReconnect() {

        if (this.reconnectTimer) {
            return;
        }

        console.log(
            "[WS] reconnect scheduled in",
            this.reconnectDelay,
            "ms"
        );

        this.reconnectTimer =
            setTimeout(
                () => {

                    this.reconnectTimer =
                        null;

                    this.connect();

                },
                this.reconnectDelay
            );
    }

    send(data) {

        if (
            !this.socket ||
            this.socket.readyState !== WebSocket.OPEN
        ) {

            console.error(
                "[WS] socket not connected"
            );

            return false;
        }

        console.log(
            "[WS] sending",
            data
        );

        try {

            this.socket.send(
                JSON.stringify(data)
            );

            return true;

        } catch (err) {

            console.error(
                "[WS] send failed",
                err
            );

            return false;
        }
    }

    handleMessage(data) {

        switch (data.type) {

            case "welcome":

                console.log(
                    "[WS] server welcome"
                );

                window.ClientId =
                    data.id;

                console.log(
                    "[WS] local client id",
                    window.ClientId
                );

                break;


            case "peers":

                console.log(
                    "[WS] peers received",
                    data.peers
                );

                this.peers =
                    Array.isArray(
                        data.peers
                    )
                        ? data.peers
                        : [];

                // WSClient только передаёт
                // список PeerManager.
                // Он сам НЕ создаёт RTC.
                PeerManager.updatePeers(
                    this.peers
                );

                console.log(
                    "[WS] PeerManager peers",
                    PeerManager.getPeers()
                );

                break;


            case "offer":

                console.log(
                    "[WS] OFFER received",
                    data
                );

                RTCManager.handleOffer(
                    data.from,
                    data.offer
                );

                break;


            case "answer":

                console.log(
                    "[WS] ANSWER received",
                    data
                );

                RTCManager.handleAnswer(
                    data.from,
                    data.answer
                );

                break;


            case "ice-candidate":

                console.log(
                    "[WS] ICE candidate received",
                    data
                );

                RTCManager.handleCandidate(
                    data.from,
                    data.candidate
                );

                break;


            case "message":

                // Старый WebSocket relay
                // пока оставляем для совместимости.
                // Основной транспорт Whisper —
                // WebRTC DataChannel.

                console.log(
                    "[WS] relay message received",
                    data
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


            default:

                console.log(
                    "[WS] unknown message",
                    data
                );
        }
    }
}

window.WSClient = WSClient;
