import { WSClient } from './ws-client.js';

export const Signaling = {

    wsClient: null,

    async init() {

        console.log('[Signaling] initialized');

        this.wsClient = new wsClient();

        window.wsClient = this.wsClient;
        
        this.wsClient.connect();

    }

};

window.Signaling = Signaling;
