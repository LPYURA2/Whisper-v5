const SIGNAL_SERVER = "wss://whisper-signaling.onrender.com";

export class WSClient {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.reconnectDelay = 3000;

        this.peerId = crypto.randomUUID();

        this.peers = [];
    }

    connect() {
        console.log("[WS] connecting...");

        this.socket = new WebSocket(SIGNAL_SERVER);

        this.socket.addEventListener("open", () => {
            this.connected = true;

            console.log("[WS] connected");

            console.log("[WS] state",
            this.socket.readyState);

            this.socket.send("test");

            this.socket.send(JSON.stringify({
                type: "ping",
                text: "hello from client"
            }));

            this.send({
                type: "join",
                peerId: this.peerId
            });
        });

        this.socket.addEventListener("message", (event) => {
            
                console.log("[RAW MESSAGE]", event.data);
            
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

        case "peers":

            this.peers = data.peers.filter(
                peer => peer !== this.peerId
            );

            console.log("[WS] peers", this.peers);

            break;

        case "message":

            console.log(
                "[MESSAGE]",
                data.from,
                ":",
                data.text
            );

            break;

        default:

            console.log("[WS] unknown message", data);

    }

}

sendMessage(text) {

    if (!this.peers || this.peers.length === 0) {

        console.log("[WS] no peers");

        return;
    }

    const targetPeer = this.peers[0];

    this.send({
        type: "message",
        to: targetPeer,
        from: this.peerId,
        text
    });

    console.log("[WS] sent message:", text);
}

}

window.WSClient = WSClient;
