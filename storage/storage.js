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
    },

    /*
     * ==========================
     * CONTACTS
     * ==========================
     */

    async saveContacts(contacts) {

        localStorage.setItem(
            "contacts",
            JSON.stringify(contacts)
        );
    },

    async loadContacts() {

        const raw =
            localStorage.getItem(
                "contacts"
            );

        if (!raw) {
            return [];
        }

        return JSON.parse(raw);
    },

    async deleteContacts() {

        localStorage.removeItem(
            "contacts"
        );
    },

    async saveChats(chats) {

    await this.set(
        "chats",
        chats
    );
},

async loadChats() {

    return (
        await this.get(
            "chats"
        )
    ) || [];
},

async deleteChats() {

    await this.remove(
        "chats"
    );
}

};

window.Storage = Storage;
