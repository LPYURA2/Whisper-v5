import { UI } from '../ui/ui.js';
import { UILayout } from '../ui/layout.js';
import { Storage } from '../storage/storage.js';

import { ProfileManager } from '../profile/profile-manager.js';

import { Welcome } from "./welcome.js";

import { startMessenger } from "./start-messenger.js";

import { KeyManager } from '../crypto/key-manager.js';

import { PeerManager } from '../peers/peer-manager.js';

import { ContactManager } from '../contacts/contact-manager.js';

import { RTCManager } from '../network/rtc-manager.js';

import { Signaling } from '../network/signaling.js';

import { registerSW } from './sw-register.js';

async function bootstrap() {

    console.log('[Bootstrap] Starting');

    await Storage.init();

    //UI.init();
    //UILayout.init();

    await registerSW();

    await ProfileManager.init();

    if (!ProfileManager.getProfile()) {

    Welcome.show();

    return;
    }

    await startMessenger();

console.log(
    "[Bootstrap] Ready"
);
}

bootstrap().catch((err) => {

    console.error(
        '[Bootstrap] Fatal Error',
        err
    );
});


window.addEventListener("ws-message", (event) => {

    console.log(
        "[APP MESSAGE]",
        event.detail
    );
});
