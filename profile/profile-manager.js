import { Storage } from "../storage/storage.js";

export const ProfileManager = {

    profile: null,

    async init() {

        console.log(
            "[Profile] init"
        );

        const profile =
            await Storage.loadProfile();

        if (profile) {

            this.profile = profile;

            console.log(
                "[Profile] loaded",
                this.profile
            );

            return;
        }

        console.log(
            "[Profile] profile not found"
        );

        this.profile = null;
    },

    async createProfile(username) {

        console.log(
            "[Profile] creating"
        );

        this.profile = {

            id: crypto.randomUUID(),

            username:
                username,

            avatar: "",

            publicKey: "",

            privateKey: "",

            createdAt: Date.now()

        };

        await this.saveProfile();

        console.log(
            "[Profile] created",
            this.profile
        );
    },

    async saveProfile() {

        await Storage.saveProfile(
            this.profile
        );

        console.log(
            "[Profile] saved"
        );
    },

    async deleteProfile() {

        await Storage.deleteProfile();

        this.profile = null;

        console.log(
            "[Profile] deleted"
        );
    },

    getProfile() {

        return this.profile;
    },

    async setUsername(username) {

        this.profile.username = username;

        await this.saveProfile();

        console.log(
            "[Profile] username updated",
            username
        );
    }

};

window.ProfileManager = ProfileManager;
