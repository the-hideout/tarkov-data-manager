import DataJob from '../modules/data-job.mjs';

const max_days_per_run = 2;

class ArchivePricesJob extends DataJob {
    constructor(options) {
        super({...options, name: 'archive-prices'});
    }

    async run() {
        // get the archive cutoff
        const today = new Date();
        let cutoff = new Date(new Date().setDate(today.getDate() - 30));
        cutoff.setUTCHours(0, 0, 0, 0);

        // archive max_days_per_run number of days
        for (let i = 0; i < max_days_per_run; i++) {
            for (const gameMode of this.gameModes) {
                // get the price with the oldest timestamp
                const oldestPrice = await this.query(`
                    SELECT * FROM price_data 
                    WHERE timestamp < ? AND game_mode = ?
                    ORDER BY timestamp
                    LIMIT 1
                `, [cutoff, gameMode.value]);
                if (oldestPrice.length === 0) {
                    // we don't have any prices before the cutoff
                    // this means archiving is current, so nothing to do
                    this.logger.success(`No ${gameMode.name} prices found before ${cutoff}`);
                    continue;
                }
                // convert oldest price date to YYYY-MM-dd
                // removes hours, mins, etc. to break at the start of the day
                const archiveDate = this.getMysqlDate(oldestPrice[0].timestamp);
    
                this.logger.log(`Archiving ${gameMode.name} prices for ${archiveDate}`);
    
                // get minimum and average prices per item during day
                const itemPrices = await this.query(`
                    SELECT item_id, MIN(price) as min_price, AVG(price) as avg_price 
                    FROM price_data 
                    WHERE timestamp >= ? AND timestamp < ? + INTERVAL 1 DAY AND game_mode = ?
                    GROUP BY item_id
                `, [archiveDate, archiveDate, gameMode.value]);
    
                // add min and average prices to price archive insert
                const insertValues = [];
                for (const itemPrice of itemPrices) {
                    insertValues.push(itemPrice.item_id, archiveDate, itemPrice.min_price, Math.round(itemPrice.avg_price), gameMode.value);
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
                this.logger.log(`Inserted ${Object.keys(itemPrices).length} ${gameMode.name} archived prices in ${new Date() - insertStart}ms`);
    
                // delete the prices we just archived from main price table
                // can only delete 100k at a time, so need to loop
                const batchSize = this.maxQueryRows;
                let deletedCount = 0;
                const deleteStart = new Date();
                while (true) {
                    const deleteResult = await this.query(`
                        DELETE FROM price_data 
                        WHERE timestamp < ? + INTERVAL 1 DAY AND game_mode = ?
                        LIMIT ?
                    `, [archiveDate, gameMode.value, batchSize]);
                    deletedCount += deleteResult.affectedRows;
                    if (deleteResult.affectedRows < batchSize) {
                        break;
                    }
                }
                this.logger.log(`Deleted ${deletedCount} individual ${gameMode.name} prices in ${new Date() - deleteStart}ms`);
            }
        }
    }

    // converts js time to YYYY-MM-dd
    getMysqlDate = (jsDate) => {
        return jsDate.toISOString().slice(0, 10);
    }
}

export default ArchivePricesJob;
