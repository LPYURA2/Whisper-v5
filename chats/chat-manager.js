import { Storage } from "../storage/storage.js";

export const ChatManager = {

    chats: [],

    currentChatId: null,

    async init() {

        this.chats =
            await Storage.loadChats();

        console.log(
            "[Chats] loaded",
            this.chats
        );
    },

    async save() {

        await Storage.saveChats(
            this.chats
        );
    },

    async createChat(chat) {

        this.chats.push(chat);

        await this.save();

        console.log(
            "[Chats] created",
            chat
        );
    },

    getChats() {

        return this.chats;
    },

    openChat(chatId) {

        this.currentChatId =
            chatId;

        console.log(
            "[Chats] opened",
            chatId
        );
    },

    getCurrentChat() {

        return this.currentChatId;
    }

};

window.ChatManager =
    ChatManager;
