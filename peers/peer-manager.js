import { ProfileManager } from "../profile/profile-manager.js";
import { RTCManager } from "../network/rtc-manager.js";
import { ContactManager } from "../contacts/contact-manager.js";

export const PeerManager = {

    peers: [],

    connections: new Map(),

    retryTimers: new Map(),

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
         * Signaling сообщает только онлайн-PeerID.
         *
         * Автоматически подключаемся только к контактам,
         * которые сейчас онлайн.
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
         * Проверяем существующее соединение.
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

            /*
             * Рабочее или устанавливаемое соединение
             * повторно не создаём.
             */

            if (
                state === "connected" ||
                state === "connecting"
            ) {

                console.log(
                    "[PeerManager] connection already active",
                    peerId,
                    state
                );

                return existing;
            }

            /*
             * Состояние new может быть нормальным
             * во время первоначального согласования.
             *
             * Но старое соединение не должно навсегда
             * блокировать повторные попытки.
             */

            const age =
                RTCManager.getConnectionAge(
                    peerId
                );

            const staleNew =
                state === "new" &&
                age > 20000;

            if (
                state === "new" &&
                !staleNew
            ) {

                console.log(
                    "[PeerManager] negotiation still starting",
                    peerId,
                    "ageMs:",
                    age
                );

                return existing;
            }

            /*
             * Временно отключённое соединение сохраняем.
             * Не закрываем его немедленно.
             */

            if (
                state === "disconnected"
            ) {

                console.warn(
                    "[PeerManager] connection temporarily disconnected; keeping it",
                    peerId
                );

                return existing;
            }

            /*
             * Очищаем окончательно завершившееся
             * или зависшее соединение.
             */

            if (
                state === "failed" ||
                state === "closed" ||
                staleNew
            ) {

                RTCManager.resetPeerConnection(
                    peerId,
                    existing,
                    staleNew
                        ? "stale-new-timeout"
                        : `state-${state}`
                );
            }
        }

        /*
         * Определяем инициатора.
         *
         * Только одна сторона создаёт Offer.
         * Правило выбора инициатора не меняем.
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
         * Создаём RTCPeerConnection.
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
         * Инициатор создаёт Offer.
         */

        if (shouldInitiate) {

            console.log(
                "[PeerManager] creating offer",
                peerId
            );

            await RTCManager.createOffer(
                peerId
            );

            /*
             * Вызов WebSocket.send() не гарантирует,
             * что удалённая сторона получила Offer.
             *
             * Если соединение слишком долго остаётся
             * в состоянии new, разрешаем повторную попытку.
             */

            const oldTimer =
                this.retryTimers.get(
                    peerId
                );

            if (oldTimer) {

                clearTimeout(
                    oldTimer
                );
            }

            const timer =
                setTimeout(
                    () => {

                        this.retryTimers.delete(
                            peerId
                        );

                        const current =
                            RTCManager.getConnection(
                                peerId
                            );

                        /*
                         * Не трогаем другое соединение,
                         * если оно уже было создано.
                         */

                        if (
                            current !== connection ||
                            current.connectionState !== "new"
                        ) {

                            return;
                        }

                        if (
                            RTCManager.getConnectionAge(
                                peerId
                            ) < 25000
                        ) {

                            return;
                        }

                        console.warn(
                            "[PeerManager] offer attempt timed out; retrying",
                            peerId
                        );

                        RTCManager.resetPeerConnection(
                            peerId,
                            connection,
                            "offer-timeout"
                        );

                        /*
                         * Повторяем попытку, только если
                         * удалённый пользователь всё ещё
                         * числится среди онлайн-пользователей.
                         */

                        if (
                            this.peers.includes(
                                peerId
                            )
                        ) {

                            this.connect(
                                peerId
                            );
                        }

                    },
                    25000
                );

            this.retryTimers.set(
                peerId,
                timer
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
