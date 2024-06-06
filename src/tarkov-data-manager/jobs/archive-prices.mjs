import DataJob from '../modules/data-job.mjs';

const max_days_per_run = 1;

class ArchivePricesJob extends DataJob {
    constructor() {
        super('archive-prices');
    }

    async run() {
        // get the archive cutoff
        const today = new Date();
        let cutoff = new Date(new Date().setDate(today.getDate() - 30));
        cutoff.setUTCHours(0, 0, 0, 0);
        // if we wanted to keep all prices since start of wipe
        /*const wipes = await this.query('SELECT * FROM wipe ORDER BY start_date desc limit 1');
        if (wipes.length > 0) {
            const currentWipe = wipes[0];
            if (currentWipe.start_date < cutoff) {
                cutoff = currentWipe.start_date;
            }
        }*/

        // archive max_days_per_run number of days
        for (let i = 0; i < max_days_per_run; i++) {
            for (let gameMode = 0; gameMode < 2; gameMode++) {
                const gameModeName = gameMode ? 'pve' : 'regular';
                // get the price with the oldest timestamp
                const oldestPrice = await this.query(`
                    SELECT * FROM price_data 
                    WHERE timestamp < ? AND game_mode = ?
                    ORDER BY timestamp
                    LIMIT 1
                `, [cutoff, gameMode]);
                if (oldestPrice.length === 0) {
                    this.logger.success(`No ${gameModeName} prices found before ${cutoff}`);
                    return;
                }
                // convert oldest price date to YYYY-MM-dd
                const archiveDate = this.getMysqlDate(oldestPrice[0].timestamp);
    
                this.logger.log(`Archiving ${gameModeName} prices for ${archiveDate}`);
    
                // get minimum and average prices per item during day
                const itemPrices = await this.query(`
                    SELECT item_id, MIN(price) as min_price, AVG(price) as avg_price 
                    FROM price_data 
                    WHERE timestamp >= ? AND timestamp < ? + INTERVAL 1 DAY AND game_mode = ?
                    GROUP BY item_id
                `, [archiveDate, archiveDate, gameMode]);
    
                // add min and average prices to price archive insert
                const insertValues = [];
                for (const itemPrice of itemPrices) {
                    insertValues.push(itemPrice.item_id, archiveDate, itemPrice.min_price, Math.round(itemPrice.avg_price), gameMode);
                }
    
                // insert archived prices
                const insertStart = new Date();
                await this.query(`
                    INSERT INTO price_archive
                        (item_id, price_date, price_min, price_avg, game_mode)
                    VALUES
                        ${Object.keys(itemPrices).map(() => '(?, ?, ?, ?, ?)').join(', ')}
                    ON DUPLICATE KEY UPDATE
                        price_min=VALUES(price_min), price_avg=VALUES(price_avg)
                `, insertValues);
                this.logger.log(`Inserted ${Object.keys(itemPrices).length} ${gameModeName} archived prices in ${new Date() - insertStart}ms`);
    
                // delete the prices we just archived
                await this.deletePricesThrough(archiveDate);
            }
        }
    }

    // converts js time to YYYY-MM-dd
    getMysqlDate = (jsDate) => {
        return jsDate.toISOString().slice(0, 10);
    }

    // deletes all prices through the given YYY-MM-dd date
    deletePricesThrough = async (mysqlDateCutoff, gameMode) => {
        // delete archived prices from main price table
        // can only delete 100k at a time, so need to loop
        const batchSize = this.maxQueryRows;
        let deletedCount = 0;
        const deleteStart = new Date();
        while (true) {
            const deleteResult = await this.query(`
                DELETE FROM price_data 
                WHERE timestamp < ? + INTERVAL 1 DAY AND game_mode = ?
                LIMIT ?
            `, [mysqlDateCutoff, gameMode, batchSize]);
            deletedCount += deleteResult.affectedRows;
            if (deleteResult.affectedRows < batchSize) {
                break;
            }
        }
        this.logger.log(`Deleted ${deletedCount} individual prices in ${new Date() - deleteStart}ms`);
    }
}

export default ArchivePricesJob;
