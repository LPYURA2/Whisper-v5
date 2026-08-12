import { ProfileManager } from '../profile/profile-manager.js';
import { RTCManager } from '../network/rtc-manager.js';

export const PeerManager = {

    peers: [],

    init() {

        console.log(
            '[PeerManager] init'
        );
    },

    updatePeers(peers) {

        const myProfile =
            ProfileManager.getProfile();

        const myId =
            myProfile.id;

        this.peers =
            peers.filter(
                (peerId) =>
                    peerId !== myId
            );

        console.log(
            '[PeerManager] peers updated',
            this.peers
        );

        for (
            const peerId
            of this.peers
        ) {

            this.connect(
                peerId
            );
        }
    },

    connect(peerId) {

        const localId =
            ProfileManager
                .getProfile()
                .id;

        if (!peerId) {
            return;
        }

        if (peerId === localId) {
            return;
        }

        console.log(
            '[PeerManager] connect request',
            peerId
        );

        const existingConnection =
            RTCManager.getConnection(
                peerId
            );

        if (existingConnection) {

            console.log(
                '[PeerManager] connection already exists',
                peerId
            );

            return;
        }

        console.log(
            '[PeerManager] creating connection',
            peerId
        );

        RTCManager.createPeerConnection(
            peerId
        );

        const comparison =
            localId.localeCompare(
                peerId
            );

        console.log(
            '[PeerManager] localId',
            localId
        );

        console.log(
            '[PeerManager] peerId',
            peerId
        );

        console.log(
            '[PeerManager] compare',
            comparison
        );

        if (comparison < 0) {

            console.log(
                '[PeerManager] initiator',
                peerId
            );

            RTCManager.createOffer(
                peerId
            );

        } else {

            console.log(
                '[PeerManager] waiting for offer',
                peerId
            );
        }
    },

    getPeers() {

        return this.peers;
    }

};

window.PeerManager = PeerManager;
