import { ProfileManager } from '../profile/profile-manager.js';

export const PeerManager = {

    peers: [],

    init() {

        console.log('[PeerManager] init');
    },

    updatePeers(peers) {

        const myProfile =
            ProfileManager.getProfile();

        const myId = myProfile.id;

        this.peers = peers.filter(
            (peerId) => peerId !== myId
        );

        console.log(
            '[PeerManager] peers updated',
            this.peers
        );
    },

    getPeers() {

        return this.peers;
    }

};

window.PeerManager = PeerManager;
