import dotenv from 'dotenv';

if (process.env.NODE_ENV !== 'production') {
    //const dotenv = await import('dotenv');
    dotenv.config({path : './creds.env'});
    dotenv.config({path : './config.env'});
    process.env.NODE_ENV = 'dev';
}