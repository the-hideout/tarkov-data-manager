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

            // query results are limited to 100k, so query as many times as needed
            const oldestPrices = [];
            const batchSize = 100000;
            let offset = 0;
            while (true) {
                const moreData = await this.query('SELECT * FROM price_data WHERE `timestamp` >= ? AND `timestamp` < ? + INTERVAL 1 DAY LIMIT ?, 100000', [oldestPrice, oldestPrice, offset]);
                oldestPrices.push(...moreData);
                if (moreData.length < batchSize) {
                    break;
                }
                offset += batchSize;
            }
            this.logger.log(`Found ${oldestPrices.length} prices to archive on ${oldestPrice}`);

            // convert prices for each item into arrays
            const itemPrices = {};
            for (const scan of oldestPrices) {
                if (typeof itemPrices[scan.item_id] === 'undefined') {
                    itemPrices[scan.item_id] = [];
                }
                itemPrices[scan.item_id].push(scan.price);
            }

            // generate values for the price archive insert
            const insertValues = [];
            for (const itemId in itemPrices) {
                const minPrice = itemPrices[itemId].reduce((min, price) => {
                    return Math.min(min, price);
                }, Number.MAX_SAFE_INTEGER);
                const avgPrice = Math.round(itemPrices[itemId].reduce((total, price) => {
                    return total + price;
                }, 0) / itemPrices[itemId].length);
                insertValues.push(itemId, oldestPrice, minPrice, avgPrice);
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
            while (true) {
                const deleteResult = await this.query('DELETE FROM price_data WHERE `timestamp` < ? + INTERVAL 1 DAY LIMIT 100000', [oldestPrice]);
                if (deleteResult.affectedRows === 0) {
                    break;
                }
            }
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
