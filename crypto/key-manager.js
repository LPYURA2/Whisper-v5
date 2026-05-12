import { ProfileManager } from '../profile/profile-manager.js';

export const KeyManager = {

    async init() {

        console.log("[KeyManager] init");

        const profile =
            ProfileManager.getProfile();

        if (
            profile.publicKey &&
            profile.privateKey
        ) {

            console.log(
                "[KeyManager] keys loaded"
            );

            return;
        }

        await this.generateKeyPair();
    },

    async generateKeyPair() {

        console.log(
            "[KeyManager] generating keys"
        );

        const profile =
            ProfileManager.getProfile();

        profile.publicKey =
            crypto.randomUUID();

        profile.privateKey =
            crypto.randomUUID();

        await ProfileManager.saveProfile();

        console.log(
            "[KeyManager] keys generated"
        );
    }

};

window.KeyManager = KeyManager;
