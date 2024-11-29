import { exec } from 'child_process';

import sevenBin from '7zip-bin'

import discord from '../modules/webhook.mjs';

async function chmod7z() {
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
}

chmod7z();
