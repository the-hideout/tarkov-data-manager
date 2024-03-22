const cron = require('node-cron')
const { spawn } = require('child_process');
const fs = require('fs');

const fileName = 'dump.sql.gz'

cron.schedule('* * * * *', () => {
    console.log('running database backup cron job')

    const dump = spawn('mysqldump', [
        '-u', process.env.DB_USER,
        '-h', process.env.DATABASE_HOST,
        '--ssl',
        '-p' + process.env.DB_PASS,
        process.env.DATABASE_NAME
    ]);

    const gzip = spawn('gzip');

    dump.stdout.pipe(gzip.stdin);
    gzip.stdout.pipe(fs.createWriteStream(fileName));

    dump.stderr.on('data', (data) => {
        console.error(`mysqldump stderr: ${data}`);
    });

    gzip.stderr.on('data', (data) => {
        console.error(`gzip stderr: ${data}`);
    });

    dump.on('close', (code) => {
        if (code !== 0) {
            console.log(`mysqldump process exited with code ${code}`);
        }
    });

    gzip.on('close', (code) => {
        if (code !== 0) {
            console.log(`gzip process exited with code ${code}`);
        }
    });

    console.log('database backup cron job finished')
    console.log(`backup file: ${fileName}`)
    console.log('backup file size: ' + fs.statSync(fileName).size + ' bytes')
})
