import { ProfileManager } from "../profile/profile-manager.js";
import { UI } from "../ui/ui.js";
import { UILayout } from "../ui/layout.js";

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
                    id="welcome-name"
                    type="text"
                    placeholder="Введите имя"
                />

                <button
                    id="create-profile"
                >
                    Создать профиль
                </button>

            </div>
        `;

        const input =
            document.getElementById(
                "welcome-name"
            );

        const button =
            document.getElementById(
                "create-profile"
            );

        button.addEventListener(
            "click",
            async () => {

                const name =
                    input.value.trim();

                if (!name) {
                    return;
                }

                await ProfileManager.createProfile();

                await ProfileManager.setUsername(
                    name
                );

                UI.init();

                UILayout.init();

            }
        );
    }

};

window.Welcome = Welcome;
