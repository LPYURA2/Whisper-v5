import { UI } from "../ui/ui.js";
import { UILayout } from "../ui/layout.js";

import { KeyManager } from "../crypto/key-manager.js";

import { PeerManager } from "../peers/peer-manager.js";
import { ContactManager } from "../contacts/contact-manager.js";
import { ChatManager } from "../chats/chat-manager.js";

import { RTCManager } from "../network/rtc-manager.js";
import { Signaling } from "../network/signaling.js";
import { LogManager } from "./log-manager.js";
import { TurnPocConfig } from "../network/turn-poc-config.js";
import { TurnPocDiagnostics } from "../network/turn-poc-diagnostics.js";

export async function startMessenger() {

    // Test-only: redact before both the browser console and the in-memory log.
    LogManager.sanitizeArgs = args => TurnPocConfig.sanitizeLogArgs(args);

    console.log(
        "[Start] starting messenger"
    );

    UI.init();

    UILayout.init();

    await KeyManager.init();

    await ContactManager.init();

    await ChatManager.init();

    PeerManager.init();

    console.log(
        "[Contacts] loaded",
        ContactManager
    );

    RTCManager.init();

    // The static test link is parsed and scrubbed on module import.
    // Normal all uses the existing STUN. Explicit TURN tests require their own
    // in-memory configuration before signaling or any new PC.
    TurnPocDiagnostics.bootstrap({ stage: "preparing" });
    TurnPocConfig.subscribe(state => TurnPocDiagnostics.bootstrap(state));
    try {
        await TurnPocConfig.prepare();
    } catch {
        // Invalid setup or an explicit TURN test without its private pair is an error.
        // Never log credentials; relay never falls back to a direct route.
        return;
    }
    TurnPocDiagnostics.attach(RTCManager, TurnPocConfig.getPublicConfig());

    await Signaling.init();
    TurnPocDiagnostics.observeSignaling(window.wsClient);

    console.log(
        "[Start] messenger ready"
    );
}
