const SIGNAL_SERVER = "wss://whisper-signaling.onrender.com";

export class WSClient {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.reconnectDelay = 3000;
    }

    connect() {
        console.log("[WS] connecting...");

        this.socket = new WebSocket(SIGNAL_SERVER);

        this.socket.addEventListener("open", () => {
            this.connected = true;

            console.log("[WS] connected");

            this.send({
                type: "hello",
                timestamp: Date.now()
            });
        });

        this.socket.addEventListener("message", (event) => {
            try {
                const data = JSON.parse(event.data);

                console.log("[WS] message", data);

                this.handleMessage(data);

            } catch (err) {
                console.error("[WS] invalid message", err);
            }
        });

        this.socket.addEventListener("close", () => {
            this.connected = false;

            console.warn("[WS] disconnected");

            setTimeout(() => {
                this.connect();
            }, this.reconnectDelay);
        });

        this.socket.addEventListener("error", (err) => {
            console.error("[WS] error", err);
        });
    }

    send(data) {
        if (!this.connected) {
            return;
        }

        this.socket.send(JSON.stringify(data));
    }

    handleMessage(data) {
        switch (data.type) {

            case "welcome":
                console.log("[WS] server welcome");
                break;

            case "peer-list":
                console.log("[WS] peers", data.peers);
                break;

            default:
                console.log("[WS] unknown message", data);
        }
    }
}

window.WSClient = WSClient;
