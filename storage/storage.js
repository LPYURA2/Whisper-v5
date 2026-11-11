// Test-only namespace; never read or migrate production keys.
const STORAGE_NAMESPACE = "whisper-test:turn-signaling-r1:";

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
            STORAGE_NAMESPACE + "profile",
            JSON.stringify(profile)
        );
    },

    async loadProfile() {

        const raw =
            localStorage.getItem(
                STORAGE_NAMESPACE + "profile"
            );

        if (!raw) {
            return null;
        }

        return JSON.parse(raw);
    },

    async deleteProfile() {

        localStorage.removeItem(
            STORAGE_NAMESPACE + "profile"
        );
    },

    /*
     * ==========================
     * CONTACTS
     * ==========================
     */

    async saveContacts(contacts) {

        localStorage.setItem(
            STORAGE_NAMESPACE + "contacts",
            JSON.stringify(contacts)
        );
    },

    async loadContacts() {

        const raw =
            localStorage.getItem(
                STORAGE_NAMESPACE + "contacts"
            );

        if (!raw) {
            return [];
        }

        return JSON.parse(raw);
    },

    async deleteContacts() {

        localStorage.removeItem(
            STORAGE_NAMESPACE + "contacts"
        );
    },

    async saveChats(chats) {

    localStorage.setItem(
        STORAGE_NAMESPACE + "chats",
        JSON.stringify(chats)
    );
},

async loadChats() {

    const raw =
        localStorage.getItem(
            STORAGE_NAMESPACE + "chats"
        );

    if (!raw) {
        return [];
    }

    return JSON.parse(raw);
},

async deleteChats() {

    localStorage.removeItem(
        STORAGE_NAMESPACE + "chats"
    );
},

};

window.Storage = Storage;
