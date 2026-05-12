export const Storage = {

    async init() {

        console.log("[Storage] initialized");
    },

    async get(key) {

        const raw =
            localStorage.getItem(key);

        if (!raw) {
            return null;
        }

        return JSON.parse(raw);
    },

    async set(key, value) {

        localStorage.setItem(
            key,
            JSON.stringify(value)
        );
    },

    async remove(key) {

        localStorage.removeItem(key);
    }

};

window.Storage = Storage;
