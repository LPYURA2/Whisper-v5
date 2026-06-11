import { RTCManager } from "../network/rtc-manager.js";
import { PeerManager } from "../peers/peer-manager.js";

export const UI = {
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

                const peers =
                    PeerManager.getPeers();

                if (peers.length === 0) {

                    console.error(
                        "[UI] no peers"
                    );

                    return;
                }

                RTCManager.sendMessage(
                    peers[0],
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
    }
};

window.UI = UI;
