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
    }

};

window.Welcome = Welcome;
