const cron = require('node-cron')
const { spawn } = require('child_process');
const fs = require('fs');
const { BlobServiceClient } = require("@azure/storage-blob");

const fileName = 'dump.sql.gz'
const containerName = 'database-backups'
const uploadOptions = {
    tier: 'Cold',
}

async function upload() {
    const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(fileName);

    await blockBlobClient.uploadFile(fileName, uploadOptions);
}

// run twice a day at 1am and 12pm
// '*/15 * * * *' runs every 15 minutes for testing
cron.schedule('*/5 * * * *', () => {
    try {
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

        new Promise((resolve, reject) => {
            dump.on('close', (code) => {
              if (code !== 0) {
                console.log(`mysqldump process exited with code ${code}`);
                reject(new Error(`mysqldump process exited with code ${code}`));
              } else {
                console.log('mysqldump process finished successfully');
                gzip.on('close', (code) => {
                  if (code !== 0) {
                    console.log(`gzip process exited with code ${code}`);
                    reject(new Error(`gzip process exited with code ${code}`));
                  } else {
                    console.log('gzip process finished successfully');
                    resolve();
                  }
                });
              }
            });
          }).then(() => {
            console.log(`backup file: ${fileName}`);
            console.log('uploading backup file to Azure Blob Storage');
            return upload();
          }).then(() => {
            console.log('upload complete');
            console.log('database backup cron job finished successfully');
          }).catch((error) => {
            console.error('error during backup or upload:', error);
            console.log('database backup cron job finished with errors');
          });
    } catch (error) {
        console.error('error during backup:', error);
        console.log('database backup cron job finished with errors')
    }
})
