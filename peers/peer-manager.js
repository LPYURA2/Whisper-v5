import { ProfileManager } from '../profile/profile-manager.js';
import { RTCManager } from '../network/rtc-manager.js';

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

    for (const peerId of this.peers) {

        RTCManager.createPeerConnection(
            peerId
        );

        RTCManager.createOffer(
            peerId
        );
    }
},

    getPeers() {

        return this.peers;
    }

};

window.PeerManager = PeerManager;
