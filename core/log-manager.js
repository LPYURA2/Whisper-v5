const MAX_LOGS = 500;

export const LogManager = {

    logs: [],

    listeners: [],

    originalConsole: null,

    initialized: false,

    init() {

        if (this.initialized) {
            return;
        }

        this.initialized = true;

        this.originalConsole = {

            log:
                console.log.bind(console),

            warn:
                console.warn.bind(console),

            error:
                console.error.bind(console)
        };

        const manager = this;

        console.log = function (...args) {

            manager.originalConsole.log(
                ...args
            );

            manager.add(
                "INFO",
                args
            );
        };

        console.warn = function (...args) {

            manager.originalConsole.warn(
                ...args
            );

            manager.add(
                "WARN",
                args
            );
        };

        console.error = function (...args) {

            manager.originalConsole.error(
                ...args
            );

            manager.add(
                "ERROR",
                args
            );
        };

        this.originalConsole.log(
            "[LogManager] initialized"
        );
    },

    add(
        level,
        args
    ) {

        const entry = {

            time:
                new Date().toLocaleTimeString(),

            level,

            message:
                args
                    .map((value) => {

                        if (
                            typeof value ===
                            "string"
                        ) {

                            return value;
                        }

                        try {

                            return JSON.stringify(
                                value
                            );

                        } catch {

                            return String(
                                value
                            );
                        }
                    })
                    .join(" ")
        };

        this.logs.push(
            entry
        );

        if (
            this.logs.length >
            MAX_LOGS
        ) {

            this.logs.shift();
        }

        for (
            const listener
            of this.listeners
        ) {

            try {

                listener(entry);

            } catch (error) {

                /*
                 * Не используем console.error здесь,
                 * иначе получим рекурсию.
                 */

                if (
                    this.originalConsole
                ) {

                    this.originalConsole.error(
                        "[LogManager] listener error",
                        error
                    );
                }
            }
        }
    },

    getLogs() {

        return [
            ...this.logs
        ];
    },

    subscribe(listener) {

        this.listeners.push(
            listener
        );

        return () => {

            this.listeners =
                this.listeners.filter(
                    (item) =>
                        item !== listener
                );
        };
    },

    clear() {

        this.logs = [];

        for (
            const listener
            of this.listeners
        ) {

            try {

                listener({
                    clear: true
                });

            } catch (error) {

                if (
                    this.originalConsole
                ) {

                    this.originalConsole.error(
                        "[LogManager] clear listener error",
                        error
                    );
                }
            }
        }
    }
};

window.LogManager =
    LogManager;
