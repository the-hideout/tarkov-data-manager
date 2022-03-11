class ConsoleTimer {
    constructor(label) {
        this.label = label;
        this.start = new Date();
    }

    end() {
        console.log(`${this.label}: ${(new Date() - this.start) / 1000}s`);
    }
}

module.exports = (label) => {
    return new ConsoleTimer(label);
};
