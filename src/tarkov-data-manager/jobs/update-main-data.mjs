import DataJob from '../modules/data-job.mjs';
import tarkovData from '../modules/tarkov-data.mjs';
import tarkovDevData from '../modules/tarkov-data-tarkov-dev.mjs';
import gameModes from '../modules/game-modes.mjs';
import mData from '../modules/tarkov-data-md.mjs';

class UpdateMainDataJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-main-data'});
        this.saveFields.push('failedLastRun');
        this.failedLastRun = {};
        for (const gameMode of gameModes) {
            this.failedLastRun[gameMode.name] = new Set();
        }
        this.failedLastRun.global = new Set();
    }

    async run() {
        const services = await tarkovData.status().then(status => status.services).catch(error => {
            this.logger.error(`Error getting EFT services status: ${error.message}`);
            return [];
        });

        const tradingService = services.find(s => s.name === 'Trading');
        const scannersStatus = await tarkovDevData.scannersStatus().catch(error => {
            this.logger.error(`Error getting scanenrs status: ${error.message}`);
            return {};
        });
        const launchedScanners = Object.values(scannersStatus).reduce((total, scanner) => {
            const availableStatuses = [
                'scanning',
                'idle',
                'paused'
            ];
            const validGameModes = [
                'regular',
                'pve',
            ];
            if (validGameModes.includes(scanner.gameMode) && availableStatuses.includes(scanner.status)) {
                total++;
            }
            return total;
        }, 0);
        /*if (tradingService?.status === 1 && launchedScanners === 0) {
            this.logger.log('Game is updating, skipping data update');
            return;
        }*/

        const returnValue = {};
        this.logger.time('data-download');
        const reqs = [
            tarkovData.mapDetails({download: true}).then(mapDetails => {
                this.failedLastRun.global.delete('map-details');
                this.logger.success(`Downloaded map details: ${Object.keys(mapDetails).join(', ')}`);
            }).catch(error => {
                this.logger.error(`Error downloading map-details: ${error.message}`);
                if (this.failedLastRun.global.has('map-details')) {
                    this.addJobSummary(`map-details: ${error.message}`, 'Error(s) updating data');
                } else {
                    this.failedLastRun.global.add('map-details');
                }
            }),
            tarkovData.botsHealth({download: true}).then(botsHealth => {
                this.failedLastRun.global.delete('bots-health');
                this.logger.success(`Downloaded bots health: ${botsHealth.groups.length}`);
            }).catch(error => {
                this.logger.error(`Error downloading bots-health: ${error.message}`);
                if (this.failedLastRun.global.has('bots-health')) {
                    this.addJobSummary(`bots-health: ${error.message}`, 'Error(s) updating data');
                } else {
                    this.failedLastRun.global.add('bots-health');
                }
            }),
            tarkovData.botsInfo({download: true}).then(botsInfo => {
                this.failedLastRun.global.delete('bots-info');
                this.logger.success(`Downloaded bots info: ${botsInfo.groups.length}`);
            }).catch(error => {
                this.logger.error(`Error downloading bots-info: ${error.message}`);
                if (this.failedLastRun.global.has('bots-info')) {
                    this.addJobSummary(`bots-info: ${error.message}`, 'Error(s) updating data');
                } else {
                    this.failedLastRun.global.add('bots-info');
                }
            }),
            tarkovData.botGroups({download: true}).then(botGroups => {
                this.failedLastRun.global.delete('bot-groups');
                this.logger.success(`Downloaded bot groups: ${botGroups.groups.length}`);
            }).catch(error => {
                this.logger.error(`Error downloading bot-groups: ${error.message}`);
                if (this.failedLastRun.global.has('bot-groups')) {
                    this.addJobSummary(`bot-groups: ${error.message}`, 'Error(s) updating data');
                } else {
                    this.failedLastRun.global.add('bot-groups');
                }
            }),
        ];
        for (const gameMode of gameModes) {
            this.logger.log(`Downloading ${gameMode.name} data...`);
            
            reqs.push(tarkovData.downloadAll({returnErrors: true, gameMode: gameMode.name}).then(results => {
                const errors = results.errors;
                results.errors = undefined;
                if (Object.keys(results).length > 0) {
                    this.logger.success(`Downloaded ${gameMode.name}: ${Object.keys(results).filter(key => key !== 'errors').map(file => {
                        this.failedLastRun[gameMode.name].delete(file);
                        return file;
                    }).join(', ')}`);
                }
                if (errors) {
                    this.logger.warn(`Error downloading ${gameMode.name} data: ${Object.keys(errors).map(file => `${file}: ${errors[file].message}`).join(', ')}`);
                    Object.keys(errors).forEach(file => {
                        if (this.failedLastRun[gameMode.name].has(file)) {
                            this.addJobSummary(`${file}: ${errors[file].message}`, `Error(s) updating ${gameMode.name} data`);
                        } else {
                            this.failedLastRun[gameMode.name].add(file);
                        }
                    });
                }
                returnValue[gameMode.name] = results;
                return results;
            }));
        }
        this.logger.log('Downloading languages...');
        reqs.push(mData.locales({download: true}).then(locales => {
            this.failedLastRun.global.delete('locales');
            this.logger.success(`Downloaded languages: ${Object.keys(locales).join(', ')}`);
        }).catch(error => {
            this.logger.error(`Error downloading languages: ${error.message}`);
            if (this.failedLastRun.global.has('locales')) {
                this.addJobSummary(`locales: ${error.message}`, 'Error(s) updating data');
            } else {
                this.failedLastRun.global.add('locales');
            }
        }));
        await Promise.all(reqs);
        this.logger.timeEnd('data-download');
        return returnValue;
    }
}

export default UpdateMainDataJob;
