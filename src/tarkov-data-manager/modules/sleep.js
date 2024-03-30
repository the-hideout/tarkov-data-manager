module.exports = function sleep(ms, signal) {
    return new Promise((resolve) => {
        let timeout;
        const abortFunction = () => {
            clearTimeout(timeout);
            resolve();
        };
        const elapsedFunction = () => {
            if (signal) {
                signal.removeEventListener('abort', abortFunction);
            }
            resolve();
        };
        timeout = setTimeout(elapsedFunction, ms);
        if (signal) {
            signal.addEventListener('abort', abortFunction, {once: true});
        }
    });
}
