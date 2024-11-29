import { exec } from 'child_process';

import sevenBin from '7zip-bin'

import {query} from '../modules/db-connection.mjs';
import discord from '../modules/webhook.mjs';

async function waitForDb() {
    const maxAttempts = 300;
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const data = await query('SELECT count(*) FROM wipe');

            // if data is not empty, the query was successful
            if (data) {
              console.log(data);
              console.log('Database is ready');
              if (!sevenBin.path7za.endsWith('.exe')) {
                await new Promise((resolve, reject) => {
                  exec(`chmod +x ${sevenBin.path7za}`, (error, stdout, stderr) => {
                    if (error) {
                      console.error(`exec error: ${error}`);
                      resolve(discord.alert({
                        title: 'Error setting 7z executable mode',
                        message: error.stack,
                      }));
                      return;
                    }
                    console.log(`stdout: ${stdout}`);
                    console.error(`stderr: ${stderr}`);
                    resolve();
                  });
                });
              }
              process.exit(0);
            } else {
              console.log('Database not ready yet, retrying in 1 second');
              await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second before the next attempt
            }

        } catch (error) {
            console.error(`Database not ready yet, retrying in 1 second - error: ${error}`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second before the next attempt
        }
    }

    console.log(`Database not ready after ${maxAttempts} attempts`);
    process.exit(1);
}

waitForDb();
