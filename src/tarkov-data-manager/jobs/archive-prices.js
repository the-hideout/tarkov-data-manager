const DataJob = require('../modules/data-job');

const max_days_per_run = 1;

class ArchivePricesJob extends DataJob {
    constructor() {
        super('archive-prices');
    }

    async run() {
        // get the archive cutoff
        // start of the current wipe or 30 days ago, whichever is earlier
        const wipes = await this.query('SELECT * FROM wipe ORDER BY start_date desc limit 1');
        const today = new Date();
        let cutoff = new Date(new Date().setDate(today.getDate() - 30));
        if (wipes.length > 0) {
            const currentWipe = wipes[0];
            if (currentWipe.start_date < cutoff) {
                cutoff = currentWipe.start_date;
            }
        }

        // archive max_days_per_run number of days
        for (let i = 0; i < max_days_per_run; i++) {
            // get the price with the oldest timestamp
            let oldestPrice = await this.query('SELECT * FROM price_data WHERE `timestamp` < ? ORDER BY `timestamp` LIMIT 1;', [this.getMysqlDateTime(cutoff)]);
            if (oldestPrice.length === 0) {
                this.logger.success(`No prices found before ${cutoff}`);
                return;
            }
            // convert oldest price date to YYYY-MM-dd
            oldestPrice = this.getMysqlDate(oldestPrice[0].timestamp);

            this.logger.log(`Archiving prices on ${oldestPrice}`);

            // get minimum and average prices per item during day
            const itemPrices = await this.query('SELECT item_id, MIN(price) as min_price, ROUND(AVG(price)) as avg_price FROM price_data WHERE `timestamp` >= ? AND `timestamp` < ? + INTERVAL 1 DAY GROUP BY item_id', [oldestPrice, oldestPrice]);

            // add min and average prices to price archive insert
            const insertValues = [];
            for (const itemPrice of itemPrices) {
                insertValues.push(itemPrice.item_id, oldestPrice, itemPrice.min_price, parseInt(itemPrice.avg_price));
            }

            // insert archived prices
            await this.query(`
                INSERT INTO price_archive
                    (item_id, price_date, price_min, price_avg)
                VALUES
                    ${Object.keys(itemPrices).map(() => '(?, ?, ?, ?)').join(', ')}
                ON DUPLICATE KEY UPDATE
                    price_min=VALUES(price_min), price_avg=VALUES(price_avg)
            `, insertValues);
            this.logger.log(`Inserted ${Object.keys(itemPrices).length} archived prices`);

            // delete archived prices from main price table
            // can only delete 100k at a time, so need to loop
            const batchSize = 100000;
            let deletedCount = 0;
            while (true) {
                const deleteResult = await this.query('DELETE FROM price_data WHERE `timestamp` < ? + INTERVAL 1 DAY LIMIT ?', [oldestPrice, batchSize]);
                deletedCount += deleteResult.affectedRows;
                if (deleteResult.affectedRows < batchSize) {
                    break;
                }
            }
            this.logger.log(`Deleted ${deletedCount} individual prices`);
        }
    }

    // converts js time to YYYY-MM-dd hh:mm:ss
    getMysqlDateTime = (jsDate) => {
        return jsDate.toISOString().slice(0, 19).replace('T', ' ');
    }

    // converts js time to YYYY-MM-dd
    getMysqlDate = (jsDate) => {
        return jsDate.toISOString().slice(0, 10);
    }
}

module.exports = ArchivePricesJob;
