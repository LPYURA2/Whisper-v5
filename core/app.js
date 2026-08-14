import { LogManager } from './log-manager.js';

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

    /*
     * =====================================================
     * LOGGING
     * =====================================================
     *
     * Запускаем первым.
     *
     * После этого все console.log / warn / error
     * автоматически попадают также в LogManager.
     */

    LogManager.init();


    console.log(
        '[Bootstrap] Starting'
    );


    /*
     * =====================================================
     * STORAGE
     * ===================================================== */

    await Storage.init();


    /*
     * =====================================================
     * SERVICE WORKER
     * ===================================================== */

    await registerSW();


    /*
     * =====================================================
     * PROFILE
     * ===================================================== */

    await ProfileManager.init();


    if (
        !ProfileManager.getProfile()
    ) {

        Welcome.show();

        return;
    }


    /*
     * =====================================================
     * START MESSENGER
     * ===================================================== */

    await startMessenger();


    console.log(
        "[Bootstrap] Ready"
    );
}


bootstrap().catch(
    (err) => {

        console.error(
            '[Bootstrap] Fatal Error',
            err
        );
    }
);


/*
 * =========================================================
 * WS MESSAGE DEBUG
 * =========================================================
 */

window.addEventListener(
    "ws-message",
    (event) => {

        console.log(
            "[APP MESSAGE]",
            event.detail
        );
    }
);
