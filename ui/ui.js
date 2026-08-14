import { RTCManager } from "../network/rtc-manager.js";
import { PeerManager } from "../peers/peer-manager.js";
import { ContactManager } from "../contacts/contact-manager.js";
import { ProfileManager } from "../profile/profile-manager.js";
import { LogManager } from "../core/log-manager.js";

export const UI = {

    selectedContactId: null,

    currentScreen: "main",

    logsUnsubscribe: null,

    init() {

        console.log("[UI] initialized");

        this.showMainScreen();
    },

    /*
     * =====================================================
     * MAIN SCREEN
     * =====================================================
     */

    showMainScreen() {

        this.currentScreen = "main";

        this.unsubscribeLogs();

        const app =
            document.getElementById(
                "app"
            );

        const profile =
            ProfileManager.getProfile();

        if (!profile) {

            console.error(
                "[UI] profile not found"
            );

            return;
        }

        app.innerHTML = `

            <div class="whisper-shell">

                <aside class="sidebar">

                    <h2>Whisper</h2>

                    <!-- PROFILE -->

                    <div class="profile-block">

                        <div class="profile-name">
                            ${profile.username || "anonymous"}
                        </div>

                        <div class="profile-label">
                            Whisper ID
                        </div>

                        <div class="profile-id">
                            ${profile.id}
                        </div>

                        <button
                            id="copy-profile-id"
                            type="button"
                        >
                            Копировать ID
                        </button>

                    </div>

                    <!-- CONTACTS -->

                    <div class="peer-list"></div>

                    <button
                        id="add-contact"
                        type="button"
                    >
                        + Добавить контакт
                    </button>

                    <!-- SETTINGS -->

                    <button
                        id="open-settings"
                        type="button"
                    >
                        ⚙ Настройки
                    </button>

                </aside>

                <main class="chat-window">

                    <div class="messages"></div>

                    <div class="input-bar">

                        <input
                            type="text"
                            placeholder="Введите сообщение..."
                        />

                        <button type="button">
                            Отправить
                        </button>

                    </div>

                </main>

            </div>
        `;

        /*
         * ==========================
         * COPY PROFILE ID
         * ==========================
         */

        const copyProfileIdButton =
            document.getElementById(
                "copy-profile-id"
            );

        copyProfileIdButton.addEventListener(
            "click",
            async () => {

                try {

                    await navigator.clipboard.writeText(
                        profile.id
                    );

                    copyProfileIdButton.textContent =
                        "ID скопирован";

                    setTimeout(() => {

                        copyProfileIdButton.textContent =
                            "Копировать ID";

                    }, 1500);

                    console.log(
                        "[UI] profile ID copied"
                    );

                } catch (error) {

                    console.error(
                        "[UI] failed to copy profile ID",
                        error
                    );
                }
            }
        );

        /*
         * ==========================
         * MESSAGE INPUT
         * ==========================
         */

        const input =
            document.querySelector(
                ".input-bar input"
            );

        const button =
            document.querySelector(
                ".input-bar button"
            );

        button.addEventListener(
            "click",
            () => {

                const text =
                    input.value.trim();

                if (!text) {
                    return;
                }

                if (!UI.selectedContactId) {

                    console.error(
                        "[UI] no active chat"
                    );

                    return;
                }

                RTCManager.sendMessage(
                    UI.selectedContactId,
                    text
                );

                input.value = "";
            }
        );

        input.addEventListener(
            "keydown",
            (event) => {

                if (
                    event.key === "Enter"
                ) {

                    button.click();
                }
            }
        );

        /*
         * ==========================
         * ADD CONTACT
         * ==========================
         */

        const addContactButton =
            document.getElementById(
                "add-contact"
            );

        addContactButton.addEventListener(
            "click",
            () => {

                const id =
                    prompt(
                        "Введите Whisper ID"
                    );

                if (!id) {
                    return;
                }

                ContactManager.addContact({

                    id,

                    name:
                        id.substring(
                            0,
                            8
                        )
                });

                UI.renderContacts();

                console.log(
                    "[UI] contact added"
                );

                /*
                 * После добавления контакта
                 * начинаем попытку соединения.
                 */

                PeerManager.connect(
                    id
                );
            }
        );

        /*
         * ==========================
         * SETTINGS
         * ==========================
         */

        const settingsButton =
            document.getElementById(
                "open-settings"
            );

        settingsButton.addEventListener(
            "click",
            () => {

                UI.showSettings();
            }
        );

        /*
         * ==========================
         * INITIAL CONTACTS
         * ==========================
         */

        UI.renderContacts();
    },

    /*
     * =====================================================
     * SETTINGS
     * =====================================================
     */

    showSettings() {

        this.currentScreen =
            "settings";

        this.unsubscribeLogs();

        const app =
            document.getElementById(
                "app"
            );

        app.innerHTML = `

            <div class="whisper-shell">

                <aside class="sidebar settings-screen">

                    <button
                        id="settings-back"
                        type="button"
                    >
                        ← Назад
                    </button>

                    <h2>Настройки</h2>

                    <div class="settings-list">

                        <button
                            id="open-logs"
                            type="button"
                        >
                            📋 Логи
                        </button>

                    </div>

                </aside>

            </div>
        `;

        const backButton =
            document.getElementById(
                "settings-back"
            );

        backButton.addEventListener(
            "click",
            () => {

                UI.showMainScreen();
            }
        );

        const logsButton =
            document.getElementById(
                "open-logs"
            );

        logsButton.addEventListener(
            "click",
            () => {

                UI.showLogs();
            }
        );
    },

    /*
     * =====================================================
     * LOGS SCREEN
     * =====================================================
     */

    showLogs() {

        this.currentScreen =
            "logs";

        this.unsubscribeLogs();

        const app =
            document.getElementById(
                "app"
            );

        app.innerHTML = `

            <div class="whisper-shell">

                <main class="logs-screen">

                    <div class="logs-header">

                        <button
                            id="logs-back"
                            type="button"
                        >
                            ← Назад
                        </button>

                        <h2>Логи</h2>

                        <button
                            id="clear-logs"
                            type="button"
                        >
                            Очистить
                        </button>

                    </div>

                    <div
                        id="logs-container"
                        class="logs-container"
                    ></div>

                </main>

            </div>
        `;

        const container =
            document.getElementById(
                "logs-container"
            );

        /*
         * ==========================
         * RENDER EXISTING LOGS
         * ==========================
         */

        const existingLogs =
            LogManager.getLogs();

        for (
            const entry
            of existingLogs
        ) {

            UI.renderLogEntry(
                entry
            );
        }

        /*
         * ==========================
         * LIVE LOGGING
         * ==========================
         */

        this.logsUnsubscribe =
            LogManager.subscribe(
                (entry) => {

                    if (
                        UI.currentScreen !==
                        "logs"
                    ) {

                        return;
                    }

                    if (
                        entry.clear
                    ) {

                        container.innerHTML =
                            "";

                        return;
                    }

                    UI.renderLogEntry(
                        entry
                    );
                }
            );

        /*
         * ==========================
         * BACK
         * ==========================
         */

        const backButton =
            document.getElementById(
                "logs-back"
            );

        backButton.addEventListener(
            "click",
            () => {

                UI.showSettings();
            }
        );

        /*
         * ==========================
         * CLEAR
         * ==========================
         */

        const clearButton =
            document.getElementById(
                "clear-logs"
            );

        clearButton.addEventListener(
            "click",
            () => {

                LogManager.clear();
            }
        );
    },

    /*
     * =====================================================
     * RENDER ONE LOG ENTRY
     * =====================================================
     */

    renderLogEntry(entry) {

        const container =
            document.getElementById(
                "logs-container"
            );

        if (!container) {
            return;
        }

        const div =
            document.createElement(
                "div"
            );

        div.className =
            "log-entry log-" +
            entry.level.toLowerCase();

        div.textContent =
            `[${entry.time}] ` +
            `[${entry.level}] ` +
            entry.message;

        container.appendChild(
            div
        );

        /*
         * Всегда показываем самые свежие записи.
         */

        container.scrollTop =
            container.scrollHeight;
    },

    /*
     * =====================================================
     * UNSUBSCRIBE LOGS
     * =====================================================
     */

    unsubscribeLogs() {

        if (
            this.logsUnsubscribe
        ) {

            this.logsUnsubscribe();

            this.logsUnsubscribe =
                null;
        }
    },

    /*
     * =====================================================
     * MESSAGES
     * =====================================================
     */

    addMessage(
        text,
        own = false
    ) {

        console.log(
            "[UI] addMessage",
            text
        );

        const messages =
            document.querySelector(
                ".messages"
            );

        if (!messages) {

            console.error(
                "[UI] messages container missing"
            );

            return;
        }

        const div =
            document.createElement(
                "div"
            );

        div.className =
            own
                ? "message own"
                : "message";

        div.textContent =
            text;

        messages.appendChild(
            div
        );
    },

    /*
     * =====================================================
     * CONTACTS
     * =====================================================
     */

    renderContacts() {

        const contacts =
            ContactManager.getContacts();

        const list =
            document.querySelector(
                ".peer-list"
            );

        if (!list) {
            return;
        }

        list.innerHTML = "";

        for (
            const contact
            of contacts
        ) {

            const div =
                document.createElement(
                    "div"
                );

            div.className =
                "contact-item";

            div.textContent =
                contact.name;

            /*
             * ACTIVE CHAT
             */

            if (
                contact.id ===
                UI.selectedContactId
            ) {

                div.classList.add(
                    "active"
                );
            }

            div.addEventListener(
                "click",
                () => {

                    UI.selectedContactId =
                        contact.id;

                    console.log(
                        "[UI] active chat",
                        contact.id
                    );

                    UI.renderContacts();
                }
            );

            list.appendChild(
                div
            );
        }
    }
};

window.UI = UI;
