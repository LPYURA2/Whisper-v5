import { Storage } from '../storage/storage.js';

export const ProfileManager = {

    profile: null,

    async init() {

        console.log("[Profile] init");

        const savedProfile =
            await Storage.get("profile");

        if (savedProfile) {

            this.profile = savedProfile;

            console.log(
                "[Profile] loaded",
                this.profile
            );

            return;
        }

        await this.createProfile();
    },

    async createProfile() {

        console.log("[Profile] creating");

        const profile = {

            id: crypto.randomUUID(),

            username: "anonymous",

            avatar: "",

            publicKey: "",

            privateKey: "",

            createdAt: Date.now()
        };

        this.profile = profile;

        await this.saveProfile();

        console.log(
            "[Profile] created",
            this.profile
        );
    },

    async saveProfile() {

        await Storage.set(
            "profile",
            this.profile
        );

        console.log("[Profile] saved");
    },

    getProfile() {

        return this.profile;
    },

    async setUsername(username){
        this.profile.username = username;

        await this.saveProfile();

        console.log(
            "[Profile] username updated",
            username
        );
    }
};

window.ProfileManager = ProfileManager;
