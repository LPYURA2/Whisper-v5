import { UI } from "../ui/ui.js";
import { UILayout } from "../ui/layout.js";

import { KeyManager } from "../crypto/key-manager.js";

import { PeerManager } from "../peers/peer-manager.js";
import { ContactManager } from "../contacts/contact-manager.js";

import { RTCManager } from "../network/rtc-manager.js";
import { Signaling } from "../network/signaling.js";

export async function startMessenger() {

    console.log(
        "[Start] starting messenger"
    );

    UI.init();

    UILayout.init();

    await KeyManager.init();

    await ContactManager.init();

    PeerManager.init();

    console.log(
        "[Contacts] loaded",
        ContactManager
    );

    RTCManager.init();

    await Signaling.init();

    console.log(
        "[Start] messenger ready"
    );
}
