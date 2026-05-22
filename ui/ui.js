export const UI = {
  init() {
    console.log('[UI] initialized');

    const app = document.getElementById('app');

    app.innerHTML = `
      <div class="whisper-shell">
        <aside class="sidebar">
          <h2>Whisper</h2>
          <div class="peer-list">No peers connected</div>
        </aside>

        <main class="chat-window">
          <div class="messages"></div>

          <div class="input-bar">
            <input type="text" placeholder="Type message..." />
            <button>Send</button>
          </div>
        </main>
      </div>
    `;
  },

addMessage(text, own = false) {

    console.log(
        "[UI] addMessage",
        text
    );

    const messages =
        document.querySelector(
            '.messages'
        );

    if (!messages) {

        console.error(
            "[UI] messages container missing"
        );

        return;
    }

    const div =
        document.createElement(
            'div'
        );

    div.className =
        own
        ? 'message own'
        : 'message';

    div.textContent = text;

    messages.appendChild(div);
},
};
