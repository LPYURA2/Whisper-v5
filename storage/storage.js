export const Storage = {

    async init() {

        console.log(
            "[Storage] initialized"
        );
    },

    /*
     * ==========================
     * PROFILE
     * ==========================
     */

    async saveProfile(profile) {

        localStorage.setItem(
            "profile",
            JSON.stringify(profile)
        );
    },

    async loadProfile() {

        const raw =
            localStorage.getItem(
                "profile"
            );

        if (!raw) {
            return null;
        }

        return JSON.parse(raw);
    },

    async deleteProfile() {

        localStorage.removeItem(
            "profile"
        );
    }

};

window.Storage = Storage;
