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

        /*
         * ==========================================
         * SIGNALING OUTBOX
         * ==========================================
         *
         * Если WebSocket ещё не подключён,
         * signaling-сообщения не теряем.
         *
         * Например:
         *
         * RTC создаёт offer
         *        ↓
         * WS ещё CONNECTING
         *        ↓
         * offer попадает сюда
         *        ↓
         * WS подключается
         *        ↓
         * offer отправляется
         */

        this.outbox = [];
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

                this.connected = true;

                console.log(
                    "[WS] connected"
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

                /*
                 * После join отправляем
                 * накопленные signaling-сообщения.
                 */

                this.flushOutbox();
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

                /*
                 * Всё, что находится в outbox,
                 * остаётся там.
                 *
                 * При следующем подключении
                 * flushOutbox() отправит сообщения.
                 */

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
     *
     * Главный метод для signaling.
     *
     * Если WS открыт:
     *
     *     отправляем сразу.
     *
     * Если WS не открыт:
     *
     *     помещаем сообщение в outbox.
     */

    send(data) {

        if (
            !this.socket ||
            this.socket.readyState !== WebSocket.OPEN
        ) {

            console.warn(
                "[WS] socket not connected, queueing message",
                data.type
            );

            this.outbox.push(
                data
            );

            /*
             * На всякий случай убеждаемся,
             * что reconnect будет запущен.
             */

            this.scheduleReconnect();

            return false;
        }

        return this.sendImmediate(
            data
        );
    }

    /*
     * ==========================================
     * SEND IMMEDIATE
     * ==========================================
     *
     * Используется только тогда,
     * когда socket уже OPEN.
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

            /*
             * Если отправка реально не удалась,
             * сохраняем сообщение.
             */

            this.outbox.unshift(
                data
            );

            return false;
        }
    }

    /*
     * ==========================================
     * FLUSH OUTBOX
     * ==========================================
     *
     * Отправляет накопленные signaling-сообщения.
     */

    flushOutbox() {

        if (
            !this.socket ||
            this.socket.readyState !== WebSocket.OPEN
        ) {

            console.warn(
                "[WS] cannot flush outbox: socket not open"
            );

            return;
        }

        if (
            this.outbox.length === 0
        ) {

            console.log(
                "[WS] outbox empty"
            );

            return;
        }

        console.log(
            "[WS] flushing outbox",
            this.outbox.length
        );

        /*
         * Отправляем сообщения последовательно.
         *
         * Если какое-либо сообщение не удалось
         * отправить, оставляем его и прекращаем flush.
         */

        while (
            this.outbox.length > 0
        ) {

            const data =
                this.outbox.shift();

            const success =
                this.sendImmediate(
                    data
                );

            if (!success) {

                /*
                 * sendImmediate уже вернул
                 * сообщение обратно в outbox.
                 */

                console.warn(
                    "[WS] outbox flush stopped"
                );

                break;
            }
        }

        console.log(
            "[WS] outbox remaining",
            this.outbox.length
        );
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
