import { ProfileManager } from "../profile/profile-manager.js";
import { RTCManager } from "../network/rtc-manager.js";
import { ContactManager } from "../contacts/contact-manager.js";

export const PeerManager = {

    peers: [],

    connections: new Map(),

    init() {

        console.log(
            "[PeerManager] init"
        );
    },

    updatePeers(peers) {

        const profile =
            ProfileManager.getProfile();

        if (!profile) {

            console.error(
                "[PeerManager] profile not found"
            );

            return;
        }

        const myId =
            profile.id;

        /*
         * Убираем собственного PeerID.
         */

        this.peers =
            peers.filter(
                peerId =>
                    peerId !== myId
            );

        console.log(
            "[PeerManager] peers updated",
            this.peers
        );

        /*
         * ==========================
         * AUTO CONNECT CONTACTS
         * ==========================
         *
         * Signaling сообщает только
         * онлайн-PeerID.
         *
         * Соединяемся только с теми
         * онлайн peers, которые уже
         * находятся в наших контактах.
         */

        const contacts =
            ContactManager.getContacts();

        for (
            const peerId
            of this.peers
        ) {

            const isContact =
                contacts.some(
                    contact =>
                        contact.id === peerId
                );

            if (!isContact) {

                console.log(
                    "[PeerManager] peer is online but not a contact",
                    peerId
                );

                continue;
            }

            console.log(
                "[PeerManager] auto-connect contact",
                peerId
            );

            this.connect(
                peerId
            );
        }
    },

    async connect(peerId) {

        if (!peerId) {

            console.error(
                "[PeerManager] invalid peerId"
            );

            return;
        }

        const profile =
            ProfileManager.getProfile();

        if (!profile) {

            console.error(
                "[PeerManager] profile not found"
            );

            return;
        }

        const myId =
            profile.id;

        if (peerId === myId) {

            console.log(
                "[PeerManager] cannot connect to self"
            );

            return;
        }

        /*
         * ==========================
         * PREVENT DUPLICATE CONNECTION
         * ==========================
         */

        const existing =
            RTCManager.getConnection(
                peerId
            );

        if (existing) {

            const state =
                existing.connectionState;

            console.log(
                "[PeerManager] existing connection",
                peerId,
                state
            );

            if (
                state === "connected" ||
                state === "connecting" ||
                state === "new"
            ) {

                console.log(
                    "[PeerManager] connection already active",
                    peerId
                );

                return existing;
            }

            /*
             * Если соединение failed/disconnected,
             * пока не создаём второе соединение
             * здесь автоматически.
             *
             * Переподключение будет отдельным
             * следующим этапом.
             */
        }

        /*
         * ==========================
         * DETERMINISTIC INITIATOR
         * ==========================
         *
         * Только одна сторона создаёт offer.
         */

        const shouldInitiate =
            myId.localeCompare(
                peerId
            ) < 0;

        console.log(
            "[PeerManager] connect",
            peerId
        );

        console.log(
            "[PeerManager] localId",
            myId
        );

        console.log(
            "[PeerManager] peerId",
            peerId
        );

        console.log(
            "[PeerManager] initiator",
            shouldInitiate
        );

        /*
         * ==========================
         * CREATE SINGLE CONNECTION
         * ==========================
         */

        const connection =
            RTCManager.createPeerConnection(
                peerId
            );

        if (!connection) {

            console.error(
                "[PeerManager] failed to create connection",
                peerId
            );

            return;
        }

        /*
         * ==========================
         * INITIATOR → OFFER
         * ==========================
         */

        if (shouldInitiate) {

            console.log(
                "[PeerManager] creating offer",
                peerId
            );

            await RTCManager.createOffer(
                peerId
            );
        }

        return connection;
    },

    getPeers() {

        return this.peers;
    }

};

window.PeerManager =
    PeerManager;
