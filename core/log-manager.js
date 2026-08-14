const MAX_LOGS = 500;

export const LogManager = {

    logs: [],

    listeners: [],

    init() {

        console.log(
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

                console.error(
                    "[LogManager] listener error",
                    error
                );
            }
        }
    },

    info(...args) {

        console.log(...args);

        this.add(
            "INFO",
            args
        );
    },

    warn(...args) {

        console.warn(...args);

        this.add(
            "WARN",
            args
        );
    },

    error(...args) {

        console.error(...args);

        this.add(
            "ERROR",
            args
        );
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

            } catch {}
        }
    }
};

window.LogManager =
    LogManager;
