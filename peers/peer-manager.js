import { ProfileManager } from "../profile/profile-manager.js";
import { RTCManager } from "../network/rtc-manager.js";

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
         * Discovery сообщает только о том,
         * какие PeerID сейчас находятся
         * на signaling-сервере.
         *
         * Само создание соединения
         * теперь выполняется через connect().
         */

        for (
            const peerId
            of this.peers
        ) {

            /*
             * Если контакт уже известен
             * и мы должны автоматически
             * поддерживать соединение,
             * connect() сам решит,
             * нужно ли его создавать.
             *
             * Пока не создаём соединения
             * со всеми обнаруженными peers.
             */
        }
    },

    async connect(peerId) {

        if (!peerId) {

            console.error(
                "[PeerManager] invalid peerId"
            );

            return;
        }

        const myId =
            ProfileManager
                .getProfile()
                .id;

        if (peerId === myId) {

            console.log(
                "[PeerManager] cannot connect to self"
            );

            return;
        }

        /*
         * Уже есть рабочее соединение?
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
        }

        /*
         * Определяем инициатора.
         *
         * Пока используем deterministic rule,
         * чтобы обе стороны не создавали offer.
         *
         * Позже это заменим пользовательской
         * моделью "тот, кто добавил контакт".
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
         * Создаём единственное
         * RTCPeerConnection.
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
         * Только инициатор создаёт offer.
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

window.PeerManager = PeerManager;
