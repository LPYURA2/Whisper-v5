import { ProfileManager } from "../profile/profile-manager.js";
import { startMessenger } from "./start-messenger.js";

export const Welcome = {

    show() {

        const app =
            document.getElementById(
                "app"
            );

        app.innerHTML = `
            <div class="welcome-screen">

                <h1>Whisper</h1>

                <p>
                    Добро пожаловать!
                </p>

                <input
                    id="username"
                    type="text"
                    placeholder="Введите ваше имя"
                />

                <button id="continue">
                    Войти
                </button>

            </div>
        `;

        const input =
            document.getElementById(
                "username"
            );

        const button =
            document.getElementById(
                "continue"
            );

        button.addEventListener(
            "click",
            async () => {

                const username =
                    input.value.trim();

                if (!username) {

                    alert(
                        "Введите имя"
                    );

                    return;
                }

                await ProfileManager.createProfile(
                    username
                );

                await startMessenger();
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
    }
};

window.Welcome = Welcome;
