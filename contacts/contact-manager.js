import { Storage } from "../storage/storage.js";

import { UI } from "../ui/ui.js";

export const ContactManager = {

    contacts: [],

    async init() {

        this.contacts =
            await Storage.loadContacts();

        UI.renderContacts();

        console.log(
            "[Contacts] loaded",
            this.contacts
        );
    },

    async addContact(contact) {

        this.contacts.push(contact);

        await Storage.saveContacts(
            this.contacts
        );

        console.log(
            "[Contacts] added",
            contact
        );
    },

    getContacts() {

        return this.contacts;
    },

    async removeContact(id) {

        this.contacts =
            this.contacts.filter(
                contact =>
                    contact.id !== id
            );

        await Storage.saveContacts(
            this.contacts
        );

        console.log(
            "[Contacts] removed",
            id
        );
    }

};

window.ContactManager = ContactManager;
