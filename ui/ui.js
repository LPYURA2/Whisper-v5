import { RTCManager } from "../network/rtc-manager.js";
import { PeerManager } from "../peers/peer-manager.js";
import { ContactManager } from "../contacts/contact-manager.js";

export const UI = {

    selectedContactId: null,
    
    init() {

        console.log('[UI] initialized');

        const app =
            document.getElementById(
                'app'
            );

        app.innerHTML = `
            <div class="whisper-shell">
                <aside class="sidebar">
                    <h2>Whisper</h2>
                    <div class="peer-list"></div>

                    <button id="add-contact">
                        + Добавить контакт
                    </button>
                </aside>

                <main class="chat-window">
                    <div class="messages"></div>

                    <div class="input-bar">
                        <input
                            type="text"
                            placeholder="Введите сообщение..."
                        />
                        <button>
                            Отправить
                        </button>
                    </div>
                </main>
            </div>
        `;

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
                id.substring(0, 8)
        });

        UI.renderContacts();

        console.log(
            "[UI] contact added"
        );
    }
);

},

    addMessage(text, own = false) {

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

    renderContacts() {

    const contacts =
        ContactManager.getContacts();

    if (!list) {
        return;
    }

    list.innerHTML = "";

    for (const contact of contacts) {

        const div =
            document.createElement(
                "div"
            );

        div.className =
            "contact-item";

        div.textContent =
            contact.name;

        div.addEventListener(
            "click",
            () => {

                UI.selectedContactId =
                    contact.id;

                console.log(
                    "[UI] active chat",
                    contact.id
                );
            }
        );

        list.appendChild(div);
    }
}
};

window.UI = UI;
