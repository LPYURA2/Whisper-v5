import { PeerManager } from "../peers/peer-manager.js";
import { RTCManager } from "./rtc-manager.js";

const SIGNAL_SERVER =
    "wss://whisper-signaling.onrender.com";

export class WSClient {

    constructor() {

        this.socket = null;

        // `connected` means the signaling protocol is ready, not just WS OPEN.
        this.connected = false;

        this.peerId =
            window.ProfileManager.profile.id;

        this.peers = [];

        this.reconnectDelay = 3000;

        this.reconnectTimer = null;

        // SDP offers/answers and ICE candidates are tied to a particular
        // RTCPeerConnection attempt. Never replay them after reconnect.
    }

    /*
     * ==========================================
     * CONNECT
     * ==========================================
     */

    connect() {

        /*
         * Не создаём второе соединение,
         * если текущее уже подключено
         * или находится в процессе подключения.
         */

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

        this.connected = false;
        this.socket = socket;

        /*
         * ==========================================
         * OPEN
         * ==========================================
         */

        socket.addEventListener(
            "open",
            () => {

                /*
                 * Игнорируем событие старого socket.
                 */

                if (
                    this.socket !== socket
                ) {
                    return;
                }

                this.connected = false;

                console.log(
                    "[WS] WebSocket open; waiting for signaling-ready"
                );

                console.log(
                    "[WS] state",
                    socket.readyState
                );

                /*
                 * Сначала заново сообщаем серверу,
                 * что этот клиент онлайн.
                 */

                const joined =
                    this.sendImmediate({
                        type: "join",
                        peerId: this.peerId
                    });

                if (!joined) {

                    console.error(
                        "[WS] failed to send join"
                    );

                    return;
                }

                // Do not flush old SDP/ICE here. The server acknowledgement
                // below is the only point at which signaling becomes ready.
            }
        );

        /*
         * ==========================================
         * MESSAGE
         * ==========================================
         */

        socket.addEventListener(
            "message",
            (event) => {

                // Ignore late events from a socket replaced during reconnect.
                if (this.socket !== socket) {
                    return;
                }

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

        /*
         * ==========================================
         * CLOSE
         * ==========================================
         */

        socket.addEventListener(
            "close",
            () => {

                /*
                 * Старый socket не должен
                 * менять состояние нового.
                 */

                if (
                    this.socket !== socket
                ) {
                    return;
                }

                this.connected = false;

                console.warn(
                    "[WS] disconnected"
                );

                this.socket = null;

                // Any SDP/ICE from the previous transport session is stale.
                this.scheduleReconnect();
            }
        );

        /*
         * ==========================================
         * ERROR
         * ==========================================
         */

        socket.addEventListener(
            "error",
            (err) => {

                /*
                 * Сам reconnect здесь НЕ запускаем.
                 *
                 * Обычно после error WebSocket
                 * перейдёт в close.
                 *
                 * reconnect выполняется через close,
                 * чтобы не создать два соединения.
                 */

                console.error(
                    "[WS] error",
                    err
                );
            }
        );
    }

    /*
     * ==========================================
     * RECONNECT
     * ==========================================
     */

    scheduleReconnect() {

        /*
         * Если reconnect уже запланирован,
         * второй таймер не создаём.
         */

        if (
            this.reconnectTimer
        ) {
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

    /*
     * ==========================================
     * SEND
     * ==========================================
     * WebRTC signaling packets are ephemeral: if signaling is not ready,
     * drop them rather than replaying them into a later connection attempt.
     */

    send(data) {

        if (!this.connected) {
            console.warn(
                "[WS] signaling not ready; dropping stale-capable packet",
                data?.type
            );
            return false;
        }

        return this.sendImmediate(data);
    }

    /*
     * ==========================================
     * SEND IMMEDIATE
     * ==========================================
     * Used for `join` before signaling-ready and for packets after readiness.
     */

    sendImmediate(data) {

        if (
            !this.socket ||
            this.socket.readyState !== WebSocket.OPEN
        ) {

            console.error(
                "[WS] socket not open"
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

    /*
     * ==========================================
     * HANDLE MESSAGE
     * ==========================================
     */

    handleMessage(data) {

        switch (
            data.type
        ) {

            case "signaling-ready": {

                if (data.peerId !== this.peerId) {
                    console.error("[WS] signaling-ready ID mismatch");
                    this.connected = false;
                    return;
                }

                this.connected = true;
                console.log("[WS] signaling ready", this.peerId);
                break;
            }

            case "signaling-error":
                this.connected = false;
                console.error("[WS] signaling rejected join", data.code);
                break;

            /*
             * ======================================
             * WELCOME
             * ======================================
             */

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


            /*
             * ======================================
             * PEERS
             * ======================================
             */

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

                /*
                 * WSClient НЕ создаёт RTC.
                 *
                 * Он только сообщает PeerManager,
                 * кто сейчас находится онлайн.
                 */

                PeerManager.updatePeers(
                    this.peers
                );

                console.log(
                    "[WS] PeerManager peers",
                    PeerManager.getPeers()
                );

                break;


            /*
             * ======================================
             * OFFER
             * ======================================
             */

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


            /*
             * ======================================
             * ANSWER
             * ======================================
             */

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


            /*
             * ======================================
             * ICE
             * ======================================
             */

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


            /*
             * ======================================
             * MESSAGE
             * ======================================
             *
             * Старый relay пока оставляем
             * для совместимости.
             *
             * Основной транспорт Whisper —
             * WebRTC DataChannel.
             */

            case "message":

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


            /*
             * ======================================
             * UNKNOWN
             * ======================================
             */

            default:

                console.log(
                    "[WS] unknown message",
                    data
                );
        }
    }
}

window.WSClient = WSClient;
