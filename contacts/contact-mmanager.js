export const ContactManager = {

    contacts: [],

    addContact(contact) {

        this.contacts.push(contact);

        console.log(
            "[Contacts] added",
            contact
        );
    },

    getContacts() {

        return this.contacts;
    }
};

window.ContactManager = ContactManager;
