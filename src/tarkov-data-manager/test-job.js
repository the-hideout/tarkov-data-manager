const jobModule = require(`./jobs/${process.argv[2]}`);
console.log(`Running ${process.argv[2]}`);
jobModule();